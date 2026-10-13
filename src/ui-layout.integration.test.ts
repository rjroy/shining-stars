import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const browser = '/usr/bin/chromium';
let server: Awaited<ReturnType<typeof createServer>> | undefined;

function captureBrowser(
  url: string,
  viewport?: { readonly width: number; readonly height: number },
): Promise<{ html: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      browser,
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--virtual-time-budget=10000',
        ...(viewport
          ? [`--window-size=${viewport.width},${viewport.height}`]
          : []),
        '--dump-dom',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => process.kill('SIGKILL'), 30000);
    process.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    process.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    process.on('error', reject);
    process.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Chromium exited ${code}: ${stderr}`));
      else resolve({ html: stdout, stderr });
    });
  });
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
});

describe('real-browser GameUI viewport wiring', () => {
  it('measures content-box-relative layout, excludes only persistent HUD, and keeps label slots stable', async () => {
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'brightvale-ui-layout-fixture',
          configureServer(vite) {
            vite.middlewares.use(
              '/__ui-layout-fixture__',
              (_request, response) => {
                response.setHeader('content-type', 'text/html');
                response.end(browserFixture);
              },
            );
          },
        },
      ],
    });
    await server.listen();
    const httpServer = server.httpServer;
    if (httpServer === null) throw new Error('Vite HTTP server is unavailable');
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Vite test server did not bind a TCP port');

    const capture = await captureBrowser(
      `http://127.0.0.1:${address.port}/__ui-layout-fixture__`,
    );
    const html = capture.html;
    const result = html.match(
      /<pre id="result" data-ready="true">([\s\S]*?)<\/pre>/,
    )?.[1];
    if (!result)
      throw new Error(
        `Browser fixture produced no result: ${capture.stderr}\n${html}`,
      );
    const report = JSON.parse(result) as {
      readonly layout: unknown;
      readonly modalStable: boolean;
      readonly labelStable: boolean;
      readonly labelSnapshots: readonly string[];
      readonly zeroHost: { readonly width: number; readonly height: number };
      readonly occupiedGroups: readonly {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }[];
      readonly modalRects: readonly {
        readonly visible: boolean;
        readonly rect: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        };
      }[];
      readonly hudSnapshots: readonly {
        readonly exclusions: readonly {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        }[];
        readonly occupiedGroups: readonly {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        }[];
        readonly modalRects: readonly {
          readonly visible: boolean;
          readonly rect: {
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
          };
        }[];
      }[];
    };

    expect(report.layout).toMatchObject({
      width: 960,
      height: 660,
      labels: {
        time: { x: 700, y: 40, width: 100, height: 24 },
        countdown: { x: 756, y: 586, width: 180, height: 32 },
        legend: { x: 230, y: 516, width: 500, height: 24 },
        feedback: { x: 340, y: 450, width: 260, height: 30 },
      },
    });
    const layout = report.layout as {
      readonly persistentHudExclusions: readonly {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }[];
    };
    expect(layout.persistentHudExclusions).toEqual(report.occupiedGroups);
    expect(report.occupiedGroups.length).toBeGreaterThan(1);
    for (const modal of report.modalRects) {
      if (modal.visible)
        expect(layout.persistentHudExclusions).not.toContainEqual(modal.rect);
    }
    expect(report.hudSnapshots).toHaveLength(5);
    for (const snapshot of report.hudSnapshots) {
      expect(snapshot.exclusions).toEqual(snapshot.occupiedGroups);
      for (const modal of snapshot.modalRects) {
        if (modal.visible)
          expect(snapshot.exclusions).not.toContainEqual(modal.rect);
      }
    }
    expect(report.zeroHost).toEqual({ width: 0, height: 0 });
    expect(report.modalStable, report.labelSnapshots.join('\n')).toBe(true);
    expect(report.labelStable).toBe(true);
  });

  it('maps loading, suspended, unavailable, and rendered status to recovery controls', async () => {
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'brightvale-ui-status-fixture',
          configureServer(vite) {
            vite.middlewares.use(
              '/__ui-status-fixture__',
              (_request, response) => {
                response.setHeader('content-type', 'text/html');
                response.end(statusFixture);
              },
            );
          },
        },
      ],
    });
    await server.listen();
    const httpServer = server.httpServer;
    if (httpServer === null) throw new Error('Vite HTTP server is unavailable');
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Vite test server did not bind a TCP port');

    const capture = await captureBrowser(
      `http://127.0.0.1:${address.port}/__ui-status-fixture__`,
    );
    const html = capture.html;
    const result = html.match(
      /<pre id="result" data-ready="true">([\s\S]*?)<\/pre>/,
    )?.[1];
    if (!result)
      throw new Error(
        `Browser fixture produced no result: ${capture.stderr}\n${html}`,
      );
    const report = JSON.parse(result) as {
      readonly loading: {
        readonly visible: boolean;
        readonly retryDisabled: boolean;
      };
      readonly suspended: {
        readonly visible: boolean;
        readonly retryDisabled: boolean;
      };
      readonly unavailable: {
        readonly visible: boolean;
        readonly retryDisabled: boolean;
      };
      readonly rendered: {
        readonly visible: boolean;
        readonly startDisabled: boolean;
      };
    };
    expect(report).toEqual({
      loading: { visible: true, retryDisabled: true },
      suspended: { visible: true, retryDisabled: true },
      unavailable: { visible: true, retryDisabled: false },
      rendered: { visible: false, startDisabled: false },
    });
  });

  it('keeps status messages readable and terminal retry clickable above Ready/Pause panels at reference and narrow viewports', async () => {
    vi.stubEnv('VITE_SONG_VOLUME', '0');
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'brightvale-ui-status-stacking-fixture',
          configureServer(vite) {
            vite.middlewares.use(
              '/__ui-status-stacking-fixture__',
              (_request, response) => {
                response.setHeader('content-type', 'text/html; charset=utf-8');
                response.end(statusStackingFixture);
              },
            );
          },
        },
      ],
    });
    await server.listen();
    const httpServer = server.httpServer;
    if (httpServer === null) throw new Error('Vite HTTP server is unavailable');
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Vite test server did not bind a TCP port');

    const inspectViewport = async (viewport: {
      readonly width: number;
      readonly height: number;
    }) => {
      const capture = await captureBrowser(
        `http://127.0.0.1:${address.port}/__ui-status-stacking-fixture__`,
        viewport,
      );
      const result = capture.html.match(
        /<pre id="result" data-ready="true">([\s\S]*?)<\/pre>/,
      )?.[1];
      if (!result)
        throw new Error(
          `Browser fixture produced no result: ${capture.stderr}\n${capture.html}`,
        );
      return JSON.parse(result) as {
        readonly viewport: { readonly width: number; readonly height: number };
        readonly samples: readonly {
          readonly panel: string;
          readonly status: string;
          readonly panelVisible: boolean;
          readonly statusVisible: boolean;
          readonly statusMessage: string;
          readonly statusMessageReadable: boolean;
          readonly retryDisabled: boolean;
          readonly retryReceivesHit: boolean;
          readonly retryClicks: number;
        }[];
      };
    };

    const reports = await Promise.all([
      inspectViewport({ width: 1600, height: 900 }),
      inspectViewport({ width: 600, height: 800 }),
    ]);
    const expectedStatuses = ['loading', 'suspended', 'unavailable'];
    for (
      let viewportIndex = 0;
      viewportIndex < reports.length;
      viewportIndex += 1
    ) {
      const report = reports[viewportIndex];
      expect(report?.viewport.width).toBe(viewportIndex === 0 ? 1600 : 600);
      expect(report?.viewport.height).toBeGreaterThan(0);
      expect(report?.samples).toHaveLength(6);
      for (const panel of ['ready', 'pause']) {
        for (const status of expectedStatuses) {
          const sample = report?.samples.find(
            (item) => item.panel === panel && item.status === status,
          );
          expect(sample, `${panel}/${status} sample`).toBeDefined();
          expect(sample?.panelVisible, `${panel} dialog remains visible`).toBe(
            true,
          );
          expect(
            sample?.statusVisible,
            `${panel}/${status} status visible`,
          ).toBe(true);
          expect
            .soft(
              sample?.statusMessageReadable,
              `${panel}/${status} message hit test`,
            )
            .toBe(true);
          expect(sample?.statusMessage).toBe(
            status === 'loading'
              ? 'Loading Brightvale…'
              : status === 'suspended'
                ? 'Resize to continue playing.'
                : 'The playfield is unavailable.',
          );
          if (status === 'unavailable') {
            expect.soft(sample?.retryDisabled).toBe(false);
            expect
              .soft(
                sample?.retryReceivesHit,
                `${panel}/${status} retry button receives hit test`,
              )
              .toBe(true);
            expect.soft(sample?.retryClicks).toBe(1);
          } else {
            expect.soft(sample?.retryDisabled).toBe(true);
          }
        }
      }
    }
  });

  it('measures occupied production control groups instead of excluding the full empty flex row', async () => {
    vi.stubEnv('VITE_SONG_VOLUME', '0');
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'brightvale-ui-production-hud-measurement',
          configureServer(vite) {
            vite.middlewares.use(
              '/__ui-production-hud__',
              (_request, response) => {
                response.setHeader('content-type', 'text/html; charset=utf-8');
                response.end(productionHudFixture);
              },
            );
          },
        },
      ],
    });
    await server.listen();
    const httpServer = server.httpServer;
    if (httpServer === null) throw new Error('Vite HTTP server is unavailable');
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Vite test server did not bind a TCP port');

    const capture = await captureBrowser(
      `http://127.0.0.1:${address.port}/__ui-production-hud__`,
      { width: 1600, height: 900 },
    );
    const encoded = capture.html.match(
      /<pre id="result" data-ready="true">([\s\S]*?)<\/pre>/,
    )?.[1];
    if (!encoded)
      throw new Error(
        `Production HUD fixture produced no result: ${capture.stderr}\n${capture.html}`,
      );
    const report = JSON.parse(encoded) as {
      readonly viewport: { readonly width: number; readonly height: number };
      readonly row: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly instruction: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly pauseHidden: boolean;
      readonly controlExclusions: readonly {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }[];
    };

    expect(report.viewport.width).toBe(1600);
    expect(report.pauseHidden).toBe(true);
    expect(report.row.width).toBeGreaterThan(report.instruction.width * 2);
    expect(report.controlExclusions).toEqual([report.instruction]);
  });
});

