/* global process, setTimeout, fetch, WebSocket, console */

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDurationEvidence,
  expectedDecodedMp3Samples,
} from './audio-preflight-evidence.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const audioRoot = path.join(root, 'data/music');
const chartRoot = path.join(root, 'src/game');
const authoringPath = path.join(root, 'data/charts/song-authoring.json');
const evidencePath = path.join(
  root,
  '.lore/local/evidence/full-song-audio-preflight.json',
);
const songs = [
  ['never-again', 'Never Again (Remastered).mp3'],
  ['the-abandoned-child', 'The Abandoned Child (Remastered).mp3'],
  ['the-commodity', 'The Commodity (Remastered).mp3'],
  ['the-game', 'The Game.mp3'],
  ['the-last-true-performer', 'The Last True Performer (Remastered).mp3'],
  ['the-rising-star', 'The Rising Star (Remastered).mp3'],
];
const chromium = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
const scratch = path.join('/tmp/opencode', `audio-preflight-${process.pid}`);
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitFor(check, label, timeoutMilliseconds = 30000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function stopOwnedProcess(child, name) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  child.kill('SIGTERM');
  return Promise.race([
    once(child, 'exit').then(() => undefined),
    pause(5000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      return once(child, 'exit').then(() => undefined);
    }),
  ]).catch((error) => {
    throw new Error(`Could not stop owned ${name}: ${error.message}`);
  });
}

function runJson(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} failed: ${result.error?.message ?? result.stderr ?? result.status}`,
    );
  }
  return JSON.parse(result.stdout);
}

async function chartTiming(songId, settings) {
  const file = path.join(chartRoot, `${songId}.candidate.ts`);
  const source = await readFile(file, 'utf8');
  const value = (key) => {
    const match = new RegExp(`^\\s*${key}: ([0-9.]+),$`, 'm').exec(source);
    if (!match) throw new Error(`Missing ${key} in ${file}`);
    return Number(match[1]);
  };
  const timing = {
    sourceStart: value('sourceStart'),
    duration: value('duration'),
    twilightAt: value('twilightAt'),
  };
  if (
    timing.sourceStart !== 0 ||
    timing.duration !== settings.duration ||
    timing.twilightAt !== settings.twilight_time ||
    timing.twilightAt !== timing.duration / 2
  ) {
    throw new Error(`Candidate chart timing disagrees with authoring settings: ${songId}`);
  }
  return timing;
}

async function sourceEvidence(songId, fileName, settings) {
  const sourcePath = path.join(audioRoot, fileName);
  const probe = runJson(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_streams',
      '-show_format',
      '-show_packets',
      '-show_entries',
      'stream=codec_name,sample_rate,channels,time_base,duration,duration_ts:format=duration:packet=duration,side_data_list=side_data_type,skip_samples,discard_padding',
      '-of',
      'json',
      sourcePath,
    ],
    `FFprobe ${fileName}`,
  );
  const stream = probe.streams?.[0];
  const containerDuration = probe.format?.duration;
  if (
    stream?.codec_name !== 'mp3' ||
    !stream.time_base ||
    !stream.sample_rate ||
    !containerDuration ||
    Number(containerDuration) !== settings.duration
  ) {
    throw new Error(`Unexpected MP3 stream/container metadata for ${songId}`);
  }
  const decodedSampleEvidence = expectedDecodedMp3Samples({
    packets: probe.packets,
    timeBase: stream.time_base,
    sampleRate: Number(stream.sample_rate),
  });
  const bytes = await readFile(sourcePath);
  return {
    path: `data/music/${fileName}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    codec: stream.codec_name,
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    containerDuration,
    streamDuration: stream.duration,
    streamDurationTicks: String(stream.duration_ts),
    timeBase: stream.time_base,
    mp3PacketCount: probe.packets.length,
    mp3PacketTimeline: decodedSampleEvidence,
    sideDataFirstPacket: probe.packets[0]?.side_data_list ?? [],
    sideDataLastPacket: probe.packets.at(-1)?.side_data_list ?? [],
  };
}

class DevTools {
  #socket;
  #sequence = 0;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id || !this.#pending.has(message.id)) return;
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.#sequence;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject }),
    );
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'Browser evaluation failed',
      );
    }
    return result.result?.value;
  }

  close() {
    this.#socket.close();
  }
}

