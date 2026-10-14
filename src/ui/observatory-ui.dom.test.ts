import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Plugin } from 'vite';

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
  description: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result !== false) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`, {
    cause: lastError,
  });
}

describe('mounted Observatory interactions', () => {
  let browser: ChildProcess | undefined;
  let devServer: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  let profileDirectory: string | undefined;

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
    if (profileDirectory !== undefined)
      await rm(profileDirectory, { recursive: true, force: true });
    profileDirectory = undefined;
  });

  it('retains constellation focus across projection updates and opens/applies filters from the overview', async () => {
    const chromiumPath = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
    await access(chromiumPath);
    await mkdir(scratchParent, { recursive: true });
    profileDirectory = await mkdtemp(
      path.join(scratchParent, 'observatory-ui-dom-'),
    );
    const vitePort = await freePort();
    const debugPort = await freePort();
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/ui/styles.css"></head><body><div id="app"></div><script type="module">
      import { createObservatoryUI } from '/src/ui/observatory-ui.ts';
      import { SONG_CATALOG } from '/src/catalog/catalog.ts';
      window.observatory = createObservatoryUI(document.querySelector('#app'), SONG_CATALOG, { onPlay() {}, onRendererRetry() {} });
      window.observatoryMounted = true;
    </script></body></html>`;
    const testPage: Plugin = {
      name: 'observatory-dom-test-page',
      configureServer(server) {
        server.middlewares.use(
          '/__observatory_dom_test__',
          (_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(html);
          },
        );
      },
    };
    devServer = await createServer({
      configFile: false,
      root: process.cwd(),
      appType: 'custom',
      plugins: [testPage],
      server: { host: '127.0.0.1', port: vitePort, strictPort: true },
    });
    await devServer.listen();

    browser = spawn(
      chromiumPath,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDirectory}`,
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
    }, 'Chromium DevTools target');
    const page = targets.find((target) => target.type === 'page');
    if (page === undefined)
      throw new Error('Chromium did not expose a page target.');

    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener(
        'error',
        () => reject(new Error('CDP websocket failed to open.')),
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
      const response = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (response.exceptionDetails !== undefined) {
        throw new Error(
          response.exceptionDetails.exception?.description ??
            response.exceptionDetails.text ??
            'Browser evaluation failed.',
        );
      }
      return response.result?.value;
    };

    await command('Page.enable');
    await command('Runtime.enable');
    await command('Page.navigate', {
      url: `http://127.0.0.1:${vitePort}/__observatory_dom_test__`,
    });
    await waitFor(
      async () => (await evaluate('window.observatoryMounted')) || false,
      'mounted Observatory UI',
    );

    const focusResult = await evaluate(`(() => {
      const button = document.querySelector('[data-action="select-collection"]');
      button.focus();
      window.__focusedConstellation = button;
      window.observatory.setProjectedAnchors([{ collectionId: 'all-songs', x: 120, y: 150, visible: true }]);
      window.observatory.setProjectedAnchors([{ collectionId: 'all-songs', x: 180, y: 210, visible: true }]);
      return { same: document.querySelector('[data-action="select-collection"]') === button,
        focused: document.activeElement === button, left: button.style.left, top: button.style.top };
    })()`);
    expect(focusResult).toMatchObject({ same: true, focused: true });
    expect(focusResult.left).not.toBe('120px'); // CSS-pixel anchor is host-relative, then translated into its layer.

    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    expect(
      await evaluate(
        'window.observatory.getSelectionSnapshot().filters.collectionId',
      ),
    ).toBe('all-songs');
    expect(
      await evaluate(
        'document.activeElement === window.__focusedConstellation',
      ),
    ).toBe(true);

    const overviewFilters = await evaluate(`(() => {
      document.querySelector('[data-action="toggle-filters"]').click();
      const panel = document.querySelector('[data-filter-panel]');
      const availability = panel.querySelector('[data-filter-availability]');
      availability.value = 'unavailable';
      availability.dispatchEvent(new Event('change', { bubbles: true }));
      return { visible: !panel.hidden,
        expanded: document.querySelector('[data-action="toggle-filters"]').getAttribute('aria-expanded'),
        filter: window.observatory.getSelectionSnapshot().filters.availability,
        results: document.querySelector('[data-result-count]').textContent };
    })()`);
    expect(overviewFilters).toMatchObject({
      visible: true,
      expanded: 'true',
      filter: 'unavailable',
      results: '0 songs',
    });

    await evaluate(
      `document.querySelector('[data-action="browse-collection"]').click()`,
    );
    expect(
      await evaluate('window.observatory.getSelectionSnapshot().screen'),
    ).toBe('browser');
    expect(
      await evaluate('!document.querySelector("[data-filter-panel]").hidden'),
    ).toBe(true);
    expect(
      await evaluate(
        'Boolean(document.querySelector("[data-song-list] .song-list-empty"))',
      ),
    ).toBe(true);
    await evaluate(
      `document.querySelector('[data-action="clear-filters"]').click()`,
    );
    expect(
      await evaluate(
        'document.querySelector("[data-result-count]").textContent',
      ),
    ).toBe('7 songs');
  }, 45_000);
});