const browserFixture = `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  html, body, #root { margin: 0; width: 100%; height: 100%; }
  .play-surface { position: relative; width: 1000px; height: 700px; border: 4px solid; padding: 16px; }
  .play-heading, .performance-controls, .stage-time, [data-countdown], [data-timing-legend], .feedback-row { position: absolute; }
  .play-heading { left: 36px; top: 36px; width: 700px; height: 80px; }
  .performance-controls { left: 36px; top: 576px; width: 500px; height: 50px; }
  .stage-time { left: 716px; top: 56px; width: 100px; height: 24px; }
  [data-countdown] { left: 416px; top: 136px; width: 180px; height: 32px; }
  [data-timing-legend] { left: 246px; top: 516px; width: 500px; height: 24px; }
  .feedback-row { left: 356px; top: 466px; width: 260px; height: 30px; }
  .stage-frame { position: absolute; inset: 0; }
  .dialog-panel { position: absolute; left: 100px; top: 100px; width: 600px; height: 400px; }
</style></head><body><div id="root"></div><pre id="result" data-ready="false"></pre><script type="module">
  import { createGameUI } from '/src/ui.ts';
  const chart = { allowedDifficulties: ['easy'], twilightStrength: 100, notes: [], duration: 10, sourceStart: 0, twilightAt: 5, twilightStrength: 100 };
  const actions = { start(){}, pause(){}, resume(){}, restart(){}, selectDifficulty(){} };
  const ui = createGameUI(document.querySelector('#root'), chart, actions);
  const host = document.querySelector('.play-surface');
  const labelsInHost = () => {
    const hostRect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const left = hostRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = hostRect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    return JSON.stringify(['[data-time]', '[data-countdown]', '[data-timing-legend]', '.feedback-row'].map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {x:rect.left-left,y:rect.top-top,width:rect.width,height:rect.height};
    }));
  };
  const waitForZeroContentBox = () => new Promise((resolve, reject) => {
    const observer = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target === host && entry.contentRect.width === 0 && entry.contentRect.height === 0)) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for zero-sized host measurement'));
    }, 5000);
    observer.observe(host);
  });
  const snapshot = { audio:{status:'ready',position:0,duration:10,scheduledWhen:null,hasActiveSource:false,loaded:true,disposed:false,error:null}, game:{transportTime:0,phase:'audience',status:'ready',renown:0,personalStrength:100,twilightStrength:100,difficulty:'easy',notes:[],result:null}, inputOffset:0,visualOffset:0,selectedDifficulty:'easy',feedback:null,pendingPlaybackRequests:false };
  const renderState = (audioStatus, gameStatus, transportTime = 0) => ui.render({ ...snapshot, audio:{...snapshot.audio,status:audioStatus}, game:{...snapshot.game,status:gameStatus,transportTime} }, 0);
  renderState('ready', 'ready');
  const layout = ui.getGameplayLayout();
  const contentOrigin = () => {
    const hostRect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    return {
      x: hostRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      y: hostRect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
    };
  };
  const rectInHost = (element) => {
    const origin = contentOrigin();
    const rect = element.getBoundingClientRect();
    return { x:rect.left-origin.x, y:rect.top-origin.y, width:rect.width, height:rect.height };
  };
  const occupiedElements = [
    ...document.querySelector('.play-heading').children,
    document.querySelector('.performance-controls p'),
    document.querySelector('[data-action="pause"]'),
  ];
  const occupiedGroups = occupiedElements
    .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
    .map(rectInHost);
  const modalRects = [...document.querySelectorAll('[data-panel]')].map((element) => ({
    visible: !element.hidden && element.getClientRects().length > 0,
    rect: rectInHost(element),
  }));
  const hudEvidence = () => ({
    exclusions: ui.getGameplayLayout().persistentHudExclusions,
    occupiedGroups: [
      ...document.querySelector('.play-heading').children,
      document.querySelector('.performance-controls p'),
      document.querySelector('[data-action="pause"]'),
    ]
      .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
      .map(rectInHost),
    modalRects: [...document.querySelectorAll('[data-panel]')].map((element) => ({
      visible: !element.hidden && element.getClientRects().length > 0,
      rect: rectInHost(element),
    })),
  });
  const hudSnapshots = [hudEvidence()];
  const before = labelsInHost();
  const labelSnapshots = [before];
  const time = document.querySelector('[data-time]');
  const countdown = document.querySelector('[data-countdown]');
  const legend = document.querySelector('[data-timing-legend]');
  const feedback = document.querySelector('[data-feedback]');
  renderState('starting', 'starting', 83);
  feedback.textContent = 'Perfect';
  labelSnapshots.push(labelsInHost());
  time.style.visibility = 'hidden';
  countdown.style.visibility = 'hidden';
  legend.style.visibility = 'hidden';
  feedback.style.visibility = 'hidden';
  labelSnapshots.push(labelsInHost());
  for (const state of [
    ['ready', 'ready'],
    ['paused', 'ready'],
    ['ready', 'results'],
    ['error', 'ready'],
  ]) {
    renderState(state[0], state[1]);
    labelSnapshots.push(labelsInHost());
    hudSnapshots.push(hudEvidence());
  }
  const after = labelsInHost();
  const zeroHostReady = waitForZeroContentBox();
  host.style.width = '40px'; host.style.height = '40px';
  await zeroHostReady;
  const zeroLayout = ui.getGameplayLayout();
  const result = document.querySelector('#result');
  result.textContent = JSON.stringify({ layout, occupiedGroups, modalRects, hudSnapshots, zeroHost:{width:zeroLayout.width,height:zeroLayout.height}, labelSnapshots, modalStable: labelSnapshots.slice(3).every((value) => value === before), labelStable: labelSnapshots.every((value) => value === before) && after === before });
  result.dataset.ready = 'true';
</script></body></html>`;