async function installBrowserHarness(devtools) {
  await devtools.evaluate(`(() => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#fff';
    const button = document.createElement('button');
    button.id = 'audio-preflight-start';
    button.textContent = 'Start muted audio preflight';
    button.style.cssText = 'position:fixed;left:40%;top:40%;width:20%;height:20%;font:24px sans-serif';
    document.body.append(button);
    window.__audioPreflightModules = Promise.all([
      import('/src/audio/audio.ts'),
      import('/src/audio/browser-audio.ts'),
    ]);
  })()`);
  await devtools.send('Runtime.enable');
  await devtools.send('Page.enable');
  await devtools.evaluate('window.__audioPreflightModules');
}

async function prepareTransport(devtools, { sourceUrl, timing }) {
  return devtools.evaluate(`(async () => {
    const [{ createAudioTransport }, { createBrowserAudioContextAdapter }] = await window.__audioPreflightModules;
    const context = new AudioContext();
    let outputGain = null;
    const originalDecode = context.decodeAudioData.bind(context);
    context.decodeAudioData = async (...args) => {
      const buffer = await originalDecode(...args);
      window.__audioPreflight.buffer = buffer;
      return buffer;
    };
    const originalCreateGain = context.createGain.bind(context);
    context.createGain = () => {
      const gain = originalCreateGain();
      outputGain = gain;
      return gain;
    };
    const originalCreateSource = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = originalCreateSource();
      const originalStart = source.start.bind(source);
      source.start = (when, offset, duration) => {
        window.__audioPreflight.scheduled = { when, offset, duration };
        return originalStart(when, offset, duration);
      };
      return source;
    };
    const adapter = createBrowserAudioContextAdapter(context, 0);
    const transport = createAudioTransport(${JSON.stringify(timing).replaceAll('"', '"')}, {
      context: adapter,
      fetchAudio: async () => {
        const response = await fetch(${JSON.stringify(sourceUrl)});
        if (!response.ok) throw new Error('Audio fetch failed: ' + response.status);
        return response.arrayBuffer();
      },
    });
    window.__audioPreflight = {
      context,
      adapter,
      transport,
      outputGain,
      buffer: null,
      scheduled: null,
      startResult: null,
      startError: null,
      clickTrusted: false,
      timer: setInterval(() => transport.update(), 10),
    };
    let loadError = null;
    try {
      await transport.load();
    } catch (error) {
      loadError = String(error);
    }
    return {
      snapshot: transport.snapshot(),
      loadError,
      contextStateBeforeClick: context.state,
      contextSampleRate: context.sampleRate,
      bufferSampleRate: window.__audioPreflight.buffer?.sampleRate ?? null,
      bufferLength: window.__audioPreflight.buffer?.length ?? null,
      bufferDuration: window.__audioPreflight.buffer?.duration ?? null,
      numberOfChannels: window.__audioPreflight.buffer?.numberOfChannels ?? null,
      outputGain: outputGain?.gain.value ?? null,
    };
  })()`);
}

async function clickStart(devtools) {
  await devtools.evaluate(`(() => {
    const proof = window.__audioPreflight;
    document.querySelector('#audio-preflight-start').addEventListener('click', (event) => {
      proof.clickTrusted = event.isTrusted;
      proof.startPromise = proof.transport.start().then(
        (snapshot) => { proof.startResult = snapshot; return snapshot; },
        (error) => { proof.startError = String(error); throw error; },
      );
      proof.startPromise.catch(() => {});
    }, { once: true });
  })()`);
  const position = await devtools.evaluate(`(() => {
    const {x,y,width,height} = document.querySelector('#audio-preflight-start').getBoundingClientRect();
    return {x:x+width/2,y:y+height/2};
  })()`);
  await devtools.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: position.x,
    y: position.y,
  });
  await devtools.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: position.x,
    y: position.y,
    button: 'left',
    clickCount: 1,
  });
  await devtools.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: position.x,
    y: position.y,
    button: 'left',
    clickCount: 1,
  });
}

