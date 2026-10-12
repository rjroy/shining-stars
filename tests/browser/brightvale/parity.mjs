import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const output = path.join(root, '.lore/local/evidence/brightvale-runtime');
await mkdir(output, { recursive: true });

function screenshotText(imagePath, label, expected) {
  const rect = {
    x: Math.max(
      0,
      Math.floor(label.screenCenter.x - label.screenSize.width / 2),
    ),
    y: Math.max(
      0,
      Math.floor(label.screenCenter.y - label.screenSize.height / 2),
    ),
    width: Math.ceil(label.screenSize.width),
    height: Math.ceil(label.screenSize.height),
  };
  const crop = spawnSync(
    'magick',
    [
      imagePath,
      '-crop',
      `${rect.width}x${rect.height}+${rect.x}+${rect.y}`,
      '+repage',
      '-filter',
      'point',
      '-resize',
      '800%',
      'png:-',
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  if (crop.status !== 0)
    throw new Error(`Could not crop ${label.name} from ${imagePath}`);
  const text = spawnSync('tesseract', ['stdin', 'stdout', '--psm', '7'], {
    input: crop.stdout,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (text.status !== 0)
    throw new Error(`Could not OCR ${label.name} from ${imagePath}`);
  return {
    label: label.name,
    image: path.basename(imagePath),
    rect,
    expected: expected.source,
    recognizedText: text.stdout.trim(),
    readable: expected.test(text.stdout),
  };
}
const scratch = `/tmp/opencode/brightvale-parity-${process.pid}`;
await mkdir(scratch, { recursive: true });
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
const vitePort = await freePort();
const debugPort = await freePort();
const server = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    root,
    '--host',
    '127.0.0.1',
    '--port',
    String(vitePort),
    '--strictPort',
  ],
  {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, VITE_SONG_VOLUME: '0' },
  },
);
let serverLog = '';
server.stderr.setEncoding('utf8').on('data', (text) => (serverLog += text));
let browser;
let browserLog = '';
let socket;
let sequence = 0;
const pending = new Map();
const browserEvents = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function cdp(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  return result.result?.value;
}
let failure;
let parity;
try {
  const base = `http://127.0.0.1:${vitePort}/tests/browser/brightvale/scene-parity.html`;
  await waitFor(async () => {
    try {
      return (
        await fetch(
          base.replace('/tests/browser/brightvale/scene-parity.html', '/'),
        )
      ).ok;
    } catch {
      return false;
    }
  }, 'Vite server');
  browser = spawn(
    '/usr/bin/chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--mute-audio',
      '--hide-scrollbars',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(scratch, 'profile')}`,
      '--window-size=1600,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  browser.stderr.setEncoding('utf8').on('data', (text) => (browserLog += text));
  const target = await waitFor(async () => {
    try {
      return (
        await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      ).find((item) => item.type === 'page');
    } catch {
      return false;
    }
  }, 'Chromium target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      if (message.method === 'Runtime.consoleAPICalled')
        browserEvents.push({
          type: 'console',
          level: message.params.type,
          args: message.params.args?.map((arg) => arg.value ?? arg.description),
        });
      else if (message.method === 'Runtime.exceptionThrown')
        browserEvents.push({
          type: 'exception',
          details: message.params.exceptionDetails?.text,
        });
      return;
    }
    const item = pending.get(message.id);
    pending.delete(message.id);
    message.error
      ? item.reject(new Error(message.error.message))
      : item.resolve(message.result);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const setViewport = async (width, height) => {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      () => evaluate(`innerWidth===${width}&&innerHeight===${height}`),
      `viewport ${width}x${height}`,
    );
  };
  await setViewport(1600, 900);
  await cdp('Page.navigate', {
    url: `http://127.0.0.1:${vitePort}/tests/browser/brightvale/scene-parity.html`,
  });
  await waitFor(async () => {
    const state = await evaluate(
      'window.__brightvaleParityError ? {error:window.__brightvaleParityError} : window.__brightvaleParityReady ? true : false',
    );
    if (state?.error) throw new Error(state.error);
    return state;
  }, 'production UI and runtime GLBs loaded');
  const reference = await evaluate('window.__brightvaleRunViewport(1600,900)');
  const referenceOverlayDataUrl = reference.firstFrameOverlayPixels.webpDataUrl;
  delete reference.firstFrameOverlayPixels.webpDataUrl;
  await writeFile(
    path.join(output, 'parity-overlay-first-reference.webp'),
    Buffer.from(referenceOverlayDataUrl.split(',')[1], 'base64'),
  );
  await setViewport(1120, 700);
  const narrow = await evaluate('window.__brightvaleRunViewport(1120,700)');
  const narrowOverlayDataUrl = narrow.firstFrameOverlayPixels.webpDataUrl;
  delete narrow.firstFrameOverlayPixels.webpDataUrl;
  await writeFile(
    path.join(output, 'parity-overlay-after-resize-narrow.webp'),
    Buffer.from(narrowOverlayDataUrl.split(',')[1], 'base64'),
  );
  const overlayTextOCR = [
    {
      viewport: 'reference-first-frame',
      image: path.join(output, 'parity-overlay-first-reference.webp'),
      sample: reference,
    },
    {
      viewport: 'narrow-after-resize',
      image: path.join(output, 'parity-overlay-after-resize-narrow.webp'),
      sample: narrow,
    },
  ].map(({ viewport, image, sample }) => {
    const labels = sample.firstFrameOverlayPixels.labels;
    const find = (name) => labels.find((label) => label.name === name);
    const legend = find('legend');
    const hit = find('hit');
    if (!legend || !hit)
      throw new Error(`${viewport} overlay is missing legend or HIT label`);
    return {
      viewport,
      legend: screenshotText(image, legend, /good[\s\S]*perfect/i),
      hit: screenshotText(image, hit, /hit/i),
    };
  });
  parity = {
    fixtureType:
      'production createGameUI + createBrightvaleScene facade + runtime GLBs; synthetic chart snapshots, not actual audio gameplay',
    sourceCameraComparedToLive:
      'The live app camera is not exposed to the external proof. Matrices below are from the same production scene facade, UI factory, measured slots, and viewport dimensions; no direct live-camera matrix parity claim.',
    cameraMatrixStability: {
      notePopulation: {
        referenceMaxElementDelta: reference.camera.notePopulationMaxMatrixDelta,
        narrowMaxElementDelta: narrow.camera.notePopulationMaxMatrixDelta,
      },
      modeChange: {
        referenceMaxElementDelta: reference.camera.modeChangeMatrixDelta,
        narrowMaxElementDelta: narrow.camera.modeChangeMatrixDelta,
      },
      tolerance: 1e-6,
    },
    viewports: { reference, narrow },
  };
  const normal = JSON.parse(
    await readFile(path.join(output, 'normal-report.json'), 'utf8'),
  );
  const hard = JSON.parse(
    await readFile(path.join(output, 'hard-report.json'), 'utf8'),
  );
  const visualChecks = {
    timingLegendVisibleAtReference:
      normal.timingLegendScreenshotProbe?.visible === true &&
      hard.timingLegendScreenshotProbe?.visible === true,
    overlayGlyphsVisibleOnFirstAndResizedFrames: [reference, narrow].every(
      (sample) =>
        sample.firstFrameOverlayPixels.labels
          .filter((label) => label.name !== 'countdown')
          .every(
            (label) =>
              label.meshVisible &&
              label.alphaPixels > 0 &&
              label.side === 0 &&
              Math.abs(label.rotationX - Math.PI) < 1e-6,
          ),
    ),
    hitLabelReadableOnFirstAndResizedFrames: overlayTextOCR.every(
      (sample) => sample.hit.readable,
    ),
    cameraStableAcrossNotePopulations: [reference, narrow].every(
      (sample) => sample.camera.notePopulationMaxMatrixDelta <= 1e-6,
    ),
    cameraStableAcrossMode: [reference, narrow].every(
      (sample) => sample.camera.modeChangeMatrixDelta <= 1e-6,
    ),
    noFullyOccludedCrowdPlacements: [reference, narrow].every(
      (sample) => sample.crowdIdPass.fullyOccluded.length === 0,
    ),
    allCrowdPlacementsHaveVisiblePixels: [reference, narrow].every((sample) =>
      sample.crowdIdPass.placements.every((person) => person.visiblePixels > 0),
    ),
    submittedNoteCentersAlign: [reference, narrow].every((sample) =>
      sample.notesAtFrames.every((frame) =>
        frame.submittedBars.every((bar) => bar.centerErrorWorld < 1e-3),
      ),
    ),
    noteBarSurfaceClearancePositive: [reference, narrow].every((sample) =>
      sample.notesAtFrames.every((frame) =>
        frame.submittedBars.every((bar) => bar.minSurfaceGap > 0),
      ),
    ),
    timingEnvelopeSurfaceClearancePositive: [reference, narrow].every(
      (sample) => {
        const framesWithNotes = sample.notesAtFrames.filter(
          (frame) => frame.projectedNotes.length > 0,
        );
        return (
          framesWithNotes.length > 0 &&
          framesWithNotes.every(
            (frame) =>
              frame.envelopeSurfaceSamples > 0 &&
              frame.minimumEnvelopeSurfaceGap !== null &&
              frame.minimumEnvelopeSurfaceGap > 0,
          )
        );
      },
    ),
  };
  const failedChecks = Object.entries(visualChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const report = {
    proof: 'Brightvale actual gameplay and fitted-camera parity review',
    status:
      failedChecks.length === 0
        ? 'passed-with-declared-limits'
        : 'visual-blocker',
    command: 'npm run test:brightvale:browser -- parity',
    actualGameplayRuns: { normal, hard },
    productionSceneParityFixture: parity,
    visualChecks,
    overlayTextOCR,
    failedChecks,
    unverified: [
      'Direct camera-matrix equality against the real main.ts game instance is unavailable without a production hook; the parity fixture uses the same production facade, UI factory, actual GLBs, and measured layout dimensions.',
      'Easy uses a geometry-only fixture chart because the production MVP chart rejects Easy; it is not reported as song gameplay.',
      'SwiftShader is not a target-device performance measurement; 1120x700 is not a minimum viewport promise.',
      'Keyboard events are chart-timed using the real audio clock, but the app does not expose note judgment internals to the browser proof.',
    ],
  };
  await writeFile(
    path.join(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { status: report.status, visualChecks, failedChecks },
      null,
      2,
    ),
  );
  if (failedChecks.length)
    failure = new Error(
      `Visual proof checks failed: ${failedChecks.join(', ')}`,
    );
} catch (error) {
  failure = error;
  const errorReport = {
    proof: 'Brightvale actual gameplay and fitted-camera parity review',
    status: 'proof-run-failed',
    error: String(error?.stack || error),
    parity,
    serverLog,
  };
  await writeFile(
    path.join(output, 'report.json'),
    `${JSON.stringify(errorReport, null, 2)}\n`,
  );
  console.error(
    JSON.stringify(
      {
        status: errorReport.status,
        error: String(error),
        scratch,
        browserLog,
        serverLog,
        browserEvents,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await socket?.close();
  } catch {}
  for (const process of [browser, server]) {
    if (process && process.exitCode === null) {
      process.kill('SIGTERM');
      await Promise.race([once(process, 'exit'), sleep(5000)]);
      if (process.exitCode === null) {
        process.kill('SIGKILL');
        await once(process, 'exit');
      }
    }
  }
  for (const port of [vitePort, debugPort]) {
    const stillOpen = await new Promise((resolve) => {
      const probe = net.connect(port, '127.0.0.1');
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', () => resolve(false));
    });
    if (stillOpen) failure ??= new Error(`Owned listener remains on ${port}`);
  }
}
if (failure) process.exitCode = 1;
