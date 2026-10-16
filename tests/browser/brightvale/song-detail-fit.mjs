import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  statfs,
} from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const phase = process.env.DETAIL_FIT_PHASE ?? 'after';
const output = `${root}.lore/local/evidence/song-detail-fit/${phase}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { phase, volume: 0, muted: true, measurements: [], cleanup: {} };
let server, browser, socket, profile, port;
let sequence = 0;
const pending = new Map();
async function wait(check, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  const memory = await readFile('/proc/meminfo', 'utf8');
  assert(
    Number(memory.match(/MemAvailable:\s+(\d+)/)[1]) > 1048576,
    'At least 1 GiB available memory',
  );
  const disk = await statfs('/tmp/opencode');
  assert(
    disk.bavail * disk.bsize > 1073741824,
    'At least 1 GiB available temp space',
  );
  await mkdir(output, { recursive: true });
  profile = await mkdtemp('/tmp/opencode/song-detail-fit-');
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  assert.notEqual(port, 3100);
  process.env.VITE_SONG_VOLUME = '0';
  server = await createServer({
    root,
    server: { port: 0, host: '127.0.0.1', strictPort: true },
  });
  await server.listen();
  report.url = server.resolvedUrls.local[0];
  report.port = port;
  browser = spawn(
    process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--mute-audio',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  report.pid = browser.pid;
  const pages = await wait(async () => {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      return null;
    }
  }, 'owned browser');
  socket = new WebSocket(
    pages.find((page) => page.type === 'page').webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data),
      request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    message.error
      ? request.reject(new Error(JSON.stringify(message.error)))
      : request.resolve(message.result);
  };
  await command('Page.enable');
  await command('Page.navigate', { url: report.url });
  await wait(
    () =>
      evaluate(
        `document.readyState==='complete' && !!document.querySelector('[data-action="all-songs"]')`,
      ),
    'real app',
  );
  await evaluate(`document.querySelector('[data-action="all-songs"]').click()`);
  await wait(
    () => evaluate(`!!document.querySelector('[data-five-gold-target]')`),
    'song details',
  );
  // Seeded historical rating is presentation-only, never gameplay evidence.
  await evaluate(
    `localStorage.setItem('shining-stars.song-ratings',JSON.stringify({schemaVersion:1,ratings:{'the-first-shining-star':{played:true,normalStars:5,goldStars:2}}}))`,
  );
  await evaluate('window.__detailFitBeforeReload = true');
  await command('Page.reload');
  await wait(
    () =>
      evaluate(
        `!window.__detailFitBeforeReload && document.readyState==='complete' && !!document.querySelector('[data-action="all-songs"]')`,
      ),
    'fixture reload',
  );
  await evaluate(`document.querySelector('[data-action="all-songs"]').click()`);
  const sizes = [
    [1600, 900],
    [1366, 768],
    [1280, 720],
    [1024, 600],
    [900, 700],
    [740, 980],
    [390, 844],
  ];
  for (const [width, height] of sizes) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 640,
    });
    for (const songId of [
      'the-first-shining-star',
      'hymn-of-the-breathing-rebellion',
    ]) {
      await evaluate(
        `document.querySelector('button[data-action="select-song"][data-song-id="${songId}"]').click()`,
      );
      await pause(250);
      const measurement = await evaluate(`(()=>{
        const panel=document.querySelector('[data-song-detail]'), list=document.querySelector('[data-song-list]');
        const p=panel.getBoundingClientRect(), l=list.closest('.song-list-panel').getBoundingClientRect();
        const sideBySide=getComputedStyle(panel.closest('.browser-layout')).display==='grid';
        const fields={};for(const selector of ['.song-detail-emblem','.song-detail-heading h2','.song-detail-duration','.song-rating-stars','[data-five-gold-target]','[data-run-difficulty]','.song-play-button']){
          const e=panel.querySelector(selector),r=e.getBoundingClientRect();fields[selector]={top:r.top,bottom:r.bottom,visible:r.top>=Math.max(p.top,0)-1&&r.bottom<=Math.min(p.bottom,innerHeight)+1&&r.left>=p.left&&r.right<=p.right};}
        return {width:innerWidth,height:innerHeight,songId:${JSON.stringify(songId)},title:panel.querySelector('h2').textContent,best:panel.querySelector('.song-best-copy').textContent,clientHeight:panel.clientHeight,scrollHeight:panel.scrollHeight,panelTop:p.top,panelBottom:p.bottom,listPanelTop:l.top,listPanelBottom:l.bottom,sideBySide,fields,listClientHeight:list.clientHeight,listScrollHeight:list.scrollHeight,listOverflow:getComputedStyle(list).overflowY};
      })()`);
      const name = `${width}x${height}-${songId}`;
      const capture = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await writeFile(
        `${output}/${name}.png`,
        Buffer.from(capture.data, 'base64'),
      );
      measurement.screenshot = `${output}/${name}.png`;
      report.measurements.push(measurement);
    }
  }
  if (!phase.endsWith('before')) {
    for (const m of report.measurements) {
      assert(
        m.scrollHeight <= m.clientHeight + 1,
        `No detail scrolling: ${m.width}x${m.height} ${m.songId}: ${m.scrollHeight}/${m.clientHeight}`,
      );
      for (const [field, bounds] of Object.entries(m.fields))
        assert(bounds.visible, `${field} visible at ${m.width}x${m.height}`);
      assert(
        m.listScrollHeight > m.listClientHeight,
        'Song list retains scrolling',
      );
      assert.equal(m.listOverflow, 'auto');
      if (m.sideBySide) {
        assert(
          Math.abs(m.panelTop - m.listPanelTop) <= 1,
          `Panel tops align at ${m.width}x${m.height}: ${m.panelTop}/${m.listPanelTop}`,
        );
        assert(
          Math.abs(m.panelBottom - m.listPanelBottom) <= 1,
          `Panel bottoms align at ${m.width}x${m.height}: ${m.panelBottom}/${m.listPanelBottom}`,
        );
      }
    }
  }
  report.result = 'passed';
} catch (error) {
  report.result = 'failed';
  report.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (browser) {
    browser.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      pause(3000),
    ]);
    if (browser.exitCode === null && browser.signalCode === null) {
      browser.kill('SIGKILL');
      await pause(400);
    }
    report.cleanup.browserExited =
      browser.exitCode !== null || browser.signalCode !== null;
  }
  if (server) {
    await server.close();
    report.cleanup.serverClosed = true;
  }
  if (profile) {
    await rm(profile, { recursive: true, force: true });
    report.cleanup.profileRemoved = true;
  }
  if (port) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/list`);
      report.cleanup.portClosed = false;
    } catch {
      report.cleanup.portClosed = true;
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