async function runOneSong(devtools, song, settings, source) {
  const timing = await chartTiming(song, settings);
  const sourceUrl = `/${source.path.split('/').map(encodeURIComponent).join('/')}`;
  const loaded = await prepareTransport(devtools, {
    sourceUrl,
    timing: {
      sourceUrl,
      sourceStart: timing.sourceStart,
      duration: timing.duration,
    },
  });
  const result = {
    id: song,
    source,
    chart: timing,
    transportBeforeGesture: loaded.snapshot,
    loadError: loaded.loadError,
    contextStateBeforeClick: loaded.contextStateBeforeClick,
    contextSampleRate: loaded.contextSampleRate,
    decodedBuffer: {
      sampleRate: loaded.bufferSampleRate,
      length: loaded.bufferLength,
      duration: loaded.bufferDuration,
      numberOfChannels: loaded.numberOfChannels,
    },
    outputGain: loaded.outputGain,
    trustedClick: false,
    startOutcome: null,
  };
  if (loaded.outputGain !== 0) {
    result.startOutcome = 'not-started: adapter output was not muted';
    result.blocksIntegration = true;
    return result;
  }
  if (loaded.bufferLength === null || loaded.bufferSampleRate === null) {
    result.startOutcome = 'not-started: browser did not decode an AudioBuffer';
    result.blocksIntegration = true;
    return result;
  }
  const durationEvidence = classifyDurationEvidence({
    chartDuration: timing.sourceStart + timing.duration,
    decodedDuration: loaded.bufferDuration,
    decodedLength: loaded.bufferLength,
    decodedSampleRate: loaded.bufferSampleRate,
    containerDuration: source.containerDuration,
    expectedDecodedSamples: source.mp3PacketTimeline.decodedSamples,
  });
  Object.assign(result, durationEvidence);
  if (durationEvidence.blocksIntegration) {
    result.startOutcome = 'not-started: duration evidence blocks integration';
    return result;
  }
  if (loaded.snapshot.status !== 'ready') {
    result.startOutcome = 'not-started: transport did not become ready';
    result.blocksIntegration = true;
    return result;
  }

  await clickStart(devtools);
  const startResult = await waitFor(
    () =>
      devtools.evaluate(`(() => {
        const p=window.__audioPreflight;
        return p.startError ? {error:p.startError} : p.startResult;
      })()`),
    `${song} transport start request`,
    10000,
  );
  if (startResult.error) {
    result.trustedClick = await devtools.evaluate(
      'window.__audioPreflight.clickTrusted',
    );
    result.startOutcome = `start rejected: ${startResult.error}`;
    result.blocksIntegration = true;
    return result;
  }
  const playing = await waitFor(
    () =>
      devtools.evaluate(`(() => {
        const p=window.__audioPreflight;
        return p.transport.snapshot().status === 'playing'
          ? {snapshot:p.transport.snapshot(),state:p.context.state,scheduled:p.scheduled}
          : null;
      })()`),
    `${song} actual scheduled playback start`,
    12000,
  );
  result.trustedClick = await devtools.evaluate(
    'window.__audioPreflight.clickTrusted',
  );
  result.contextStateAfterClick = playing.state;
  result.startSnapshot = startResult;
  result.playingSnapshot = playing.snapshot;
  result.scheduledSource = playing.scheduled;
  result.startOutcome = 'ready, trusted-click start scheduled, then playing';
  if (
    !result.trustedClick ||
    loaded.contextStateBeforeClick !== 'suspended' ||
    playing.state !== 'running' ||
    startResult.status !== 'starting' ||
    playing.snapshot.status !== 'playing' ||
    playing.scheduled?.offset !== timing.sourceStart ||
    playing.scheduled?.duration !== timing.duration
  ) {
    result.startOutcome = 'blocked: start/offset/duration assertion failed';
    result.blocksIntegration = true;
  }
  return result;
}

async function cleanupCurrentTransport(devtools) {
  try {
    await devtools?.evaluate(`(async () => {
      const proof=window.__audioPreflight;
      if (!proof) return;
      clearInterval(proof.timer);
      await proof.transport.dispose();
    })()`);
  } catch {
    // Context may not have been constructed or may already have closed.
  }
}

