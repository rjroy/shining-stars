import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test(
  'actual crowd shader keeps unmatched atlas edges straight-alpha bright',
  { timeout: 45_000 },
  async () => {
    let server;
    let browser;
    let profile;
    let socket;
    let debugPort;
    let sequence = 0;
    const pending = new Map();

    const waitFor = async (read, label, timeout = 15_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const result = await read();
        if (result) return result;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }, 15_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await cdp('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };

    try {
      server = await createServer({
        root,
        configFile: false,
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      await server.listen();
      const url = server.resolvedUrls.local[0];
      assert.ok(url);
      profile = await mkdtemp('/tmp/opencode/crowd-alpha-webgl-');
      browser = spawn(
        process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--disable-extensions',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          'about:blank',
        ],
        { stdio: 'ignore' },
      );
      const endpoint = await waitFor(async () => {
        try {
          return await readFile(`${profile}/DevToolsActivePort`, 'utf8');
        } catch {
          return null;
        }
      }, 'Chromium DevTools endpoint');
      debugPort = Number(endpoint.split('\n')[0]);
      const pages = await (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      ).json();
      socket = new WebSocket(
        pages.find((page) => page.type === 'page').webSocketDebuggerUrl,
      );
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      socket.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        const entry = pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(message.id);
        if (message.error)
          entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      });
      await cdp('Runtime.enable');
      await cdp('Page.enable');
      await cdp('Page.navigate', {
        url: `${url}tests/browser/brightvale/silhouette-atlas-blend.fixture.html`,
      });
      const outcome = await waitFor(
        async () => {
          const result = await evaluate('window.__crowdBlendResult ?? null');
          return result;
        },
        'actual WebGL blend output',
        25_000,
      );
      assert.equal(outcome.error, undefined, outcome.error);
      const [red, green, blue, alpha] = outcome.pixel;
      assert.ok(
        red >= 245,
        `unmatched original edge should stay bright red; got ${outcome.pixel}`,
      );
      assert.ok(green <= 5, `green should remain absent; got ${outcome.pixel}`);
      assert.ok(
        blue <= 5,
        `masked Twilight sample must not bleed into the edge; got ${outcome.pixel}`,
      );
      assert.ok(
        Math.abs(alpha - 102) <= 4,
        `half blend of 0.8 source alpha should be about 0.4; got ${outcome.pixel}`,
      );
    } finally {
      socket?.close();
      for (const entry of pending.values()) clearTimeout(entry.timer);
      if (browser) {
        browser.kill('SIGTERM');
        await Promise.race([
          new Promise((resolve) => browser.once('exit', resolve)),
          delay(2500),
        ]);
        if (browser.exitCode === null && browser.signalCode === null) {
          browser.kill('SIGKILL');
          await delay(250);
        }
      }
      if (server) await server.close();
      if (profile) await rm(profile, { recursive: true, force: true });
      if (debugPort) {
        await assert.rejects(fetch(`http://127.0.0.1:${debugPort}/json/list`));
      }
    }
  },
);
