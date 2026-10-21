import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createCdpCommandChannel } from './cdp-command.mjs';
import { stopOwnedChildren } from './child-process-cleanup.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureRoute = '/__observatory-collection-grid-test';

function browserEndpoint(browser) {
  return new Promise((resolve, reject) => {
    let output = '';
    const finish = (error, endpoint) => {
      clearTimeout(timer);
      browser.removeListener('error', onError);
      browser.removeListener('exit', onExit);
      browser.stderr.removeListener('data', onData);
      if (error) reject(error);
      else resolve(endpoint);
    };
    const onError = (error) => finish(error);
    const onExit = () => finish(new Error(`Chromium exited during startup: ${output}`));
    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    };
    const timer = setTimeout(() => finish(new Error('Chromium startup timed out')), 15_000);
    browser.once('error', onError);
    browser.once('exit', onExit);
    browser.stderr.on('data', onData);
  });
}

// This exercises the real mounted UI and styles, not the production catalog or
// renderer. No application bootstrap, audio, city assets, or test-only CSS runs.
const mountFixture = (count, rendererStatus) => `(async () => {
  window.__collectionGridTest?.dispose();
  const { createObservatoryUI } = await import('/src/ui/observatory-ui.ts');
  const { createFavoriteStore } = await import('/src/catalog/favorites.ts');
  const host = document.querySelector('#app');
  const ids = Array.from({ length: ${count} }, (_, index) => 'fixture-' + index);
  const collections = ids.map((id, index) => ({
    id, title: 'Fixture constellation ' + (index + 1), sortOrder: index,
    songIds: ['song-' + id],
  }));
  const catalog = {
    collections,
    songs: collections.map((collection, index) => ({
      id: collection.songIds[0], title: 'Fixture song ' + (index + 1),
      sortOrder: index, audioUrl: '/unused-fixture.mp3', source: 'fixture',
      segmentKind: 'full', availability: 'available', chartStatus: 'candidate',
      collections: [collection.id],
      charts: { normal: { sourceStart: 0, duration: 12, twilightAt: 6,
        allowedDifficulties: ['normal'], notes: [] } },
      scoring: { version: 1, normalMaximum: 0, fiveGoldTarget: 0,
        chartFingerprint: 'a'.repeat(64) },
    })),
    chartIssues: new Map(),
  };
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) };
  const ui = createObservatoryUI(host, catalog, { onPlay: () => {
    throw new Error('This collection-navigation test must never start playback');
  } }, createFavoriteStore(storage), { browsePreferenceStorage: storage });
  ui.setRendererStatus(${JSON.stringify(rendererStatus)});
  const buttons = () => [...host.querySelectorAll('[data-action="select-collection"]')];
  const scrollParent = (button) => {
    for (let parent = button?.parentElement; parent; parent = parent.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) &&
          parent.clientHeight > 0 && parent.scrollHeight > parent.clientHeight + 1)
        return parent;
    }
    return null;
  };
  // Include labels and every clipping ancestor, not just the button's center.
  const visible = (element) => {
    if (!element || !element.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    const boxes = [rect, ...[...element.querySelectorAll('span')]
      .map(child => child.getBoundingClientRect())];
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && element.contains(hit) &&
      boxes.every(box => box.left >= left - 1 && box.right <= right + 1 &&
        box.top >= top - 1 && box.bottom <= bottom + 1);
  };
  window.__collectionGridTest = {
    host, ui, ids, buttons, scrollParent, visible,
    dispose() { ui.destroy(); },
    state() {
      const all = buttons(), active = document.activeElement;
      const scroller = scrollParent(all[all.length - 1]);
      return {
        ids: all.map(button => button.dataset.collectionId),
        hidden: all.filter(button => button.hidden).map(button => button.dataset.collectionId),
        collectionTargetsUsable: all.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        }),
        selected: all.filter(button => button.getAttribute('aria-pressed') === 'true')
          .map(button => button.dataset.collectionId),
        activeId: active?.dataset.collectionId ?? null,
        activeAction: active?.dataset.action ?? null,
        activeVisible: visible(active),
        focusVisible: !!active?.matches(':focus-visible') &&
          getComputedStyle(active).outlineStyle !== 'none' &&
          parseFloat(getComputedStyle(active).outlineWidth) > 0,
        lastVisible: visible(all[all.length - 1]),
        scrollTop: scroller?.scrollTop ?? null,
        scrollRange: scroller ? scroller.scrollHeight - scroller.clientHeight : 0,
        title: host.querySelector('[data-collection-title]').textContent,
        browserTitle: host.querySelector('[data-browser-title]').textContent,
        snapshot: ui.getSelectionSnapshot(),
      };
    },
  };
})()`;

