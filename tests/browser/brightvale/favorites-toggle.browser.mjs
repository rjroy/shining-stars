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
        difficulty: find('[data-filter-difficulty]').value,
        collection: find('[data-browser-title]').textContent,
        pressed: find('[data-action="favorites"]').getAttribute('aria-pressed'),
        ids: [...document.querySelectorAll('[data-action="select-song"]')].map(row => row.dataset.songId),
        empty: find('[data-song-list]').textContent.includes('No songs match'),
      });
      click('browse-collection');
      click('toggle-favorite');
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
      const filters = ({ query, difficulty, collection }) => ({
        query,
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
      const progressionEvidence = await evaluate(`(async () => {
        const { createObservatoryUI, getSongUnlockRequest } = await import('/src/ui/observatory-ui.ts');
        const { SONG_CATALOG } = await import('/src/catalog/catalog.ts');
        const { createSaveStore } = await import('/src/app/save-data.ts');
        const { createProgressionMembership } = await import('/src/catalog/progression-catalog.ts');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#0e0d28';
        document.body.append(host);
        const store = createSaveStore(null);
        const blank = store.exportJson();
        const ui = createObservatoryUI(host, SONG_CATALOG, { onPlay: () => {} }, store.favorites, { saveStore: store });
        window.__progressionFilterFixture = { host, ui };
        const find = selector => host.querySelector(selector);
        const ids = () => [...host.querySelectorAll('.song-row')].map(row => row.dataset.songId);
        const set = (selector, value) => {
          const input = find(selector);
          if (input.type === 'checkbox') input.checked = value; else input.value = value;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        find('[data-action="all-songs"]').click();
        find('[data-action="toggle-filters"]').click();
        const defaults = ui.getSelectionSnapshot();
        const all = ids();
        const songId = all[0];
        set('[data-filter-unplayed]', true);
        store.songRatings.recordCompletedResult(songId, { score: 0, normalMaximum: 100, outcome: 'defeat', difficulty: 'normal' });
        ui.setPlayStatus('idle');
        const resultRefresh = !ids().includes(songId) && ui.getSelectionSnapshot().selection.selectedSongId !== songId;
        store.applyImport(store.previewImport(blank, 'replace', 'replace'), 'session');
        ui.refreshSavedData();
        const resetRefresh = ids().includes(songId);
        const imported = createSaveStore(null);
        imported.songRatings.recordCompletedResult(songId, { score: 100, normalMaximum: 100, outcome: 'victory', difficulty: 'hard' });
        imported.progression.recordVictory(songId, 'hard');
        store.applyImport(store.previewImport(imported.exportJson(), 'replace', 'replace'), 'session');
        ui.refreshSavedData();
        const importRefresh = !ids().includes(songId);
        find('[data-action="clear-filters"]').click();
        set('[data-filter-normal-stars]', true);
        const normalBest = !ids().includes(songId);
        set('[data-filter-normal-stars]', false);
        set('[data-filter-gold-stars]', true);
        const goldBest = !ids().includes(songId);
        set('[data-filter-gold-stars]', false);
        const beforeDifficulty = ui.getSelectionSnapshot().selection.runDifficulty;
        set('[data-filter-undefeated]', 'easy');
        const higherCredit = !ids().includes(songId);
        set('[data-filter-undefeated]', '');
        const noOpposite = ids().length === all.length;
        const independent = ui.getSelectionSnapshot().selection.runDifficulty === beforeDifficulty;
        const membership = createProgressionMembership(SONG_CATALOG);
        const locked = all.find(id => getSongUnlockRequest(id, store.progression.snapshot(), membership) !== null);
        set('[data-filter-unlocked]', true);
        const lockedExcluded = locked !== undefined && !ids().includes(locked);
        if (locked !== undefined) {
          const parent = membership.songs.get(locked);
          const needed = (membership.collections.get(parent) ?? 0) + (membership.songPrice ?? 1);
          for (let index = 0; index < Math.ceil(needed / 3); index++) store.progression.recordVictory('browser-credit-' + index, 'hard');
          store.progression.purchase({ kind: 'collection', collectionId: parent }, 'session');
          ui.refreshSavedData();
          const afterCollection = ids().includes(locked);
          store.progression.purchase({ kind: 'song', songId: locked }, 'session');
          ui.refreshSavedData();
          const unlockRefresh = !afterCollection && ids().includes(locked);
          find('[data-action="clear-filters"]').click();
          return { defaults: defaults.filters, resultRefresh, resetRefresh, importRefresh, normalBest, goldBest, higherCredit, noOpposite, independent, lockedExcluded, unlockRefresh };
        }
        throw new Error('The integration catalog needs an unlockable song');
      })()`);
      assert.equal(
        progressionEvidence.defaults.undefeatedDifficulty,
        undefined,
      );
      for (const [check, passed] of Object.entries(progressionEvidence)) {
        if (check !== 'defaults') assert.equal(passed, true, check);
      }
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
        await evaluate(
          `document.querySelector('[data-action="clear-filters"]').click()`,
        );
        await evaluate(
          `if (document.querySelector('[data-filter-panel]').hidden) document.querySelector('[data-action="toggle-filters"]').click()`,
        );
        await delay(250);
        const layout = await evaluate(`(() => {
          const panel = document.querySelector('[data-filter-panel]');
          const select = document.querySelector('[data-filter-difficulty]');
          const rect = select.getBoundingClientRect();
          return {
            noAvailability: !document.querySelector('[data-filter-availability]'),
            open: !panel.hidden,
            fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
            usable: rect.height >= 40 && !select.disabled,
            rows: document.querySelectorAll('.song-row').length,
          };
        })()`);
        assert.equal(layout.noAvailability, true);
        assert.equal(layout.open, true);
        assert.equal(
          layout.fits,
          true,
          `${width}px difficulty filter stays in view`,
        );
        assert.equal(layout.usable, true);
        assert.ok(layout.rows > 0);
        const progressionLayout = await evaluate(`(() => {
          const { host } = window.__progressionFilterFixture;
          const panel = host.querySelector('[data-filter-panel]');
          const controls = [...panel.querySelectorAll('input, select')];
          const rect = panel.getBoundingClientRect();
          const detail = host.querySelector('[data-song-detail]');
          return {
            checkboxes: panel.querySelectorAll('input[type="checkbox"]').length,
            defaults: [...panel.querySelector('[data-filter-undefeated]').options].map(option => option.textContent),
            fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
            controlsFit: controls.every(input => { const r = input.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom; }),
            detailScroll: detail.scrollHeight > detail.clientHeight + 1,
          };
        })()`);
        assert.equal(progressionLayout.checkboxes, 4);
        assert.deepEqual(progressionLayout.defaults, [
          'None',
          'Easy',
          'Normal',
          'Hard',
        ]);
        assert.equal(
          progressionLayout.fits,
          true,
          'progression panel fits viewport',
        );
        assert.equal(
          progressionLayout.controlsFit,
          true,
          'all separate controls visible',
        );
        assert.equal(
          progressionLayout.detailScroll,
          false,
          'details stay compact and non-scrolling',
        );
      }
      await evaluate(
        `window.__progressionFilterFixture.ui.destroy(); window.__progressionFilterFixture.host.remove(); delete window.__progressionFilterFixture;`,
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
