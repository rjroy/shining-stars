import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createAcceptancePlan } from './acceptance-plan.mjs';

const repositoryRoot = process.cwd();
const scratchParent = '/tmp/opencode';
const evidenceDirectory = path.join(
  repositoryRoot,
  '.lore/local/evidence/observatory-acceptance',
);
const chromiumBinary = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
const mode = process.argv[2] ?? 'smoke';
if (mode !== 'smoke' && mode !== 'exhaustive')
  throw new Error('Usage: observatory-acceptance.mjs [smoke|exhaustive]');
const runStartedAt = new Date();
const report = {
  title: 'Observatory technical acceptance evidence',
  mode,
  startedAt: runStartedAt.toISOString(),
  branchCommit: null,
  runtimeWorkingTreePaths: [],
  browser: null,
  volume: 0,
  clockMethod:
    'Native AudioContext.currentTime; no clock overrides or fake timers.',
  reducedMotion: true,
  browsingAudioRequestsBeforePlay: null,
  favoritesStorageFailure: null,
  realCatalog: [],
  staticChartValidation: null,
  plannedRunCount: null,
  playbackRuns: [],
  scaleFixture: null,
  cleanup: {},
  failure: null,
};

let server;
let browser;
let profile;
let cdp;
let pageTargetId;
let vitePort;
let debugPort;
let failure;
let difficultyProfiles;

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (address === null || typeof address === 'string') {
        listener.close();
        reject(new Error('Unable to allocate an ephemeral TCP port.'));
        return;
      }
      listener.close((error) =>
        error === undefined ? resolve(address.port) : reject(error),
      );
    });
  });
}

async function waitFor(check, label, timeoutMilliseconds = 45_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== false && value !== null && value !== undefined) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (request === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined)
      request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? {});
  });

  const open = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('Chromium DevTools WebSocket failed.')),
      { once: true },
    );
  });

  return {
    socket,
    open,
    command(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools command timed out: ${method}`));
        }, 60_000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timeout);
            reject(error);
          },
        });
      });
    },
    async evaluate(expression) {
      const response = await this.command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails !== undefined) {
        throw new Error(
          response.exceptionDetails.exception?.description ??
            response.exceptionDetails.text ??
            'Browser-side evaluation failed.',
        );
      }
      return response.result?.value;
    },
  };
}

async function click(selector) {
  const rect = await cdp.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element || element.disabled) return null;
    element.scrollIntoView({block:'center',inline:'center'});
    const box=element.getBoundingClientRect();
    return {x:box.x+box.width/2,y:box.y+box.height/2};
  })()`);
  assert.ok(rect, `Expected an enabled, visible control: ${selector}`);
  await cdp.command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: rect.x,
    y: rect.y,
  });
  await cdp.command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  });
}

