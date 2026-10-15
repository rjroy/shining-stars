import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  goodJudgmentTargetSeconds,
  recordJudgmentReceipt,
  scheduleJudgmentVisualCapture,
} from './judgment-receipt.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const output = path.join(root, '.lore/local/evidence/brightvale-runtime');
const [songId = 'the-first-shining-star', difficulty = 'normal', ...extraArgs] =
  process.argv.slice(2);
if (extraArgs.length > 0 || !['easy', 'normal', 'hard'].includes(difficulty))
  throw new Error('Usage: gameplay.mjs [song-id] [easy|normal|hard]');
const catalogDocument = JSON.parse(
  await readFile(path.join(root, 'data/catalog.json'), 'utf8'),
);
const authoringDocument = JSON.parse(
  await readFile(path.join(root, 'data/charts/song-authoring.json'), 'utf8'),
);
const selectedSong = catalogDocument.songs.find((song) => song.id === songId);
if (selectedSong === undefined)
  throw new Error(`Song '${songId}' is not in data/catalog.json.`);
if (selectedSong.segmentKind !== 'excerpt')
  throw new Error(
    'This bounded native-judgment harness requires the demo excerpt; use acceptance smoke/exhaustive for full-track playback.',
  );
const chartBundle = JSON.parse(
  await readFile(
    path.join(root, `data/charts/generated/${songId}.charts.json`),
    'utf8',
  ),
);
if (
  chartBundle.songId !== songId ||
  chartBundle.schemaVersion !== 1 ||
  chartBundle.source !== authoringDocument.songs[songId]?.source
)
  throw new Error(
    `Generated chart bundle for '${songId}' does not match catalog metadata.`,
  );
const chart = chartBundle.charts?.[difficulty];
if (
  chart === undefined ||
  chart.allowedDifficulties?.length !== 1 ||
  chart.allowedDifficulties[0] !== difficulty
)
  throw new Error(
    `Generated chart variant is unavailable: ${songId}/${difficulty}.`,
  );
const chartSourceStart = chart.sourceStart;
const chartDuration = chart.duration;
const notes = chart.notes;
const judgmentCandidates = notes.filter(
  (note) => note.time >= 12 && note.time < chart.twilightAt - 4,
);
const judgmentNotes = judgmentCandidates.reduce((selected, note) => {
  if (
    selected.length < 4 &&
    (selected.length === 0 || note.time - selected.at(-1).time >= 0.75)
  )
    selected.push(note);
  return selected;
}, []);
if (judgmentNotes.length < 4)
  throw new Error(
    `Generated ${songId}/${difficulty} chart lacks four safe audience judgment notes.`,
  );
const judgmentExpectedById = new Map([
  [judgmentNotes[0].id, 'perfect'],
  [judgmentNotes[1].id, 'good'],
  [judgmentNotes[2].id, 'perfect'],
  [judgmentNotes[3].id, 'miss'],
]);
const missedJudgmentNote = judgmentNotes[3];
const runId = `${songId}-${difficulty}-native-restart`;
const runPrefix = `${songId}-${difficulty}`;
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
const lateTravelWrites = [];
let lateTravelBindingInstalled = false;
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
  const target = await evaluate(`(() => {
    const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(candidate=>!candidate.disabled&&!candidate.closest('[hidden]')&&candidate.getClientRects().length>0);
    if(!element)return null;
    element.scrollIntoView({block:'center',inline:'center'});
    const rect=element.getBoundingClientRect();
    if(rect.width===0||rect.height===0)return null;
    return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  })()`);
  if (!target) throw new Error(`Missing visible enabled button ${selector}`);
  const before = await evaluate('window.__proofTrustedClicks.length');
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: target.x,
    y: target.y,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1,
  });
  const event = await waitFor(
    () =>
      evaluate(`window.__proofTrustedClicks.slice(${before}).at(-1) ?? null`),
    `trusted click on ${selector}`,
    5000,
  );
  if (!event?.trusted)
    throw new Error(
      `Click was not trusted for ${selector}: ${JSON.stringify(event)}`,
    );
  return event;
}

