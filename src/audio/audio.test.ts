import { describe, expect, it } from 'vitest';
import {
  createAudioTransport,
  type AudioBufferPort,
  type AudioContextPort,
  type AudioLogEntry,
  type AudioSourcePort,
  type AudioTransport,
  type AudioTransportConfig,
} from './audio';

interface StartCall {
  readonly when: number;
  readonly offset: number;
  readonly duration: number;
}

class FakeBuffer implements AudioBufferPort {
  constructor(readonly duration: number) {}
}

class FakeSource extends EventTarget implements AudioSourcePort<FakeBuffer> {
  buffer: FakeBuffer | null = null;
  readonly startCalls: StartCall[] = [];
  stopCalls = 0;
  disconnectCalls = 0;

  start(when: number, offset: number, duration: number): void {
    this.startCalls.push({ when, offset, duration });
  }

  stop(): void {
    this.stopCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  finish(): void {
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeContext
  extends EventTarget
  implements AudioContextPort<FakeBuffer, FakeSource>
{
  currentTime = 0;
  state = 'suspended';
  bufferDuration = 180;
  resumeCalls = 0;
  closeCalls = 0;
  decodeCalls = 0;
  readonly sources: FakeSource[] = [];
  resumeBehavior: () => Promise<void> = async () => {
    this.setState('running');
  };
  decodeBehavior: (audioData: ArrayBuffer) => Promise<FakeBuffer> = async (
    audioData,
  ) => {
    void audioData;
    return new FakeBuffer(this.bufferDuration);
  };
  createSourceBehavior: () => FakeSource = () => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  };

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return this.resumeBehavior();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.setState('closed');
    return Promise.resolve();
  }

  decodeAudioData(audioData: ArrayBuffer): Promise<FakeBuffer> {
    this.decodeCalls += 1;
    return this.decodeBehavior(audioData);
  }

  createBufferSource(): FakeSource {
    return this.createSourceBehavior();
  }

  setState(state: string): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise has not initialized its resolver.');
      }
      resolvePromise(value);
    },
    reject(error) {
      if (rejectPromise === undefined) {
        throw new Error('Deferred promise has not initialized its rejecter.');
      }
      rejectPromise(error);
    },
  };
}

const config: AudioTransportConfig = {
  sourceUrl: 'synthetic://brightvale-track',
  sourceStart: 107.1,
  duration: 65.8,
};

type NativeAudioContextFitsPort =
  AudioContext extends AudioContextPort<AudioBuffer, AudioBufferSourceNode>
    ? true
    : false;

interface Harness {
  readonly context: FakeContext;
  readonly transport: AudioTransport;
  fetchCalls(): number;
  setFetchBehavior(
    behavior: (sourceUrl: string, signal?: AbortSignal) => Promise<ArrayBuffer>,
  ): void;
}

function createHarness(log?: (entry: AudioLogEntry) => void): Harness {
  const context = new FakeContext();
  let fetchCount = 0;
  let fetchBehavior: (
    sourceUrl: string,
    signal?: AbortSignal,
  ) => Promise<ArrayBuffer> = async (sourceUrl) => {
    void sourceUrl;
    return new ArrayBuffer(8);
  };
  const transport = createAudioTransport(config, {
    context,
    fetchAudio(sourceUrl, signal) {
      fetchCount += 1;
      return fetchBehavior(sourceUrl, signal);
    },
    log,
  });

  return {
    context,
    transport,
    fetchCalls: () => fetchCount,
    setFetchBehavior(behavior) {
      fetchBehavior = behavior;
    },
  };
}

function sourceAt(context: FakeContext, index = 0): FakeSource {
  const source = context.sources[index];
  if (source === undefined) {
    throw new Error(`No fake source exists at index ${index}.`);
  }
  return source;
}