test('growing collection grids support native scroll, keyboard reveal and Browse/Back restoration',
  { timeout: 120_000 }, async (t) => {
    let server, browser, socket, channel, port, debugOrigin;
    const profile = await mkdtemp(path.join('/tmp/opencode', 'observatory-grid-'));
    const previousVolume = process.env.VITE_SONG_VOLUME;
    process.env.VITE_SONG_VOLUME = '0';
    try {
      server = await createServer({
        root,
        server: { host: '127.0.0.1', port: 0, strictPort: true },
        plugins: [{
          name: 'observatory-grid-isolated-document',
          configureServer(vite) {
            vite.middlewares.use((request, response, next) => {
              if (request.url !== fixtureRoute) return next();
              response.setHeader('Content-Type', 'text/html');
              response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/ui/styles.css"></head><body><div id="app"></div></body></html>');
            });
          },
        }],
      });
      await server.listen();
      port = server.httpServer.address().port;
      assert.notEqual(port, 3100);
      browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', [
        '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      const endpoint = await browserEndpoint(browser);
      debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
      const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
      socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
      await once(socket, 'open');
      channel = createCdpCommandChannel(socket, { timeoutMs: 15_000 });
      socket.addEventListener('message', ({ data }) => channel.handleMessage(JSON.parse(String(data))));
      const command = (method, params = {}) => channel.command(method, params);
      const evaluate = async (expression) => {
        const result = await command('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitFor = async (expression, message) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await evaluate(expression)) return;
          await delay(50);
        }
        assert.fail(message);
      };
      const state = () => evaluate('window.__collectionGridTest.state()');
      const key = async (name, code, windowsVirtualKeyCode) => {
        const event = { key: name, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
        // Chromium needs Enter's character payload to emit the trusted keypress
        // that performs a native button click; keydown/up alone do not activate it.
        await command('Input.dispatchKeyEvent', {
          ...event, type: 'keyDown',
          ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
        });
        await command('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
      };
      await command('Page.navigate', { url: `http://127.0.0.1:${port}${fixtureRoute}` });
      await waitFor('document.readyState === "complete" && !!document.querySelector("#app")', 'isolated UI document loaded');
      await command('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });

      for (const scenario of [
        { count: 13, width: 1440, height: 900, mobile: false, status: 'rendered' },
        { count: 31, width: 390, height: 844, mobile: true, status: 'unavailable' },
      ]) {
        await t.test(`${scenario.count} collections at ${scenario.width}×${scenario.height} (${scenario.status})`, async () => {
          const { count, width, height, mobile, status } = scenario;
          await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          await command('Emulation.setTouchEmulationEnabled', { enabled: mobile });
          await evaluate(mountFixture(count, status));
          const ids = Array.from({ length: count }, (_, index) => `fixture-${index}`);
          const initial = await state();
          assert.deepEqual(initial.ids, ids, 'every collection remains mounted in catalog order');
          assert.deepEqual(initial.hidden, [], 'collections are not hidden by viewport culling');
          assert.equal(initial.collectionTargetsUsable, true, 'collection touch targets are not shrunk to fit');
          assert.ok(initial.scrollRange > 0,
            `${count} collections need a native vertical scroll container, not clipped or overlapping anchors`);
          assert.equal(initial.lastVisible, false, 'fixture genuinely exercises overflow rather than fit-to-screen shrinking');
          assert.deepEqual(initial.selected, [ids[0]]);

          const point = await evaluate(`(() => {
            const h = window.__collectionGridTest, rect = h.buttons()[0].getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          })()`);
          if (mobile) {
            // synthesizeScrollGesture emitted no touchmove in installed Chromium.
            // Send an actual trusted contact/move/release sequence instead.
            await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
            try {
              for (let step = 1; step <= 10; step++) {
                await command('Input.dispatchTouchEvent', {
                  type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 18 }],
                });
                await delay(20);
              }
              await delay(100); // End at rest so inertia cannot disturb later Tab checks.
            } finally {
              await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            }
            await waitFor('window.__collectionGridTest.state().scrollTop > 0', 'native touch gesture scrolls the collection grid');
          }
          await command('Input.dispatchMouseEvent', {
            type: 'mouseWheel', ...point, deltaX: 0, deltaY: 10_000,
          });
          await waitFor('window.__collectionGridTest.state().lastVisible', 'native scroll reveals the final collection and its label');
          assert.deepEqual((await state()).selected, [ids[0]], 'scrolling does not change selection');

          await evaluate(`(() => {
            const h = window.__collectionGridTest, first = h.buttons()[0];
            h.scrollParent(first).scrollTop = 0;
            first.focus({ preventScroll: true });
          })()`);
          for (let index = 1; index < count; index++) {
            await key('Tab', 'Tab', 9);
            const focused = await state();
            assert.equal(focused.activeId, ids[index], 'native Tab follows catalog order without skipping offscreen collections');
            assert.equal(focused.activeVisible, true, `Tab reveals ${ids[index]} and its label without clipping or obstruction`);
            assert.equal(focused.focusVisible, true, 'keyboard focus has a visible outline');
            assert.deepEqual(focused.selected, [ids[0]], 'focus movement does not activate collections');
          }
          assert.ok((await state()).scrollTop > 0, 'keyboard traversal itself scrolls to the final row');
          await key('Enter', 'Enter', 13);
          const selected = await state();
          assert.deepEqual(selected.selected, [ids.at(-1)]);
          assert.equal(selected.title, `Fixture constellation ${count}`);
          assert.equal(selected.snapshot.filters.collectionId, ids.at(-1));

          // Reach the real Browse control by keyboard, not an offscreen .click().
          for (let attempt = 0; attempt < 10 && (await state()).activeAction !== 'browse-collection'; attempt++)
            await key('Tab', 'Tab', 9);
          const beforeBrowse = await state();
          assert.equal(beforeBrowse.activeAction, 'browse-collection');
          assert.equal(beforeBrowse.activeVisible, true, 'Browse remains reachable after selecting the last collection');
          await key('Enter', 'Enter', 13);
          const browserState = await state();
          assert.equal(browserState.snapshot.screen, 'browser');
          assert.equal(browserState.browserTitle, `Fixture constellation ${count}`);
          assert.equal(browserState.snapshot.selection.selectedSongId, `song-${ids.at(-1)}`);
          assert.equal(browserState.activeAction, 'back-overview');
          assert.equal(browserState.activeVisible, true);
          await key('Enter', 'Enter', 13);
          const returned = await state();
          assert.equal(returned.snapshot.screen, 'overview');
          assert.deepEqual(returned.selected, [ids.at(-1)], 'Browse/Back preserves collection selection');
          assert.equal(returned.activeAction, 'browse-collection', 'Back restores focus to the invoking Browse control');
          assert.equal(returned.activeVisible, true, 'restored focus is not clipped or covered');
          assert.notEqual(returned.scrollTop, null, 'the overview still has a native collection scroller');
          assert.ok(Math.abs(returned.scrollTop - beforeBrowse.scrollTop) <= 2, 'Browse/Back preserves the collection scroll position');
        });
      }
    } finally {
      const errors = [];
      channel?.rejectPending('test cleanup');
      try { socket?.close(); } catch (error) { errors.push(error); }
      const failures = await stopOwnedChildren([['collection-grid Chromium', browser]]);
      errors.push(...failures.map(failure => failure.error));
      if (debugOrigin) {
        try { await assert.rejects(fetch(`${debugOrigin}/json/version`), 'owned Chromium listener stopped'); }
        catch (error) { errors.push(error); }
      }
      try { await server?.close(); } catch (error) { errors.push(error); }
      if (port) {
        try { await assert.rejects(fetch(`http://127.0.0.1:${port}`), 'owned Vite listener stopped'); }
        catch (error) { errors.push(error); }
      }
      try { await rm(profile, { recursive: true, force: true }); }
      catch (error) { errors.push(error); }
      if (previousVolume === undefined) delete process.env.VITE_SONG_VOLUME;
      else process.env.VITE_SONG_VOLUME = previousVolume;
      if (errors.length) throw new AggregateError(errors, 'Owned collection-grid test cleanup failed');
    }
  });
