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
const difficulty = 'normal';
if (process.argv.slice(2).some((value) => value !== 'normal'))
  throw new Error(
    'Only the configured default Normal run is available in this HUD.',
  );
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
    path.join(output, `${difficulty}-${name}`),
    Buffer.from(shot.data, 'base64'),
  );
}
function timingLegendScreenshotProbe(name, measuredRegion) {
  const imagePath = path.join(output, `${difficulty}-${name}`);
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
    sourceImage: `${difficulty}-${name}`,
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
  await click('[data-action="start"]');
  await waitFor(async () => {
    const s = await status();
    return !s.panels.includes('ready') && s.renderer === 'rendered';
  }, 'active gameplay');
  const chartSource = await readFile(
    path.join(root, 'src/game/mvp-chart.ts'),
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
  const pendingPeakScreenshots = [];
  const pendingFadeScreenshots = [];
  const captureFadeAfter = (name, delayMs) =>
    pendingFadeScreenshots.push(
      new Promise((resolve, reject) => {
        setTimeout(() => screenshot(name).then(resolve, reject), delayMs);
      }),
    );
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
      reports.audienceHud = await inspectResourceHud();
      if (
        reports.audienceHud.renownLabel.hidden ||
        reports.audienceHud.renown.hidden ||
        !reports.audienceHud.personalLabel.hidden ||
        !reports.audienceHud.personal.hidden ||
        !reports.audienceHud.twilightGroup.hidden ||
        !Number.isFinite(Number(reports.audienceHud.renown.text)) ||
        reports.audienceHud.renownMaximum.text !== '132' ||
        reports.audienceHud.renownBar.ariaValueText !==
          `${reports.audienceHud.renown.text} of 132`
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
        reports.twilightHud.twilightMaximum.text !== '100'
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
      note.id === 'a02' ? 0.085 : note.id === 'a05' ? goodWindowSeconds + 0.03 : 0;
    await waitTransport(note.time + effectDelay);
    if (note.id === 'a05') {
      await pause(110);
      const missedLane = ['D', 'F', 'J', 'K'][note.lane];
      const accessibleText = await waitFor(async () => {
        const text = await evaluate(
          `document.querySelector('[data-gameplay-status]')?.textContent?.trim()??''`,
        );
        return new RegExp(`Lane ${missedLane}: Miss`, 'i').test(text)
          ? text
          : false;
      }, `the deliberately missed ${note.id} lane`);
      await screenshot('judgment-miss-peak.webp');
      await pause(450);
      await screenshot('judgment-miss-fade.webp');
      reports.judgmentEffects ??= [];
      reports.judgmentEffects.push({
        noteId: note.id,
        outcome: 'miss',
        accessibleText,
        screenshots: [
          'normal-judgment-miss-peak.webp',
          'normal-judgment-miss-fade.webp',
        ],
        source: 'actual chart note left unplayed until its model miss deadline',
      });
      hitNotes.push({ id: note.id, result: 'deliberately-missed' });
      continue;
    }
    const keyCode = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane];
    const now = await audioTime();
    const lateness = now - scheduledWhen - note.time;
    if (
      note.id === 'a02' &&
      (lateness < 0.075 || lateness > 0.145)
    )
      throw new Error(
        `The real-app Good probe missed the Normal Good window: ${lateness}s`,
      );
    if (lateness > sendCutoffSeconds && note.id !== 'a02') {
      hitNotes.push({ id: note.id, result: 'not-sent-late', lateness });
      continue;
    }
    await key(keyCode, 'down');
    if (note.id === 'a01' || note.id === 'a02' || note.id === 'a04') {
      const expected = note.id === 'a02' ? 'good' : 'perfect';
      if (note.id === 'a01')
        await screenshot(`judgment-${expected}-peak.webp`);
      else if (note.id === 'a02')
        pendingPeakScreenshots.push(screenshot(`judgment-${expected}-peak.webp`));
      if (note.id === 'a01' || note.id === 'a02')
        captureFadeAfter(`judgment-${expected}-fade.webp`, 400);
      const accessibleText = await evaluate(
        `document.querySelector('[data-gameplay-status]')?.textContent?.trim()??''`,
      );
      if (!new RegExp(expected, 'i').test(accessibleText))
        throw new Error(
          `Expected actual ${expected} feedback for ${note.id}, got: ${accessibleText}`,
        );
      reports.judgmentEffects ??= [];
      reports.judgmentEffects.push({
        noteId: note.id,
        outcome: expected,
        lateness,
        accessibleText,
        screenshots: [
          `normal-judgment-${expected}-peak.webp`,
          `normal-judgment-${expected}-fade.webp`,
        ],
        source: 'actual chart note, CDP D/F/J/K keyboard input and rendered WebGL app',
      });
      await key(keyCode, 'up');
      hitNotes.push({ id: note.id, result: 'key-sent', lateness });
      continue;
    }
    await key(keyCode, 'up');
    hitNotes.push({ id: note.id, result: 'key-sent', lateness });
  }
  await Promise.all(pendingPeakScreenshots);
  await Promise.all(pendingFadeScreenshots);
  if (
    !['perfect', 'good', 'miss'].every((outcome) =>
      reports.judgmentEffects?.some((event) => event.outcome === outcome),
    )
  )
    throw new Error(
      `Expected actual Perfect, Good, and Miss visual probes; captured ${JSON.stringify(reports.judgmentEffects)}`,
    );
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
    command: `npm run test:brightvale:browser -- ${difficulty}`,
    runtime:
      'actual src/main.ts app; production chart/audio and GLB-backed scene',
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
      'This HUD uses the default Normal run; selection of other difficulty profiles is not currently exposed.',
      'This live harness sends chart-timed keyboard inputs but does not independently inspect internal score judgments or live note mesh vertices.',
      'Per-person occlusion is not exposed by the live app DOM; no fully-visible crowd claim is made from these screenshots.',
      `This actual audio run used the configured ${difficulty} default.`,
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
          `${difficulty}-twilight-phone-dpr2.webp`,
          `${difficulty}-twilight-reference.webp`,
          `${difficulty}-judgment-perfect-peak.webp`,
          `${difficulty}-judgment-perfect-fade.webp`,
          `${difficulty}-judgment-good-peak.webp`,
          `${difficulty}-judgment-good-fade.webp`,
          `${difficulty}-judgment-miss-peak.webp`,
          `${difficulty}-judgment-miss-fade.webp`,
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
