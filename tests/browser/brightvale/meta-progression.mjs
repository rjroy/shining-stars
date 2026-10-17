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
const phase = `actual-app-${new Date().toISOString().replaceAll(':', '-')}`;
const output = `${root}.lore/local/evidence/meta-progression/${phase}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { phase, volume: 0, muted: true, measurements: [], cleanup: {} };
report.checks = [];
report.fixture = 'Explicit seeded valid save: Hard victories credited for 12 fixture songs, 36 earned credits. NOT earned through browser gameplay.';
report.limitations = ['No gameplay award claim: immediate defeat → quit → reload is not exercised by this menu-focused harness.'];
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
async function check(name, expression) {
  const result = await evaluate(expression);
  report.checks.push({ name, passed: !!result });
  assert(result, name);
}
async function click(selector) {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.focus();e.click()})()`);
}
async function clickText(text) {
  await evaluate(`(()=>{const e=[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)throw Error('Missing button '+${JSON.stringify(text)});e.click()})()`);
}
async function shot(name) {
  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${output}/${name}.png`, Buffer.from(capture.data, 'base64'));
}
async function reload() {
  await evaluate('window.__metaReload = true');
  await command('Page.reload');
  await wait(() => evaluate(`!window.__metaReload && document.readyState==='complete' && !!document.querySelector('[data-action="all-songs"]')`), 'real app reload');
  await click('[data-action="all-songs"]');
  await wait(() => evaluate(`!!document.querySelector('[data-five-gold-target]')`), 'detail after reload');
}
async function importFixture(value) {
  await click('[data-action="save-data"]');
  await evaluate(`(()=>{const input=document.querySelector('dialog[open] input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(value))}], 'explicit-fixture.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(() => evaluate(`!!document.querySelector('input[name="save-progression-mode"]')`), 'real file preview');
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
  await command('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await evaluate(`localStorage.clear()`);
  await reload();
  await wait(
    () => evaluate(`!!document.querySelector('[data-five-gold-target]')`),
    'song details',
  );
  await click('[data-action="select-song"][data-song-id="the-first-shining-star"]');
  await check('Fresh Lyra is free', `!!document.querySelector('[data-action="play"]') && document.querySelector('[data-credits]').textContent.includes('0 credits')`);
  await shot('desktop-fresh-lyra');
  const lockedId = await evaluate(`document.querySelector('.song-row small') && [...document.querySelectorAll('.song-row')].find(e=>e.querySelector('small').textContent.includes('Locked')).dataset.songId`);
  await click(`[data-action="select-song"][data-song-id="${lockedId}"]`);
  await check('Other collection locked but inspectable', `!!document.querySelector('[data-action="unlock"]') && !document.querySelector('[data-action="play"]')`);
  await click(`[data-action="toggle-favorite"][data-song-id="${lockedId}"]`);
  await check('Locked song favorite works', `document.querySelector('[data-action="toggle-favorite"][data-song-id="${lockedId}"]').getAttribute('aria-pressed')==='true'`);
  await evaluate(`(()=>{const e=document.querySelector('[data-search]');e.value=document.querySelector('[data-song-detail] h2').textContent;e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await check('Search retains inspectable locked result', `!!document.querySelector('[data-action="unlock"]') && document.querySelector('[data-song-list]').textContent.includes('Locked')`);
  await click('[data-action="unlock"]');
  await check('Insufficient credits explained without purchase', `document.querySelector('dialog[open]').textContent.includes('more credits') && [...document.querySelectorAll('dialog[open] button')].length===1`);
  await shot('desktop-insufficient-credits');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await wait(() => evaluate(`!document.querySelector('dialog[open]')`), 'native Escape cancellation');
  await check('Escape closes modal and restores unlock focus', `!document.querySelector('dialog[open]') && document.activeElement.dataset.action==='unlock'`);
  const fixture = { format: 'shining-stars-save', schemaVersion: 2, favorites: [lockedId], ratings: { 'the-first-shining-star': { played: true, normalStars: 5, goldStars: 2 } }, progression: { balance: 36, victoryMarks: Object.fromEntries(Array.from({length:12},(_,i)=>[i === 0 ? 'the-first-shining-star' : 'explicit-earned-fixture-'+i,'hard'])), collectionPurchases: {}, songPurchases: {} } };
  await evaluate(`localStorage.setItem('shining-stars.save',${JSON.stringify(JSON.stringify(fixture))})`);
  await reload();
  await click(`[data-action="select-song"][data-song-id="${lockedId}"]`);
  await click('[data-action="unlock"]');
  await check('Collection confirmation shows cost and balance', `document.querySelector('dialog[open]').textContent.includes('Balance: 36') && document.querySelector('dialog[open]').textContent.includes('Songs are unlocked separately')`);
  await check('Ordinary unlock has one confirmation and no storage destination picker', `(()=>{const d=document.querySelector('dialog[open]');const labels=[...d.querySelectorAll('button')].map(e=>e.textContent);return labels.length===2 && labels[0]==='Cancel' && labels[1].startsWith('Unlock ·') && !d.querySelector('select,input[type=radio]') && !d.textContent.includes('session only')})()`);
  await clickText('Unlock ·');
  await check('Collection debit only; no autoplay', `JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance<36 && !!document.querySelector('[data-song-detail]') && document.querySelector('dialog[open]').textContent.includes('Collection unlocked')`);
  const afterCollection = await evaluate(`JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance`);
  await clickText('Done');
  await click('[data-action="unlock"]');
  await check('Separate song confirmation costs one', `document.querySelector('dialog[open]').textContent.includes('Cost: 1 credit')`);
  await shot('desktop-song-confirmation');
  await clickText('Unlock ·');
  await clickText('Done');
  await check('Song debit exactly one; Play still explicit', `JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===${afterCollection-1} && !!document.querySelector('[data-action="play"]') && !document.querySelector('[data-play-status]:not([hidden])')`);
  await reload();
  await click(`[data-action="select-song"][data-song-id="${lockedId}"]`);
  await check('Purchased song survives reload', `!!document.querySelector('[data-action="play"]')`);
  const purchased = await evaluate(`JSON.parse(localStorage.getItem('shining-stars.save'))`);
  await click('[data-action="save-data"]');
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await clickText('Download backup');
  await check('Real export started', `document.querySelector('[data-download-status]').textContent==='Backup download started.'`);
  await clickText('Close');
  const old = { format: 'shining-stars-save', schemaVersion: 1, favorites: [], ratings: {} };
  await importFixture(old);
  await check('v1 reset warning visible; default keeps progression', `document.querySelector('dialog[open]').textContent.includes('resets all credited victories') && document.querySelector('input[name="save-progression-mode"]').checked`);
  await clickText('Import backup');
  await check('Keep-current import preserves whole progression', `JSON.stringify(JSON.parse(localStorage.getItem('shining-stars.save')).progression)===${JSON.stringify(JSON.stringify(purchased.progression))}`);
  await clickText('Close');
  await importFixture(old);
  await evaluate(`document.querySelectorAll('input[name="save-progression-mode"]')[1].click()`);
  await check('Preview counts cumulative difficulty marks', `document.querySelector('dialog[open]').textContent.includes('credited difficulty marks 36 → 0')`);
  await clickText('Import backup');
  await check('Progression-only replacement needs confirmation', `document.querySelector('dialog[open] h2').textContent.includes('Replace current') && JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===${purchased.progression.balance}`);
  await clickText('Replace save data');
  await check('v1 confirmed replacement resets whole progression', `JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===0 && Object.keys(JSON.parse(localStorage.getItem('shining-stars.save')).progression.collectionPurchases).length===0`);
  await clickText('Close');
  await importFixture(purchased);
  await evaluate(`document.querySelectorAll('input[name="save-progression-mode"]')[1].click()`);
  await clickText('Import backup');
  await clickText('Replace save data');
  await clickText('Close');
  await reload();
  await check('v2 whole replacement restores purchases and credits', `JSON.stringify(JSON.parse(localStorage.getItem('shining-stars.save')).progression)===${JSON.stringify(JSON.stringify(purchased.progression))}`);
  await click('[data-action="select-song"][data-song-id="the-first-shining-star"]');
  await check('Stars remain separate from cumulative E/N/H credited seals', `document.querySelector('[data-song-detail] .song-best-copy').textContent==='5 normal · 2 gold' && document.querySelectorAll('[data-song-detail] .credited-seal.is-credited').length===3`);
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
  await click('[data-action="select-song"][data-song-id="hymn-of-the-breathing-rebellion"]');
  await click('[data-action="unlock"]');
  await evaluate(`window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('Explicit validation fixture: denied write')}`);
  await clickText('Unlock ·');
  await check('Denied local write leaves unlock and balance unchanged', `document.querySelector('dialog[open]').textContent.includes('No credits were spent; nothing was unlocked') && JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===${purchased.progression.balance} && !!document.querySelector('[data-action="unlock"]')`);
  await shot('portrait-local-save-failed');
  await clickText('Retry unlock');
  await check('Retry stays local and preserves balance when write still fails', `document.querySelector('dialog[open]').textContent.includes('No credits were spent; nothing was unlocked') && JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===${purchased.progression.balance} && !!document.querySelector('[data-action="unlock"]')`);
  await evaluate(`Storage.prototype.setItem=window.__originalSetItem`);
  await clickText('Use temporary unlock');
  await check('Temporary fallback requires separate consent before any unlock', `document.querySelector('dialog[open] h2').textContent.includes('Temporarily unlock') && document.querySelector('dialog[open]').textContent.includes('will not be saved on this device') && !!document.querySelector('[data-action="unlock"]') && JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===${purchased.progression.balance}`);
  await shot('portrait-temporary-confirmation');
  await clickText('Confirm temporary unlock');
  await check('Explicit session purchase is labeled and never writes local debit', `document.querySelector('dialog[open]').textContent.includes('session only') && document.querySelector('[data-credits]').textContent.includes('session only') && JSON.parse(localStorage.getItem('shining-stars.save')).progression.balance===${purchased.progression.balance}`);
  await shot('portrait-session-unlock');
  await clickText('Done');
  const anotherLockedId = await evaluate(`[...document.querySelectorAll('.song-row')].find(e=>e.dataset.songId!=='hymn-of-the-breathing-rebellion' && e.querySelector('small').textContent.includes('Locked')).dataset.songId`);
  await click(`[data-action="select-song"][data-song-id="${anotherLockedId}"]`);
  await click('[data-action="unlock"]');
  await check('Existing session state warns and offers only explicit temporary confirmation', `(()=>{const d=document.querySelector('dialog[open]');return d.querySelector('h2').textContent.includes('Temporarily unlock') && d.textContent.includes('will not be saved on this device') && [...d.querySelectorAll('button')].length===2 && [...d.querySelectorAll('button')].some(e=>e.textContent.startsWith('Confirm temporary unlock'))})()`);
  await clickText('Cancel');
  await reload();
  await click('[data-action="select-song"][data-song-id="hymn-of-the-breathing-rebellion"]');
  await check('Session-only unlock does not survive reload', `!!document.querySelector('[data-action="unlock"]')`);
  report.layoutFailures = report.measurements.filter(m=>m.scrollHeight>m.clientHeight+1).map(m=>({width:m.width,height:m.height,songId:m.songId,clientHeight:m.clientHeight,scrollHeight:m.scrollHeight}));
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
