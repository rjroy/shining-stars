import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createServer } from 'vite';

// Uses the real app and its DOM events, with an isolated browser profile.
test(
  'personal best score selection and completed-run comparison',
  { timeout: 120_000 },
  async () => {
    let server;
    let browser;
    let socket;
    let port;
    const profile = await mkdtemp(
      path.join('/tmp/opencode', 'brightvale-personal-best-'),
    );
    const previousVolume = process.env.VITE_SONG_VOLUME;
    process.env.VITE_SONG_VOLUME = '0';
    try {
      server = await createServer({
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      await server.listen();
      port = server.httpServer.address().port;
      assert.notEqual(port, 3100);
      browser = spawn(
        process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
        [
          '--headless',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--mute-audio',
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          'about:blank',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error('Chromium startup timed out')),
          15_000,
        );
        browser.once('error', reject);
        browser.stderr.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      const debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
      const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
      socket = new WebSocket(
        targets.find((target) => target.type === 'page').webSocketDebuggerUrl,
      );
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
      const command = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('CDP timed out: ' + method));
          }, 15000);
          pending.set(id, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const result = await command('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        });
        assert.equal(
          result.exceptionDetails,
          undefined,
          JSON.stringify(result.exceptionDetails),
        );
        return result.result.value;
      };
      await command('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
      const wait = async (expression) => {
        for (let attempt = 0; attempt < 300; attempt++) {
          if (await evaluate(expression)) return;
          await delay(100);
        }
        throw new Error(
          'Timed out: ' +
            expression +
            ' ' +
            (await evaluate(`document.body.innerText`)),
        );
      };
      await wait(
        `!!document.querySelector('[data-action="browse-collection"]')`,
      );
      await evaluate(
        `document.querySelector('[data-action="browse-collection"]').click()`,
      );
      await wait(
        `!!document.querySelector('[data-action="play"]:not(:disabled)')`,
      );
      assert.match(
        await evaluate(
          `document.querySelector('[data-personal-best-score]').textContent`,
        ),
        /No score yet/,
      );
      const fixture = await evaluate(`(async () => {
        const { createObservatoryUI } = await import('/src/ui/observatory-ui.ts');
        const { createGameUI } = await import('/src/ui/ui.ts');
        const { createSaveStore } = await import('/src/app/save-data.ts');
        const { createSongCatalog } = await import('/src/catalog/catalog.ts');
        const { createGame } = await import('/src/game/game.ts');
        const host = document.createElement('div'); host.style.cssText='position:fixed;inset:0;z-index:9999;background:#0e0d28'; document.body.append(host);
        const chart = difficulty => ({sourceStart:0,duration:2,twilightAt:1,allowedDifficulties:[difficulty],notes:[]});
        const { default: prices } = await import('/data/progression.json');
        const starter = Object.entries(prices.collections).find(([,price]) => price === null)[0];
        const metadata = {schemaVersion:1,songs:['one','two'].map((id,index)=>({id,title:'Fixture '+id,sortOrder:index,segmentKind:'full',availability:'available',chartStatus:'candidate'})),collections:Object.keys(prices.collections).map((id,index)=>({id,title:'Fixture '+id,sortOrder:id===starter?-1:index,songIds:id===starter?['one','two']:[]}))};
        const generated = Object.fromEntries(['one','two'].map(id=>[id+'.charts.json',{schemaVersion:1,songId:id,source:'data/music/'+id+'.mp3',scoring:{version:1,normalMaximum:0,fiveGoldTarget:0,chartFingerprint:'a'.repeat(64)},charts:{normal:chart('normal'),hard:chart('hard')}}]));
        const catalog = createSongCatalog(metadata,generated,{'../../data/music/one.mp3':'/one.mp3','../../data/music/two.mp3':'/two.mp3'});
        const store = createSaveStore(null);
        store.personalBestScores.recordCompletedScore('one','normal',0);
        store.personalBestScores.recordCompletedScore('one','hard',1200);
        store.personalBestScores.recordCompletedScore('two','normal',450);
        const ui = createObservatoryUI(host,catalog,{onPlay:()=>{}},store.favorites,{saveStore:store});ui.setRendererStatus('rendered');
        host.querySelector('[data-action="browse-collection"]').click();
        const text = () => host.querySelector('[data-personal-best-score]').textContent;
        const normal = text();
        const select = host.querySelector('[data-run-difficulty]'); select.value='hard';select.dispatchEvent(new Event('change',{bubbles:true}));
        const hard = text();
        host.querySelector('[data-action="select-song"][data-song-id="two"]').click();
        const missing = text();
        const other = host.querySelector('[data-run-difficulty]');other.value='normal';other.dispatchEvent(new Event('change',{bubbles:true}));
        const second = text();
        const imported = createSaveStore(null);imported.personalBestScores.recordCompletedScore('two','normal',789);
        store.applyImport(store.previewImport(imported.exportJson(),'replace','replace'),'session');ui.refreshSavedData();
        const refreshed = text();
        const comparisons = [];
        const game = createGame(chart('normal'),0,'normal');
        const completed = game.advanceTo(2);
        let gameUI;
        const snapshot = (runId,resultScore,status='results') => ({runId,audio:{status:'ended',transportTime:3,scheduledWhen:null,error:null},game:{...completed,status,score:resultScore,result:status==='results'?{...completed.result,score:resultScore}:null},inputOffset:0,visualOffset:0,selectedDifficulty:'normal',feedback:[],pendingPlaybackRequests:false});
        const showResults = () => {
          ui.destroy(); gameUI = createGameUI(host,catalog.songs[0],chart('normal'),{});gameUI.setRendererStatus('rendered');
          for (const [index,score] of [0,25,25,12].entries()) {
            gameUI.render(snapshot(index+1,score,'playing'),0);
            const comparison = store.personalBestScores.recordCompletedScore('one','normal',score);
            gameUI.setCompletedScore(index+1,comparison);
            gameUI.render(snapshot(index+1,score),0);
            comparisons.push(host.querySelector('[data-result-personal-best]').textContent);
          }
          const captured = host.querySelector('[data-result-personal-best]').textContent;
          store.personalBestScores.recordCompletedScore('one','normal',1000);gameUI.render(snapshot(4,12),0);
          const stable = captured === host.querySelector('[data-result-personal-best]').textContent;
          gameUI.render(snapshot(5,0,'playing'),0);gameUI.render(snapshot(5,0),0);
          const cleared = host.querySelector('[data-result-personal-best]').hidden;
          gameUI.setCompletedScore(5,{previousBest:25,best:99,isNewBest:true});gameUI.render(snapshot(5,99),0);
          return {cleared, comparisons, stable};
        };
        window.__bestFixture={host,ui,showResults,dispose:()=>{gameUI?.destroy();host.remove();}};
        return {normal,hard,missing,second,refreshed};
      })()`);
      assert.match(fixture.normal, /Normal best score: 0/);
      assert.match(fixture.hard, /Hard best score: 1,200/);
      assert.match(fixture.missing, /Hard best score: No score yet/);
      assert.match(fixture.second, /Normal best score: 450/);
      assert.match(fixture.refreshed, /Normal best score: 789/);
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ]) {
        await command('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await delay(100);
        const layout = await evaluate(
          `(() => {const e=window.__bestFixture.host.querySelector('[data-personal-best-score]');const r=e.getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,visible:r.height>0};})()`,
        );
        assert.deepEqual(layout, { fits: true, visible: true });
        if (process.env.BRIGHTVALE_SCREENSHOT_DIR) {
          const { data } = await command('Page.captureScreenshot', {
            format: 'png',
          });
          await writeFile(
            path.join(
              process.env.BRIGHTVALE_SCREENSHOT_DIR,
              '8lw-selection-' + width + '.png',
            ),
            Buffer.from(data, 'base64'),
          );
        }
      }
      const resultProof = await evaluate(`window.__bestFixture.showResults()`);
      assert.equal(resultProof.cleared, true, 'retry clears prior comparison');
      assert.equal(
        resultProof.stable,
        true,
        'completed comparison survives later store updates',
      );
      assert.match(resultProof.comparisons[0], /First score recorded/);
      assert.match(resultProof.comparisons[1], /New personal best/);
      assert.doesNotMatch(resultProof.comparisons[2], /New personal best/);
      assert.doesNotMatch(resultProof.comparisons[3], /New personal best/);
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ]) {
        await command('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await delay(100);
        const text = await evaluate(
          `document.querySelector('[data-result-personal-best]')?.textContent`,
        );
        assert.match(text, /New personal best/);
        if (process.env.BRIGHTVALE_SCREENSHOT_DIR) {
          const { data } = await command('Page.captureScreenshot', {
            format: 'png',
          });
          await writeFile(
            path.join(
              process.env.BRIGHTVALE_SCREENSHOT_DIR,
              '8lw-results-' + width + '.png',
            ),
            Buffer.from(data, 'base64'),
          );
        }
      }
      await evaluate(
        `window.__bestFixture.dispose();delete window.__bestFixture`,
      );
    } finally {
      try {
        socket?.close();
        if (browser && browser.exitCode === null) {
          const exited = once(browser, 'exit');
          browser.kill('SIGKILL');
          await exited;
        }
        await server?.close();
        if (port)
          await assert.rejects(
            fetch(`http://127.0.0.1:${port}`),
            'owned server stopped',
          );
      } finally {
        try {
          await rm(profile, { recursive: true, force: true });
        } finally {
          if (previousVolume === undefined) delete process.env.VITE_SONG_VOLUME;
          else process.env.VITE_SONG_VOLUME = previousVolume;
        }
      }
    }
  },
);