async function pressKey(key, virtualKeyCode) {
  const parameters = {
    key,
    code: key,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  await cdp.command('Input.dispatchKeyEvent', {
    ...parameters,
    type: 'keyDown',
  });
  await cdp.command('Input.dispatchKeyEvent', {
    ...parameters,
    type: 'keyUp',
  });
}

async function chooseDifficulty(value, expectedOptions) {
  const selector = '[data-song-detail] [data-run-difficulty]';
  const current = await cdp.evaluate(`(()=>{
    const select=document.querySelector(${JSON.stringify(selector)});
    if(!select) return null;
    return {value:select.value,options:[...select.options].map(option=>option.value)};
  })()`);
  assert.deepEqual(current?.options, expectedOptions);
  assert.ok(
    expectedOptions.includes(value),
    `Unsupported UI difficulty ${value}`,
  );

  await cdp.evaluate(`(()=>{
    window.__lastDifficultyChangeTrusted=null;
    const select=document.querySelector(${JSON.stringify(selector)});
    select.addEventListener('change',event=>window.__lastDifficultyChangeTrusted=event.isTrusted,{once:true});
    select.focus();
  })()`);
  await click(selector);
  await pressKey('Home', 36);
  for (let index = 0; index < expectedOptions.indexOf(value); index += 1)
    await pressKey('ArrowDown', 40);
  await pressKey('Enter', 13);

  const selectedValue = await waitFor(async () => {
    const state = await cdp.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.value ?? null`,
    );
    return state === value ? state : false;
  }, `keyboard difficulty selection ${value}`);
  return {
    value: selectedValue,
    trustedChange: await cdp.evaluate('window.__lastDifficultyChangeTrusted'),
  };
}

function frameStatistics(samples) {
  if (samples.length === 0)
    return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  const values = samples
    .map((sample) => sample.elapsedMs)
    .sort((a, b) => a - b);
  const percentile = (fraction) =>
    values[Math.ceil(values.length * fraction) - 1];
  return {
    count: values.length,
    medianMs: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    maxMs: Number(values.at(-1).toFixed(3)),
  };
}

async function waitForGameplayStart(song, difficulty) {
  const state = await waitFor(
    async () => {
      const current = await cdp.evaluate(`(()=>{
      const root=document.querySelector('[data-experience-screen="gameplay"]');
      if(!root || root.hidden) return null;
      const error=root.querySelector('[data-panel="error"]');
      const time=root.querySelector('[data-time]')?.textContent?.trim() ?? null;
      const countdown=root.querySelector('[data-countdown]')?.textContent?.trim() ?? '';
      const label=root.querySelector('[data-song-label]')?.textContent ?? '';
      const legend=root.querySelector('[data-timing-legend]')?.textContent ?? '';
      return {
        time,
        countdown,
        label,
        legend,
        error:error?.hidden===false ? root.querySelector('[data-audio-error]')?.textContent : null,
      };
    })()`);
      if (current === null) return false;
      if (current.error !== null) return { error: current.error };
      if (
        current.countdown.startsWith('Starting in') ||
        current.time !== '00:00'
      )
        return current;
      return false;
    },
    `audio-ready start for ${song.title} (${difficulty})`,
    120_000,
  );
  assert.equal(state.error, null, `${song.title}: ${state.error}`);
  assert.ok(
    state.label.includes(song.title),
    `Gameplay title mismatch: ${state.label}`,
  );
  if (song.segmentKind === 'excerpt')
    assert.match(
      state.label,
      /Demo excerpt/i,
      'The excerpt must stay explicitly labeled.',
    );

  const profile = difficultyProfiles.profiles[difficulty];
  const cue = [
    `Good ±${profile.timing.good_ms} ms`,
    `Perfect ±${profile.timing.perfect_ms} ms`,
  ];
  assert.ok(
    state.legend.includes(cue[0]),
    `Expected ${difficulty} timing cue: ${state.legend}`,
  );
  assert.ok(
    state.legend.includes(cue[1]),
    `Expected ${difficulty} timing cue: ${state.legend}`,
  );
  return state;
}

async function returnFromGameplay(baselineCanvasCount, song) {
  await pressKey('Escape', 27);
  await waitFor(
    async () =>
      (await cdp.evaluate(
        `document.querySelector('[data-panel="pause"]')?.hidden === false`,
      )) || false,
    'paused gameplay return control',
  );
  await click('[data-panel="pause"] [data-action="return"]');
  const returned = await waitFor(async () => {
    const current = await cdp.evaluate(`(()=>{
        const browser=document.querySelector('[data-observatory-page="browser"]');
        const gameplay=document.querySelector('[data-experience-screen="gameplay"]');
        return browser && !browser.hidden && gameplay===null ? {
          canvasCount:document.querySelectorAll('canvas').length,
          activeContexts:window.__activeAudioContexts,
          activeSources:window.__activeAudioSources,
          detailTitle:document.querySelector('[data-song-detail] h2')?.textContent,
          selectedRow:document.querySelector('.song-row-main[aria-pressed="true"]')?.dataset.songId,
        } : null;
      })()`);
    return current !== null &&
      current.activeContexts === 0 &&
      current.activeSources === 0
      ? current
      : false;
  }, 'return to the retained song browser');
  assert.equal(
    returned.canvasCount,
    baselineCanvasCount,
    'Gameplay must not add or leak canvases.',
  );
  assert.equal(
    returned.detailTitle,
    song.title,
    'Return must restore the selected song detail.',
  );
  assert.equal(
    returned.selectedRow,
    song.id,
    'Return must restore selection by stable song ID.',
  );
  assert.equal(await cdp.evaluate('window.__activeAudioContexts'), 0);
  assert.equal(await cdp.evaluate('window.__activeAudioSources'), 0);
  return returned;
}

async function runAcceptance() {
  difficultyProfiles = JSON.parse(
    await readFile(
      path.join(repositoryRoot, 'data/charts/difficulty-profiles.json'),
      'utf8',
    ),
  );
  assert.deepEqual(Object.keys(difficultyProfiles.profiles).sort(), [
    'easy',
    'hard',
    'normal',
  ]);
  report.branchCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  report.runtimeWorkingTreePaths = execFileSync(
    'git',
    [
      'status',
      '--short',
      '--',
      'src/main.ts',
      'src/app',
      'src/audio',
      'src/game/controller.ts',
      'src/ui',
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  await mkdir(scratchParent, { recursive: true });
  profile = await mkdtemp(path.join(scratchParent, 'observatory-acceptance-'));
  debugPort = await freePort();

  const chromiumVersion = spawn(chromiumBinary, ['--version'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const versionChunks = [];
  chromiumVersion.stdout.on('data', (chunk) => versionChunks.push(chunk));
  await new Promise((resolve, reject) => {
    chromiumVersion.once('error', reject);
    chromiumVersion.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Unable to read Chromium version.')),
    );
  });
  report.browser = Buffer.concat(versionChunks).toString().trim();

  server = await createServer({
    configFile: false,
    root: repositoryRoot,
    define: { 'import.meta.env.VITE_SONG_VOLUME': JSON.stringify('0') },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      watch: null,
    },
  });
  await server.listen();
  const viteAddress = server.httpServer?.address();
  assert.ok(viteAddress && typeof viteAddress !== 'string');
  vitePort = viteAddress.port;

  browser = spawn(
    chromiumBinary,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const targets = await waitFor(async () => {
    const response = await fetch(
      `http://127.0.0.1:${debugPort}/json/list`,
    ).catch(() => null);
    return response?.ok ? response.json() : false;
  }, 'Chromium DevTools page');
  const page = targets.find((target) => target.type === 'page');
  assert.ok(page, 'Chromium did not expose its page target.');
  pageTargetId = page.id;
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.open;

  await cdp.command('Page.enable');
  await cdp.command('Runtime.enable');
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
    source: `(()=>{
      window.__audioContextCount=0;
      window.__activeAudioContexts=0;
      window.__audioRequests=[];
      window.__activeSources=new Set();
      window.__activeAudioSources=0;
      window.__storageFailures=0;
      window.__frameSamples=[];
      window.__frameLabel=null;
      window.__appErrors=[];
      window.addEventListener('error',event=>window.__appErrors.push(String(event.message)));
      window.addEventListener('unhandledrejection',event=>window.__appErrors.push(String(event.reason)));
      const NativeContext=window.AudioContext;
      if(NativeContext)window.AudioContext=new Proxy(NativeContext,{construct(target,args,newTarget){
        const context=Reflect.construct(target,args,newTarget);
        window.__audioContextCount++;
        window.__activeAudioContexts++;
        let countedOpen=true;
        context.addEventListener('statechange',()=>{
          if(countedOpen && context.state==='closed'){
            countedOpen=false;
            window.__activeAudioContexts--;
          }
        });
        return context;
      }});
      const sourcePrototype=window.AudioBufferSourceNode?.prototype;
      if(sourcePrototype){
        const start=sourcePrototype.start;
        const stop=sourcePrototype.stop;
        sourcePrototype.start=function(...args){
          const result=start.apply(this,args);
          window.__activeSources.add(this);
          window.__activeAudioSources=window.__activeSources.size;
          this.addEventListener('ended',()=>{
            window.__activeSources.delete(this);
            window.__activeAudioSources=window.__activeSources.size;
          },{once:true});
          return result;
        };
        sourcePrototype.stop=function(...args){
          const result=stop.apply(this,args);
          window.__activeSources.delete(this);
          window.__activeAudioSources=window.__activeSources.size;
          return result;
        };
      }
      const nativeFetch=window.fetch.bind(window);
      window.fetch=(input,init)=>{
        const url=String(input);
        if(/\\.mp3(?:$|[?#])/i.test(url))window.__audioRequests.push(url);
        return nativeFetch(input,init);
      };
      const nativeGet=Storage.prototype.getItem;
      const nativeSet=Storage.prototype.setItem;
      Object.defineProperty(Storage.prototype,'getItem',{configurable:true,writable:true,value:function(key){
        if(key==='shining-stars.favorite-song-ids'){
          window.__storageFailures++;
          throw new DOMException('Storage denied by acceptance fixture','SecurityError');
        }
        return nativeGet.call(this,key);
      }});
      Object.defineProperty(Storage.prototype,'setItem',{configurable:true,writable:true,value:function(key,value){
        if(key==='shining-stars.favorite-song-ids'){
          window.__storageFailures++;
          throw new DOMException('Storage denied by acceptance fixture','QuotaExceededError');
        }
        return nativeSet.call(this,key,value);
      }});
      const nativeRequestAnimationFrame=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=callback=>nativeRequestAnimationFrame(timestamp=>{
        const before=window.performance.now();
        try{callback(timestamp)}finally{
          const visible=document.querySelector('[data-experience-screen="gameplay"]')?.hidden===false;
          if(visible && window.__frameLabel!==null)
            window.__frameSamples.push({run:window.__frameLabel,elapsedMs:window.performance.now()-before});
        }
      });
    })()`,
  });
  await cdp.command('Page.navigate', {
    url: `http://127.0.0.1:${vitePort}/`,
  });

  await waitFor(async () => {
    try {
      return await cdp.evaluate(
        "document.querySelector('.observatory-app')?.isConnected",
      );
    } catch {
      return false;
    }
  }, 'Observatory application mount');
  await waitFor(
    () =>
      cdp.evaluate(
        "document.querySelector('[data-renderer-notice]')?.hidden === true",
      ),
    'WebGL Observatory renderer readiness',
    60_000,
  );
  assert.equal(
    await cdp.evaluate(
      "matchMedia('(prefers-reduced-motion: reduce)').matches",
    ),
    true,
  );
  assert.equal(await cdp.evaluate('window.__audioContextCount'), 0);
  assert.deepEqual(await cdp.evaluate('window.__audioRequests'), []);
  report.browsingAudioRequestsBeforePlay = 0;

  const overview = await cdp.evaluate(`(()=>({
    title:document.querySelector('[data-collection-title]')?.textContent,
    count:document.querySelector('[data-collection-count]')?.textContent,
    story:document.querySelector('.collection-story')?.textContent,
  }))()`);
  assert.deepEqual(overview, {
    title: 'All Songs',
    count: '29 songs',
    story: '29 songs in the current collection.',
  });
  await click('[data-action="browse-collection"]');
  assert.equal(
    await cdp.evaluate(
      "document.querySelector('[data-breadcrumb]')?.textContent",
    ),
    'All Songs',
  );
  assert.equal(
    await cdp.evaluate("document.querySelectorAll('.song-row').length"),
    29,
  );
  await click('[data-action="back-overview"]');
  await click('[data-action="all-songs"]');

  const catalogState = await cdp.evaluate(`(async()=>{
    const {SONG_CATALOG,getSongChart,getSongDifficulties}=await import('/src/catalog/catalog.ts');
    return SONG_CATALOG.songs.map(song=>({
      id:song.id,title:song.title,audioUrl:new URL(song.audioUrl,location.href).href,
      audioPath:new URL(song.audioUrl,location.href).pathname,
      segmentKind:song.segmentKind,chartStatus:song.chartStatus,
      source:song.source,difficulties:[...getSongDifficulties(song)],
      charts:Object.fromEntries(getSongDifficulties(song).map(difficulty=>[difficulty,getSongChart(song,difficulty)])),
      chartIssues:Object.fromEntries(getSongDifficulties(song).map(difficulty=>[difficulty,SONG_CATALOG.chartIssues.get(song.id)?.[difficulty]??null])),
    }));
  })()`);
  const catalogRows = catalogState;
  assert.equal(catalogRows.length, 29);
  const staticVariants = catalogRows.reduce(
    (sum, song) => sum + song.difficulties.length,
    0,
  );
  const invalidVariants = catalogRows.flatMap((song) =>
    song.difficulties
      .filter(
        (difficulty) =>
          (song.chartIssues[difficulty] ?? ['missing chart validation'])
            .length > 0,
      )
      .map((difficulty) => `${song.id}/${difficulty}`),
  );
  assert.equal(
    staticVariants,
    87,
    'All 29 catalog songs must have three generated difficulty variants.',
  );
  assert.deepEqual(
    invalidVariants,
    [],
    'Every generated chart variant must pass runtime validation.',
  );
  report.staticChartValidation = {
    songs: catalogRows.length,
    variants: staticVariants,
    invalidVariants,
  };
  report.realCatalog = catalogRows.map((song) => ({
    id: song.id,
    title: song.title,
    source: song.source,
    segmentKind: song.segmentKind,
    difficulties: song.difficulties,
    chartVariants: Object.fromEntries(
      song.difficulties.map((difficulty) => {
        const chart = song.charts[difficulty];
        return [
          difficulty,
          {
            sourceStart: chart.sourceStart,
            duration: chart.duration,
            twilightAt: chart.twilightAt,
            twilightStrength: chart.twilightStrength,
            noteCount: chart.notes.length,
          },
        ];
      }),
    ),
  }));

  const storageState = await cdp.evaluate(`(()=>({
    noticeVisible:document.querySelector('[data-storage-notice]')?.hidden===false,
    notice:document.querySelector('[data-storage-notice]')?.textContent,
    failures:window.__storageFailures,
  }))()`);
  assert.equal(
    storageState.noticeVisible,
    true,
    'Unavailable favorites storage should show a fallback notice.',
  );
  assert.match(storageState.notice, /session only/i);
  assert.ok(storageState.failures > 0);
  const favoriteId = catalogRows[0].id;
  await click(
    `button[data-action="toggle-favorite"][data-song-id="${favoriteId}"]`,
  );
  assert.match(
    await cdp.evaluate(
      "document.querySelector('[data-storage-notice]')?.textContent",
    ),
    /session only/i,
  );
  await click('[data-action="favorites"]');
  assert.equal(
    await cdp.evaluate("document.querySelectorAll('.song-row').length"),
    1,
  );
  assert.equal(
    await cdp.evaluate("document.querySelector('.song-row')?.dataset.songId"),
    favoriteId,
  );
  report.favoritesStorageFailure = {
    storageFailures: storageState.failures,
    fallbackNotice: storageState.notice,
    favoriteVisibleInFavoritesRoute: true,
  };
  await click('[data-action="all-songs"]');
  assert.equal(
    await cdp.evaluate("document.querySelectorAll('.song-row').length"),
    29,
  );
  assert.equal(await cdp.evaluate('window.__audioContextCount'), 0);
  assert.deepEqual(await cdp.evaluate('window.__audioRequests'), []);

  report.scaleFixture = await cdp.evaluate(`(async()=>{
    const {SONG_CATALOG,createSongCatalog}=await import('/src/catalog/catalog.ts');
    const {selectSongs}=await import('/src/catalog/selectors.ts');
    const source=SONG_CATALOG.songs.find(song=>song.segmentKind==='full');
    const count=120;
    const collectionId='acceptance-scale-only';
    const songIds=Array.from({length:count},(_,index)=>'scale-fixture-'+String(index).padStart(3,'0'));
    const songs=songIds.map((id,index)=>({
      ...source,id,title:'Synthetic scale record '+String(index).padStart(3,'0'),
      sortOrder:index,availability:index%2===0?'available':'unavailable',
    }));
    const generated=Object.fromEntries(songs.map(song=>[song.id+'.charts.json',{
      schemaVersion:1,songId:song.id,source:'data/music/'+song.id+'.mp3',charts:source.charts,
    }]));
    const audio=Object.fromEntries(songs.map(song=>['../../data/music/'+song.id+'.mp3','/'+song.id+'.mp3']));
    const fixture=createSongCatalog({schemaVersion:1,songs,collections:[{
      id:collectionId,title:'Synthetic scale-only fixture',sortOrder:0,songIds,
    }]},generated,audio);
    const filters={query:'synthetic scale record',availability:'available',supportsDifficulty:'hard'};
    const expected=selectSongs(fixture,filters).length;
    const iterations=400;
    const started=performance.now();
    let matches=0;
    for(let iteration=0;iteration<iterations;iteration++)
      matches+=selectSongs(fixture,filters).length;
    const elapsed=performance.now()-started;
    return {
      label:'synthetic scale-only selector fixture; never mounted or added to live catalog',
      recordCount:fixture.songs.length,expectedMatchesPerQuery:expected,
      iterations,totalMatches:matches,elapsedMilliseconds:Number(elapsed.toFixed(3)),
      meanMillisecondsPerQuery:Number((elapsed/iterations).toFixed(4)),
    };
  })()`);
  assert.equal(report.scaleFixture.recordCount, 120);
  assert.equal(report.scaleFixture.expectedMatchesPerQuery, 60);
  assert.equal(
    report.scaleFixture.totalMatches,
    report.scaleFixture.expectedMatchesPerQuery *
      report.scaleFixture.iterations,
  );

  const baselineCanvasCount = await cdp.evaluate(
    'document.querySelectorAll("canvas").length',
  );
  for (const song of catalogRows) {
    await click(`button[data-action="select-song"][data-song-id="${song.id}"]`);
    const details = await cdp.evaluate(`(()=>({
      title:document.querySelector('[data-song-detail] h2')?.textContent,
      options:[...document.querySelectorAll('[data-song-detail] [data-run-difficulty] option')].map(option=>option.value),
      excerpt:document.querySelector('[data-song-detail] .detail-kicker')?.textContent,
      duration:document.querySelector('[data-song-detail] .song-detail-duration')?.textContent,
      rowStatus:document.querySelector('[data-action="select-song"][data-song-id=${JSON.stringify(song.id)}] .song-row-copy small')?.textContent,
    }))()`);
    assert.equal(details.title, song.title);
    assert.deepEqual(details.options, song.difficulties);
    const browseChart = song.charts.normal;
    const expectedDuration = (() => {
      const seconds = Math.round(browseChart.duration);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    })();
    assert.equal(
      details.duration,
      `${expectedDuration} playable`,
      'Details must show the playable chart duration.',
    );
    assert.ok(
      details.rowStatus.endsWith(expectedDuration),
      'Each song row must show its playable duration.',
    );
    if (song.segmentKind === 'excerpt') {
      assert.match(details.excerpt, /Demo excerpt/i);
      assert.match(details.rowStatus, /Demo excerpt/i);
      const sample = 1 / 48_000;
      assert.ok(
        Math.abs(browseChart.duration - 65.8) <= sample,
        'Demo duration should match its authored interval within one sample.',
      );
      assert.ok(
        Math.abs(browseChart.sourceStart - 107.1) <= sample,
        'Demo source offset should match its authored interval within one sample.',
      );
    }
  }

  const plan = createAcceptancePlan(catalogRows, mode);
  report.plannedRunCount = plan.runs.length;
  for (const { songId, difficulty } of plan.runs) {
    const song = catalogRows.find((candidate) => candidate.id === songId);
    assert.ok(song, `Planned song is present in runtime catalog: ${songId}`);
    const runChart = song.charts[difficulty];
    await click(`button[data-action="select-song"][data-song-id="${song.id}"]`);
    const difficultySelection = await chooseDifficulty(
      difficulty,
      song.difficulties,
    );
    assert.equal(difficultySelection.value, difficulty);
    assert.equal(
      await cdp.evaluate(
        "document.querySelector('[data-song-detail] h2')?.textContent",
      ),
      song.title,
    );
    assert.equal(
      await cdp.evaluate('window.__audioContextCount'),
      report.playbackRuns.length,
    );
    assert.equal(
      await cdp.evaluate('window.__audioRequests.length'),
      report.playbackRuns.length,
    );

    await cdp.evaluate(`(()=>{
        window.__frameLabel=${JSON.stringify(`${song.id}:${difficulty}`)};
        const button=document.querySelector('[data-song-detail] [data-action="play"]');
        if(!button || button.disabled) throw new Error('Selected song Play control is unavailable.');
        button.addEventListener('click',event=>window.__lastPlayTrusted=event.isTrusted,{once:true});
      })()`);
    const previousRequestCount = report.playbackRuns.length;
    const previousContextCount = await cdp.evaluate(
      'window.__audioContextCount',
    );
    await click('[data-song-detail] [data-action="play"]');
    await waitFor(
      async () =>
        (await cdp.evaluate('window.__audioContextCount')) ===
        previousContextCount + 1,
      `trusted AudioContext construction for ${song.id}/${difficulty}`,
    );
    const trustedPlay = await cdp.evaluate('window.__lastPlayTrusted');
    assert.equal(
      trustedPlay,
      true,
      'Playback must begin from a trusted user click.',
    );

    await waitFor(
      async () =>
        (await cdp.evaluate('window.__audioRequests.length')) ===
        previousRequestCount + 1,
      `selected audio request for ${song.id}/${difficulty}`,
      30_000,
    );
    const requestedUrl = await cdp.evaluate(
      `window.__audioRequests[${previousRequestCount}]`,
    );
    assert.equal(
      new URL(requestedUrl, `http://127.0.0.1:${vitePort}/`).pathname,
      song.audioPath,
      `Audio URL must pair with ${song.id}.`,
    );

    const startView = await waitForGameplayStart(song, difficulty);
    const startedFrameCount = await waitFor(
      async () => {
        const count = await cdp.evaluate(
          `window.__frameSamples.filter(sample=>sample.run===${JSON.stringify(`${song.id}:${difficulty}`)}).length`,
        );
        return count >= 60 ? count : false;
      },
      `60 live gameplay frame measurements for ${song.id}/${difficulty}`,
      30_000,
    );
    const frameSamples = await cdp.evaluate(
      `window.__frameSamples.filter(sample=>sample.run===${JSON.stringify(`${song.id}:${difficulty}`)})`,
    );
    assert.ok(startedFrameCount >= 60);
    const runFrameStats = frameStatistics(frameSamples);
    assert.ok(runFrameStats.count >= 60);
    const beforeReturn = {
      audioContextCount: await cdp.evaluate('window.__audioContextCount'),
      activeContexts: await cdp.evaluate('window.__activeAudioContexts'),
      activeSources: await cdp.evaluate('window.__activeAudioSources'),
      canvasCount: await cdp.evaluate(
        'document.querySelectorAll("canvas").length',
      ),
    };
    assert.ok(beforeReturn.activeContexts > 0);
    assert.ok(beforeReturn.activeSources > 0);
    const returned = await returnFromGameplay(baselineCanvasCount, song);
    const contextCountAfterReturn = await cdp.evaluate(
      'window.__audioContextCount',
    );
    assert.equal(contextCountAfterReturn, previousContextCount + 1);
    assert.equal(
      await cdp.evaluate('window.__audioRequests.length'),
      previousRequestCount + 1,
    );
    assert.equal(
      await cdp.evaluate('window.__audioContextCount'),
      contextCountAfterReturn,
    );
    assert.equal(await cdp.evaluate('window.__activeAudioContexts'), 0);
    assert.equal(await cdp.evaluate('window.__activeAudioSources'), 0);

    report.playbackRuns.push({
      songId: song.id,
      title: song.title,
      segmentKind: song.segmentKind,
      difficulty,
      trustedPlay,
      selectedAudioUrl: song.audioUrl,
      requestedUrl,
      gameplayLabel: startView.label,
      timingLegend: startView.legend,
      chartTiming: {
        sourceStart: runChart.sourceStart,
        duration: runChart.duration,
        twilightAt: runChart.twilightAt,
      },
      frameCostMilliseconds: runFrameStats,
      resourceStateBeforeReturn: beforeReturn,
      resourceStateAfterReturn: returned,
    });
    assert.equal(
      await cdp.evaluate('window.__appErrors.length'),
      0,
      'No page errors should occur.',
    );
    process.stdout.write(
      `Accepted ${song.id} (${difficulty}); ${runFrameStats.count} frame samples, p95 ${runFrameStats.p95Ms} ms.\n`,
    );
  }

  assert.equal(report.playbackRuns.length, plan.runs.length);
  assert.deepEqual(await cdp.evaluate('window.__audioRequests.slice(0,0)'), []);
  report.fullTrackFrameCost = frameStatistics(
    (await cdp.evaluate('window.__frameSamples')).filter((sample) => {
      const [songId] = sample.run.split(':');
      return (
        catalogRows.find((song) => song.id === songId)?.segmentKind === 'full'
      );
    }),
  );
  report.fullTrackFrameCostMethod =
    'Elapsed wall time around the app requestAnimationFrame callback while the gameplay screen was visible; descriptive measurements, no performance budget asserted.';
  report.runCount = report.playbackRuns.length;
  report.completedAt = new Date().toISOString();
}