const statusFixture = `<!doctype html><html><body><div id="root"></div><pre id="result" data-ready="false"></pre><script type="module">
  import { createGameUI } from '/src/ui.ts';
  const chart = { allowedDifficulties: ['easy'], twilightStrength: 100, notes: [], duration: 10, sourceStart: 0, twilightAt: 5 };
  const actions = { start(){}, pause(){}, resume(){}, restart(){}, selectDifficulty(){}, onRendererRetry(){} };
  const ui = createGameUI(document.querySelector('#root'), chart, actions);
  const snapshot = { audio:{status:'ready',position:0,duration:10,scheduledWhen:null,hasActiveSource:false,loaded:true,disposed:false,error:null}, game:{transportTime:0,phase:'audience',status:'ready',renown:0,personalStrength:100,twilightStrength:100,difficulty:'easy',notes:[],result:null}, inputOffset:0,visualOffset:0,selectedDifficulty:'easy',feedback:null,pendingPlaybackRequests:false };
  const status = () => ({ visible: !document.querySelector('[data-renderer-status]').hidden, retryDisabled: document.querySelector('[data-action="renderer-retry"]').disabled });
  ui.setRendererStatus('loading', 'Loading'); ui.render(snapshot, 0); const loading = status();
  ui.setRendererStatus('suspended', 'Suspended'); ui.render(snapshot, 0); const suspended = status();
  ui.setRendererStatus('unavailable', 'Unavailable'); ui.render(snapshot, 0); const unavailable = status();
  ui.setRendererStatus('rendered');
  ui.render(snapshot, 0);
  const result = document.querySelector('#result');
  result.textContent = JSON.stringify({ loading, suspended, unavailable, rendered:{visible:!document.querySelector('[data-renderer-status]').hidden,startDisabled:document.querySelector('[data-action="start"]').disabled} });
  result.dataset.ready = 'true';
</script></body></html>`;

