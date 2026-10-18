import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createServer } from 'vite';

// Uses the real app and its DOM events, with an isolated browser profile.
test(
  'Favorites toggles independently of collection, search and refinement filters',
  { timeout: 90_000 },
  async () => {
    let server;
    let browser;
    let socket;
    let port;
    const profile = await mkdtemp(
      path.join(os.tmpdir(), 'brightvale-favorites-toggle-'),
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
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const result = await command('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.equal(
          result.exceptionDetails,
          undefined,
          JSON.stringify(result.exceptionDetails),
        );
        return result.result.value;
      };
      await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
      let ready = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        ready = await evaluate(
          `!!document.querySelector('[data-action="browse-collection"]')`,
        );
        if (ready) break;
        await delay(100);
      }
      assert.ok(ready, 'actual app loaded');
      const evidence = await evaluate(`(() => {
      const find = selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Missing control: ' + selector);
        return element;
      };
      const click = action => find('[data-action="' + action + '"]').click();
      const change = (selector, value, event = 'change') => {
        const input = find(selector);
        input.value = value;
        input.dispatchEvent(new Event(event, { bubbles: true }));
      };
      const snapshot = () => ({
        query: find('[data-search]').value,
        availability: find('[data-filter-availability]').value,
        difficulty: find('[data-filter-difficulty]').value,
        collection: find('[data-browser-title]').textContent,
        pressed: find('[data-action="favorites"]').getAttribute('aria-pressed'),
        ids: [...document.querySelectorAll('[data-action="select-song"]')].map(row => row.dataset.songId),
        empty: find('[data-song-list]').textContent.includes('No songs match'),
      });
      click('browse-collection');
      click('toggle-favorite');
      change('[data-filter-availability]', 'available');
      change('[data-filter-difficulty]', 'normal');
      change('[data-search]', 'a', 'input');
      const before = snapshot();
      click('favorites');
      const on = snapshot();
      click('favorites');
      const off = snapshot();
      change('[data-search]', 'no-song-matches-this-query', 'input');
      const emptyBefore = snapshot();
      click('favorites');
      const emptyOn = snapshot();
      click('favorites');
      const emptyOff = snapshot();
      return { before, on, off, emptyBefore, emptyOn, emptyOff };
    })()`);
      const filters = ({ query, availability, difficulty, collection }) => ({
        query,
        availability,
        difficulty,
        collection,
      });
      assert.ok(
        evidence.before.ids.length > 1,
        'combined filters have multiple matches',
      );
      assert.equal(evidence.on.pressed, 'true');
      assert.equal(
        evidence.on.ids.length,
        1,
        'only the favorited song remains',
      );
      assert.deepEqual(filters(evidence.on), filters(evidence.before));
      assert.deepEqual(
        evidence.off,
        evidence.before,
        'turning off restores only the favorites restriction',
      );
      for (const state of [evidence.emptyOn, evidence.emptyOff]) {
        assert.deepEqual(filters(state), filters(evidence.emptyBefore));
        assert.equal(state.empty, true);
        assert.deepEqual(state.ids, []);
      }
      assert.equal(evidence.emptyOn.pressed, 'true');
      assert.equal(evidence.emptyOff.pressed, 'false');
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