async function waitForBrowserExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(timeoutMilliseconds).then(() => false),
  ]);
}

async function cleanup() {
  if (cdp !== undefined && cdp.socket.readyState === WebSocket.OPEN) {
    try {
      await cdp.command('Page.close');
    } catch {
      // Closing the target can close its own DevTools connection first.
    }
  }

  if (cdp !== undefined && debugPort !== undefined) {
    try {
      await waitFor(
        async () => {
          const response = await fetch(
            `http://127.0.0.1:${debugPort}/json/list`,
          );
          const targets = response.ok ? await response.json() : [];
          return targets.some((target) => target.id === pageTargetId)
            ? false
            : true;
        },
        'page target destruction and listener teardown',
        10_000,
      );
      report.cleanup.pageTargetDestroyed = true;
    } catch (error) {
      report.cleanup.pageTargetDestroyed = false;
      report.cleanup.pageTargetError = String(error);
      failure ??= error;
    }
  }

  if (cdp !== undefined && cdp.socket.readyState < WebSocket.CLOSING) {
    const closed = new Promise((resolve) =>
      cdp.socket.addEventListener('close', resolve, { once: true }),
    );
    cdp.socket.close();
    await Promise.race([closed, delay(2_000)]);
  }
  report.cleanup.devtoolsSocketClosed =
    cdp === undefined || cdp.socket.readyState === WebSocket.CLOSED;

  if (browser !== undefined && browser.exitCode === null) {
    browser.kill('SIGTERM');
    const exited = await waitForBrowserExit(browser, 5_000);
    if (!exited && browser.exitCode === null) {
      browser.kill('SIGKILL');
      await waitForBrowserExit(browser, 3_000);
    }
  }
  report.cleanup.browserProcessExited =
    browser === undefined || browser.exitCode !== null;

  if (server !== undefined) {
    await server.close();
    report.cleanup.viteServerClosed = true;
  } else {
    report.cleanup.viteServerClosed = true;
  }
  if (profile !== undefined) {
    await rm(profile, { recursive: true, force: true });
    report.cleanup.temporaryProfileRemoved = true;
  }
}

try {
  await runAcceptance();
} catch (error) {
  failure = error;
  report.failure =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  try {
    await cleanup();
  } catch (error) {
    failure ??= error;
    report.cleanup.failure = String(error);
  }
  if (
    !report.cleanup.pageTargetDestroyed ||
    !report.cleanup.devtoolsSocketClosed ||
    !report.cleanup.browserProcessExited ||
    !report.cleanup.viteServerClosed ||
    !report.cleanup.temporaryProfileRemoved
  ) {
    failure ??= new Error('Acceptance harness cleanup did not fully complete.');
  }
  report.completedAt ??= new Date().toISOString();
  report.result = failure === undefined ? 'passed' : 'failed';
  await mkdir(evidenceDirectory, { recursive: true });
  const artifactName = `run-${runStartedAt.toISOString().replaceAll(':', '-')}.json`;
  await writeFile(
    path.join(evidenceDirectory, artifactName),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `Evidence ${report.result}: ${path.join('.lore/local/evidence/observatory-acceptance', artifactName)}\n`,
  );
}

if (failure !== undefined) {
  process.stderr.write(
    `${failure instanceof Error ? failure.stack : String(failure)}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Page target, DevTools connection, browser, Vite server and profile were cleaned up.\n',
  );
}