describe('audio transport', () => {
  it('accepts native Web Audio context, buffer, and source types structurally', () => {
    const nativeTypesFit: NativeAudioContextFitsPort = true;

    expect(nativeTypesFit).toBe(true);
  });

  it('fetches and decodes only once, including concurrent load requests', async () => {
    const harness = createHarness();

    const firstLoad = harness.transport.load();
    const secondLoad = harness.transport.load();
    await Promise.all([firstLoad, secondLoad]);
    await harness.transport.load();

    expect(harness.fetchCalls()).toBe(1);
    expect(harness.context.decodeCalls).toBe(1);
    expect(harness.transport.snapshot().status).toBe('ready');
  });

  it('rejects a decoded buffer shorter than sourceStart plus excerpt duration and allows retry', async () => {
    const harness = createHarness();
    harness.context.bufferDuration =
      config.sourceStart + config.duration - 0.01;

    await expect(harness.transport.load()).rejects.toThrow(/duration/i);
    expect(harness.transport.snapshot().status).toBe('error');

    harness.context.bufferDuration = config.sourceStart + config.duration;
    await harness.transport.load();

    expect(harness.transport.snapshot().status).toBe('ready');
    expect(harness.fetchCalls()).toBe(2);
    expect(harness.context.decodeCalls).toBe(2);
  });

  it('can retry after a fetch error without decoding the failed response', async () => {
    const harness = createHarness();
    harness.setFetchBehavior(async () => {
      throw new Error('network failure');
    });

    await expect(harness.transport.load()).rejects.toThrow('network failure');
    expect(harness.context.decodeCalls).toBe(0);
    expect(harness.transport.snapshot().status).toBe('error');

    harness.setFetchBehavior(async () => new ArrayBuffer(8));
    await harness.transport.load();

    expect(harness.fetchCalls()).toBe(2);
    expect(harness.context.decodeCalls).toBe(1);
    expect(harness.transport.snapshot().status).toBe('ready');
  });

  it('can retry after a decode error', async () => {
    const harness = createHarness();
    harness.context.decodeBehavior = async () => {
      throw new Error('decode failure');
    };

    await expect(harness.transport.load()).rejects.toThrow('decode failure');
    expect(harness.transport.snapshot().status).toBe('error');

    harness.context.decodeBehavior = async () =>
      new FakeBuffer(config.sourceStart + config.duration);
    await harness.transport.load();

    expect(harness.fetchCalls()).toBe(2);
    expect(harness.context.decodeCalls).toBe(2);
    expect(harness.transport.snapshot().status).toBe('ready');
  });

  it('awaits a running context before scheduling a source', async () => {
    const harness = createHarness();
    await harness.transport.load();
    const resumeGate = deferred<void>();
    harness.context.resumeBehavior = () =>
      resumeGate.promise.then(() => harness.context.setState('running'));

    const start = harness.transport.start();

    expect(harness.context.resumeCalls).toBe(1);
    expect(harness.context.sources).toHaveLength(0);
    expect(harness.transport.snapshot().status).toBe('starting');

    resumeGate.resolve(undefined);
    await start;

    expect(harness.context.state).toBe('running');
    expect(harness.context.sources).toHaveLength(1);
    expect(sourceAt(harness.context).startCalls).toEqual([
      { when: 2, offset: 107.1, duration: 65.8 },
    ]);
  });

  it('keeps a pending start alive when the render loop updates before context resume resolves', async () => {
    const harness = createHarness();
    await harness.transport.load();
    const resumeGate = deferred<void>();
    harness.context.resumeBehavior = () =>
      resumeGate.promise.then(() => harness.context.setState('running'));

    const start = harness.transport.start();
    expect(harness.transport.snapshot().status).toBe('starting');

    harness.transport.update();
    resumeGate.resolve(undefined);
    await start;

    expect(harness.context.sources).toHaveLength(1);
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'starting',
      hasActiveSource: true,
    });
  });

  it('does not schedule when resume resolves without the context reaching running', async () => {
    const harness = createHarness();
    await harness.transport.load();
    harness.context.resumeBehavior = async () => undefined;

    await harness.transport.start();

    expect(harness.context.sources).toHaveLength(0);
    expect(harness.transport.snapshot().status).toBe('paused');
  });

  it('keeps position frozen and not playing through the two-second countdown', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();

    harness.context.currentTime = 1.999;
    expect(harness.transport.update()).toMatchObject({
      status: 'starting',
      position: 0,
    });
    harness.context.currentTime = 2;
    expect(harness.transport.update()).toMatchObject({
      status: 'playing',
      position: 0,
    });
    harness.context.currentTime = 5.25;
    expect(harness.transport.update()).toMatchObject({
      status: 'playing',
      position: 3.25,
    });
  });

  it('uses audio currentTime and clamps transport position at excerpt duration', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();

    harness.context.currentTime = 2;
    harness.transport.update();
    harness.context.currentTime = 2 + config.duration + 1;

    expect(harness.transport.update()).toMatchObject({
      status: 'results',
      position: config.duration,
      hasActiveSource: false,
    });
  });

  it('captures pause position and resumes a fresh source at the matching excerpt offset and remaining duration', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    harness.context.currentTime = 2;
    harness.transport.update();
    harness.context.currentTime = 8.25;
    harness.transport.update();

    expect(harness.transport.pause()).toMatchObject({
      status: 'paused',
      position: 6.25,
      hasActiveSource: false,
    });
    expect(sourceAt(harness.context).stopCalls).toBe(1);
    expect(sourceAt(harness.context).disconnectCalls).toBe(1);

    harness.context.currentTime = 8.25;
    await harness.transport.resume();
    expect(harness.context.sources).toHaveLength(2);
    expect(sourceAt(harness.context, 1).startCalls).toEqual([
      {
        when: 10.25,
        offset: config.sourceStart + 6.25,
        duration: config.duration - 6.25,
      },
    ]);
  });

  it('cancels a countdown on pause and does not auto-resume later', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    const source = sourceAt(harness.context);

    harness.context.currentTime = 1;
    expect(harness.transport.pause()).toMatchObject({
      status: 'paused',
      position: 0,
      hasActiveSource: false,
    });
    expect(source.stopCalls).toBe(1);
    harness.context.currentTime = 4;
    harness.context.setState('running');
    expect(harness.transport.update()).toMatchObject({
      status: 'paused',
      position: 0,
      hasActiveSource: false,
    });
    source.finish();
    expect(harness.transport.snapshot().status).toBe('paused');
  });

  it('cancels an asynchronous start when paused before resume resolves', async () => {
    const harness = createHarness();
    await harness.transport.load();
    const resumeGate = deferred<void>();
    harness.context.resumeBehavior = () =>
      resumeGate.promise.then(() => harness.context.setState('running'));

    const start = harness.transport.start();
    expect(harness.transport.pause().status).toBe('paused');
    resumeGate.resolve(undefined);
    await start;

    expect(harness.context.sources).toHaveLength(0);
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'paused',
      hasActiveSource: false,
    });
  });

  it('ignores an old source ended event after pause and resume in the same run', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    const oldSource = sourceAt(harness.context);
    harness.context.currentTime = 4;
    harness.transport.update();
    harness.transport.pause();
    await harness.transport.resume();
    const resumedSnapshot = harness.transport.snapshot();

    oldSource.finish();

    expect(harness.transport.snapshot()).toEqual(resumedSnapshot);
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'starting',
      hasActiveSource: true,
    });
  });

  it('restarts from zero with one active source and ignores the old source event', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    const oldSource = sourceAt(harness.context);
    harness.context.currentTime = 6;
    harness.transport.update();

    await harness.transport.restart();
    expect(harness.context.sources).toHaveLength(2);
    expect(oldSource.stopCalls).toBe(1);
    expect(sourceAt(harness.context, 1).startCalls).toEqual([
      { when: 8, offset: config.sourceStart, duration: config.duration },
    ]);
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'starting',
      position: 0,
      hasActiveSource: true,
    });

    const activeSnapshot = harness.transport.snapshot();
    oldSource.finish();
    expect(harness.transport.snapshot()).toEqual(activeSnapshot);
  });

  it('cancels restart playback when paused while its initial fetch is pending', async () => {
    const harness = createHarness();
    const fetchGate = deferred<ArrayBuffer>();
    harness.setFetchBehavior(() => fetchGate.promise);

    const restart = harness.transport.restart();
    await Promise.resolve();
    expect(harness.fetchCalls()).toBe(1);

    expect(harness.transport.pause().status).toBe('paused');
    fetchGate.resolve(new ArrayBuffer(8));
    await restart;

    expect(harness.context.decodeCalls).toBe(1);
    expect(harness.context.sources).toHaveLength(0);
    expect(harness.transport.snapshot().status).not.toBe('starting');
    expect(harness.transport.snapshot().status).not.toBe('playing');
    expect(harness.transport.snapshot().hasActiveSource).toBe(false);
  });

  it('reports source creation failure as a schedule error and permits a later retry', async () => {
    const entries: AudioLogEntry[] = [];
    const harness = createHarness((entry) => entries.push(entry));
    await harness.transport.load();
    let shouldFail = true;
    harness.context.createSourceBehavior = () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('source creation failure');
      }
      const source = new FakeSource();
      harness.context.sources.push(source);
      return source;
    };

    await expect(harness.transport.start()).rejects.toThrow(
      'source creation failure',
    );
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'error',
      error: 'source creation failure',
      hasActiveSource: false,
    });
    expect(
      entries.filter((entry) => entry.operation === 'source-schedule'),
    ).toEqual([
      expect.objectContaining({
        operation: 'source-schedule',
        outcome: 'attempt',
      }),
      expect.objectContaining({
        operation: 'source-schedule',
        outcome: 'failure',
      }),
    ]);

    await expect(harness.transport.restart()).resolves.toMatchObject({
      status: 'starting',
      hasActiveSource: true,
    });
  });

  it('enters recoverable error when the current source ends before its scheduled end', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    const source = sourceAt(harness.context);
    harness.context.currentTime = 2;
    harness.transport.update();
    harness.context.currentTime = 3;

    source.finish();

    expect(harness.transport.snapshot()).toMatchObject({
      status: 'error',
      position: 1,
      hasActiveSource: false,
    });
  });

  it('treats source end at its scheduled excerpt end as normal results', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    const source = sourceAt(harness.context);
    harness.context.currentTime = 2 + config.duration;

    source.finish();

    expect(harness.transport.snapshot()).toMatchObject({
      status: 'results',
      position: config.duration,
      hasActiveSource: false,
    });
  });

  it('pauses and preserves position after an unexpected context suspension without auto-resume', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    harness.context.currentTime = 2;
    harness.transport.update();
    harness.context.currentTime = 4.5;
    harness.transport.update();

    harness.context.setState('suspended');
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'paused',
      position: 2.5,
      hasActiveSource: false,
    });

    harness.context.setState('running');
    expect(harness.transport.snapshot().status).toBe('paused');
  });

  it('invalidates a pending resume and closes the context on dispose', async () => {
    const harness = createHarness();
    await harness.transport.load();
    const resumeGate = deferred<void>();
    harness.context.resumeBehavior = () =>
      resumeGate.promise.then(() => harness.context.setState('running'));

    const start = harness.transport.start();
    await harness.transport.dispose();
    resumeGate.resolve(undefined);
    await start;

    expect(harness.context.sources).toHaveLength(0);
    expect(harness.context.closeCalls).toBe(1);
    expect(harness.transport.snapshot()).toMatchObject({
      disposed: true,
      hasActiveSource: false,
    });
  });

  it('ignores an ended callback from an intentionally stopped source after dispose', async () => {
    const harness = createHarness();
    await harness.transport.load();
    await harness.transport.start();
    const source = sourceAt(harness.context);
    harness.context.currentTime = 2;
    harness.transport.update();

    await harness.transport.dispose();
    source.finish();

    expect(source.stopCalls).toBe(1);
    expect(harness.context.closeCalls).toBe(1);
    expect(harness.transport.snapshot()).toMatchObject({
      disposed: true,
      hasActiveSource: false,
    });
  });

  it('does not decode or resurrect state when a pending fetch completes after dispose', async () => {
    const harness = createHarness();
    const fetchGate = deferred<ArrayBuffer>();
    harness.setFetchBehavior(() => fetchGate.promise);
    const load = harness.transport.load();

    await harness.transport.dispose();
    fetchGate.resolve(new ArrayBuffer(8));
    await load;

    expect(harness.context.decodeCalls).toBe(0);
    expect(harness.transport.snapshot()).toMatchObject({
      disposed: true,
      hasActiveSource: false,
    });
  });

  it('logs attempts and outcomes at fetch, decode, resume, schedule, and stop boundaries', async () => {
    const entries: AudioLogEntry[] = [];
    const harness = createHarness((entry) => entries.push(entry));
    await harness.transport.load();
    await harness.transport.start();
    harness.transport.pause();

    for (const operation of [
      'fetch',
      'decode',
      'context-resume',
      'source-schedule',
      'source-stop',
    ] as const) {
      expect(
        entries.some(
          (entry) =>
            entry.operation === operation && entry.outcome === 'attempt',
        ),
      ).toBe(true);
      expect(
        entries.some(
          (entry) =>
            entry.operation === operation && entry.outcome === 'success',
        ),
      ).toBe(true);
    }
  });

  it('aborts a pending fetch and permits a clean retry', async () => {
    const harness = createHarness();
    const fetchGate = deferred<ArrayBuffer>();
    let signal: AbortSignal | undefined;
    harness.setFetchBehavior((_url, requestSignal) => {
      signal = requestSignal;
      return fetchGate.promise;
    });
    const pendingLoad = harness.transport.load();
    await Promise.resolve();
    harness.transport.cancelLoad();

    expect(signal?.aborted).toBe(true);
    fetchGate.resolve(new ArrayBuffer(8));
    await pendingLoad;
    expect(harness.context.decodeCalls).toBe(0);

    harness.setFetchBehavior(async () => new ArrayBuffer(8));
    await expect(harness.transport.load()).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('invalidates a decode that cannot be aborted and releases the decoded buffer on dispose', async () => {
    const harness = createHarness();
    const decodeGate = deferred<FakeBuffer>();
    harness.context.decodeBehavior = () => decodeGate.promise;
    const pendingLoad = harness.transport.load();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.context.decodeCalls).toBe(1);
    harness.transport.cancelLoad();
    decodeGate.resolve(new FakeBuffer(200));
    await pendingLoad;
    expect(harness.transport.snapshot()).toMatchObject({
      status: 'paused',
      loaded: false,
    });

    harness.context.decodeBehavior = async () => new FakeBuffer(200);
    await harness.transport.load();
    await harness.transport.start();
    const source = sourceAt(harness.context);
    expect(source.buffer).not.toBeNull();
    await harness.transport.dispose();
    expect(source.buffer).toBeNull();
  });
});
