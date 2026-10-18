import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

// Explicit browser-only invocation (not the no-browser brightvale/*.test.mjs suite):
// node --test tests/browser/gameplay-timing.browser.mjs
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div>
<script type="module">
import '/src/ui/styles.css';
import { createGameUI } from '/src/ui/ui.ts';
import { createGame } from '/src/game/game.ts';
import { getDifficultyProfile } from '/src/game/game-balance.ts';
const check = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const root = document.querySelector('#app');
  const chart = { sourceStart: 0, duration: 10, twilightAt: 5,
    allowedDifficulties: ['easy', 'normal', 'hard'], notes: [] };
  const song = { title: 'Timing regression fixture', segmentKind: 'full', chartStatus: 'candidate' };
  const noop = () => {};
  let checks = 0;
  for (const difficulty of chart.allowedDifficulties) {
    const ui = createGameUI(root, song, chart, {
      start: noop, resume: noop, restart: noop, returnToBrowser: noop,
    });
    ui.setRendererStatus('rendered');
    const game = createGame(chart, 0, difficulty);
    const base = game.advanceTo(1);
    const render = state => ui.render({
      audio: { status: 'playing', loaded: true, scheduledWhen: null },
      game: state, inputOffset: 0, visualOffset: 0,
      selectedDifficulty: difficulty, feedback: [], pendingPlaybackRequests: false,
    }, state.transportTime);
    render(base);
    const layoutBefore = JSON.stringify(ui.getGameplayLayout());
    const hudBefore = root.querySelector('.play-heading').getBoundingClientRect().toJSON();
    const overlay = root.querySelector('[data-countdown]');
    check(root.querySelectorAll('[data-countdown]').length === 1, 'single countdown presentation');
    check(overlay.getAttribute('role') === 'status' && overlay.getAttribute('aria-atomic') === 'true', 'accessible atomic countdown');
    const countIn = (now, status = 'starting', scheduledWhen = 105) => ui.render({
      audio: { status, loaded: true, scheduledWhen },
      game: base, inputOffset: 0, visualOffset: 0,
      selectedDifficulty: difficulty, feedback: [], pendingPlaybackRequests: false,
    }, now);
    for (const [now, expected] of [[100, 5], [101, 4], [102, 3], [103, 2], [104, 1], [104.999, 1]]) {
      countIn(now);
      check(!overlay.hidden, 'countdown visible at ' + now);
      check(overlay.textContent.replace(/\\s+/g, ' ').trim() === 'Starting in ' + expected + (expected === 1 ? ' second' : ' seconds'), 'scheduled countdown value at ' + now);
      const rect = overlay.getBoundingClientRect();
      const content = root.querySelector('.gameplay-screen-content').getBoundingClientRect();
      check(Math.abs(rect.x + rect.width / 2 - content.x - content.width / 2) < 1, 'horizontally centered');
      check(Math.abs(rect.y + rect.height / 2 - content.y - content.height / 2) < 1, 'vertically centered');
      check(rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight, 'overlay fits viewport');
      check(parseFloat(getComputedStyle(root.querySelector('[data-countdown-number]')).fontSize) >= 80, 'large readable numeral');
      check(getComputedStyle(overlay).animationName === 'none', 'no forced countdown motion');
      check(JSON.stringify(ui.getGameplayLayout()) === layoutBefore, 'no highway layout changes');
      check(JSON.stringify(root.querySelector('.play-heading').getBoundingClientRect().toJSON()) === JSON.stringify(hudBefore), 'no HUD movement');
      check(ui.getGameplayLayout().labels.countdown.width === 0, 'duplicate 3D countdown disabled');
    }
    for (const [now, status, scheduledWhen] of [[105, 'starting', 105], [100, 'playing', 105], [100, 'paused', 105], [100, 'loading', null], [100, 'error', 105], [100, 'starting', null]]) {
      countIn(now, status, scheduledWhen);
      check(overlay.hidden && root.querySelector('[data-countdown-number]').textContent === '', 'countdown cleared at ' + status + '/' + now);
    }
    countIn(200, 'starting', 205);
    check(!overlay.hidden && root.querySelector('[data-countdown-number]').textContent === '5', 'resume uses new schedule');
    ui.setTouchPresentation({ eligible: true, portrait: false, enabled: false, showGuard: true });
    countIn(201, 'starting', 205);
    check(overlay.hidden, 'orientation guard takes precedence');
    ui.setTouchPresentation({ eligible: false, portrait: true, enabled: false, showGuard: false });
    let spacerHeight;
    // Deterministic snapshots exercise the shipped UI renderer, not audio or game rules.
    for (const [phase, victory] of [['audience', false], ['twilight', false], ['twilight', true]]) {
      render({ ...base, phase, victory });
      const gameplay = root.querySelector('[data-experience-screen="gameplay"]');
      check(!/Perfect ±|Good ±/.test(gameplay.textContent), difficulty + ': timing text during ' + phase + '/' + victory);
      const spacer = gameplay.querySelector('.timing-window-legend');
      check(spacer.textContent === '', 'spacer must remain empty');
      const height = spacer.getBoundingClientRect().height;
      check(height > 0, 'spacer must retain layout space');
      check(spacerHeight === undefined || height === spacerHeight, 'spacer size changed across phases');
      spacerHeight = height;
      check(root.querySelector('.play-surface').classList.contains('is-victory') === victory, 'Radiant state exercised');
      checks++;
    }
    const result = game.advanceTo(chart.duration);
    check(result.status === 'results', 'real game result available');
    render(result);
    const panel = root.querySelector('[data-panel="results"]');
    check(!panel.hidden, 'results panel visible');
    const timing = getDifficultyProfile(difficulty).timing;
    check(panel.textContent.includes('Perfect ±' + Math.round(timing.perfectWindowSeconds * 1000) + ' ms'), difficulty + ': result Perfect window: ' + panel.textContent);
    check(panel.textContent.includes('Good ±' + Math.round(timing.goodWindowSeconds * 1000) + ' ms'), difficulty + ': result Good window');
    checks++;
    ui.destroy();
  }
  document.body.dataset.timingCheck = 'passed-' + checks;
  document.body.dataset.countdownCheck = 'passed';
  document.body.dataset.viewport = innerWidth + 'x' + innerHeight;
  document.body.dataset.reducedMotion = String(matchMedia('(prefers-reduced-motion: reduce)').matches);
} catch (error) {
  document.body.dataset.timingCheck = 'failed: ' + error.stack;
}
</script></body></html>`;

for (const [name, size, reducedMotion] of [
  ['desktop', '1280,900', false],
  ['portrait', '390,844', true],
])
  test(
    'gameplay timing and centered scheduled countdown: ' + name,
    { timeout: 30_000 },
    async () => {
      const profile = await mkdtemp(
        path.join(tmpdir(), 'shining-stars-timing-'),
      );
      let server;
      let browser;
      let port;
      let timer;
      const previousVolume = process.env.VITE_SONG_VOLUME;
      process.env.VITE_SONG_VOLUME = '0';
      try {
        server = await createServer({
          server: { host: '127.0.0.1', port: 0, strictPort: true },
          plugins: [
            {
              name: 'timing-regression-fixture',
              configureServer(vite) {
                vite.middlewares.use(
                  '/__timing-regression',
                  (_request, response) => {
                    response.setHeader('Content-Type', 'text/html');
                    response.end(fixture);
                  },
                );
              },
            },
          ],
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
            '--force-device-scale-factor=1',
            '--window-size=' + size,
            ...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
            '--dump-dom',
            '--virtual-time-budget=5000',
            `--user-data-dir=${profile}`,
            `http://127.0.0.1:${port}/__timing-regression`,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '';
        let errors = '';
        browser.stdout.on('data', (chunk) => {
          output += chunk;
        });
        browser.stderr.on('data', (chunk) => {
          errors += chunk;
        });
        timer = setTimeout(() => browser.kill('SIGKILL'), 20_000);
        const [code] = await once(browser, 'exit');
        assert.equal(code, 0, errors);
        assert.match(
          output.match(/data-timing-check="[^"]*"/)?.[0] ??
            'missing browser result',
          /data-timing-check="passed-12"/,
        );
      assert.match(output, /data-countdown-check="passed"/);
      if (reducedMotion) assert.match(output, /data-reduced-motion="true"/);
        const viewport = output.match(/data-viewport="(\d+)x(\d+)"/);
        assert.ok(viewport, 'observed viewport dimensions');
        if (name === 'portrait')
          assert.ok(
            Number(viewport[1]) < Number(viewport[2]),
            'portrait viewport',
          );
        console.log(name + ' viewport: ' + viewport[1] + 'x' + viewport[2]);
      } finally {
        clearTimeout(timer);
        if (
          browser &&
          browser.exitCode === null &&
          browser.signalCode === null
        ) {
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
        await rm(profile, { recursive: true, force: true });
        if (previousVolume === undefined) delete process.env.VITE_SONG_VOLUME;
        else process.env.VITE_SONG_VOLUME = previousVolume;
      }
    },
  );
