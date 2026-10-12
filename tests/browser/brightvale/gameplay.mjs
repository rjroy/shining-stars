import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const output = path.join(root, '.lore/local/evidence/brightvale-runtime');
const [difficulty = 'normal'] = process.argv.slice(2);
if (!['normal', 'hard'].includes(difficulty))
  throw new Error('Usage: gameplay.mjs [normal|hard]');
await mkdir(output, { recursive: true });
const chromium = '/usr/bin/chromium';
const scratch = await (async () => {
  const parent = '/tmp/opencode';
  const name = `brightvale-gameplay-${process.pid}`;
  const dir = path.join(parent, name);
  await mkdir(dir, { recursive: true });
  return dir;
})();
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
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
server.stderr.setEncoding('utf8').on('data', (value) => {
  serverLog += value;
});
let browser;
let cdp;
let sequence = 0;
const pending = new Map();
const events = [];
const reports = {};
const base = `http://127.0.0.1:${vitePort}/`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await pause(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function command(method, params = {}) {
  const id = ++sequence;
  cdp.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression, awaitPromise = true) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Browser evaluation failed',
    );
  return result.result?.value;
}
async function click(selector) {
  const result = await evaluate(
    `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return false; e.click(); return true; })()`,
  );
  if (!result) throw new Error(`Missing clickable element ${selector}`);
}
async function key(code, type) {
  await command('Input.dispatchKeyEvent', {
    type: type === 'down' ? 'keyDown' : 'keyUp',
    code,
    key: code.replace('Key', '').toLowerCase(),
  });
}
async function status() {
  return evaluate(
    `(()=>{const node=document.querySelector('[data-renderer-status]');const message=document.querySelector('[data-renderer-message]')?.textContent?.trim()??'';const retry=document.querySelector('[data-action=renderer-retry]');const renderer=node?.hidden?'rendered':retry&&!retry.disabled?'unavailable':/resize/i.test(message)?'suspended':/loading/i.test(message)?'loading':'unavailable';return{renderer,text:message,panels:[...document.querySelectorAll('[data-panel]')].filter(e=>!e.hidden).map(e=>e.dataset.panel),host:(()=>{const r=document.querySelector('.play-surface')?.getBoundingClientRect();return r?{width:r.width,height:r.height}:null})(),time:document.querySelector('[data-time]')?.textContent?.trim(),startDisabled:document.querySelector('[data-action=start]')?.disabled,retryHidden:retry?.hidden,retryDisabled:retry?.disabled}})()`,
  );
}
async function screenshot(name) {
  const shot = await command('Page.captureScreenshot', {
    format: 'webp',
    quality: 90,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(
    path.join(output, `${difficulty}-${name}`),
    Buffer.from(shot.data, 'base64'),
  );
}
function timingLegendScreenshotProbe(name) {
  const imagePath = path.join(output, `${difficulty}-${name}`);
  const crop = spawnSync(
    'magick',
    [imagePath, '-crop', '1470x40+65+166', '+repage', 'png:-'],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  if (crop.status !== 0)
    throw new Error(
      `Could not crop timing legend from ${imagePath}: ${crop.stderr}`,
    );
  const ocr = spawnSync('tesseract', ['stdin', 'stdout', '--psm', '7'], {
    input: crop.stdout,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (ocr.status !== 0)
    throw new Error(
      `Could not read timing legend from ${imagePath}: ${ocr.stderr}`,
    );
  return {
    sourceImage: `${difficulty}-${name}`,
    screenshotRegion: { x: 65, y: 166, width: 1470, height: 40 },
    recognizedText: ocr.stdout.trim(),
    expectedWords: ['Good', 'Perfect'],
    visible: /good/i.test(ocr.stdout) && /perfect/i.test(ocr.stdout),
    method:
      'OCR of the actual WebGL gameplay screenshot crop, not DOM text or slot dimensions',
  };
}
async function resize(width, height) {
  await command('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(async () => {
    const s = await status();
    const canvas = await evaluate(
      `(()=>{const c=document.querySelector('.play-surface canvas');const r=c?.getBoundingClientRect();return c&&r?{bufferWidth:c.width,bufferHeight:c.height,width:r.width,height:r.height}:null})()`,
    );
    return (
      Math.abs((s.host?.width ?? 0) - width) < 1 &&
      Math.abs((s.host?.height ?? 0) - height) < 1 &&
      canvas?.width >= width * 0.75 &&
      canvas.width <= width &&
      Math.abs(canvas.bufferWidth - canvas.width) < 2 &&
      Math.abs(canvas.bufferHeight - canvas.height) < 2
    );
  }, `host ${width}x${height}`);
}
async function inspect() {
  const state = await status();
  const visible = await evaluate(
    `(()=>{const c=document.querySelector('.play-surface canvas');return c?{canvas:{width:c.width,height:c.height,rect:(()=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()},labels:[...document.querySelectorAll('[data-time],[data-countdown],[data-timing-legend],[data-feedback]')].map(e=>({key:e.dataset.time!==undefined?'time':e.dataset.countdown!==undefined?'countdown':e.dataset.timingLegend!==undefined?'legend':'feedback',text:e.textContent.trim(),rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()}))}:null})()`,
  );
  return { state, visible };
}
async function main() {
  await waitFor(async () => {
    try {
      return (await fetch(base)).ok;
    } catch {
      return false;
    }
  }, 'Vite ready');
  browser = spawn(
    chromium,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-scrollbars',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(scratch, 'profile')}`,
      `--window-size=1600,900`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let browserLog = '';
  browser.stderr.setEncoding('utf8').on('data', (v) => {
    browserLog += v;
  });
  const target = await waitFor(async () => {
    try {
      const data = await (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      ).json();
      return data.find((x) => x.type === 'page');
    } catch {
      return false;
    }
  }, 'Chromium target');
  cdp = new WebSocket(target.webSocketDebuggerUrl);
  await once(cdp, 'open');
  cdp.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error
        ? p.reject(new Error(msg.error.message))
        : p.resolve(msg.result);
    } else if (msg.method)
      events.push({ method: msg.method, params: msg.params });
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `(()=>{const Native=window.AudioContext;if(Native){window.__proofAudioContexts=[];window.AudioContext=function(...args){const c=new Native(...args);window.__proofAudioContexts.push(c);return c};window.AudioContext.prototype=Native.prototype}const p=window.AudioBufferSourceNode?.prototype;if(p){const start=p.start;p.start=function(when,...args){window.__proofScheduledWhen=when;return start.call(this,when,...args)}}})()`,
  });
  await command('Page.navigate', { url: base });
  await resize(1600, 900);
  await waitFor(
    async () => {
      const s = await status();
      return s.host && s.host.width > 0 && s.renderer === 'rendered';
    },
    'initial rendered frame',
    60000,
  );
  reports.initial = await inspect();
  if (!reports.initial.state.panels.includes('ready'))
    throw new Error('Ready panel not visible before start');
  if (reports.initial.state.startDisabled)
    throw new Error('Start remained disabled after rendered scene');
  await screenshot('ready-reference.webp');
  if (difficulty !== 'normal') {
    const selected = await evaluate(
      `(()=>{const select=document.querySelector('[data-difficulty-select]');if(!select)return false;select.value=${JSON.stringify(difficulty)};select.dispatchEvent(new Event('change',{bubbles:true}));return select.value===${JSON.stringify(difficulty)}})()`,
    );
    if (!selected)
      throw new Error(`Could not select actual-chart ${difficulty}`);
  }
  await click('[data-action="start"]');
  await waitFor(async () => {
    const s = await status();
    return !s.panels.includes('ready') && s.renderer === 'rendered';
  }, 'active gameplay');
  const chartSource = await readFile(
    path.join(root, 'src/mvp-chart.ts'),
    'utf8',
  );
  const notes = [
    ...chartSource.matchAll(/\{ id: '(\w+)', time: ([\d.]+), lane: (\d) \}/g),
  ].map(([, id, time, lane]) => ({
    id,
    time: Number(time),
    lane: Number(lane),
  }));
  const profileFile = JSON.parse(
    await readFile(
      path.join(root, 'data/charts/difficulty-profiles.json'),
      'utf8',
    ),
  );
  const goodWindowSeconds =
    profileFile.profiles[difficulty].timing.good_ms / 1000;
  const sendCutoffSeconds = goodWindowSeconds * 0.75;
  const scheduledWhen = await waitFor(
    async () =>
      evaluate(
        'Number.isFinite(window.__proofScheduledWhen) ? window.__proofScheduledWhen : null',
      ),
    'actual audio schedule',
  );
  const audioTime = async () =>
    evaluate('window.__proofAudioContexts?.[0]?.currentTime ?? null');
  const waitTransport = async (position) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const now = await audioTime();
      if (now !== null && now - scheduledWhen >= position) return;
      await pause(5);
    }
    throw new Error(`Timed out waiting for song time ${position}`);
  };
  const hitNotes = [];
  let capturedReferenceAudience = false;
  let resizedNarrow = false;
  let capturedNarrowAudience = false;
  let capturedNarrowTwilight = false;
  let capturedReferenceTwilight = false;
  let pausedAtTwilight = false;
  for (const note of notes) {
    if (!capturedReferenceAudience && note.time >= 9.7) {
      await waitTransport(10.2);
      reports.audienceReference = await inspect();
      await screenshot('audience-reference.webp');
      reports.timingLegendScreenshotProbe = timingLegendScreenshotProbe(
        'audience-reference.webp',
      );
      capturedReferenceAudience = true;
    }
    if (!resizedNarrow && note.time >= 18.8) {
      await waitTransport(19.0);
      await resize(1120, 700);
      await waitFor(async () => {
        const r = await evaluate(
          `(()=>{const c=document.querySelector('.play-surface canvas');const r=c?.getBoundingClientRect();return r?{cw:c.width,ch:c.height,w:r.width,h:r.height}:null})()`,
        );
        return r?.cw > 0 && r?.ch > 0 && r?.w > 0 && r?.h > 0;
      }, 'narrow canvas resize');
      reports.audienceNarrow = await inspect();
      await screenshot('audience-narrow.webp');
      resizedNarrow = true;
      capturedNarrowAudience = true;
    }
    if (!capturedNarrowTwilight && note.id === 't02') {
      await waitTransport(note.time);
      reports.twilightNarrow = await inspect();
      reports.modeAtTransition = await evaluate(
        `document.querySelector('[data-mode-label]')?.textContent?.trim() ?? null`,
      );
      await screenshot('twilight-narrow.webp');
      capturedNarrowTwilight = true;
    }
    if (!capturedReferenceTwilight && note.id === 't02') {
      await resize(1600, 900);
      await waitFor(async () => {
        const r = await evaluate(
          `(()=>{const c=document.querySelector('.play-surface canvas');const r=c?.getBoundingClientRect();return r?{cw:c.width,ch:c.height,w:r.width,h:r.height}:null})()`,
        );
        return r?.cw > 0 && r?.ch > 0 && r?.w > 0 && r?.h > 0;
      }, 'reference canvas resize');
      reports.twilightReference = await inspect();
      await screenshot('twilight-reference.webp');
      capturedReferenceTwilight = true;
      const stateBeforePause = await status();
      if (stateBeforePause.panels.includes('results'))
        throw new Error(
          `Actual chart reached Results before the Twilight pause point: ${JSON.stringify(stateBeforePause)}`,
        );
      await click('[data-action="pause"]');
      await waitFor(
        async () => (await status()).panels.includes('pause'),
        'Pause at actual Twilight frame',
        5000,
      );
      pausedAtTwilight = true;
      // Once Pause is confirmed, stop scheduling chart keys. Audio clocks can
      // continue advancing while the game is paused; those keys would not be
      // gameplay inputs and must not be counted as such.
      break;
    }
    await waitTransport(note.time);
    const keyCode = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane];
    const now = await audioTime();
    const lateness = now - scheduledWhen - note.time;
    if (lateness > sendCutoffSeconds) {
      hitNotes.push({ id: note.id, result: 'not-sent-late', lateness });
      continue;
    }
    await key(keyCode, 'down');
    await key(keyCode, 'up');
    hitNotes.push({ id: note.id, result: 'key-sent', lateness });
  }
  reports.chartInput = {
    method:
      'CDP keyDown/keyUp on D/F/J/K at actual Web Audio transport time; no controller or scoring hooks',
    audioClockObserved: true,
    difficulty,
    goodWindowSeconds,
    sendCutoffSeconds,
    chartNoteCount: notes.length,
    attemptedThrough: hitNotes.at(-1)?.id ?? null,
    sent: hitNotes.filter((x) => x.result === 'key-sent').length,
    tooLate: hitNotes.filter((x) => x.result !== 'key-sent').length,
    sentWithinTolerance: hitNotes.filter((x) => x.result === 'key-sent').length,
    deliberatelySkippedLate: hitNotes.filter((x) => x.result !== 'key-sent')
      .length,
    maximumSentLatenessSeconds: Math.max(
      0,
      ...hitNotes.filter((x) => x.result === 'key-sent').map((x) => x.lateness),
    ),
  };
  reports.afterModeTransition = await inspect();
  if (!reports.modeAtTransition || !/twilight/i.test(reports.modeAtTransition))
    throw new Error(
      `Expected actual Twilight mode at captured transition, got ${reports.modeAtTransition}`,
    );
  // Exercise collapse/restore while paused; restoration alone must not resume playback.
  if (!pausedAtTwilight) await click('[data-action="pause"]');
  const pauseOrEnd = await waitFor(
    async () => {
      const s = await status();
      return s.panels.includes('pause') || s.panels.includes('results')
        ? s
        : false;
    },
    'pause or terminal state',
    5000,
  );
  if (!pauseOrEnd.panels.includes('pause'))
    throw new Error(
      `Run reached terminal state before Pause: ${JSON.stringify({ state: pauseOrEnd, mode: reports.modeAtTransition, chartInput: reports.chartInput })}`,
    );
  reports.pauseTime = (await status()).time;
  await evaluate(
    `(()=>{const h=document.querySelector('.play-surface');h.dataset.proofOriginalStyle=h.getAttribute('style')??'';h.style.display='none'})()`,
  );
  await waitFor(
    async () => {
      const s = await status();
      return s.renderer === 'suspended' || /resize/i.test(s.text ?? '');
    },
    'zero viewport suspension',
    15000,
  );
  reports.zeroSuspended = await status();
  if (
    reports.zeroSuspended.host?.width !== 0 ||
    reports.zeroSuspended.host?.height !== 0
  )
    throw new Error(
      `Host did not reach a zero-sized box: ${JSON.stringify(reports.zeroSuspended.host)}`,
    );
  await evaluate(
    `(()=>{const h=document.querySelector('.play-surface');h.setAttribute('style',h.dataset.proofOriginalStyle);delete h.dataset.proofOriginalStyle})()`,
  );
  await waitFor(
    async () => {
      const s = await status();
      return s.renderer === 'rendered';
    },
    'renderer recovery after restore',
    30000,
  );
  await pause(1300);
  reports.restoredPaused = await status();
  if (!reports.restoredPaused.panels.includes('pause'))
    throw new Error('Viewport restoration dismissed Pause panel');
  if (reports.restoredPaused.time !== reports.pauseTime)
    throw new Error(
      'Playback time changed while paused after viewport restoration',
    );
  await click('[data-action="resume"]');
  await waitFor(async () => {
    const s = await status();
    return s.panels.includes('pause') === false;
  }, 'explicit resume');
  reports.explicitResume = await status();
  if (reports.explicitResume.renderer !== 'rendered')
    throw new Error(
      `Renderer did not return to rendered state on explicit Resume: ${JSON.stringify(reports.explicitResume)}`,
    );
  reports.renderPassInstrumentation = {
    available: false,
    reason:
      'The live renderer does not expose scene objects or renderer counters to the page harness; no pass count inferred from the canvas.',
  };
  reports.visualNodes = await evaluate(
    `(()=>{const root=document.querySelector('.play-surface');const cn=root?.querySelector('canvas');const labels=[...document.querySelectorAll('[data-time],[data-countdown],[data-timing-legend],[data-feedback]')].map(e=>({key:e.dataset.time!==undefined?'time':e.dataset.countdown!==undefined?'countdown':e.dataset.timingLegend!==undefined?'legend':'feedback',text:e.textContent.trim(),rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()}));return{canvas:!!cn,labels,mode:document.querySelector('[data-mode-label]')?.textContent?.trim()??null,bodyText:document.body.innerText.slice(0,1200)}})()`,
  );
  // If the live renderer exposes a context-loss extension, verify unavailable→retry→rendered without editing source.
  reports.contextLoss = await evaluate(
    `(()=>{const c=document.querySelector('.play-surface canvas');const gl=c?.getContext('webgl2')||c?.getContext('webgl');const ext=gl?.getExtension('WEBGL_lose_context');if(!ext)return{supported:false};ext.loseContext();return{supported:true}})()`,
  );
  if (reports.contextLoss.supported) {
    await waitFor(
      async () => {
        const s = await status();
        return s.renderer === 'unavailable' && !s.retryHidden;
      },
      'renderer unavailable after context loss',
      15000,
    );
    reports.contextUnavailable = await status();
    await click('[data-action="renderer-retry"]');
    await waitFor(
      async () => {
        const s = await status();
        return s.renderer === 'rendered';
      },
      'renderer retry',
      60000,
    );
    reports.contextRetry = await status();
  }
  reports.webVitals = {
    userAgent: await evaluate('navigator.userAgent'),
    devicePixelRatio: await evaluate('devicePixelRatio'),
    songVolume: process.env.VITE_SONG_VOLUME,
  };
  reports.consoleApiEvents = events.filter(
    (x) => x.method === 'Runtime.consoleAPICalled',
  ).length;
  reports.loadedResources = await evaluate(
    `performance.getEntriesByType('resource').map(e=>e.name).filter(x=>x.includes('/src/main')||x.includes('/src/scene')||x.includes('/src/ui')||x.toLowerCase().includes('.glb')||x.includes('/data/music/')).map(x=>new URL(x).pathname)`,
  );
  const outputReport = {
    proof: 'Brightvale actual gameplay browser proof',
    status: reports.timingLegendScreenshotProbe.visible
      ? 'partial'
      : 'visual-blocker',
    harnessChecks: 'passed',
    command: `npm run test:brightvale:browser -- ${difficulty}`,
    runtime:
      'actual src/main.ts app; production chart/audio and GLB-backed scene',
    viewportSamples: {
      reference: { width: 1600, height: 900 },
      narrow: { width: 1120, height: 700 },
    },
    limitations: [
      'Chromium/SwiftShader; no target-device performance claim.',
      '1120x700 is a tested sample, not a minimum supported viewport.',
      'Song output was muted; audio audibility is not evaluated.',
      'No per-person live-occlusion pass was available from the application DOM; composition proof has the separate GLB ID-pass evidence.',
      'Easy is not enabled by the actual MVP chart; this report covers the selected Normal or Hard audio run only. Easy geometry is reported separately as fixture-only.',
      'This live harness sends chart-timed keyboard inputs but does not independently inspect internal score judgments or live note mesh vertices.',
      'Per-person occlusion is not exposed by the live app DOM; no fully-visible crowd claim is made from these screenshots.',
      `This actual audio run selected ${difficulty}; other difficulty evidence is recorded in its separate run report.`,
    ],
    ...reports,
  };
  await writeFile(
    path.join(output, `${difficulty}-report.json`),
    JSON.stringify(outputReport, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        status: reports.timingLegendScreenshotProbe.visible
          ? 'passed-with-limitations'
          : 'visual-blocker',
        screenshots: [
          `${difficulty}-ready-reference.webp`,
          `${difficulty}-audience-reference.webp`,
          `${difficulty}-audience-narrow.webp`,
          `${difficulty}-twilight-narrow.webp`,
          `${difficulty}-twilight-reference.webp`,
        ],
        liveMode: reports.modeAtTransition,
        initial: reports.initial.state,
        zeroSuspended: reports.zeroSuspended,
        restored: reports.restoredPaused,
        contextLoss: reports.contextLoss,
        loadedResources: reports.loadedResources,
      },
      null,
      2,
    ),
  );
}
let failure;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(error.stack ?? error);
  console.error(`Proof scratch: ${scratch}`);
  await writeFile(
    path.join(output, `${difficulty}-report.json`),
    JSON.stringify(
      {
        proof: 'Brightvale actual gameplay browser proof',
        status: 'proof-incomplete',
        difficulty,
        error: String(error?.stack || error),
        partialEvidence: reports,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  try {
    cdp?.close();
  } catch {}
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([once(browser, 'exit'), pause(5000)]);
    if (browser.exitCode === null) {
      browser.kill('SIGKILL');
      await once(browser, 'exit');
    }
  }
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), pause(5000)]);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
      await once(server, 'exit');
    }
  }
  for (const file of await readdir(output)) {
    if (file.startsWith('results-') && file.endsWith('.webp'))
      await (await import('node:fs/promises')).unlink(path.join(output, file));
  }
  for (const port of [vitePort, debugPort]) {
    const open = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
    });
    if (open) failure ??= new Error(`Owned listener remains on ${port}`);
  }
}
if (failure) process.exitCode = 1;