async function main() {
  const authoring = JSON.parse(await readFile(authoringPath, 'utf8')).songs;
  const chromiumVersion = spawnSync(chromium, ['--version'], {
    encoding: 'utf8',
  });
  if (chromiumVersion.status !== 0) {
    throw new Error(`Cannot identify Chromium: ${chromiumVersion.stderr}`);
  }
  let vitePort;
  let debugPort;
  const evidence = {
    purpose: 'Muted sequential Web Audio full-track compatibility preflight',
    browser: {
      binary: chromium,
      version: chromiumVersion.stdout.trim(),
      userAgent: null,
    },
    runtime: {
      viteSongVolume: '0',
      chromiumMuteAudio: true,
      adapterOutputGain: 0,
      autoplayPolicyOverride: false,
      clockModified: false,
      genuineTrustedClick: true,
      visualIntegrationClaim: false,
    },
    songs: [],
  };
  let server;
  let browser;
  let devtools;
  let failure;
  try {
    vitePort = await freePort();
    debugPort = await freePort();
    const baseUrl = `http://127.0.0.1:${vitePort}/`;
    await mkdir(scratch, { recursive: true });
    server = spawn(
      process.execPath,
      [
        path.join(root, 'node_modules/vite/bin/vite.js'),
        root,
        '--host',
        '127.0.0.1',
        '--port',
        String(vitePort),
        '--strictPort',
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, VITE_SONG_VOLUME: '0' },
      },
    );
    let serverLog = '';
    server.stderr.setEncoding('utf8').on('data', (value) => {
      serverLog += value;
    });
    await waitFor(async () => {
      try {
        return (await fetch(baseUrl)).ok;
      } catch {
        if (server.exitCode !== null) throw new Error(`Vite stopped: ${serverLog}`);
        return false;
      }
    }, 'owned Vite server');
    browser = spawn(
      chromium,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--mute-audio',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${path.join(scratch, 'profile')}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let browserLog = '';
    browser.stderr.setEncoding('utf8').on('data', (value) => {
      browserLog += value;
    });
    const target = await waitFor(async () => {
      try {
        const targets = await (
          await fetch(`http://127.0.0.1:${debugPort}/json/list`)
        ).json();
        return targets.find((entry) => entry.type === 'page');
      } catch {
        if (browser.exitCode !== null) {
          throw new Error(`Chromium stopped: ${browserLog}`);
        }
        return false;
      }
    }, 'owned Chromium page');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, 'open');
    devtools = new DevTools(socket);
    await devtools.send('Page.enable');
    await devtools.send('Runtime.enable');
    await devtools.send('Page.navigate', { url: baseUrl });
    await waitFor(
      () => devtools.evaluate('document.readyState === "complete"'),
      'Vite document load',
    );
    evidence.browser.userAgent = await devtools.evaluate('navigator.userAgent');
    for (const [song, fileName] of songs) {
      const songPageUrl = `${baseUrl}?audio-preflight=${encodeURIComponent(song)}`;
      await devtools.send('Page.navigate', { url: songPageUrl });
      await waitFor(
        () =>
          devtools.evaluate(
            `location.search === ${JSON.stringify(`?audio-preflight=${song}`)} && document.readyState === 'complete'`,
          ),
        `${song} fresh Vite document`,
      );
      await installBrowserHarness(devtools);
      const settings = authoring[song];
      if (!settings || settings.source !== `data/music/${fileName}`) {
        throw new Error(`Missing/mismatched authoring settings for ${song}`);
      }
      const source = await sourceEvidence(song, fileName, settings);
      await devtools.evaluate(`(() => {
        const button=document.querySelector('#audio-preflight-start');
        if(button) button.replaceWith(button.cloneNode(true));
      })()`);
      // Ensure every track receives a fresh native Web Audio context and transport.
      await cleanupCurrentTransport(devtools);
      const result = await runOneSong(devtools, song, settings, source);
      evidence.songs.push(result);
      await cleanupCurrentTransport(devtools);
      console.log(
        `${song}: ${result.decodedBuffer?.sampleRate ?? 'no decode'}Hz, ` +
          `${result.decodedBuffer?.length ?? '—'} frames, ` +
          `${result.decodedBuffer?.duration ?? '—'}s, ` +
          `residual ${result.residual ?? '—'}s, ` +
          `${result.classification ?? result.startOutcome}`,
      );
      if (result.blocksIntegration) {
        evidence.status = 'blocked';
        throw new Error(`${song} blocks integration: ${result.startOutcome}`);
      }
    }
    evidence.status = 'passed-with-candidate-review-required';
  } catch (error) {
    failure = error;
    evidence.status = 'blocked-or-incomplete';
    evidence.error = String(error?.stack ?? error);
  } finally {
    await cleanupCurrentTransport(devtools);
    devtools?.close();
    await stopOwnedProcess(browser, 'Chromium');
    await stopOwnedProcess(server, 'Vite');
    for (const [label, port] of [
      ['Vite', vitePort],
      ['Chromium DevTools', debugPort],
    ]) {
      if (await portIsOpen(port)) {
        failure ??= new Error(`Owned ${label} listener remains on ${port}`);
        evidence.cleanupError = `Owned ${label} listener remains on ${port}`;
      }
    }
    await rm(scratch, { recursive: true, force: true });
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  if (failure) {
    console.error(`Audio preflight evidence: ${evidencePath}`);
    throw failure;
  }
  console.log(`Evidence written to ${path.relative(root, evidencePath)}`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
