import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createServer } from 'vite';

// Explicit integration invocation; never part of brightvale/*.test.mjs.
// Native audio timing is observed, not replaced or accelerated.
for (const [name, width, height] of [
  ['desktop', 1280, 757],
  ['portrait', 390, 844],
])
  test(
    'real song playback begins when the single five-second countdown completes: ' +
      name,
    { timeout: 90_000 },
    async () => {
      const profile = await mkdtemp(
        path.join(tmpdir(), 'shining-stars-countdown-'),
      );
      let server;
      let browser;
      let socket;
      let port;
      let startupTimer;
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
            '--enable-gpu',
            '--use-angle=gl',
            '--ignore-gpu-blocklist',
            '--window-size=1280,900',
            '--remote-debugging-port=0',
            `--user-data-dir=${profile}`,
            'about:blank',
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
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
        const origin = new URL(endpoint).origin.replace('ws:', 'http:');
        const targets = await (await fetch(`${origin}/json/list`)).json();
        socket = new WebSocket(
          targets.find((target) => target.type === 'page').webSocketDebuggerUrl,
        );
        await once(socket, 'open');
        const pending = new Map();
        let nextId = 0;
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
            const timeout = setTimeout(() => {
              pending.delete(id);
              reject(new Error('CDP timeout: ' + method));
            }, 15_000);
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timeout);
                resolve(value);
              },
              reject: (error) => {
                clearTimeout(timeout);
                reject(error);
              },
            });
            socket.send(JSON.stringify({ id, method, params }));
          });
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
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            const value = await evaluate(expression);
            if (value) return value;
            await delay(100);
          }
          throw new Error(
            'Timed out waiting for ' +
              label +
              ': ' +
              (await evaluate(
                'JSON.stringify(window.__countdownEvidence?.samples)',
              )),
          );
        };
        const click = async (selector) => {
          const point = await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!button || button.disabled) return null;
        button.scrollIntoView({block:'center'});
        const rect = button.getBoundingClientRect();
        return rect.width && rect.height ? {x:rect.x+rect.width/2,y:rect.y+rect.height/2} : null;
      })()`);
          assert.ok(point, 'enabled visible control: ' + selector);
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
        await command('Page.enable');
        await command('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 0.5,
          mobile: false,
        });
        await command('Page.addScriptToEvaluateOnNewDocument', {
          source: `
      window.__countdownEvidence = { contexts: [], starts: [], samples: [] };
      const evidence = window.__countdownEvidence;
      const NativeContext = window.AudioContext;
      window.AudioContext = new Proxy(NativeContext, { construct(target, args) {
        const context = Reflect.construct(target, args);
        evidence.contexts.push(context);
        const create = context.createBufferSource.bind(context);
        context.createBufferSource = () => {
          const source = create();
          const start = source.start.bind(source);
          source.start = (...args) => {
            evidence.starts.push({ when: args[0], calledAt: context.currentTime, offset: args[1] ?? 0 });
            return start(...args);
          };
          return source;
        };
        return context;
      }});
      function observe() {
        const overlay = document.querySelector('[data-countdown]');
        const context = evidence.contexts.at(-1);
        if (overlay && context) {
          const visible = !overlay.hidden;
          const number = overlay.querySelector('[data-countdown-number]')?.textContent ?? '';
          const previous = evidence.samples.at(-1);
          if (!previous || previous.visible !== visible || previous.number !== number) {
            evidence.samples.push({ now: context.currentTime, visible, number,
              text: overlay.textContent.replace(/\\s+/g,' ').trim(),
              visibleStartingStrings: document.body.innerText.match(/Starting in/g)?.length ?? 0,
              time: document.querySelector('[data-time]')?.textContent });
          }
        }
        requestAnimationFrame(observe);
      }
      requestAnimationFrame(observe);
    `,
        });
        await command('Page.navigate', { url: `http://127.0.0.1:${port}` });
        await waitFor(
          `document.querySelector('[data-action="browse-collection"]')`,
          'observatory',
        );
        await click('[data-action="browse-collection"]');
        console.log(
          'WebGL renderer:',
          await evaluate(
            `(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_debug_renderer_info'); return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`,
          ),
        );
        await waitFor(
          `document.querySelector('[data-song-detail] [data-action="play"]:not(:disabled)')`,
          'playable selected song',
        );
        await click('[data-song-detail] [data-action="play"]');
        await waitFor(
          `document.querySelector('[data-countdown]:not([hidden])')`,
          'scheduled count-in',
        );
        if (process.env.IF3_SCREENSHOT_PATH) {
          const capture = await command('Page.captureScreenshot', {
            format: 'png',
          });
          await writeFile(
            process.env.IF3_SCREENSHOT_PATH + '-' + name + '.png',
            Buffer.from(capture.data, 'base64'),
            { flag: 'wx' },
          );
        }
        await waitFor(
          `window.__countdownEvidence.samples.some(sample => sample.visible && sample.number === '1')`,
          'final count',
        );
        await waitFor(
          `window.__countdownEvidence.samples.some((sample, index, samples) => !sample.visible && samples.slice(0,index).some(earlier => earlier.visible))`,
          'countdown completion',
        );
        await waitFor(
          `document.querySelector('[data-time]')?.textContent && document.querySelector('[data-time]').textContent !== '00:00'`,
          'advancing gameplay time',
        );
        const evidence = await evaluate(`(() => {
      const evidence = window.__countdownEvidence;
      const canvas = document.querySelector('canvas');
      const context = evidence.contexts.at(-1);
      return { starts: evidence.starts, samples: evidence.samples, audioState: context.state,
        now: context.currentTime, canvas: !!canvas, rendererError: document.querySelector('[data-panel="error"]')?.hidden === false };
    })()`);
        assert.equal(evidence.rendererError, false);
        assert.equal(
          evidence.canvas,
          true,
          'actual city/highway canvas exists',
        );
        assert.equal(evidence.audioState, 'running');
        assert.equal(
          evidence.starts.length,
          1,
          'one native song source scheduled',
        );
        const source = evidence.starts[0];
        assert.ok(
          Math.abs(source.when - source.calledAt - 5) < 0.05,
          JSON.stringify(source),
        );
        const visible = evidence.samples.filter((sample) => sample.visible);
        assert.deepEqual(
          visible.map((sample) => sample.number),
          ['5', '4', '3', '2', '1'],
        );
        for (const sample of visible) {
          assert.equal(
            sample.visibleStartingStrings,
            1,
            'one visible DOM countdown string',
          );
          assert.equal(
            Number(sample.number),
            Math.ceil(source.when - sample.now),
            JSON.stringify(sample),
          );
          assert.equal(sample.time, '00:00', 'song clock held during count-in');
        }
        const first = evidence.samples.findIndex((sample) => sample.visible);
        const completed = evidence.samples
          .slice(first + 1)
          .find((sample) => !sample.visible);
        assert.ok(
          completed.now >= source.when,
          'overlay does not finish before scheduled audio start',
        );
        assert.ok(
          completed.now - source.when < 0.15,
          'countdown ends within a rendered frame budget of native start',
        );
        console.log(
          JSON.stringify({
            scheduledLeadSeconds: source.when - source.calledAt,
            countdown: visible.map((sample) => sample.number),
            completionDeltaSeconds: completed.now - source.when,
            playbackNowSeconds: evidence.now,
            singleSource: true,
          }),
        );
      } finally {
        clearTimeout(startupTimer);
        socket?.close();
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