async function selectAndStartSong(
  runLabel,
  selectedScreenshot = 'observatory-selected-song.webp',
) {
  await waitFor(
    () =>
      evaluate(`(() => {
        const overview=document.querySelector('[data-observatory-page="overview"]');
        const notice=document.querySelector('[data-renderer-notice]');
        const canvas=document.querySelector('.play-surface canvas');
        return !!overview && !overview.hidden && !!notice?.hidden &&
          !!canvas && canvas.width>0 && canvas.height>0;
      })()`),
    `${runLabel} Observatory overview renderer`,
    60000,
  );
  const allSongsClick = await click('[data-action="overview-all"]');
  await waitFor(
    () =>
      evaluate(
        `!document.querySelector('[data-observatory-page="browser"]')?.hidden`,
      ),
    `${runLabel} All Songs browser`,
  );
  const rowClick = await click(
    `button[data-action="select-song"][data-song-id="${songId}"]`,
  );
  const selected = await waitFor(
    () =>
      evaluate(`(() => {
        const detail=document.querySelector('[data-song-detail]');
        const title=detail?.querySelector('h2')?.textContent?.trim();
        const play=detail?.querySelector('[data-action="play"]');
        return title && play ? {title,chartNotice:detail.querySelector('.song-chart-status')?.textContent?.trim(),playDisabled:play.disabled} : null;
      })()`),
    `${runLabel} selected ${selectedSong.title} detail`,
  );
  if (
    !selected.title.includes(
      selectedSong.title.replace(' (Demo Excerpt)', ''),
    ) ||
    selected.playDisabled
  )
    throw new Error(
      `Selected chart is not Play-ready: ${JSON.stringify(selected)}`,
    );
  const difficultySelector = '[data-song-detail] [data-run-difficulty]';
  const difficultyOptions = await evaluate(`(() => {
    const select=document.querySelector(${JSON.stringify(difficultySelector)});
    return select ? [...select.options].map(option=>option.value) : null;
  })()`);
  if (
    !Array.isArray(difficultyOptions) ||
    !difficultyOptions.includes(difficulty)
  )
    throw new Error(
      `Selected song does not offer ${difficulty}: ${JSON.stringify(difficultyOptions)}`,
    );
  await evaluate(`(() => {
    const select=document.querySelector(${JSON.stringify(difficultySelector)});
    select.focus();
  })()`);
  const difficultyTarget = await evaluate(`(() => {
    const select=document.querySelector(${JSON.stringify(difficultySelector)});
    const rect=select?.getBoundingClientRect();
    return rect && rect.width>0 && rect.height>0
      ? {x:rect.left+rect.width/2,y:rect.top+rect.height/2} : null;
  })()`);
  if (!difficultyTarget)
    throw new Error(
      `Missing visible difficulty selector ${difficultySelector}`,
    );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: difficultyTarget.x,
    y: difficultyTarget.y,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: difficultyTarget.x,
    y: difficultyTarget.y,
    button: 'left',
    clickCount: 1,
  });
  const pressSelectionKey = async (key, virtualKeyCode) => {
    const parameters = {
      key,
      code: key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await command('Input.dispatchKeyEvent', { ...parameters, type: 'keyDown' });
    await command('Input.dispatchKeyEvent', { ...parameters, type: 'keyUp' });
  };
  await pressSelectionKey('Home', 36);
  for (let index = 0; index < difficultyOptions.indexOf(difficulty); index += 1)
    await pressSelectionKey('ArrowDown', 40);
  await pressSelectionKey('Enter', 13);
  const chosenDifficulty = await waitFor(
    () =>
      evaluate(
        `document.querySelector(${JSON.stringify(difficultySelector)})?.value ?? null`,
      ),
    `${runLabel} ${difficulty} difficulty selection`,
  );
  if (chosenDifficulty !== difficulty)
    throw new Error(`UI selected ${chosenDifficulty}, expected ${difficulty}.`);
  const audioContextsBeforePlay = await evaluate(
    'window.__proofAudioContexts.length',
  );
  if (audioContextsBeforePlay !== 0)
    throw new Error(
      `An AudioContext was created before the trusted Play action: ${audioContextsBeforePlay}`,
    );
  await screenshot(selectedScreenshot);
  const playClick = await click('[data-action="play"]');
  if (playClick.action !== 'play' || playClick.trusted !== true)
    throw new Error(
      `Play did not receive a genuine click: ${JSON.stringify(playClick)}`,
    );
  const scheduled = await waitFor(
    () =>
      evaluate(`(() => {
        const context=window.__proofAudioContexts?.[0];
        return context && Number.isFinite(window.__proofScheduledWhen)
          ? {stateAtCreation:context.__proofStateAtCreation,state:context.state,
              createdDuringTrustedPlay:context.__proofCreatedDuringTrustedPlay,
              createdAtTime:context.__proofCreatedAtTime,
              scheduledWhen:window.__proofScheduledWhen,
              sourceOffset:window.__proofScheduledOffset,
              sourceDuration:window.__proofScheduledDuration,
              currentTime:context.currentTime,
              ownCurrentTime: Object.hasOwn(context,'currentTime')}
          : null;
      })()`),
    `${runLabel} real Play startup and audio scheduling`,
    20000,
  );
  const playing = await waitFor(
    () =>
      evaluate(`(() => {
        const context=window.__proofAudioContexts?.[0];
        return context && Number.isFinite(window.__proofScheduledWhen) &&
          context.state==='running' && context.currentTime>=window.__proofScheduledWhen
          ? {state:context.state,currentTime:context.currentTime,
              scheduledWhen:window.__proofScheduledWhen,
              sourceOffset:window.__proofScheduledOffset,
              sourceDuration:window.__proofScheduledDuration,
              ownCurrentTime:Object.hasOwn(context,'currentTime')}
          : null;
      })()`),
    `${runLabel} actual audio clock passing scheduled start`,
    12000,
  );
  if (
    !scheduled.createdDuringTrustedPlay ||
    audioContextsBeforePlay !== 0 ||
    scheduled.ownCurrentTime ||
    playing.ownCurrentTime
  ) {
    throw new Error(
      `Play did not start from a genuine gesture on an unmodified AudioContext: ${JSON.stringify({ selected, playClick, scheduled, playing })}`,
    );
  }
  return {
    selected,
    difficultySelection: {
      value: chosenDifficulty,
      options: difficultyOptions,
    },
    audioContextsBeforePlay,
    allSongsClick,
    rowClick,
    playClick,
    selectionScreenshot: `${runPrefix}-${selectedScreenshot}`,
    scheduled,
    playing,
    startupClockModified: false,
  };
}

