import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = `${root}.lore/local/evidence/article-capture/${new Date().toISOString().replaceAll(':', '-')}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { output, audioMuted: true, fixture: 'Fresh save; no seeded achievements. Gameplay uses automated keyboard inputs against the real chart and native playback clock.', captures: [], cleanup: {} };
let server, browser, socket, profile, debugPort;
let sequence = 0;
const pending = new Map();
async function wait(check, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await pause(80); }
  throw Error(`Timed out: ${label}`);
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function capture(name) {
  const state = await evaluate(`({mode:document.querySelector('[data-mode-label]')?.textContent,time:document.querySelector('[data-time]')?.textContent,score:document.querySelector('[data-score]')?.textContent})`);
  const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${output}/${name}.png`, Buffer.from(image.data, 'base64'));
  report.captures.push({ name, ...state });
}
try {
  const space = await statfs('/tmp/opencode');
  assert(space.bavail * space.bsize > 1024 ** 3, 'At least 1 GiB scratch space');
  const memory = await readFile('/proc/meminfo', 'utf8');
  assert(Number(memory.match(/MemAvailable:\s+(\d+)/)[1]) > 1048576, 'At least 1 GiB RAM');
  await mkdir(output, { recursive: true });
  profile = await mkdtemp('/tmp/opencode/shining-stars-article-');
  process.env.VITE_SONG_VOLUME = '0';
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true } });
  await server.listen();
  report.url = server.resolvedUrls.local[0];
  assert(!report.url.includes(':3100/'));
  browser = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const endpoint = await wait(async () => { try { return await readFile(`${profile}/DevToolsActivePort`, 'utf8'); } catch { return null; } }, 'owned browser endpoint');
  debugPort = Number(endpoint.split('\n')[0]);
  assert.notEqual(debugPort, 3100);
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({data}) => { const message = JSON.parse(data), request = pending.get(message.id); if (!request) return; clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result); };
  await command('Page.enable');
  // Observe the native clock and scheduling only; do not seek, accelerate or alter state.
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const Original=window.AudioContext;window.AudioContext=class extends Original{constructor(...args){super(...args);window.__articleAudio=this}};const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(when,...args){window.__articleWhen??=when;return start.call(this,when,...args)}})()` });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: report.url });
  await wait(() => evaluate(`document.readyState==='complete' && !!document.querySelector('[data-action="all-songs"]') && document.querySelector('[data-renderer-notice]').hidden`), 'real Observatory rendered');
  await pause(1500);
  await capture('observatory-collections');
  await click('[data-action="all-songs"]');
  await click('[data-action="select-song"][data-song-id="the-first-shining-star"]');
  await pause(300);
  await capture('song-selection');
  await click('[data-action="play"]');
  await wait(() => evaluate(`window.__articleAudio?.state==='running' && Number.isFinite(window.__articleWhen) && window.__articleAudio.currentTime>=window.__articleWhen`), 'native playback');
  const chart = JSON.parse(await readFile(`${root}data/charts/generated/the-first-shining-star.charts.json`, 'utf8')).charts.normal;
  await evaluate(`(()=>{const notes=${JSON.stringify(chart.notes)};let next=0;window.__articleKeys=setInterval(()=>{const t=window.__articleAudio.currentTime-window.__articleWhen;while(next<notes.length&&notes[next].time<=t){const note=notes[next++];if(note.time<t-.15)continue;const code=['KeyD','KeyF','KeyJ','KeyK'][note.lane];window.dispatchEvent(new KeyboardEvent('keydown',{code,key:code.slice(3).toLowerCase(),bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code,key:code.slice(3).toLowerCase(),bubbles:true}))}},4)})()`);
  let audience = false, twilight = false;
  const deadline = Date.now() + 230000;
  while (Date.now() < deadline && !twilight) {
    const time = await evaluate('window.__articleAudio.currentTime-window.__articleWhen');
    if (!audience && time > 16) { await capture('gameplay-audience'); audience = true; }
    if (time > chart.twilightAt + 0.8) { await capture('gameplay-twilight'); twilight = true; }
    await pause(15);
  }
  assert(audience && twilight, 'Both gameplay phases captured');
  report.result = 'captured';
} catch (error) {
  report.result = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;
} finally {
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (browser) { browser.kill('SIGTERM'); await Promise.race([new Promise(resolve => browser.once('exit', resolve)), pause(3000)]); if (browser.exitCode === null && browser.signalCode === null) { browser.kill('SIGKILL'); await pause(400); } report.cleanup.browserExited = browser.exitCode !== null || browser.signalCode !== null; }
  if (server) { await server.close(); report.cleanup.serverClosed = true; }
  if (profile) { await rm(profile, { recursive: true, force: true }); report.cleanup.profileRemoved = true; }
  if (debugPort) { try { await fetch(`http://127.0.0.1:${debugPort}/json/list`); report.cleanup.portClosed = false; } catch { report.cleanup.portClosed = true; } }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
