import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canvasMatchesMeasuredLayout,
  writeResponsiveReport,
} from './responsive-contract.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const output = path.join(root, '.lore/local/evidence/brightvale-runtime');
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'responsive-report.json');
const source =
  'production src/main.ts + src/ui.ts/styles.css + default GLB scene';
const startedAt = new Date().toISOString();
await writeResponsiveReport(reportPath, {
  status: 'running',
  source,
  startedAt,
  viewports: [],
});
const scratch = `/tmp/opencode/brightvale-responsive-${process.pid}`;
await mkdir(scratch, { recursive: true });
const freePort = () =>
  new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
const ports = [await freePort(), await freePort()];
const vitePort = ports[0];
const debugPort = ports[1];
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
server.stderr.setEncoding('utf8').on('data', (chunk) => (serverLog += chunk));
let browser;
let socket;
let seq = 0;
const pending = new Map();
let layoutSequence = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await check();
    if (result) return result;
    await pause(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function cdp(method, params = {}) {
  const id = ++seq;
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
async function measure() {
  return evaluate(
    `(()=>{
      const host=document.querySelector('.play-surface');
      const canvas=host?.querySelector('canvas');
      const slot=document.querySelector('[data-time]');
      if(!host||!canvas||!slot)return null;
      const hr=host.getBoundingClientRect();
      const cr=canvas.getBoundingClientRect();
      const lr=slot.getBoundingClientRect();
      const style=getComputedStyle(host);
      const n=value=>parseFloat(value)||0;
      const border={left:n(style.borderLeftWidth),right:n(style.borderRightWidth),top:n(style.borderTopWidth),bottom:n(style.borderBottomWidth)};
      const padding={left:n(style.paddingLeft),right:n(style.paddingRight),top:n(style.paddingTop),bottom:n(style.paddingBottom)};
      const content={x:hr.left+border.left+padding.left,y:hr.top+border.top+padding.top,width:hr.width-border.left-border.right-padding.left-padding.right,height:hr.height-border.top-border.bottom-padding.top-padding.bottom};
      return{viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,host:{x:hr.x,y:hr.y,width:hr.width,height:hr.height,clientWidth:host.clientWidth,clientHeight:host.clientHeight},border,padding,content,canvas:{x:cr.x,y:cr.y,width:cr.width,height:cr.height,bufferWidth:canvas.width,bufferHeight:canvas.height,style:{left:canvas.style.left,right:canvas.style.right,top:canvas.style.top,bottom:canvas.style.bottom}},label:{x:lr.x,y:lr.y,width:lr.width,height:lr.height,canvasLocalX:lr.x-cr.x,canvasLocalY:lr.y-cr.y,contentLocalX:lr.x-content.x,contentLocalY:lr.y-content.y},canvasContentDelta:{x:cr.x-content.x,y:cr.y-content.y,width:cr.width-content.width,height:cr.height-content.height},rendererStatus:document.querySelector('[data-renderer-status]')?.hidden?'rendered':'not-rendered'};
    })()`,
  );
}
async function setViewport(width, height, deviceScaleFactor = 1) {
  layoutSequence = await evaluate('window.__brightvaleMeasuredLayouts.length');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });
  let measuredLayout;
  await waitFor(async () => {
    const m = await measure();
    if (
      m?.viewport.width !== width ||
      m?.viewport.height !== height ||
      Math.abs(m.devicePixelRatio - deviceScaleFactor) > 0.001
    )
      return false;
    const layouts = await evaluate(
      `window.__brightvaleMeasuredLayouts.slice(${layoutSequence})`,
    );
    measuredLayout = layouts.find(
      (layout) =>
        Math.abs(layout.width - m.content.width) <= 1 &&
        Math.abs(layout.height - m.content.height) <= 1,
    );
    return (
      measuredLayout !== undefined &&
      canvasMatchesMeasuredLayout(m, measuredLayout)
    );
  }, `measured layout, CSS canvas, and DPR ${deviceScaleFactor} backing store at ${width}x${height}`);
  const m = await measure();
  m.measuredLayout = measuredLayout;
  if (m.rendererStatus !== 'rendered')
    throw new Error(
      `Renderer not rendered at ${width}x${height} DPR ${deviceScaleFactor}`,
    );
  const delta = m.canvasContentDelta;
  if (
    Math.abs(delta.x) > 1 ||
    Math.abs(delta.y) > 1 ||
    Math.abs(delta.width) > 1 ||
    Math.abs(delta.height) > 1
  )
    throw new Error(
      `Canvas/content-box delta exceeds 1 CSS px at ${width}x${height} DPR ${deviceScaleFactor}`,
    );
  return m;
}
async function inspectWebGLResize(label) {
  const result = await evaluate(`(()=>{
    const name=${JSON.stringify(label)};
    const canvas=document.querySelector('.play-surface canvas');
    const gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');
    if(!gl)return {supported:false,label:name};
    const width=canvas.width,height=canvas.height;
    const pixels=new Uint8Array(width*height*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const error=gl.getError();
    return {supported:true,label:name,width,height,error,readbackBytes:pixels.byteLength};
  })()`);
  evidence.webglResizeChecks.push(result);
  if (!result.supported)
    throw new Error(`WebGL context unavailable during ${label}`);
  if (result.error !== 0 || result.readbackBytes === 0)
    throw new Error(
      `WebGL resize readback failed during ${label}: ${JSON.stringify(result)}`,
    );
}
let failure;
let evidence;
async function main() {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${vitePort}/`)).ok;
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
      `http://127.0.0.1:${vitePort}/`,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const target = await waitFor(async () => {
    try {
      return (
        await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      ).find((item) => item.type === 'page');
    } catch {
      return false;
    }
  }, 'Chromium page target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    msg.error
      ? item.reject(new Error(msg.error.message))
      : item.resolve(msg.result);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await waitFor(
    async () => {
      const m = await measure();
      return m?.rendererStatus === 'rendered' && m.canvas.width > 0;
    },
    'actual UI and default GLB scene render',
    60000,
  );
  await evaluate(
    `(()=>{const host=document.querySelector('.play-surface');window.__brightvaleMeasuredLayouts=[];host.addEventListener('brightvale-layout-measured',event=>window.__brightvaleMeasuredLayouts.push({sequence:window.__brightvaleMeasuredLayouts.length+1,width:event.detail.width,height:event.detail.height}))})()`,
  );
  evidence = {
    source,
    viewports: [],
    issues: [],
    dprSamples: [],
    webglResizeChecks: [],
  };
  evidence.viewports.push(await measure());

  for (const width of [1120, 620]) {
    const m = await setViewport(width, 700);
    evidence.viewports.push(m);
    if (m.rendererStatus !== 'rendered') {
      evidence.issues.push(`Renderer not rendered at ${width}px`);
      continue;
    }
    const delta = m.canvasContentDelta;
    if (
      Math.abs(delta.x) > 1 ||
      Math.abs(delta.y) > 1 ||
      Math.abs(delta.width) > 1 ||
      Math.abs(delta.height) > 1
    )
      evidence.issues.push(
        `SCENE04 RED at ${width}px: canvas/content-box delta exceeds 1 CSS px`,
      );
    const anchorDelta = {
      x: m.label.canvasLocalX - m.label.contentLocalX,
      y: m.label.canvasLocalY - m.label.contentLocalY,
    };
    evidence.viewports.at(-1).labelCanvasRegistration = anchorDelta;
    if (Math.abs(anchorDelta.x) > 1 || Math.abs(anchorDelta.y) > 1)
      evidence.issues.push(
        `SCENE04 RED at ${width}px: DOM label-to-canvas coordinate registration exceeds 1 CSS px`,
      );
  }
  for (const [index, deviceScaleFactor] of [1, 1.25, 1.5, 2].entries()) {
    // Alternate a CSS pixel to force a fresh measured-layout event when DPR
    // changes without changing the viewport's content-box dimensions.
    const sample = await setViewport(
      index % 2 === 0 ? 1120 : 1119,
      700,
      deviceScaleFactor,
    );
    sample.requestedDeviceScaleFactor = deviceScaleFactor;
    evidence.dprSamples.push(sample);
    if (!canvasMatchesMeasuredLayout(sample, sample.measuredLayout))
      throw new Error(
        `Canvas failed measured content/DPR contract at DPR ${deviceScaleFactor}`,
      );
  }
  for (const deviceScaleFactor of [1, 1.5]) {
    if (deviceScaleFactor > 1) await setViewport(1366, 768, deviceScaleFactor);
    for (const [width, height] of [
      [800, 600],
      [1366, 768],
      [800, 600],
    ]) {
      const sample = await setViewport(width, height, deviceScaleFactor);
      evidence.viewports.push(sample);
      await inspectWebGLResize(`${width}x${height} DPR ${deviceScaleFactor}`);
    }
  }
  if (evidence.issues.length > 0)
    throw new Error(
      `SCENE04 RED: ${evidence.issues.join('; ')}; evidence=${JSON.stringify(evidence)}`,
    );
}
try {
  await main();
} catch (error) {
  failure = error;
  console.error(String(error), serverLog);
} finally {
  try {
    socket?.close();
  } catch {}
  for (const proc of [browser, server]) {
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await Promise.race([once(proc, 'exit'), pause(4000)]);
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
        await once(proc, 'exit');
      }
    }
  }
  for (const port of ports) {
    const listening = await new Promise((resolve) => {
      const probe = net.connect(port, '127.0.0.1');
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', () => resolve(false));
    });
    if (listening)
      failure ??= new Error(`Owned listener remains on port ${port}`);
  }
  await rm(scratch, { recursive: true, force: true }).catch((error) => {
    failure ??= error;
  });
}
const report = {
  status: failure ? 'failed' : 'passed',
  source,
  startedAt,
  completedAt: new Date().toISOString(),
  ...(evidence ?? { viewports: [], issues: [] }),
  ...(failure ? { error: String(failure) } : {}),
};
try {
  await writeResponsiveReport(reportPath, report);
} catch (error) {
  failure ??= error;
  console.error('Could not atomically write responsive evidence report', error);
}
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
