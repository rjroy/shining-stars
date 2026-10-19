import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createServer } from 'vite';
import { createCdpCommandChannel } from './brightvale/cdp-command.mjs';

// Explicit browser-only invocation; not collected by brightvale/*.test.mjs.
// node --test tests/browser/unlock-dialog.browser.mjs
test(
  'saved unlocks close directly; original consent, cancellation and storage safeguards remain',
  { timeout: 90_000 },
  async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'shining-stars-unlock-'));
    const previousVolume = process.env.VITE_SONG_VOLUME;
    process.env.VITE_SONG_VOLUME = '0';
    let server;
    let browser;
    let socket;
    let channel;
    let startupTimer;
    let port;
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
          '--enable-gpu',
          '--use-angle=gl',
          '--ignore-gpu-blocklist',
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          'about:blank',
        ],
        { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        startupTimer = setTimeout(
          () => reject(new Error('Chromium startup timed out')),
          15_000,
        );
        browser.once('error', reject);
        browser.stderr.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(startupTimer);
            resolve(match[1]);
          }
        });
      });
      assert.notEqual(Number(new URL(endpoint).port), 3100);
      const debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
      const pages = await (await fetch(`${debugOrigin}/json/list`)).json();
      socket = new WebSocket(
        pages.find((page) => page.type === 'page').webSocketDebuggerUrl,
      );
      await once(socket, 'open');
      channel = createCdpCommandChannel(socket, { timeoutMs: 15_000 });
      socket.addEventListener('message', ({ data }) =>
        channel.handleMessage(JSON.parse(String(data))),
      );
      const command = channel.command;
      const evaluate = async (expression) => {
        const response = await command('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.equal(
          response.exceptionDetails,
          undefined,
          JSON.stringify(response.exceptionDetails),
        );
        return response.result.value;
      };
      const waitFor = async (expression, label) => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          try {
            const result = await evaluate(expression);
            if (result) return result;
          } catch (error) {
            // Reload briefly invalidates the old page's execution context.
            if (
              !/navigated|Execution context was destroyed|Cannot find context/.test(
                error.message,
              )
            )
              throw error;
          }
          await delay(50);
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const click = async (selector, buttonText) => {
        const point = await evaluate(`(() => {
        const scope = document.querySelector(${JSON.stringify(selector)});
        const element = ${buttonText === undefined ? 'scope' : `[...scope.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(buttonText)})`};
        if (!element || element.disabled) return null;
        element.scrollIntoView({block:'center'});
        const box = element.getBoundingClientRect();
        return box.width && box.height ? {x:box.x+box.width/2,y:box.y+box.height/2} : null;
      })()`);
        assert.ok(
          point,
          'enabled visible control: ' + selector + ' ' + (buttonText ?? ''),
        );
        await command('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...point,
          button: 'left',
          clickCount: 1,
        });
        await command('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...point,
          button: 'left',
          clickCount: 1,
        });
      };
      const capture = async (name) => {
        if (!process.env.UNLOCK_SCREENSHOT_PREFIX) return;
        await evaluate('window.scrollTo(0, 0)');
        const screenshot = await command('Page.captureScreenshot', {
          format: 'png',
        });
        await writeFile(
          process.env.UNLOCK_SCREENSHOT_PREFIX + '-' + name + '.png',
          Buffer.from(screenshot.data, 'base64'),
          { flag: 'wx' },
        );
      };
      const savedProgression = () =>
        evaluate(
          `JSON.parse(localStorage.getItem('shining-stars.save')).progression`,
        );
      const visibleCredits = () =>
        evaluate(`document.querySelector('[data-credits]').textContent`);
      const modal = 'dialog.unlock-dialog[open]';
      const buy = () => click(modal, 'Unlock · 1 credit');
      const assertClosed = () =>
        waitFor(
          `!document.querySelector('dialog[open]')`,
          'no post-unlock confirmation',
        );
      await command('Page.enable');
      await command('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await command('Page.addScriptToEvaluateOnNewDocument', {
        source: `
      window.__failUnlockWrite = false;
      window.__unlockAudioContexts = 0;
      const save = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (window.__failUnlockWrite && key === 'shining-stars.save') throw new DOMException('Test-only storage write failure', 'QuotaExceededError');
        return save.call(this, key, value);
      };
      const Context = window.AudioContext;
      window.AudioContext = new Proxy(Context, { construct(target, args) { window.__unlockAudioContexts++; return Reflect.construct(target, args); } });
    `,
      });
      await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
      await waitFor(
        `!!document.querySelector('[data-action="browse-collection"]')`,
        'actual Observatory',
      );
      await click('[data-action="all-songs"]');
      await waitFor(
        `!!document.querySelector('[data-song-detail] [data-action="play"]:not(:disabled)')`,
        'initial city finished loading before fixture reload',
      );
      // Valid test credit fixture, created through the real persistence API. No gameplay award claim.
      await evaluate(`(async () => {
      const { createSaveStore } = await import('/src/app/save-data.ts');
      const store = createSaveStore(localStorage);
      store.progression.recordVictory('the-first-shining-star', 'hard');
      store.progression.recordVictory('never-again', 'hard');
      window.__unlockReload = true;
    })()`);
      await command('Page.reload');
      await waitFor(
        `!window.__unlockReload && !!document.querySelector('[data-action="browse-collection"]')`,
        'fresh app reads six saved test credits',
      );
      assert.equal((await savedProgression()).balance, 6);
      const songs = await evaluate(`(async () => {
      const { SONG_CATALOG: catalog } = await import('/src/catalog/catalog.ts');
      return catalog.collections.find(collection => collection.id === 'outside-worlds').songIds.filter(id => catalog.songs.find(song => song.id === id).availability === 'available').slice(0,3);
    })()`);
      assert.equal(songs.length, 3);
      await click('[data-action="all-songs"]');
      const selectSong = (id) =>
        click(`[data-action="select-song"][data-song-id="${id}"]`);
      await selectSong(songs[0]);
      await click('[data-song-detail] [data-action="unlock"]');
      assert.match(
        await evaluate(
          `document.querySelector(${JSON.stringify(modal)}).textContent`,
        ),
        /Unlock Outside Worlds\?/,
      );
      await click(modal, 'Cancel');
      assert.equal(
        (await savedProgression()).balance,
        6,
        'collection cancellation spends nothing',
      );
      await click('[data-song-detail] [data-action="unlock"]');
      await buy();
      await assertClosed();
      assert.equal(
        (await savedProgression()).balance,
        5,
        'collection cost debited once',
      );
      assert.equal(
        (await savedProgression()).collectionPurchases['outside-worlds'],
        1,
      );
      assert.match(await visibleCredits(), /^5 credits/);
      assert.match(
        await evaluate(
          `document.querySelector('[data-song-detail] [data-action="unlock"]').textContent`,
        ),
        /Unlock song/,
      );

      await click('[data-song-detail] [data-action="unlock"]');
      assert.match(
        await evaluate(
          `document.querySelector(${JSON.stringify(modal)}).textContent`,
        ),
        /Cost: 1 credit · Balance: 5 · After unlock: 4 credits/,
      );
      await click(modal, 'Cancel');
      assert.equal(
        (await savedProgression()).balance,
        5,
        'song cancellation spends nothing',
      );
      assert.equal(
        Object.hasOwn((await savedProgression()).songPurchases, songs[0]),
        false,
      );
      await click('[data-song-detail] [data-action="unlock"]');
      await capture('original-dialog');
      await evaluate(
        `window.__confirmedUnlockButton = [...document.querySelector(${JSON.stringify(modal)}).querySelectorAll('button')].find(button => button.textContent === 'Unlock · 1 credit')`,
      );
      await buy();
      await assertClosed();
      // A queued duplicate activation still hits the terminal controller guard.
      await evaluate(`window.__confirmedUnlockButton.click()`);
      assert.equal((await savedProgression()).balance, 4);
      assert.equal(
        (await savedProgression()).songPurchases[songs[0]],
        'outside-worlds',
      );
      assert.match(await visibleCredits(), /^4 credits/);
      await waitFor(
        `!!document.querySelector('[data-song-detail] [data-action="play"]:not(:disabled)')`,
        'visibly unlocked playable song',
      );
      assert.equal(
        await evaluate(
          `document.querySelector('.song-row[data-song-id="${songs[0]}"] small').textContent.startsWith('Locked')`,
        ),
        false,
      );
      assert.equal(
        await evaluate(`document.activeElement.dataset.action`),
        'play',
        'focus returns to the newly rendered Play control',
      );
      await capture('unlocked-song');

      await selectSong(songs[1]);
      const beforeFailure = await evaluate(
        `localStorage.getItem('shining-stars.save')`,
      );
      await evaluate(`window.__failUnlockWrite = true`);
      await click('[data-song-detail] [data-action="unlock"]');
      await buy();
      assert.match(
        await evaluate(
          `document.querySelector(${JSON.stringify(modal)}).textContent`,
        ),
        /No credits were spent; nothing was unlocked/,
      );
      assert.equal(
        await evaluate(`localStorage.getItem('shining-stars.save')`),
        beforeFailure,
      );
      assert.match(await visibleCredits(), /^4 credits/);
      await click(modal, 'Cancel');
      await assertClosed();
      assert.ok(
        await evaluate(
          `!!document.querySelector('[data-song-detail] [data-action="unlock"]')`,
        ),
      );
      await click('[data-song-detail] [data-action="unlock"]');
      await buy();
      await evaluate(`window.__failUnlockWrite = false`);
      await click(modal, 'Retry unlock');
      await assertClosed();
      assert.equal(
        (await savedProgression()).balance,
        3,
        'retry applies exactly one song purchase',
      );
      assert.equal(
        (await savedProgression()).songPurchases[songs[1]],
        'outside-worlds',
      );

      await selectSong(songs[2]);
      await evaluate(`window.__failUnlockWrite = true`);
      await click('[data-song-detail] [data-action="unlock"]');
      await buy();
      await click(modal, 'Use temporary unlock…');
      assert.match(
        await evaluate(
          `document.querySelector(${JSON.stringify(modal)}).textContent`,
        ),
        /not be saved on this device/,
      );
      assert.equal(
        (await savedProgression()).balance,
        3,
        'requesting temporary consent spends nothing',
      );
      await click(modal, 'Confirm temporary unlock · 1 credit');
      assert.match(
        await evaluate(
          `document.querySelector(${JSON.stringify(modal)}).textContent`,
        ),
        /Unlocked for this session only/,
      );
      assert.match(await visibleCredits(), /^2 credits · session only/);
      assert.equal(
        (await savedProgression()).balance,
        3,
        'temporary purchase never overwrites local save',
      );
      await capture('storage-warning');
      await click(modal, 'Done');
      await assertClosed();
      assert.ok(
        await evaluate(
          `!!document.querySelector('[data-song-detail] [data-action="play"]')`,
        ),
      );
      assert.equal(
        await evaluate(`window.__unlockAudioContexts`),
        0,
        'unlocking never starts playback',
      );
      console.log(
        'Real app: collection/song consent, direct saved-success close, visible lock/balance, cancel, duplicate guard, failure/retry and temporary warnings passed.',
      );
    } finally {
      clearTimeout(startupTimer);
      channel?.rejectPending('test cleanup');
      socket?.close();
      try {
        if (
          browser?.pid &&
          browser.exitCode === null &&
          browser.signalCode === null
        ) {
          const exited = once(browser, 'exit');
          process.kill(-browser.pid, 'SIGKILL');
          await exited;
        }
      } finally {
        try {
          await server?.close();
        } finally {
          await rm(profile, { recursive: true, force: true });
          if (previousVolume === undefined) delete process.env.VITE_SONG_VOLUME;
          else process.env.VITE_SONG_VOLUME = previousVolume;
        }
      }
      if (port)
        await assert.rejects(
          fetch(`http://127.0.0.1:${port}`),
          'owned server stopped',
        );
    }
  },
);