const statusStackingFixture = `<!doctype html><html><body><div id="app"></div><pre id="result" data-ready="false"></pre><script type="module">
  import '/src/styles.css';
  import { createGameUI } from '/src/ui.ts';
  const chart = { allowedDifficulties: ['easy'], twilightStrength: 100, notes: [], duration: 10, sourceStart: 0, twilightAt: 5 };
  let retryClicks = 0;
  const actions = { start(){}, pause(){}, resume(){}, restart(){}, selectDifficulty(){}, onRendererRetry(){ retryClicks += 1; } };
  const ui = createGameUI(document.querySelector('#app'), chart, actions);
  const base = { audio:{status:'ready',position:0,duration:10,scheduledWhen:null,hasActiveSource:false,loaded:true,disposed:false,error:null}, game:{transportTime:0,phase:'audience',status:'ready',renown:0,personalStrength:100,twilightStrength:100,difficulty:'easy',notes:[],result:null}, inputOffset:0,visualOffset:0,selectedDifficulty:'easy',feedback:null,pendingPlaybackRequests:false };
  const messages = { loading:'Loading Brightvale…', suspended:'Resize to continue playing.', unavailable:'The playfield is unavailable.' };
  const samples = [];
  try {
  for (const panel of ['ready', 'pause']) {
    const snapshot = panel === 'ready'
      ? base
      : { ...base, audio:{ ...base.audio, status:'paused' }, game:{ ...base.game, status:'playing' } };
    for (const status of ['loading', 'suspended', 'unavailable']) {
      ui.setRendererStatus(status, messages[status]);
      ui.render(snapshot, 0);
      const modal = document.querySelector('[data-panel="' + panel + '"]');
      const statusNode = document.querySelector('[data-renderer-status]');
      const message = document.querySelector('[data-renderer-message]');
      const retry = document.querySelector('[data-action="renderer-retry"]');
      const messageRect = message.getBoundingClientRect();
      const messageHit = document.elementFromPoint(messageRect.left + messageRect.width / 2, messageRect.top + messageRect.height / 2);
      const retryRect = retry.getBoundingClientRect();
      const retryHit = document.elementFromPoint(retryRect.left + retryRect.width / 2, retryRect.top + retryRect.height / 2);
      const retryReceivesHit = retryHit === retry || retry.contains(retryHit);
      const clicksBefore = retryClicks;
      if (status === 'unavailable' && retryReceivesHit && retryHit instanceof HTMLElement)
        retryHit.click();
      samples.push({
        panel,
        status,
        panelVisible: getComputedStyle(modal).display !== 'none' && modal.getClientRects().length > 0,
        statusVisible: !statusNode.hidden && statusNode.getClientRects().length > 0,
        statusMessage: message.textContent,
        statusMessageReadable: statusNode.contains(messageHit),
        retryDisabled: retry.disabled,
        retryReceivesHit,
        retryClicks: retryClicks - clicksBefore,
      });
    }
  }
  const result = document.querySelector('#result');
  result.textContent = JSON.stringify({ viewport:{width:window.innerWidth,height:window.innerHeight}, samples });
  result.dataset.ready = 'true';
  } catch (error) {
    const result = document.querySelector('#result');
    result.textContent = JSON.stringify({ error:String(error), stack:error?.stack });
    result.dataset.ready = 'true';
  }
</script></body></html>`;

