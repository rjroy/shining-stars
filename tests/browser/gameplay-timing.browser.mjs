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
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div>
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
} catch (error) {
  document.body.dataset.timingCheck = 'failed: ' + error.stack;
}
</script></body></html>`;

test(
  'gameplay omits timing text in Audience, Twilight and Radiant; all result difficulties retain it',
  { timeout: 30_000 },
  async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'shining-stars-timing-'));
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
    } finally {
      clearTimeout(timer);
      if (browser && browser.exitCode === null && browser.signalCode === null) {
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
