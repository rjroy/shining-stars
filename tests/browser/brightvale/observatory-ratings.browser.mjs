import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createServer } from 'vite';

async function stopBrowserProcess(process, timeoutMs = 5_000) {
  if (process === undefined || process.exitCode !== null || process.signalCode !== null) return;
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.removeListener('exit', onExit);
      reject(new Error('Chromium did not exit after SIGKILL'));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    process.once('exit', onExit);
  });
  process.kill('SIGKILL');
  await exited;
}

test('browser cleanup does not wait for an already-signaled process', async () => {
  let killCalled = false;
  await stopBrowserProcess({ exitCode: null, signalCode: 'SIGKILL', kill() { killCalled = true; } });
  assert.equal(killCalled, false);
});

test('mounted Observatory refreshes ratings, notices, and filtered selection on idle return', { timeout: 120_000 }, async () => {
  let server;
  let browser;
  let socket;
  let port;
  const profile = await mkdtemp(path.join('/tmp/opencode', 'observatory-ratings-'));
  const previousVolume = process.env.VITE_SONG_VOLUME;
  process.env.VITE_SONG_VOLUME = '0';
  try {
    server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await server.listen();
    port = server.httpServer.address().port;
    assert.notEqual(port, 3100);
    browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Chromium startup timed out')), 15_000);
      browser.once('error', reject);
      browser.stderr.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const origin = new URL(endpoint).origin.replace('ws:', 'http:');
    const targets = await (await fetch(`${origin}/json/list`)).json();
    socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15_000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
    await delay(500);
    await evaluate(`(async()=>{
      const {createObservatoryUI}=await import('/src/ui/observatory-ui.ts');
      const {createSongCatalog}=await import('/src/catalog/catalog.ts');
      const {createSaveStore}=await import('/src/app/save-data.ts');
      const chart=d=>({sourceStart:0,duration:12,twilightAt:6,allowedDifficulties:[d],notes:[]});
      const ids=['zero','other'];
      const metadata={schemaVersion:1,songs:ids.map((id,i)=>({id,title:'Fixture '+id,sortOrder:i,segmentKind:'full',availability:'available',chartStatus:'candidate'})),collections:[]};
      const generated=Object.fromEntries(ids.map(id=>[id+'.charts.json',{schemaVersion:1,songId:id,source:'data/music/'+id+'.mp3',scoring:{version:1,normalMaximum:100,fiveGoldTarget:90,chartFingerprint:'a'.repeat(64)},charts:{normal:chart('normal')}}]));
      const catalog=createSongCatalog(metadata,generated,{'../../data/music/zero.mp3':'/zero.mp3','../../data/music/other.mp3':'/other.mp3'});
      const store=createSaveStore(null);
      let ratings={zero:null,other:null};
      let ratingNotice=null;
      const host=document.createElement('div'); document.body.append(host);
      const ui=createObservatoryUI(host,catalog,{onPlay:()=>{}},store.favorites,{getSongRating:id=>ratings[id],getRatingNotice:()=>ratingNotice});
      ui.setRendererStatus('rendered');
      host.querySelector('[data-action="all-songs"]').click();
      window.__ratingHarness={host,ui,setRating(id,value){ratings[id]=value},setNotice(value){ratingNotice=value},dispose(){ui.destroy();host.remove()}};
    })()`);
    const waitFor = async (expr) => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expr)) return; await delay(50); }
      throw new Error(`Timed out waiting for ${expr}`);
    };
    await waitFor(`!!window.__ratingHarness?.host.querySelector('[data-song-id="zero"]')`);
    await evaluate(`(()=>{const h=window.__ratingHarness;h.setRating('zero',{played:true,normalStars:3,goldStars:1,achievementOrdinal:18});h.setRating('other',{played:true,normalStars:2,goldStars:0,achievementOrdinal:8});h.setNotice('Fixture rating storage notice');h.ui.setPlayStatus('idle')})()`);
    const refreshed = await evaluate(`(()=>{const h=window.__ratingHarness.host;const row=h.querySelector('[data-song-best="zero"]');const detail=h.querySelector('[data-song-detail]');const stars=node=>({slots:node.querySelectorAll('svg[data-rating-slot]').length,normal:node.querySelectorAll('svg[data-rating-normal="true"]').length,gold:node.querySelectorAll('svg[data-rating-gold="true"]').length});const notice=h.querySelector('[data-storage-notice]');return {zero:row.textContent,other:h.querySelector('[data-song-best="other"]')?.textContent,detail:detail.querySelector('.song-best-copy')?.textContent,rowStars:stars(row),detailStars:stars(detail),rowDuration:h.querySelector('.song-row[data-song-id="zero"] .song-row-copy small')?.textContent,detailDuration:h.querySelector('.song-detail-duration')?.textContent,target:detail.querySelector('[data-five-gold-target]')?.textContent,notice:notice.textContent,noticeHidden:notice.hidden}})()`);
    assert.match(refreshed.zero, /3 normal · 1 gold/);
    assert.match(refreshed.other, /2 normal · 0 gold/);
    assert.match(refreshed.detail, /3 normal · 1 gold/);
    assert.deepEqual(refreshed.rowStars, { slots: 5, normal: 3, gold: 1 });
    assert.deepEqual(refreshed.detailStars, { slots: 5, normal: 3, gold: 1 });
    assert.match(refreshed.rowDuration, /0:12/);
    assert.equal(refreshed.detailDuration, '0:12 playable');
    assert.equal(refreshed.target, '90');
    assert.match(refreshed.notice, /Fixture rating storage notice/);
    assert.equal(refreshed.noticeHidden, false);

    await evaluate(`(()=>{const test=window.__ratingHarness;test.setRating('zero',null);test.setRating('other',null);test.ui.setPlayStatus('idle');const h=test.host;const filter=h.querySelector('[data-action="toggle-filters"]');filter.click();const input=h.querySelector('[data-filter-unplayed]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const beforeCompletion = await evaluate(`(()=>{const h=window.__ratingHarness.host;return {rows:[...h.querySelectorAll('.song-row')].map(r=>r.dataset.songId),selection:window.__ratingHarness.ui.getSelectionSnapshot().selection,detail:h.querySelector('[data-song-achievement]')?.dataset.songAchievement}})()`);
    assert.deepEqual(beforeCompletion.rows, ['zero', 'other']);
    assert.equal(beforeCompletion.selection.selectedSongId, 'zero');
    assert.equal(beforeCompletion.detail, 'zero');
    await evaluate(`(()=>{window.__ratingHarness.setRating('zero',{played:true,normalStars:0,goldStars:0,achievementOrdinal:0});window.__ratingHarness.ui.setPlayStatus('idle')})()`);
    const reconciled = await evaluate(`(()=>{const h=window.__ratingHarness.host;return {rows:[...h.querySelectorAll('.song-row')].map(r=>r.dataset.songId),selection:window.__ratingHarness.ui.getSelectionSnapshot().selection,detail:h.querySelector('[data-song-achievement]')?.dataset.songAchievement}})()`);
    assert.deepEqual(reconciled.rows, ['other']);
    assert.equal(reconciled.selection.selectedSongId, 'other');
    assert.equal(reconciled.detail, 'other');
    await evaluate(`window.__ratingHarness.dispose();delete window.__ratingHarness`);
  } finally {
    const cleanupErrors = [];
    try { socket?.close(); } catch (error) { cleanupErrors.push(error); }
    try { await stopBrowserProcess(browser); } catch (error) { cleanupErrors.push(error); }
    try { await server?.close(); } catch (error) { cleanupErrors.push(error); }
    if (port) {
      try { await assert.rejects(fetch(`http://127.0.0.1:${port}`), 'owned server stopped'); }
      catch (error) { cleanupErrors.push(error); }
    }
    try { await rm(profile, { recursive: true, force: true }); }
    catch (error) { cleanupErrors.push(error); }
    if (previousVolume === undefined) delete process.env.VITE_SONG_VOLUME;
    else process.env.VITE_SONG_VOLUME = previousVolume;
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned browser test cleanup failed');
  }
});