function silentWave(seconds = 4, sampleRate = 48_000) {
  const samples = seconds * sampleRate;
  const wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(samples * 2, 40);
  return wave;
}

test(
  'main records a personal best after a test-owned chart reaches results',
  { timeout: 120_000 },
  async () => {
    let server;
    let browser;
    let socket;
    let port;
    const profile = await mkdtemp(
      path.join('/tmp/opencode', 'brightvale-main-score-'),
    );
    const previousVolume = process.env.VITE_SONG_VOLUME;
    process.env.VITE_SONG_VOLUME = '0';
    const source = 'data/music/main-personal-best-fixture.mp3';
    const chart = {
      sourceStart: 0,
      duration: 8,
      twilightAt: 4,
      allowedDifficulties: ['normal'],
      notes: [{ id: 'missed-note', time: 6, lane: 0 }],
    };
    const metadata = {
      schemaVersion: 1,
      songs: [
        {
          id: 'main-personal-best-fixture',
          title: 'Main Personal Best Fixture',
          sortOrder: 0,
          segmentKind: 'full',
          availability: 'available',
          chartStatus: 'candidate',
        },
      ],
      collections: [
        {
          id: 'lyra-of-brightvale',
          title: 'Fixture Collection',
          sortOrder: 0,
          songIds: ['main-personal-best-fixture'],
        },
      ],
    };
    const generatedCharts = {
      schemaVersion: 1,
      songId: 'main-personal-best-fixture',
      source,
      scoring: {
        version: 1,
        normalMaximum: 100,
        fiveGoldTarget: 90,
        chartFingerprint: 'f'.repeat(64),
      },
      charts: { normal: chart },
    };
    const progression = JSON.parse(
      await readFile(
        new URL('../../../data/progression.json', import.meta.url),
        'utf8',
      ),
    );
    metadata.collections = Object.keys(progression.collections).map(
      (id, sortOrder) => ({
        id,
        title: id === 'lyra-of-brightvale' ? 'Fixture Collection' : id,
        sortOrder,
        songIds:
          id === 'lyra-of-brightvale'
            ? ['main-personal-best-fixture']
            : [],
      }),
    );
    const fixtureModule = `
      import { createSongCatalog } from '/src/catalog/catalog.ts';
      const metadata = ${JSON.stringify(metadata)};
      const charts = ${JSON.stringify(generatedCharts)};
      const source = ${JSON.stringify(source)};
      export const SONG_CATALOG = createSongCatalog(
        metadata,
        { [charts.songId + '.charts.json']: charts },
        { ['../../' + source]: '/__fixture-audio.wav' },
      );
      export function getSongChart(song, difficulty) {
        const chart = song.charts[difficulty];
        if (!chart) throw new RangeError('Fixture difficulty is missing.');
        return chart;
      }
    `;
    const fixtureCatalogPlugin = {
      name: 'main-personal-best-fixture-catalog',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === './catalog/catalog' && importer?.endsWith('/src/main.ts'))
          return '\0main-personal-best-fixture-catalog';
        return null;
      },
      load(id) {
        return id === '\0main-personal-best-fixture-catalog'
          ? fixtureModule
          : null;
      },
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/__fixture-audio.wav') return next();
          response.statusCode = 200;
          response.setHeader('content-type', 'audio/wav');
        response.end(silentWave(9));
        });
      },
    };
    try {
      server = await createServer({
        plugins: [fixtureCatalogPlugin],
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      await server.listen();
      port = server.httpServer.address().port;
      assert.notEqual(port, 3100);
      browser = spawn(
        process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
        [
          '--headless',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--mute-audio',
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          'about:blank',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error('Chromium startup timed out')),
          15_000,
        );
        browser.once('error', reject);
        browser.stderr.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      const debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
      const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
      socket = new WebSocket(
        targets.find((target) => target.type === 'page').webSocketDebuggerUrl,
      );
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
      const command = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('CDP timed out: ' + method));
          }, 15_000);
          pending.set(id, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const result = await command('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        });
        assert.equal(
          result.exceptionDetails,
          undefined,
          JSON.stringify(result.exceptionDetails),
        );
        return result.result.value;
      };
      const wait = async (expression, label) => {
        for (let attempt = 0; attempt < 450; attempt++) {
          if (await evaluate(expression)) return;
          await delay(100);
        }
        throw new Error(
          `Timed out waiting for ${label}: ${await evaluate('document.body.innerText')}`,
        );
      };
      await command('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
      await wait(
        `!!document.querySelector('[data-action="browse-collection"]')`,
        'Observatory mount',
      );
      await wait(
        `document.querySelector('[data-renderer-notice]')?.hidden === true`,
        'Observatory renderer',
      );
      await evaluate(`document.querySelector('[data-action="browse-collection"]').click()`);
      await wait(
        `!!document.querySelector('[data-action="play"]')`,
        'fixture song browser',
      );
      await evaluate(`document.querySelector('[data-action="select-song"]').click()`);
      await wait(
        `document.querySelector('[data-action="play"]')?.disabled === false`,
        'fixture song selection',
      );
      await evaluate(`document.querySelector('[data-action="play"]').click()`);
      await wait(
        `document.querySelector('[data-experience-screen="gameplay"]')?.hidden === false && document.querySelector('[data-panel="ready"]')?.hidden === false`,
        'fixture run ready state',
      );
      await evaluate(`document.querySelector('[data-panel="ready"] [data-action="start"]').click()`);
      await wait(
        `document.querySelector('[data-panel="results"]')?.hidden === false`,
        'short fixture chart terminal result',
      );
      const persisted = await evaluate(`JSON.parse(localStorage.getItem('shining-stars.save'))`);
      assert.deepEqual(persisted.personalBestScores, [
        {
          songId: 'main-personal-best-fixture',
          difficulty: 'normal',
          score: 0,
        },
      ]);
      assert.match(
        await evaluate(
          `document.querySelector('[data-result-personal-best]')?.textContent`,
        ),
        /First score recorded/,
      );
    } finally {
      try {
        socket?.close();
        if (browser && browser.exitCode === null) {
          const exited = once(browser, 'exit');
          browser.kill('SIGKILL');
          await exited;
        }
        await server?.close();
        if (port)
          await assert.rejects(
            fetch(`http://127.0.0.1:${port}`),
            'owned server stopped',
          );
      } finally {
        try {
          await rm(profile, { recursive: true, force: true });
        } finally {
          if (previousVolume === undefined) delete process.env.VITE_SONG_VOLUME;
          else process.env.VITE_SONG_VOLUME = previousVolume;
        }
      }
    }
  },
);
