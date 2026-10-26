import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import proposedCollections from '../data/proposed-collections.json';

const scratchParent = '/tmp/opencode';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate an ephemeral port.'));
        return;
      }
      server.close((error) =>
        error === undefined ? resolve(address.port) : reject(error),
      );
    });
  });
}

async function waitFor<T>(
  check: () => Promise<T | false>,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== false) return value;
    } catch {
      // Retry while Vite and the page finish starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

describe('real app Observatory-to-gameplay integration', () => {
  let browser: ChildProcess | undefined;
  let devServer: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  let profile: string | undefined;

  afterEach(async () => {
    socket?.close();
    socket = undefined;
    if (browser !== undefined && browser.exitCode === null) {
      browser.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((resolve) => browser?.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (browser.exitCode === null) browser.kill('SIGKILL');
    }
    browser = undefined;
    await devServer?.close();
    devServer = undefined;
    if (profile !== undefined)
      await rm(profile, { recursive: true, force: true });
    profile = undefined;
  });

  it('keeps browsing audio-free, pairs the chosen song, and returns from loading and gameplay', async () => {
    const chromium = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
    await access(chromium);
    profile = await mkdtemp(path.join(scratchParent, 'observatory-main-'));
    const vitePort = await freePort();
    const debugPort = await freePort();
    devServer = await createServer({
      configFile: false,
      root: process.cwd(),
      define: { 'import.meta.env.VITE_SONG_VOLUME': JSON.stringify('0') },
      server: { host: '127.0.0.1', port: vitePort, strictPort: true },
    });
    await devServer.listen();
    browser = spawn(
      chromium,
      [
        '--headless=new',
        '--mute-audio',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      return response.ok
        ? ((await response.json()) as {
            type: string;
            webSocketDebuggerUrl: string;
          }[])
        : false;
    }, 'Chromium DevTools');
    const page = targets.find((target) => target.type === 'page');
    if (page === undefined) throw new Error('Chromium did not expose a page.');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener(
        'error',
        () => reject(new Error('CDP connection failed.')),
        { once: true },
      );
    });
    let nextId = 0;
    const pending = new Map<
      number,
      { resolve(value: Record<string, any>): void; reject(error: Error): void }
    >();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Record<string, any>;
        error?: { message: string };
      };
      if (message.id === undefined) return;
      const request = pending.get(message.id);
      if (request === undefined) return;
      pending.delete(message.id);
      if (message.error !== undefined)
        request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
    });
    const command = (method: string, params: Record<string, unknown> = {}) => {
      const id = ++nextId;
      socket!.send(JSON.stringify({ id, method, params }));
      return new Promise<Record<string, any>>((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
    };
    const evaluate = async (expression: string): Promise<any> => {
      const result = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails !== undefined)
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'Page evaluation failed.',
        );
      return result.result?.value;
    };
    const click = async (selector: string): Promise<void> => {
      const rect = await waitFor(
        async () =>
          (await evaluate(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.getClientRects().length===0||getComputedStyle(e).visibility==='hidden')return false;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
          )) || false,
        `visible control ${selector}`,
      );
      await command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rect.x,
        y: rect.y,
      });
      await command('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
      await command('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
    };
    const screenshot = async (name: string): Promise<void> => {
      const result = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await mkdir('/tmp/opencode', { recursive: true });
      await writeFile(
        `/tmp/opencode/${name}.png`,
        Buffer.from(result.data, 'base64'),
      );
    };

    await command('Page.enable');
    await command('Runtime.enable');
    await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const NativeAudioContext = window.AudioContext;
        window.__audioContextCount = 0;
        window.__audioResumeCalls = 0;
        window.__sourceStartCalls = 0;
        window.__musicGainTargets = [];
        window.__audioRequests = [];
        window.__holdAudio = false;
        window.__frameClearSamples = [];
        window.__frameClearCount = 0;
        window.__insideAppFrame = false;
        if (NativeAudioContext) {
          window.AudioContext = new Proxy(NativeAudioContext, {
            construct(target, args) {
              window.__audioContextCount++;
              const context = Reflect.construct(target, args);
              const resume = context.resume.bind(context);
              context.resume = (...resumeArgs) => {
                window.__audioResumeCalls++;
                return resume(...resumeArgs);
              };
              const createGain = context.createGain.bind(context);
              context.createGain = () => {
                const node = createGain();
                const parameter = node.gain;
                const setTargetAtTime = parameter.setTargetAtTime.bind(parameter);
                parameter.setTargetAtTime = (targetValue, startTime, timeConstant) => {
                  window.__musicGainTargets.push(targetValue);
                  return setTargetAtTime(targetValue, startTime, timeConstant);
                };
                return node;
              };
              return context;
            },
          });
        }
        const sourcePrototype = window.AudioBufferSourceNode?.prototype;
        if (sourcePrototype) {
          const start = sourcePrototype.start;
          sourcePrototype.start = function (...args) {
            window.__sourceStartCalls++;
            return start.apply(this, args);
          };
        }
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init = {}) => {
          const url = String(input);
          if (/\\.mp3(?:$|\\?)/i.test(url)) {
            window.__audioRequests.push(url);
            if (window.__holdAudio)
              return new Promise((resolve, reject) => {
                const signal = init.signal;
                if (signal?.aborted) {
                  reject(new DOMException('Aborted', 'AbortError'));
                  return;
                }
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
              });
          }
          return nativeFetch(input, init);
        };
        for (const proto of new Set([window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype])) {
          if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'clear')) continue;
          const clear = proto.clear;
          proto.clear = function (...args) {
            if (window.__insideAppFrame) window.__frameClearCount++;
            return clear.apply(this, args);
          };
        }
        const nativeRaf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => nativeRaf((now) => {
          window.__insideAppFrame = true;
          window.__frameClearCount = 0;
          try {
            callback(now);
          } finally {
            window.__insideAppFrame = false;
            if (document.querySelector('[data-experience-screen=gameplay]')?.hidden === false) {
              window.__frameClearSamples.push(window.__frameClearCount);
              if (window.__frameClearSamples.length > 40) window.__frameClearSamples.shift();
            }
          }
        });
      })()`,
    });
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` });
    await waitFor(
      async () =>
        (await evaluate(
          "document.querySelector('.observatory-app')?.isConnected",
        )) || false,
      'Observatory mount',
    );
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-renderer-notice]')?.hidden === true",
        ),
      'rendered Observatory scene',
    );
    await waitFor(
      async () =>
        await evaluate(
          "[...document.querySelectorAll('[data-collection-artwork]')].length === 4 && [...document.querySelectorAll('[data-collection-artwork]')].every(image => image.complete && image.naturalWidth === 1024 && image.naturalHeight === 1024)",
        ),
      'decoded collection medallions',
    );
    expect(
      await evaluate(
        "Promise.all([...document.querySelectorAll('[data-collection-artwork]')].map(image=>image.decode())).then(()=>true)",
      ),
    ).toBe(true);
    expect(await evaluate('window.__audioContextCount')).toBe(0);
    expect(await evaluate('window.__audioRequests')).toEqual([]);
    const musicControlReport = await evaluate(`(() => {
      const saveButton = document.querySelector('[data-action="save-data"]');
      const utility = saveButton?.closest('.observatory-save-utility');
      const disclosure = [...(utility?.querySelectorAll('button[aria-expanded], summary') ?? [])]
        .find((element) => /^music$/i.test(element.textContent?.trim() ?? ''));
      return {
        disclosure: disclosure !== undefined,
        besideSaveData: disclosure !== undefined && utility?.contains(saveButton) === true,
        slider: (() => {
          const range = document.querySelector('input[type="range"][aria-label="Music volume"]');
          return !!range && range.min === '0' && range.max === '100';
        })(),
        muteButton: [...document.querySelectorAll('button')].some((button) => /^mute\\b/i.test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '')),
      };
    })()`);
    expect(musicControlReport).toEqual({
      disclosure: true,
      besideSaveData: true,
      slider: true,
      muteButton: true,
    });
    const volumePersistence = await evaluate(`(() => {
      const utility = document.querySelector('.observatory-save-utility');
      const disclosure = [...(utility?.querySelectorAll('button[aria-expanded], summary') ?? [])]
        .find((element) => /^music$/i.test(element.textContent?.trim() ?? ''));
      disclosure?.click();
      const slider = document.querySelector('input[type="range"][aria-label="Music volume"]');
      const setVolume = (value) => {
        if (!slider) return;
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const findMute = (unmute) => [...document.querySelectorAll('button')].find((button) => {
        const name = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '';
        return unmute ? /^unmute\\b/i.test(name) : /^mute\\b/i.test(name);
      });
      const savedBefore = localStorage.getItem('shining-stars.save');
      setVolume(42);
      findMute(false)?.click();
      const muted = JSON.parse(localStorage.getItem('shining-stars.audio-preferences') ?? 'null');
      findMute(true)?.click();
      const unmuted = JSON.parse(localStorage.getItem('shining-stars.audio-preferences') ?? 'null');
      setVolume(0);
      const sliderMuted = JSON.parse(localStorage.getItem('shining-stars.audio-preferences') ?? 'null');
      setVolume(42);
      const sliderRestored = JSON.parse(localStorage.getItem('shining-stars.audio-preferences') ?? 'null');
      return {
        muted,
        unmuted,
        sliderMuted,
        sliderRestored,
        percentageOutput: [...(utility?.querySelectorAll('output') ?? [])]
          .some((output) => output.textContent?.trim() === '42%'),
        progressSaveUnchanged: localStorage.getItem('shining-stars.save') === savedBefore,
      };
    })()`);
    expect(volumePersistence).toMatchObject({
      muted: {
        version: 1,
        preferences: { volume: 0, muted: true, lastAudibleVolume: 0.42 },
      },
      unmuted: {
        version: 1,
        preferences: { volume: 0.42, muted: false, lastAudibleVolume: 0.42 },
      },
      sliderMuted: {
        version: 1,
        preferences: { volume: 0, muted: true, lastAudibleVolume: 0.42 },
      },
      sliderRestored: {
        version: 1,
        preferences: { volume: 0.42, muted: false, lastAudibleVolume: 0.42 },
      },
      percentageOutput: true,
      progressSaveUnchanged: true,
    });
    await evaluate('window.__oldMusicPreferencesDocument = true');
    await command('Page.reload', { ignoreCache: true });
    await waitFor(
      async () =>
        (await evaluate('window.__oldMusicPreferencesDocument === undefined')) ||
        false,
      'new document after music preference reload',
    );
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('.observatory-app')?.isConnected === true && document.querySelector('[data-renderer-notice]')?.hidden === true",
        ),
      'mounted Observatory and rendered scene after music preference reload',
    );
    await evaluate(`(() => {
      const utility = document.querySelector('.observatory-save-utility');
      [...(utility?.querySelectorAll('button[aria-expanded], summary') ?? [])]
        .find((element) => /^music$/i.test(element.textContent?.trim() ?? ''))?.click();
    })()`);
    await waitFor(
      async () =>
        (await evaluate(
          "document.querySelector('input[type=range][aria-label=\\\"Music volume\\\"]')?.value === '42'",
        )) || false,
      'reloaded music volume control state',
    );
    const reloadedVolume = await evaluate(
      "document.querySelector('input[type=range][aria-label=\\\"Music volume\\\"]')?.value ?? null",
    );
    expect(reloadedVolume).toBe('42');
    const fallbackReport = await evaluate(
      `(async()=>{const {createObservatoryUI}=await import('/src/ui/observatory-ui.ts');const {createSaveStore}=await import('/src/app/save-data.ts');const favorites=createSaveStore(null).favorites;const host=document.createElement('div');host.id='unillustrated-collection-test';host.style.cssText='position:fixed;left:-10000px;top:0;width:700px;height:700px';document.body.append(host);const catalog={songs:[],collections:[{id:'new-curation',title:'New Curation',sortOrder:10,songIds:[]}],chartIssues:new Map()};const ui=createObservatoryUI(host,catalog,{onPlay:()=>{}},favorites);const anchor=host.querySelector('[data-action=select-collection]');const accessibleLabel=anchor.getAttribute('aria-label');const anchorHasArtwork=!!anchor.querySelector('img[data-collection-artwork]');const anchorFallback=!!anchor.querySelector('.song-glyph');const detailFallback=!!host.querySelector('.detail-emblem > svg');anchor.click();const selected=host.querySelector('.detail-emblem').dataset.collectionId;host.querySelector('[data-action=browse-collection]').click();const empty=host.querySelector('.song-list-empty')?.textContent;ui.destroy();host.remove();return {accessibleLabel,anchorHasArtwork,anchorFallback,detailFallback,selected,empty}})()`,
    );
    expect(fallbackReport).toMatchObject({
      accessibleLabel: 'Select New Curation constellation',
      anchorHasArtwork: false,
      anchorFallback: true,
      detailFallback: true,
      selected: 'new-curation',
    });
    expect(fallbackReport.empty).toContain(
      'No songs are available in this collection yet',
    );

    await evaluate(
      "document.querySelector('button[data-action=select-collection]')?.focus()",
    );
    await waitFor(
      async () =>
        (await evaluate(
          "document.activeElement?.dataset.collectionId === 'lyra-of-brightvale'",
        )) || false,
      'keyboard focus on the first constellation',
    );
    expect(await evaluate('document.activeElement?.dataset.collectionId')).toBe(
      'lyra-of-brightvale',
    );
    expect(
      await evaluate(
        "[...document.querySelectorAll('[data-action=select-collection]')].map(e=>e.dataset.collectionId)",
      ),
    ).toEqual(['lyra-of-brightvale', 'christmas-star', 'outside-worlds']);
    const authoredSongIds = Object.values(proposedCollections).flat();
    expect(authoredSongIds).toHaveLength(29);
    expect(new Set(authoredSongIds).size).toBe(29);
    expect(
      await evaluate(
        "[...document.querySelectorAll('.song-row-main')].map(e=>e.dataset.songId).sort()",
      ),
    ).toEqual([...authoredSongIds].sort());
    for (const [title, songIds] of Object.entries(proposedCollections)) {
      const collectionId = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      await click(
        `button[data-action="select-collection"][data-collection-id="${collectionId}"]`,
      );
      await waitFor(
        async () =>
          (await evaluate(
            `document.querySelector('[data-collection-title]')?.textContent === ${JSON.stringify(title)}`,
          )) || false,
        `selected collection title ${title}`,
      );
      expect(
        await evaluate('document.activeElement?.dataset.collectionId'),
      ).toBe(collectionId);
      expect(
        await evaluate(
          "document.querySelector('[data-collection-title]')?.textContent",
        ),
      ).toBe(title);
      const selectedArtwork = await evaluate(
        `(()=>{const button=document.querySelector('[data-collection-id="${collectionId}"]');const buttonImage=button.querySelector('img[data-collection-artwork]');const buttonBox=button.getBoundingClientRect(),buttonArt=buttonImage.getBoundingClientRect();const detail=document.querySelector('.detail-emblem');const detailImage=detail.querySelector('img[data-collection-artwork]');const detailBox=detail.getBoundingClientRect(),detailArt=detailImage.getBoundingClientRect();return {button:buttonImage?.dataset.artworkUrl,buttonLoaded:buttonImage?.complete&&buttonImage.naturalWidth===1024,buttonFit:getComputedStyle(buttonImage).objectFit,buttonBounds:buttonArt.left>=buttonBox.left&&buttonArt.right<=buttonBox.right&&buttonArt.top>=buttonBox.top&&buttonArt.bottom<=buttonBox.bottom,detailId:detail.dataset.collectionId,detail:detailImage?.dataset.artworkUrl,detailLoaded:detailImage?.complete&&detailImage.naturalWidth===1024,detailFit:getComputedStyle(detailImage).objectFit,detailBounds:detailArt.left>=detailBox.left&&detailArt.right<=detailBox.right&&detailArt.top>=detailBox.top&&detailArt.bottom<=detailBox.bottom,fallbackIcon:getComputedStyle(button.querySelector('.song-glyph')).display}})()`,
      );
      expect(selectedArtwork.button).toContain(`${collectionId}.webp`);
      expect(selectedArtwork.buttonLoaded).toBe(true);
      expect(selectedArtwork.buttonFit).toBe('contain');
      expect(selectedArtwork.buttonBounds).toBe(true);
      expect(selectedArtwork.detailId).toBe(collectionId);
      expect(selectedArtwork.detail).toContain(`${collectionId}.webp`);
      expect(selectedArtwork.detailLoaded).toBe(true);
      expect(selectedArtwork.detailFit).toBe('contain');
      expect(selectedArtwork.detailBounds).toBe(true);
      expect(selectedArtwork.fallbackIcon).toBe('none');
      await click('[data-action="browse-collection"]');
      await waitFor(
        async () =>
          (await evaluate(
            "document.querySelector('[data-observatory-page=browser]')?.hidden === false",
          )) || false,
        `browser view for ${title}`,
      );
      expect(
        await evaluate(
          "[...document.querySelectorAll('.song-row-main')].map(e=>e.dataset.songId)",
        ),
      ).toEqual(songIds);
      await click('[data-action="back-overview"]');
      await waitFor(
        async () =>
          (await evaluate(
            "document.querySelector('[data-observatory-page=overview]')?.hidden === false",
          )) || false,
        `overview after browsing ${title}`,
      );
    }
    // Unlike projected anchors, a scroll grid need not show every collection at
    // once. Verify the real medallions remain accessible over the live canvas
    // after scrolling and renderer frames; growth/Tab/touch behavior has its own
    // controlled-catalog browser regression.
    const checkCollectionAccess = async (label: string) => {
      const report = await evaluate(`(async () => {
        const grid = document.querySelector('[data-collection-grid]');
        const buttons = [...document.querySelectorAll('[data-action=select-collection]')];
        const pressed = () => buttons.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.collectionId);
        const focusedElement = document.activeElement;
        const before = { selected: pressed(), focused: document.activeElement?.dataset.collectionId };
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const detail = document.querySelector('.collection-detail');
        const collections = [];
        for (const button of buttons) {
          button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = button.getBoundingClientRect();
          let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
          for (let parent = button.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
            if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
              left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
            }
            if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
              top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
            }
          }
          const boxes = [rect, ...[...button.querySelectorAll('.constellation-label, img[data-collection-artwork]')].map(node => node.getBoundingClientRect())];
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          collections.push({
            id: button.dataset.collectionId,
            nativeNamedButton: button instanceof HTMLButtonElement && !button.disabled && !!button.getAttribute('aria-label'),
            inGrid: grid?.contains(button) === true,
            visible: !button.hidden && rect.width >= 44 && rect.height >= 44 && boxes.every(box => box.left >= left - 1 && box.right <= right + 1 && box.top >= top - 1 && box.bottom <= bottom + 1),
            hit: button.contains(hit),
            clear: !overlap(rect, detail.getBoundingClientRect()) && buttons.every(other => other === button || !overlap(rect, other.getBoundingClientRect())),
          });
        }
        return { collections, before, after: { selected: pressed(), focused: document.activeElement?.dataset.collectionId }, focusPreserved: document.activeElement === focusedElement };
      })()`);
      expect(
        report.collections.length,
        `${label}: real collections mounted`,
      ).toBeGreaterThan(0);
      for (const collection of report.collections) {
        expect(
          collection,
          `${label}: ${collection.id} remains accessible after scrolling and city frames`,
        ).toMatchObject({
          nativeNamedButton: true,
          inGrid: true,
          visible: true,
          hit: true,
          clear: true,
        });
      }
      expect(
        report.after,
        `${label}: scrolling preserves selection and focus`,
      ).toEqual(report.before);
      expect(
        report.focusPreserved,
        `${label}: the focused control is retained`,
      ).toBe(true);
    };
    await checkCollectionAccess('desktop');
    await screenshot('shining-stars-collections-overview-desktop');
    await evaluate(
      "document.querySelector('[data-collection-id=outside-worlds]')?.focus()",
    );
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    expect(await evaluate('document.activeElement?.dataset.collectionId')).toBe(
      'outside-worlds',
    );
    await command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      async () =>
        (await evaluate('innerWidth === 900 && innerHeight === 760')) || false,
      'narrow desktop viewport',
    );
    expect(await evaluate('document.activeElement?.dataset.collectionId')).toBe(
      'outside-worlds',
    );
    await checkCollectionAccess('narrow desktop');
    await screenshot('shining-stars-collections-overview-narrow');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitFor(
      async () =>
        (await evaluate('innerWidth === 390 && innerHeight === 844')) || false,
      'portrait mobile viewport',
    );
    await checkCollectionAccess('portrait mobile');
    await screenshot('shining-stars-collections-overview-portrait');
    await evaluate(
      "document.querySelector('[data-action=all-songs]')?.click()",
    );
    await click('[data-action="toggle-filters"]');
    expect(
      await evaluate("document.querySelector('[data-filter-panel]')?.hidden"),
    ).toBe(false);
    expect(
      await evaluate(
        "document.querySelector('[data-filter-availability]') === null",
      ),
    ).toBe(true);
    await click('[data-action="clear-filters"]');
    expect(
      await evaluate(
        "document.querySelector('[data-result-count]')?.textContent",
      ),
    ).toBe('29 songs');

    await click('[data-action="all-songs"]');
    await click('[data-action="toggle-filters"]');
    expect(
      await evaluate("document.querySelectorAll('.song-row').length"),
    ).toBe(29);
    const headerCheck = async (
      width: number,
      height: number,
      label: string,
    ) => {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await waitFor(
        async () =>
          (await evaluate(
            `innerWidth === ${width} && innerHeight === ${height}`,
          )) || false,
        `${label} viewport dimensions`,
      );
      const overlaps = await evaluate(
        `(()=>{const rect=(s)=>document.querySelector(s).getBoundingClientRect();const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;const kicker=rect('.browser-title-block .observatory-kicker'),title=rect('[data-browser-title]'),count=rect('[data-browser-count]'),label=rect('.song-list-heading span:first-child'),total=rect('[data-result-count]'),heading=rect('.browser-heading'),listHeading=rect('.song-list-heading');return {title:overlap(kicker,title)||overlap(title,count)||overlap(kicker,count),list:overlap(label,total),section:overlap(heading,listHeading),boxes:[kicker.toJSON(),title.toJSON(),count.toJSON(),label.toJSON(),total.toJSON(),heading.toJSON(),listHeading.toJSON()]}})()`,
      );
      expect(overlaps.title, `${label}: browser title header overlap`).toBe(
        false,
      );
      expect(overlaps.list, `${label}: song-list header overlap`).toBe(false);
      expect(
        overlaps.section,
        `${label}: browser heading overlaps song list`,
      ).toBe(false);
      await screenshot(`shining-stars-collections-${label}`);
    };
    await headerCheck(1440, 900, 'desktop');
    await headerCheck(900, 760, 'narrow');
    await headerCheck(390, 844, 'portrait');
    expect(
      await evaluate(
        "document.querySelector('[data-result-count]')?.textContent",
      ),
    ).toBe('29 songs');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click(
      'button[data-action="select-song"][data-song-id="never-again"]',
    );
    expect(
      await evaluate(
        "document.querySelector('[data-song-detail]').innerText.includes('Never Again')",
      ),
    ).toBe(true);
    const difficulty = await evaluate(
      "document.querySelector('[data-run-difficulty]').value",
    );
    expect(difficulty).toBe('normal');
    await evaluate(
      "(()=>{const select=document.querySelector('[data-run-difficulty]');select.value='hard';select.dispatchEvent(new Event('change',{bubbles:true}))})()",
    );
    expect(
      await evaluate("document.querySelector('[data-run-difficulty]').value"),
    ).toBe('hard');

    await evaluate('window.__holdAudio=true');
    await click('button[data-action="play"]');
    await waitFor(
      async () => (await evaluate('window.__audioContextCount')) === 1,
      'Play-gesture AudioContext',
    );
    await waitFor(
      async () => (await evaluate('window.__audioRequests.length')) === 1,
      'selected audio request',
    );
    expect(await evaluate('window.__audioRequests[0]')).toContain(
      'Never%20Again',
    );
    expect(
      await evaluate(
        "document.querySelector('[data-action=return]')?.isConnected",
      ),
    ).toBe(true);
    await click('[data-panel="ready"] [data-action="return"]');
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay]')===null",
        ),
      'gameplay disposal and return',
    );
    expect(
      await evaluate(
        "document.querySelector('[data-observatory-page=browser]')?.hidden",
      ),
    ).toBe(false);
    expect(
      await evaluate(
        "document.querySelector('[data-song-detail]').innerText.includes('Never Again')",
      ),
    ).toBe(true);
    expect(await evaluate('window.__audioContextCount')).toBe(1);

    await evaluate('window.__holdAudio=false');
    await click('button[data-action="play"]');
    await waitFor(
      async () => (await evaluate('window.__audioContextCount')) === 2,
      'fresh context for the selected run',
    );
    await waitFor(
      async () => (await evaluate('window.__audioRequests.length')) === 2,
      'selected track fetch',
    );
    expect(await evaluate('window.__audioRequests[1]')).toContain(
      'Never%20Again',
    );
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay]')?.hidden === false && document.querySelector('[data-panel=ready]')?.hidden === true && document.querySelector('[data-panel=error]')?.hidden === true",
        ),
      'audio-ready gameplay start',
    );
    expect(
      await evaluate(
        "document.querySelector('[data-song-label]')?.textContent",
      ),
    ).toContain('Never Again');
    expect(
      await evaluate(
        "document.querySelector('[data-timing-legend]')?.textContent",
      ),
    ).toBe('');
    await waitFor(
      async () =>
        await evaluate(
          'window.__frameClearSamples.length >= 8 && window.__frameClearSamples.slice(-8).every(count => count === 2)',
        ),
      'one gameplay paint per steady animation frame',
    );
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code: 'Escape',
      key: 'Escape',
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code: 'Escape',
      key: 'Escape',
    });
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-panel=pause]')?.hidden === false",
        ),
      'gameplay pause',
    );
    const pauseVolumeReport = await evaluate(`(() => {
      const panel = document.querySelector('[data-panel="pause"]');
      const slider = panel?.querySelector('input[type="range"][aria-label="Music volume"]');
      const muteButton = [...(panel?.querySelectorAll('button') ?? [])]
        .find((button) => /mute/i.test(button.getAttribute('aria-label') ?? button.textContent ?? ''));
      const initialValue = slider?.value ?? null;
      const before = {
        contexts: window.__audioContextCount,
        resumes: window.__audioResumeCalls,
        sourceStarts: window.__sourceStartCalls,
      };
      if (slider) {
        slider.value = '64';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const stored = JSON.parse(localStorage.getItem('shining-stars.audio-preferences') ?? 'null');
      return {
        initialValue,
        currentValue: slider?.value ?? null,
        muteButton: muteButton !== undefined,
        latestEffectiveGain: window.__musicGainTargets.at(-1) ?? null,
        unchangedContext: window.__audioContextCount === before.contexts,
        unchangedResumeCount: window.__audioResumeCalls === before.resumes,
        unchangedSourceStarts: window.__sourceStartCalls === before.sourceStarts,
        stored,
      };
    })()`);
    expect(pauseVolumeReport).toMatchObject({
      initialValue: '42',
      currentValue: '64',
      muteButton: true,
      latestEffectiveGain: 0,
      unchangedContext: true,
      unchangedResumeCount: true,
      unchangedSourceStarts: true,
      stored: {
        version: 1,
        preferences: { volume: 0.64, muted: false, lastAudibleVolume: 0.64 },
      },
    });
    const pausedTime = await evaluate(
      "document.querySelector('[data-time]')?.textContent",
    );
    const contextLost = await evaluate(
      "(()=>{const canvas=document.querySelector('.scene-canvas');const gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');const extension=gl?.getExtension('WEBGL_lose_context');if(!extension)return false;extension.loseContext();return true})()",
    );
    expect(contextLost).toBe(true);
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay] [data-renderer-status]')?.hidden === false && document.querySelector('[data-experience-screen=gameplay] [data-action=renderer-retry]')?.disabled === false",
        ),
      'visible gameplay renderer retry',
    );
    await click(
      '[data-experience-screen="gameplay"] [data-action="renderer-retry"]',
    );
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay] [data-renderer-status]')?.hidden === true && document.querySelector('[data-recovery-notice]')?.hidden === false",
        ),
      'renderer recreated with an explicit resume requirement',
    );
    expect(
      await evaluate(
        "document.querySelector('[data-panel=pause]')?.hidden === false && document.querySelector('[data-action=resume]')?.disabled === false",
      ),
    ).toBe(true);
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    expect(
      await evaluate("document.querySelector('[data-time]')?.textContent"),
    ).toBe(pausedTime);
    expect(await evaluate('window.__audioContextCount')).toBe(2);
    expect(await evaluate('window.__audioRequests.length')).toBe(2);
    await click('[data-panel="pause"] [data-action="resume"]');
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-panel=pause]')?.hidden === true",
        ),
      'explicit resume after renderer recreation',
    );
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code: 'Escape',
      key: 'Escape',
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code: 'Escape',
      key: 'Escape',
    });
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-panel=pause]')?.hidden === false",
        ),
      'pause after explicit renderer recovery resume',
    );
    await click('[data-panel="pause"] [data-action="return"]');
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay]')===null",
        ),
      'return after gameplay',
    );
    expect(
      await evaluate(
        "document.querySelectorAll('[data-renderer-status]').length",
      ),
    ).toBe(0);
    expect(
      await evaluate(
        "document.querySelector('[data-song-detail]').innerText.includes('Never Again')",
      ),
    ).toBe(true);
    await click('button[data-action="play"]');
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay]')?.hidden === false && document.querySelectorAll('[data-experience-screen=gameplay] [data-renderer-status]').length === 1",
        ),
      'clean gameplay screen on re-entry',
    );
    await click('[data-panel="ready"] [data-action="return"]');
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('[data-experience-screen=gameplay]')===null",
        ),
      'second return cleanup',
    );
    expect(
      await evaluate(
        "document.querySelectorAll('[data-renderer-status]').length",
      ),
    ).toBe(0);
  }, 300_000);

  it('applies a nonzero environment multiplier to the chosen user volume without native playback', async () => {
    const chromium = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
    await access(chromium);
    profile = await mkdtemp(path.join(scratchParent, 'music-volume-main-'));
    const vitePort = await freePort();
    const debugPort = await freePort();
    devServer = await createServer({
      configFile: false,
      root: process.cwd(),
      define: { 'import.meta.env.VITE_SONG_VOLUME': JSON.stringify('0.5') },
      server: { host: '127.0.0.1', port: vitePort, strictPort: true },
    });
    await devServer.listen();
    browser = spawn(
      chromium,
      [
        '--headless=new',
        '--mute-audio',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      return response.ok
        ? ((await response.json()) as {
            type: string;
            webSocketDebuggerUrl: string;
          }[])
        : false;
    }, 'Chromium DevTools for nonzero music volume');
    const page = targets.find((target) => target.type === 'page');
    if (page === undefined) throw new Error('Chromium did not expose a page.');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener(
        'error',
        () => reject(new Error('CDP connection failed.')),
        { once: true },
      );
    });
    let nextId = 0;
    const pending = new Map<
      number,
      { resolve(value: Record<string, any>): void; reject(error: Error): void }
    >();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Record<string, any>;
        error?: { message: string };
      };
      if (message.id === undefined) return;
      const request = pending.get(message.id);
      if (request === undefined) return;
      pending.delete(message.id);
      if (message.error !== undefined)
        request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
    });
    const command = (method: string, params: Record<string, unknown> = {}) => {
      const id = ++nextId;
      socket!.send(JSON.stringify({ id, method, params }));
      return new Promise<Record<string, any>>((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
    };
    const evaluate = async (expression: string): Promise<any> => {
      const result = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails !== undefined)
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'Page evaluation failed.',
        );
      return result.result?.value;
    };
    const click = async (selector: string): Promise<void> => {
      const rect = await waitFor(
        async () =>
          (await evaluate(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.getClientRects().length===0)return false;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
          )) || false,
        `visible control ${selector}`,
      );
      await command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rect.x,
        y: rect.y,
      });
      await command('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
      await command('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
    };

    await command('Page.enable');
    await command('Runtime.enable');
    await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__musicGainNodes = [];
        class FakeSource extends EventTarget {
          buffer = null;
          connect() {}
          start() {}
          stop() { this.dispatchEvent(new Event('ended')); }
          disconnect() {}
        }
        class FakeAudioContext extends EventTarget {
          currentTime = 0;
          state = 'suspended';
          destination = {};
          createGain() {
            const node = {
              gain: {
                value: 1,
                cancelScheduledValues() {},
                setTargetAtTime(value) { this.value = value; },
              },
              connect() {},
            };
            window.__musicGainNodes.push(node);
            return node;
          }
          createBufferSource() { return new FakeSource(); }
          async decodeAudioData() { return { duration: 300, sampleRate: 48000 }; }
          async resume() {
            this.state = 'running';
            this.dispatchEvent(new Event('statechange'));
          }
          async close() {
            this.state = 'closed';
            this.dispatchEvent(new Event('statechange'));
          }
        }
        window.AudioContext = FakeAudioContext;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => /\\.mp3(?:$|\\?)/i.test(String(input))
          ? Promise.resolve(new Response(new ArrayBuffer(8)))
          : nativeFetch(input, init);
      })()`,
    });
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` });
    await waitFor(
      async () =>
        await evaluate(
          "document.querySelector('.observatory-app')?.isConnected === true && document.querySelector('[data-renderer-notice]')?.hidden === true",
        ),
      'rendered Observatory with mocked audio context',
    );

    await click('[data-action="all-songs"]');
    await click(
      'button[data-action="select-song"][data-song-id="never-again"]',
    );
    await click('[data-music-toggle]');
    await evaluate(`(() => {
      const slider = document.querySelector('input[type="range"][aria-label="Music volume"]');
      slider.value = '40';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    expect(
      await evaluate(
        "document.querySelector('input[type=range][aria-label=\\\"Music volume\\\"]')?.value",
      ),
    ).toBe('40');
    await click('button[data-action="play"]');
    await waitFor(
      async () =>
        (await evaluate('window.__musicGainNodes.length === 1')) || false,
      'music output gain node creation',
    );
    expect(
      await evaluate('window.__musicGainNodes[0].gain.value'),
    ).toBeCloseTo(0.2);
  }, 120_000);
});