async function installPostStartupClockProbe() {
  const result = await evaluate(`(() => {
    const context=window.__proofAudioContexts?.[0];
    if(!context || !Number.isFinite(window.__proofScheduledWhen))return null;
    let prototype=Object.getPrototypeOf(context);
    let descriptor;
    while(prototype&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(prototype,'currentTime');prototype=Object.getPrototypeOf(prototype)}
    if(!descriptor?.get)return null;
    const raw=()=>descriptor.get.call(context);
    let rawBase=raw();
    let logicalBase=rawBase;
    let rate=1;
    Object.defineProperty(context,'currentTime',{configurable:true,get:()=>logicalBase+(raw()-rawBase)*rate});
    context.__setProofClockRate=(next)=>{const now=raw();logicalBase+=((now-rawBase)*rate);rawBase=now;rate=next};
    const nativeBefore=raw();
    const reportedAfterInstall=context.currentTime;
    const nativeAfter=raw();
    return{installedAfterPlaybackStart:true,nativeAtInstall:rawBase,reportedAfterInstall,nativeBefore,nativeAfter,initialRate:rate,unchangedAtInstall:rate===1&&reportedAfterInstall>=nativeBefore&&reportedAfterInstall<=nativeAfter};
  })()`);
  if (!result?.unchangedAtInstall)
    throw new Error(
      `Could not install a neutral post-start clock probe: ${JSON.stringify(result)}`,
    );
  return result;
}
async function key(code, type) {
  await command('Input.dispatchKeyEvent', {
    type: type === 'down' ? 'keyDown' : 'keyUp',
    code,
    key: code.replace('Key', '').toLowerCase(),
  });
}
async function pauseWithEscape() {
  await key('Escape', 'down');
  await key('Escape', 'up');
  return waitFor(
    async () => {
      const state = await status();
      return state.panels.includes('pause') ? state : false;
    },
    'Escape pause overlay',
    5000,
  );
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
    path.join(output, `${runPrefix}-${name}`),
    Buffer.from(shot.data, 'base64'),
  );
}
function queueJudgmentVisualCapture(receipt, pendingCaptures) {
  const filename = `${runPrefix}-judgment-${receipt.outcome}-capture-${receipt.noteId}.webp`;
  const capture = scheduleJudgmentVisualCapture(
    receipt,
    async () => {
      const stateAtCaptureRequest = await evaluate(`(()=>({
        liveRegionText:document.querySelector('[data-gameplay-status]')?.textContent?.trim()??'',
        performanceTime:performance.now(),
        audioTime:window.__proofAudioContexts?.[0]?.currentTime??null,
        scheduledWhen:window.__proofScheduledWhen??null
      }))()`);
      await screenshot(filename);
      const expectedStillVisible = new RegExp(
        `Lane ${receipt.lane}: ${receipt.outcome}`,
        'i',
      ).test(stateAtCaptureRequest.liveRegionText);
      if (!expectedStillVisible) {
        throw new Error(
          `Visual capture for ${receipt.noteId} was requested after its feedback changed: ${JSON.stringify(stateAtCaptureRequest)}`,
        );
      }
      return {
        filename,
        captureState: stateAtCaptureRequest,
        stateVerifiedAtCaptureRequest: expectedStillVisible,
        screenshotRole: 'captured after receipt; not labeled as a peak frame',
      };
    },
    (result) => {
      reports.judgmentVisualCaptures ??= [];
      reports.judgmentVisualCaptures.push(result);
    },
  );
  pendingCaptures.push(capture);
}
function timingLegendScreenshotProbe(name, measuredRegion) {
  const imagePath = path.join(output, `${runPrefix}-${name}`);
  const screenshotRegion = {
    x: Math.round(measuredRegion.x),
    y: Math.round(measuredRegion.y),
    width: Math.round(measuredRegion.width),
    height: Math.round(measuredRegion.height),
  };
  const crop = spawnSync(
    'magick',
    [
      imagePath,
      '-crop',
      `${screenshotRegion.width}x${screenshotRegion.height}+${screenshotRegion.x}+${screenshotRegion.y}`,
      '+repage',
      'png:-',
    ],
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
    sourceImage: `${runPrefix}-${name}`,
    screenshotRegion,
    recognizedText: ocr.stdout.trim(),
    expectedWords: ['Good', 'Perfect'],
    visible: /good/i.test(ocr.stdout) && /perfect/i.test(ocr.stdout),
    method:
      'OCR of the actual WebGL gameplay screenshot crop, not DOM text or slot dimensions',
  };
}
async function resize(width, height, deviceScaleFactor = 1) {
  const expectedHostWidth = Math.min(width, height * (16 / 9));
  await command('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });
  await waitFor(async () => {
    const s = await status();
    const measurement = await evaluate(
      `(()=>{const h=document.querySelector('.play-surface');const c=h?.querySelector('canvas');if(!h||!c)return null;const r=h.getBoundingClientRect();const q=c.getBoundingClientRect();const s=getComputedStyle(h);const n=v=>parseFloat(v)||0;const w=r.width-n(s.borderLeftWidth)-n(s.borderRightWidth)-n(s.paddingLeft)-n(s.paddingRight);const y=r.height-n(s.borderTopWidth)-n(s.borderBottomWidth)-n(s.paddingTop)-n(s.paddingBottom);return{bufferWidth:c.width,bufferHeight:c.height,width:q.width,height:q.height,contentWidth:w,contentHeight:y,canvasOffsetX:q.x-(r.x+n(s.borderLeftWidth)+n(s.paddingLeft)),canvasOffsetY:q.y-(r.y+n(s.borderTopWidth)+n(s.paddingTop))}})()`,
    );
    return (
      Math.abs((s.host?.width ?? 0) - expectedHostWidth) < 1 &&
      Math.abs((s.host?.height ?? 0) - height) < 1 &&
      measurement !== null &&
      Math.abs(measurement.width - measurement.contentWidth) <= 1 &&
      Math.abs(measurement.height - measurement.contentHeight) <= 1 &&
      Math.abs(measurement.canvasOffsetX) <= 1 &&
      Math.abs(measurement.canvasOffsetY) <= 1 &&
      Math.abs(
        measurement.bufferWidth -
          measurement.width * Math.min(deviceScaleFactor, 1.5),
      ) < 2 &&
      Math.abs(
        measurement.bufferHeight -
          measurement.height * Math.min(deviceScaleFactor, 1.5),
      ) < 2
    );
  }, `host ${width}x${height}`);
}
async function inspect() {
  const state = await status();
  const visible = await evaluate(
    `(()=>{const host=document.querySelector('.play-surface');const c=host?.querySelector('canvas');if(!host||!c)return null;const r=host.getBoundingClientRect();const s=getComputedStyle(host);const n=v=>parseFloat(v)||0;const content={x:r.x+n(s.borderLeftWidth)+n(s.paddingLeft),y:r.y+n(s.borderTopWidth)+n(s.paddingTop),width:r.width-n(s.borderLeftWidth)-n(s.borderRightWidth)-n(s.paddingLeft)-n(s.paddingRight),height:r.height-n(s.borderTopWidth)-n(s.borderBottomWidth)-n(s.paddingTop)-n(s.paddingBottom)};const cr=c.getBoundingClientRect();const rect=e=>{const q=e.getBoundingClientRect();return{x:q.x,y:q.y,width:q.width,height:q.height}};return{viewport:{innerWidth,innerHeight,devicePixelRatio,visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale}:null,document:{clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}},host:{x:r.x,y:r.y,width:r.width,height:r.height},content,canvas:{width:c.width,height:c.height,rect:{x:cr.x,y:cr.y,width:cr.width,height:cr.height},contentDelta:{x:cr.x-content.x,y:cr.y-content.y,width:cr.width-content.width,height:cr.height-content.height}},hud:[...document.querySelectorAll('.play-heading,.performance-controls,[data-time],[data-countdown],[data-timing-legend],[data-feedback]')].map(e=>({selector:e.className||e.tagName,key:e.dataset.time!==undefined?'time':e.dataset.countdown!==undefined?'countdown':e.dataset.timingLegend!==undefined?'legend':e.dataset.feedback!==undefined?'feedback':undefined,text:e.textContent.trim(),rect:rect(e)}))}})()`,
  );
  return { state, visible };
}
async function inspectResourceHud() {
  return evaluate(
    `(()=>{const read=(selector)=>{const e=document.querySelector(selector);return e?{hidden:e.hidden,text:e.textContent.trim(),value:e instanceof HTMLProgressElement?e.value:null,max:e instanceof HTMLProgressElement?e.max:null,ariaValueText:e.getAttribute('aria-valuetext'),rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()}:null};return{mode:document.querySelector('[data-mode-label]')?.textContent?.trim(),renownLabel:read('[data-audience-resource]'),renown:read('[data-resource-value]'),renownMaximum:read('[data-audience-maximum]'),renownBar:read('[data-audience-bar]'),personalLabel:read('[data-personal-label]'),personal:read('[data-personal-strength]'),personalMaximum:read('[data-personal-maximum]'),personalBar:read('[data-personal-bar]'),twilightGroup:read('[data-opponent-resource]'),twilight:read('[data-twilight-strength]'),twilightMaximum:read('[data-twilight-maximum]'),twilightBar:read('[data-twilight-bar]'),difficultySelect:read('[data-difficulty-select]'),canvas:(()=>{const e=document.querySelector('.play-surface canvas');const r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()}})()`,
  );
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
    } else if (
      msg.method === 'Runtime.bindingCalled' &&
      msg.params.name === '__brightvaleLateTravelSample'
    ) {
      const sample = JSON.parse(msg.params.payload);
      const filename = `${runPrefix}-late-note-travel-${sample.name}.webp`;
      lateTravelWrites.push(
        command('Page.captureScreenshot', {
          format: 'webp',
          quality: 90,
          fromSurface: true,
          captureBeyondViewport: false,
        })
          .then((capture) =>
            writeFile(
              path.join(output, filename),
              Buffer.from(capture.data, 'base64'),
            ),
          )
          .then(() => {
            sample.screenshot = filename;
            reports.lateNoteTravel?.push(sample);
          }),
      );
    } else if (msg.method)
      events.push({ method: msg.method, params: msg.params });
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `(()=>{
      window.__proofTrustedClicks=[];
      window.__proofLastTrustedClick=null;
      window.__proofJudgmentReceipts=[];
      window.__proofKeydownReceipts=[];
      window.__proofStatusMutations=[];
      window.__proofActiveJudgment=null;
      document.addEventListener('click',event=>{
        const button=event.target instanceof Element?event.target.closest('button[data-action]'):null;
        if(!button)return;
        const record={action:button.dataset.action??null,songId:button.dataset.songId??null,trusted:event.isTrusted};
        window.__proofTrustedClicks.push(record);
        window.__proofLastTrustedClick=record;
      },true);
      const observeJudgment=(mutations)=>{
        const active=window.__proofActiveJudgment;
        const status=document.querySelector('[data-gameplay-status]');
        const text=status?.textContent?.trim()??'';
        if(status&&mutations.some(mutation=>mutation.target===status||status.contains(mutation.target)))
          window.__proofStatusMutations.push({text,performanceTime:performance.now(),audioTime:window.__proofAudioContexts?.[0]?.currentTime??null});
        if(!active||!text||text===active.baselineText)return;
        const match=text.match(new RegExp('Lane '+active.lane+': (Perfect|Good|Miss)','i'));
        if(!match)return;
        window.__proofJudgmentReceipts.push({
          ...active,
          outcome:match[1].toLowerCase(),
          liveRegionText:text,
          performanceTime:performance.now(),
          audioTime:window.__proofAudioContexts?.[0]?.currentTime??null,
          scheduledWhen:window.__proofScheduledWhen??null
        });
        window.__proofActiveJudgment=null;
      };
      new MutationObserver(observeJudgment).observe(document,{subtree:true,childList:true,characterData:true});
      document.addEventListener('keydown',event=>{
        const active=window.__proofActiveJudgment;
        if(!active||event.code!==active.keyCode||event.repeat)return;
        const context=window.__proofAudioContexts?.[0];
        const receipt={...active,trusted:event.isTrusted,code:event.code,
          performanceTime:performance.now(),audioTime:context?.currentTime??null};
        window.__proofKeydownReceipts.push(receipt);
      },true);
      const Native=window.AudioContext;
      if(Native){
        window.__proofAudioContexts=[];
        window.AudioContext=function(...args){
          const context=new Native(...args);
          const click=window.__proofLastTrustedClick;
          context.__proofStateAtCreation=context.state;
          context.__proofCreatedAtTime=context.currentTime;
          context.__proofCreatedDuringTrustedPlay=click?.action==='play'&&click.trusted===true;
          window.__proofAudioContexts.push(context);
          return context;
        };
        window.AudioContext.prototype=Native.prototype;
      }
      const sourcePrototype=window.AudioBufferSourceNode?.prototype;
      if(sourcePrototype){
        const start=sourcePrototype.start;
        sourcePrototype.start=function(when,...args){
          window.__proofScheduledWhen=when;
          window.__proofScheduledOffset=args[0]??0;
          window.__proofScheduledDuration=args[1]??null;
          return start.call(this,when,...args);
        };
      }
    })()`,
  });
  await command('Page.navigate', { url: base });
  reports.startupGesture = await selectAndStartSong('initial run');
  reports.gameplayInitialScreenshot = `${runPrefix}-gameplay-initial.webp`;
  await screenshot('gameplay-initial.webp');
  reports.initialPause = await pauseWithEscape();
  await resize(1600, 900);
  await waitFor(
    async () => {
      const s = await status();
      const gameplayVisible = await evaluate(
        `document.querySelector('[data-experience-screen="gameplay"]')?.hidden===false`,
      );
      return (
        s.host &&
        s.host.width > 0 &&
        s.renderer === 'rendered' &&
        gameplayVisible
      );
    },
    'actual gameplay after Observatory Play',
    60000,
  );
  reports.initial = await inspect();
  if (
    reports.initial.state.renderer !== 'rendered' ||
    reports.initial.state.panels.includes('error')
  )
    throw new Error(
      `Gameplay did not become ready after Play: ${JSON.stringify(reports.initial.state)}`,
    );
  reports.initialHud = await inspectResourceHud();
  if (reports.initialHud.difficultySelect !== null)
    throw new Error(
      'Difficulty selector unexpectedly remains in the gameplay HUD.',
    );
  reports.judgmentHudContract = await evaluate(
    `(()=>({legacyFeedback:document.querySelector('[data-feedback]')!==null,sharedLabel:document.body.innerText.includes('Notes meet the line here'),accessibleStatus:!!document.querySelector('[data-gameplay-status][aria-live="polite"]'),instructions:document.querySelector('#lane-instructions')?.textContent?.trim()??''}))()`,
  );
  if (
    reports.judgmentHudContract.legacyFeedback ||
    reports.judgmentHudContract.sharedLabel ||
    !reports.judgmentHudContract.accessibleStatus
  )
    throw new Error(
      `Shared judgment HUD remains or accessible status is missing: ${JSON.stringify(reports.judgmentHudContract)}`,
    );
  if (
    await evaluate(`document.querySelector('[data-action="pause"]') !== null`)
  )
    throw new Error(
      'Visible pause button unexpectedly remains in the gameplay HUD.',
    );
  if (
    reports.startupGesture.scheduled.sourceOffset !== chartSourceStart ||
    reports.startupGesture.scheduled.sourceDuration !== chartDuration
  ) {
    throw new Error(
      `Play scheduled a different chart interval: ${JSON.stringify({ startup: reports.startupGesture, chartSourceStart, chartDuration })}`,
    );
  }
  const profileFile = JSON.parse(
    await readFile(
      path.join(root, 'data/charts/difficulty-profiles.json'),
      'utf8',
    ),
  );
  const goodWindowSeconds =
    profileFile.profiles[difficulty].timing.good_ms / 1000;
  const sendCutoffSeconds = goodWindowSeconds * 0.75;
  const perfectWindowSeconds =
    profileFile.profiles[difficulty].timing.perfect_ms / 1000;
  const goodOffsetSeconds = goodJudgmentTargetSeconds(
    profileFile.profiles[difficulty].timing.perfect_ms,
    profileFile.profiles[difficulty].timing.good_ms,
  );
  const perfectLeadSeconds = Math.min(0.02, perfectWindowSeconds * 0.4);
  const inputDispatchLeadSeconds = Math.min(0.03, goodWindowSeconds * 0.3);
  const audienceMaximum =
    notes.filter((note) => note.time < chart.twilightAt).length *
    profileFile.profiles[difficulty].audience.perfect;
  let scheduledWhen = await waitFor(
    async () =>
      evaluate(
        'Number.isFinite(window.__proofScheduledWhen) ? window.__proofScheduledWhen : null',
      ),
    'actual audio schedule',
  );
  const audioTime = async () =>
    evaluate('window.__proofAudioContexts?.[0]?.currentTime ?? null');
  const currentSongTime = async () =>
    evaluate(
      `(()=>{const c=window.__proofAudioContexts?.[0];const when=window.__proofScheduledWhen;return c&&Number.isFinite(when)?c.currentTime-when+(window.__proofScheduledOffset??0)-${chartSourceStart}:null})()`,
    );
  const waitTransport = async (position) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const now = await audioTime();
      if (now !== null && now - scheduledWhen >= position) return;
      await pause(5);
    }
    throw new Error(`Timed out waiting for song time ${position}`);
  };
  const waitResumedTransport = async (position) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const now = await currentSongTime();
      if (now !== null && now >= position) return now;
      await pause(2);
    }
    throw new Error(`Timed out waiting for resumed song time ${position}`);
  };
  const armJudgmentReceipt = async (note, expected) =>
    evaluate(`(()=>{
      const active={
        runId:${JSON.stringify(runId)},
        noteId:${JSON.stringify(note.id)},
        lane:${JSON.stringify(['D', 'F', 'J', 'K'][note.lane])},
        keyCode:${JSON.stringify(['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane])},
        expected:${JSON.stringify(expected)},
        baselineText:document.querySelector('[data-gameplay-status]')?.textContent?.trim()??''
      };
      window.__proofActiveJudgment=active;
      return active;
    })()`);
  const waitForKeydownReceipt = async (note) =>
    waitFor(
      () =>
        evaluate(`window.__proofKeydownReceipts.find(receipt=>
          receipt.runId===${JSON.stringify(runId)}&&
          receipt.noteId===${JSON.stringify(note.id)}
        )??null`),
      `browser keydown receipt for ${note.id}`,
      1000,
    );
  const waitForJudgmentReceipt = async (note, expected, inputReceipt) => {
    try {
      return await waitFor(
        () =>
          evaluate(`window.__proofJudgmentReceipts.find(receipt=>
          receipt.runId===${JSON.stringify(runId)}&&
          receipt.noteId===${JSON.stringify(note.id)}
        )??null`),
        `browser-side ${expected} receipt for ${note.id}`,
        5000,
      );
    } catch (error) {
      const latest = await evaluate(
        `window.__proofJudgmentReceipts.filter(receipt=>receipt.runId===${JSON.stringify(runId)}&&receipt.noteId===${JSON.stringify(note.id)}).at(-1)??null`,
      );
      throw new Error(
        `Missing ${expected} DOM receipt for ${note.id}; input keydown=${JSON.stringify(inputReceipt)}; latest DOM receipt=${JSON.stringify(latest)}; ${error.message}`,
        { cause: error },
      );
    }
  };
  const captureLateNoteTravel = async (note, samples) => {
    reports.lateNoteTravel = [];
    const clockWasScaled = await evaluate(`(()=>{
      const audio=window.__proofAudioContexts?.[0];
      if(typeof audio?.__setProofClockRate!=='function')return false;
      audio.__setProofClockRate(0.1);
      return true;
    })()`);
    if (!clockWasScaled)
      throw new Error(
        'Could not slow the silent proof clock for frame sampling',
      );
    try {
      if (!lateTravelBindingInstalled) {
        await command('Runtime.addBinding', {
          name: '__brightvaleLateTravelSample',
        });
        lateTravelBindingInstalled = true;
      }
      const scheduled = await evaluate(`(()=>{
        const audio=window.__proofAudioContexts?.[0];
        const scheduled=window.__proofScheduledWhen;
        const report=window.__brightvaleLateTravelSample;
        if(!audio||!Number.isFinite(scheduled)||typeof report!=='function')throw new Error('Actual gameplay clock or screencast marker binding is unavailable');
        const samples=${JSON.stringify(samples)};
        let index=0;
        const sampleFrame=()=>{
          const transportTime=audio.currentTime-scheduled;
          if(index<samples.length&&transportTime>=samples[index].transportTime){
            report(JSON.stringify({...samples[index],capturedTransportTime:transportTime}));
            index+=1;
          }
          if(index<samples.length)requestAnimationFrame(sampleFrame);
        };
        requestAnimationFrame(sampleFrame);
        return true;
      })()`);
      if (scheduled !== true)
        throw new Error(
          `Could not schedule actual-app travel samples for ${note.id}`,
        );
      await waitFor(
        async () => reports.lateNoteTravel.length === samples.length,
        `actual-app travel frames for ${note.id}`,
        15000,
      );
      await Promise.all(lateTravelWrites);
    } finally {
      await evaluate(
        `window.__proofAudioContexts?.[0]?.__setProofClockRate?.(1)`,
      );
    }
    return reports.lateNoteTravel.sort(
      (left, right) => left.transportTime - right.transportTime,
    );
  };
  const hitNotes = [];
  const pendingPeakScreenshots = [];
  if (!reports.initialPause.panels.includes('pause'))
    throw new Error(
      `Expected the initial performance to be paused during chart-proof setup: ${JSON.stringify(reports.initialPause)}`,
    );
  const restartClick = await click('[data-action="restart"]');
  const restartedSchedule = await waitFor(
    () =>
      evaluate(`(() => {
        const when=window.__proofScheduledWhen;
        return Number.isFinite(when)&&when!==${JSON.stringify(scheduledWhen)}
          ?{when,offset:window.__proofScheduledOffset,duration:window.__proofScheduledDuration}
          :null;
      })()`),
    'trusted Start over schedule from chart time zero',
    10000,
  );
  if (
    restartClick.action !== 'restart' ||
    restartedSchedule.offset !== chartSourceStart ||
    restartedSchedule.duration !== chartDuration
  )
    throw new Error(
      `Start over did not restore the authored chart interval: ${JSON.stringify({ restartClick, restartedSchedule, chartSourceStart, chartDuration })}`,
    );
  await waitFor(
    () =>
      evaluate(`(() => {
        const context=window.__proofAudioContexts?.[0];
        return context?.state==='running'&&context.currentTime>=${JSON.stringify(restartedSchedule.when)};
      })()`),
    'restarted chart audio clock at its actual scheduled start',
    12000,
  );
  scheduledWhen = restartedSchedule.when;
  reports.noteRunRestart = {
    click: restartClick,
    scheduled: restartedSchedule,
    clockModified: false,
  };
  let capturedReferenceAudience = false;
  let resizedNarrow = false;
  let capturedNarrowAudience = false;
  let capturedNarrowTwilight = false;
  let capturedReferenceTwilight = false;
  let pausedAtTwilight = false;
  for (const note of notes) {
    const expectedJudgment = judgmentExpectedById.get(note.id);
    if (expectedJudgment !== undefined)
      await armJudgmentReceipt(note, expectedJudgment);
    if (!capturedReferenceAudience && note.time >= 9.7) {
      await waitTransport(10.2);
      reports.audienceReference = await inspect();
      reports.audienceHud = await inspectResourceHud();
      if (
        reports.audienceHud.renownLabel.hidden ||
        reports.audienceHud.renown.hidden ||
        !reports.audienceHud.personalLabel.hidden ||
        !reports.audienceHud.personal.hidden ||
        !reports.audienceHud.twilightGroup.hidden ||
        !Number.isFinite(Number(reports.audienceHud.renown.text)) ||
        reports.audienceHud.renownMaximum.text !== String(audienceMaximum) ||
        reports.audienceHud.renownBar.ariaValueText !==
          `${reports.audienceHud.renown.text} of ${audienceMaximum}`
      )
        throw new Error(
          `Audience HUD did not show only uncapped Renown: ${JSON.stringify(reports.audienceHud)}`,
        );
      await screenshot('audience-reference.webp');
      const legendRegion = reports.audienceReference.visible.hud.find(
        (entry) => entry.key === 'legend',
      )?.rect;
      if (legendRegion === undefined)
        throw new Error('Could not measure the visible timing-legend region');
      reports.timingLegendScreenshotProbe = timingLegendScreenshotProbe(
        'audience-reference.webp',
        legendRegion,
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

      reports.activeResponsiveFrames = [];
      for (const [width, height, name] of [
        [1920, 600, 'wide-short'],
        [1366, 768, 'laptop'],
        [1280, 720, 'compact-laptop'],
      ]) {
        await resize(width, height);
        const capture = await inspect();
        reports.activeResponsiveFrames.push({ width, height, capture });
        if (capture.state.renderer !== 'rendered')
          throw new Error(
            `Active renderer not rendered at ${width}x${height}: ${JSON.stringify(capture.state)}`,
          );
        await screenshot(`audience-${name}.webp`);
      }
      await resize(1120, 700);
    }
    if (!capturedNarrowTwilight && note.id === 't02') {
      await waitTransport(note.time);
      reports.twilightNarrow = await inspect();
      reports.twilightHud = await inspectResourceHud();
      if (
        !reports.twilightHud.renown.hidden ||
        reports.twilightHud.personalLabel.hidden ||
        reports.twilightHud.personal.hidden ||
        reports.twilightHud.twilightGroup.hidden ||
        reports.twilightHud.twilight.hidden ||
        !Number.isFinite(Number(reports.twilightHud.personal.text)) ||
        !Number.isFinite(Number(reports.twilightHud.twilight.text)) ||
        reports.twilightHud.personal.text !== reports.twilightHud.renown.text ||
        reports.twilightHud.personalMaximum.text !==
          reports.twilightHud.renown.text ||
        reports.twilightHud.twilightMaximum.text !==
          String(chart.twilightStrength)
      )
        throw new Error(
          `Twilight HUD did not show both strengths: ${JSON.stringify(reports.twilightHud)}`,
        );
      reports.modeAtTransition = await evaluate(
        `document.querySelector('[data-mode-label]')?.textContent?.trim() ?? null`,
      );
      await screenshot('twilight-narrow.webp');
      capturedNarrowTwilight = true;
      await resize(390, 844, 2);
      reports.twilightPhoneDpr2 = await inspect();
      reports.twilightPhoneHud = await inspectResourceHud();
      await screenshot('twilight-phone-dpr2.webp');
      if (reports.twilightPhoneDpr2.state.renderer !== 'rendered')
        throw new Error(
          'Renderer failed at constrained phone viewport / DPR 2',
        );
      if (
        reports.twilightPhoneDpr2.visible.viewport.document.scrollWidth > 390 ||
        reports.twilightPhoneHud.difficultySelect !== null
      )
        throw new Error(
          `Phone HUD controls overflow or overlap: ${JSON.stringify(reports.twilightPhoneHud)}`,
        );
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
      reports.escapePause = await pauseWithEscape();
      pausedAtTwilight = true;
      // Once Pause is confirmed, stop scheduling chart keys. Audio clocks can
      // continue advancing while the game is paused; those keys would not be
      // gameplay inputs and must not be counted as such.
      break;
    }
    const effectDelay =
      expectedJudgment === 'good'
        ? goodOffsetSeconds
        : expectedJudgment === 'miss'
          ? goodWindowSeconds + 0.03
          : expectedJudgment === 'perfect'
            ? -perfectLeadSeconds
            : 0;
    const inputTargetTime =
      note.time + effectDelay - (expectedJudgment === 'good' ? 0 : inputDispatchLeadSeconds);
    await waitTransport(inputTargetTime);
    if (note.id === missedJudgmentNote.id) {
      const missedLane = ['D', 'F', 'J', 'K'][note.lane];
      const liveRegion = await waitForJudgmentReceipt(note, 'miss');
      const receipt = recordJudgmentReceipt({
        runId,
        noteId: note.id,
        lane: missedLane,
        expected: 'miss',
        liveRegionText: liveRegion.liveRegionText,
        receivedAt: liveRegion.performanceTime,
      });
      queueJudgmentVisualCapture(receipt, pendingPeakScreenshots);
      reports.judgmentEffects ??= [];
      reports.judgmentEffects.push({
        ...receipt,
        receiptAudioTime: liveRegion.audioTime,
        receiptScheduledWhen: liveRegion.scheduledWhen,
        screenshots: [`${runPrefix}-judgment-miss-capture-${note.id}.webp`],
        source: 'actual chart note left unplayed until its model miss deadline',
      });
      hitNotes.push({ id: note.id, result: 'deliberately-missed' });
      continue;
    }
    const keyCode = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane];
    const now = await audioTime();
    const lateness = now - scheduledWhen - note.time;
    if (lateness > sendCutoffSeconds && expectedJudgment === undefined) {
      hitNotes.push({ id: note.id, result: 'not-sent-late', lateness });
      continue;
    }
    await key(keyCode, 'down');
    if (expectedJudgment !== undefined) {
      const expected = expectedJudgment;
      const inputReceipt = await waitForKeydownReceipt(note);
      const liveRegion = await waitForJudgmentReceipt(note, expected, inputReceipt);
      const receipt = recordJudgmentReceipt({
        runId,
        noteId: note.id,
        lane: ['D', 'F', 'J', 'K'][note.lane],
        expected,
        liveRegionText: liveRegion.liveRegionText,
        receivedAt: liveRegion.performanceTime,
        inputReceipt,
        receiptAudioTime: liveRegion.audioTime,
        receiptPerformanceTime: liveRegion.performanceTime,
      });
      queueJudgmentVisualCapture(receipt, pendingPeakScreenshots);
      reports.judgmentEffects ??= [];
      reports.judgmentEffects.push({
        ...receipt,
        receiptAudioTime: liveRegion.audioTime,
        receiptScheduledWhen: liveRegion.scheduledWhen,
        inputAudioTime: inputReceipt.audioTime,
        inputPerformanceTime: inputReceipt.performanceTime,
        receiptDelayAudioSeconds: receipt.receiptDelayAudioSeconds,
        receiptDelayPerformanceMs: receipt.receiptDelayPerformanceMs,
        screenshots: [
          `${runPrefix}-judgment-${expected}-capture-${note.id}.webp`,
        ],
        source:
          'actual chart note, CDP D/F/J/K keyboard input and rendered WebGL app',
      });
      await key(keyCode, 'up');
      hitNotes.push({ id: note.id, result: 'key-sent', lateness });
      continue;
    }
    await key(keyCode, 'up');
    hitNotes.push({ id: note.id, result: 'key-sent', lateness });
  }
  await Promise.all(pendingPeakScreenshots);
  if (
    !['perfect', 'good', 'miss'].every((outcome) =>
      reports.judgmentEffects?.some((event) => event.outcome === outcome),
    )
  )
    throw new Error(
      `Expected actual Perfect, Good, and Miss judgment receipts; captured ${JSON.stringify(reports.judgmentEffects)}`,
    );
  reports.nativeClockJudgmentReceipts = reports.judgmentEffects
    .filter((event) =>
      judgmentNotes.slice(0, 3).some((note) => note.id === event.noteId),
    )
    .map(
      ({
        runId,
        noteId,
        lane,
        outcome,
         expected,
         receivedAt,
         inputReceipt,
         inputAudioTime,
         inputPerformanceTime,
         receiptAudioTime,
         receiptScheduledWhen,
         receiptDelayAudioSeconds,
         receiptDelayPerformanceMs,
      }) => ({
        runId,
        noteId,
        lane,
        outcome,
         expected,
         receivedAt,
         inputReceipt,
         inputAudioTime,
         inputPerformanceTime,
         receiptAudioTime,
         receiptScheduledWhen,
         receiptDelayAudioSeconds,
         receiptDelayPerformanceMs,
      }),
    );
  if (
    reports.nativeClockJudgmentReceipts
      .map((event) => event.outcome)
      .join(',') !== 'perfect,good,perfect'
  )
    throw new Error(
      `Native-clock trusted judgments were not Perfect/Good/Perfect: ${JSON.stringify(reports.nativeClockJudgmentReceipts)}`,
    );
  reports.chartInput = {
    method:
      'CDP keyDown/keyUp on D/F/J/K; immediate browser-side live-region receipt associated to run/note/lane; no controller or scoring hooks',
    nativeClockJudgmentNotes: judgmentNotes.slice(0, 3).map((note) => note.id),
    nativeClockPlaythroughContinuesUntil: 't02 (Escape Pause)',
    controlledVisualProbeRun: 'controlled-visual-probe-run',
    controlledVisualClockIsNotNativeSyncEvidence: true,
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
  if (!pausedAtTwilight) reports.escapePause = await pauseWithEscape();
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
  // Start a fresh real-app run and play the chart through Twilight's defeat to
  // verify radiant mode and the natural song-end boundary with real input.
  await command('Page.navigate', { url: `${base}?browser-proof=victory` });
  reports.victoryRunStartup = await selectAndStartSong(
    'victory run',
    'victory-observatory-selected-song.webp',
  );
  scheduledWhen = reports.victoryRunStartup.scheduled.scheduledWhen;
  if (
    reports.victoryRunStartup.scheduled.sourceOffset !== chartSourceStart ||
    reports.victoryRunStartup.scheduled.sourceDuration !== chartDuration
  )
    throw new Error(
      `Victory run Play scheduled a different demo interval: ${JSON.stringify(reports.victoryRunStartup.scheduled)}`,
    );
  const waitRestartTransport = async (position) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const now = await currentSongTime();
      if (now !== null && now >= position) return now;
      await pause(2);
    }
    throw new Error(`Timed out waiting for restarted song time ${position}`);
  };
  let victoryValues = null;
  let victoryNoteIndex = -1;
  let victoryProbeNote = null;
  const victoryInput = [];
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const reached = await waitRestartTransport(note.time);
    const lateness = reached - note.time;
    const keyCode = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane];
    if (victoryValues !== null && note.id !== victoryProbeNote?.id) {
      const hud = await inspectResourceHud();
      if (
        hud.personal.text !== victoryValues.personal.text ||
        hud.twilight.text !== victoryValues.twilight.text ||
        hud.personalBar.value !== victoryValues.personalBar.value ||
        hud.twilightBar.value !== victoryValues.twilightBar.value
      )
        throw new Error(
          `Strength changed during post-victory playback at ${note.id}: ${JSON.stringify({ victoryValues, hud })}`,
        );
      victoryInput.push({ id: note.id, result: 'left-unplayed-after-victory', lateness });
      continue;
    }
    if (victoryValues !== null && note.id === victoryProbeNote?.id) {
      const probeLane = ['D', 'F', 'J', 'K'][note.lane];
      const missDeadline = note.time + goodWindowSeconds + 0.03;
      if (note.time <= victoryValues.transportTime || missDeadline <= victoryValues.transportTime)
        throw new Error(
          `Chosen post-victory probe ${note.id} does not occur after observed victory: ${JSON.stringify({ note, missDeadline, victoryValues })}`,
        );
      const mutationCount = await evaluate('window.__proofStatusMutations.length');
      await waitRestartTransport(note.time + goodWindowSeconds + 0.03);
      reports.victoryProbeDomReceipt = await waitFor(
        () =>
          evaluate(
            `window.__proofStatusMutations.slice(${mutationCount}).find(receipt=>new RegExp(${JSON.stringify(`Lane ${probeLane}: Miss`)},'i').test(receipt.text))??null`,
          ),
        'post-victory final-lane miss feedback',
      );
      const afterMiss = await inspectResourceHud();
      if (
        victoryValues === null ||
        afterMiss.personal.text !== victoryValues.personal.text ||
        afterMiss.twilight.text !== victoryValues.twilight.text ||
        afterMiss.personalBar.value !== victoryValues.personalBar.value ||
        afterMiss.twilightBar.value !== victoryValues.twilightBar.value
      )
        throw new Error(
          `Strength changed after the victory miss: ${JSON.stringify({ victoryValues, afterMiss, victoryInput })}`,
        );
      reports.victoryAfterMiss = afterMiss;
      victoryInput.push({
        id: note.id,
        lane: probeLane,
        result: 'deliberately-missed',
        lateness,
        noteTime: note.time,
        missDeadline,
        observedVictoryTime: victoryValues.transportTime,
      });
      reports.victoryProbe = {
        noteId: note.id,
        lane: probeLane,
        noteTime: note.time,
        missDeadline,
        observedVictoryTime: victoryValues.transportTime,
        selectedOnlyAfterVictoryObserved: true,
      };
      break;
    }
    await key(keyCode, 'down');
    await key(keyCode, 'up');
    victoryInput.push({ id: note.id, result: 'key-sent', lateness });
    await pause(25);
    if (victoryValues === null) {
      const reachedVictory = await evaluate(
        `document.querySelector('.play-surface')?.classList.contains('is-victory') ?? false`,
      );
      if (reachedVictory) {
        victoryNoteIndex = index;
        const victoryObservedTransportTime = await currentSongTime();
        const hud = await inspectResourceHud();
        const announcementReceipt = await evaluate(
          `window.__proofStatusMutations.findLast(receipt=>/Twilight is defeated/i.test(receipt.text))??null`,
        );
        const announcement = announcementReceipt?.text ?? await evaluate(
          `document.querySelector('[data-gameplay-status]')?.textContent?.trim()??''`,
        );
        if (
          hud.mode !== 'Radiant victory · the song continues' ||
          !/Twilight is defeated/i.test(announcement)
        )
          throw new Error(
            `Victory presentation or accessible announcement was missing: ${JSON.stringify({ hud, announcement })}`,
          );
        victoryValues = hud;
        victoryProbeNote = notes
          .slice(index + 1)
          .find((candidate) => candidate.time > victoryObservedTransportTime + 0.25);
        if (victoryProbeNote === undefined)
          throw new Error(
            `Victory at ${victoryObservedTransportTime}s has no later chart note for a post-victory probe.`,
          );
        reports.victoryProbeSelection = {
          noteId: victoryProbeNote.id,
          lane: ['D', 'F', 'J', 'K'][victoryProbeNote.lane],
          noteTime: victoryProbeNote.time,
          observedVictoryTime: victoryObservedTransportTime,
          selectedAfterVictoryObserved: true,
        };
        reports.radiantVictory = {
          noteId: note.id,
          transportTime: victoryObservedTransportTime,
          phase: 'Twilight',
          playing: true,
          announcement,
          announcementReceipt,
          hud,
          screenshot: `${runPrefix}-radiant-victory.webp`,
        };
        await screenshot('radiant-victory.webp');
      }
    } else if (index > victoryNoteIndex) {
      const hud = await inspectResourceHud();
      if (
        hud.personal.text !== victoryValues.personal.text ||
        hud.twilight.text !== victoryValues.twilight.text ||
        hud.personalBar.value !== victoryValues.personalBar.value ||
        hud.twilightBar.value !== victoryValues.twilightBar.value
      )
        throw new Error(
          `Strength changed after victory judgment ${note.id}: ${JSON.stringify({ victoryValues, hud })}`,
        );
    }
  }
  if (victoryValues === null)
    throw new Error(
      `The real chart did not reach victory: ${JSON.stringify(victoryInput)}`,
    );
  if (reports.victoryProbe === undefined)
    throw new Error(
      `Victory was observed but no post-victory miss probe completed: ${JSON.stringify({ victoryValues, victoryProbeNote, victoryInput })}`,
    );
  const afterVictoryMissState = await status();
  if (afterVictoryMissState.panels.includes('results'))
    throw new Error('Results appeared before the song reached its natural end');
  reports.victoryContinuedPerformance = {
    inputs: victoryInput,
    lastGameplayTime: afterVictoryMissState.time,
    stillPlayingBeforeNaturalEnd: true,
  };
  const naturalEnd = await waitFor(
    async () => {
      const state = await status();
      return state.panels.includes('results') ? state : false;
    },
    'natural song-end results after victory',
    20000,
  );
  const finalOutcome = await evaluate(
    `document.querySelector('[data-result-title]')?.textContent?.trim()??''`,
  );
  if (!/victory/i.test(finalOutcome))
    throw new Error(
      `Natural song end did not preserve Victory result: ${finalOutcome}`,
    );
  reports.naturalVictoryResults = {
    state: naturalEnd,
    outcome: finalOutcome,
    songDuration: chartDuration,
  };
  // Keep the native-clock gameplay/judgment runs uninterrupted. Run the scaled
  // late-note frame-positioning probe separately after the outcome is recorded.
  await command('Page.navigate', {
    url: `${base}?browser-proof=controlled-visual`,
  });
  reports.controlledVisualRunStartup = await selectAndStartSong(
    'controlled visual probe run',
    'controlled-visual-observatory-selected-song.webp',
  );
  reports.controlledVisualClockProbe = await installPostStartupClockProbe();
  const controlledVisualSchedule = reports.controlledVisualRunStartup.scheduled;
  scheduledWhen = controlledVisualSchedule.scheduledWhen;
  const lateNote = missedJudgmentNote;
  if (!lateNote)
    throw new Error('Chart has no selected miss note for the visual probe.');
  await waitTransport(lateNote.time - 0.08);
  const visualSamples = [
    { name: 'before-target', transportTime: lateNote.time - 0.05 },
    { name: 'at-target', transportTime: lateNote.time },
    {
      name: 'late-window',
      transportTime: lateNote.time + goodWindowSeconds * 0.45,
    },
    {
      name: 'before-miss-cutoff',
      transportTime: lateNote.time + goodWindowSeconds - 0.03,
    },
  ].map((sample) => ({ ...sample, noteId: lateNote.id, lane: lateNote.lane }));
  const capturedVisualSamples = await captureLateNoteTravel(
    lateNote,
    visualSamples,
  );
  if (
    capturedVisualSamples.some(
      (sample, index) =>
        sample.capturedTransportTime < visualSamples[index].transportTime ||
        sample.capturedTransportTime - visualSamples[index].transportTime >
          0.045,
    )
  )
    throw new Error(
      `Controlled visual samples missed their requested transport instants: ${JSON.stringify(capturedVisualSamples)}`,
    );
  reports.controlledVisualProbe = {
    runId: 'controlled-visual-probe-run',
    noteId: lateNote.id,
    clockScaled: true,
    nativeClockSyncClaim: false,
    samples: capturedVisualSamples,
  };
  reports.webVitals = {
    userAgent: await evaluate('navigator.userAgent'),
    devicePixelRatio: await evaluate('devicePixelRatio'),
    songVolume: process.env.VITE_SONG_VOLUME,
  };
  reports.consoleApiEvents = events.filter(
    (x) => x.method === 'Runtime.consoleAPICalled',
  ).length;
  reports.loadedResources = await evaluate(
    `performance.getEntriesByType('resource').map(e=>e.name).filter(x=>x.includes('/src/main')||x.includes('/src/rendering/')||x.includes('/src/ui/')||x.includes('/src/game/')||x.includes('/src/audio/')||x.toLowerCase().includes('.glb')||x.includes('/data/music/')).map(x=>new URL(x).pathname)`,
  );
  const outputReport = {
    proof: 'Brightvale actual gameplay browser proof',
    status: reports.timingLegendScreenshotProbe.visible
      ? 'partial'
      : 'visual-blocker',
    harnessChecks: 'passed',
    command: `npm run test:brightvale:browser -- gameplay ${songId} ${difficulty}`,
    runtime: `actual src/main.ts app; selected generated ${songId}/${difficulty} chart, production audio and GLB-backed scene`,
    viewportSamples: {
      reference: { width: 1600, height: 900 },
      narrow: { width: 1120, height: 700 },
      phoneTwilight: { width: 390, height: 844, deviceScaleFactor: 2 },
    },
    limitations: [
      'Chromium/SwiftShader; no target-device performance claim.',
      'These viewport sizes are tested samples, not minimum supported dimensions.',
      'Song output was muted; audio audibility is not evaluated.',
      'No per-person live-occlusion pass was available from the application DOM; composition proof has the separate GLB ID-pass evidence.',
      'Radiant victory proof used the actual app, production chart/assets, and CDP keyboard events; its chart time was derived from intercepted AudioBufferSource start offsets, not an independent hardware audio-sync audit.',
      'The browser harness selected the requested generated song/difficulty variant through the actual Observatory controls.',
      'This live harness sends chart-timed keyboard inputs but does not independently inspect internal score judgments or live note mesh vertices.',
      'Per-person occlusion is not exposed by the live app DOM; no fully-visible crowd claim is made from these screenshots.',
      'Both gameplay runs begin through a trusted mouse click on the actual Observatory Play button; no AudioContext exists before Play, and the context is created in that trusted event without an autoplay-policy override or a modified startup clock.',
      `Three selected ${difficulty} variant judgments (Perfect/Good/Perfect) are captured from the live region with browser-side receipt time and note/lane association before any scaled-clock visual probe.`,
      'The late-note screenshot-positioning probe runs separately after native gameplay results; only that run wraps/scales the clock, and it is explicitly not native-clock synchronization evidence.',
      'Judgment screenshots are separate visual captures. Reports include each capture request state/time and do not label them as peak frames.',
      `This actual audio run used ${songId}/${difficulty}.`,
    ],
    ...reports,
  };
  await writeFile(
    path.join(output, `${runPrefix}-report.json`),
    JSON.stringify(outputReport, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        status: reports.timingLegendScreenshotProbe.visible
          ? 'passed-with-limitations'
          : 'visual-blocker',
        screenshots: [
          `${runPrefix}-observatory-selected-song.webp`,
          `${runPrefix}-gameplay-initial.webp`,
          `${runPrefix}-audience-reference.webp`,
          `${runPrefix}-audience-narrow.webp`,
          `${runPrefix}-twilight-narrow.webp`,
          `${runPrefix}-twilight-phone-dpr2.webp`,
          `${runPrefix}-twilight-reference.webp`,
          ...(reports.judgmentVisualCaptures ?? []).map(
            (capture) => capture.filename,
          ),
          ...(reports.lateNoteTravel ?? []).map((sample) => sample.screenshot),
          ...(reports.radiantVictory
            ? [reports.radiantVictory.screenshot]
            : []),
        ],
        liveMode: reports.modeAtTransition,
        radiantVictory: reports.radiantVictory
          ? {
              noteId: reports.radiantVictory.noteId,
              transportTime: reports.radiantVictory.transportTime,
              playing: reports.radiantVictory.playing,
              mode: reports.radiantVictory.hud.mode,
              announcement: reports.radiantVictory.announcement,
              screenshot: reports.radiantVictory.screenshot,
            }
          : null,
        victoryAfterMissMode: reports.victoryAfterMiss?.mode ?? null,
        naturalVictoryResults: reports.naturalVictoryResults ?? null,
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
    path.join(output, `${runPrefix}-report.json`),
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