const productionHudFixture = `<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="app"></div><pre id="result" data-ready="false"></pre><script type="module">
  import { createGameUI } from '/src/ui.ts';
  const chart = { allowedDifficulties:['normal'], notes:[], duration:10, sourceStart:0, twilightAt:5, twilightStrength:100 };
  const actions = { start(){}, pause(){}, resume(){}, restart(){}, selectDifficulty(){} };
  const ui = createGameUI(document.querySelector('#app'), chart, actions);
  const measure = () => {
    const host = document.querySelector('.play-surface');
    const hr = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const left = hr.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = hr.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const rect = (element) => { const r=element.getBoundingClientRect(); return {x:r.left-left,y:r.top-top,width:r.width,height:r.height}; };
    const row = document.querySelector('.performance-controls');
    const layout = ui.getGameplayLayout();
    const rowRect = rect(row);
    return { viewport:{width:innerWidth,height:innerHeight}, row:rowRect, instruction:rect(row.querySelector('p')), pauseHidden:row.querySelector('[data-action="pause"]').hidden, controlExclusions:layout.persistentHudExclusions.filter(exclusion=>exclusion.y>=rowRect.y-1&&exclusion.y<rowRect.y+rowRect.height+1) };
  };
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const report = measure();
  const result = document.querySelector('#result');
  result.textContent = JSON.stringify(report);
  result.dataset.ready = 'true';
</script></body></html>`;
