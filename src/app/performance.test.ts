import { describe, expect, it } from 'vitest';
import { SONG_CATALOG } from '../catalog/catalog';
import type {
  AudioBufferPort,
  AudioContextPort,
  AudioSourcePort,
} from '../audio/audio';
import { createPerformanceCoordinator } from './performance';

class TestBuffer implements AudioBufferPort {
  constructor(readonly duration: number) {}
}

class TestSource extends EventTarget implements AudioSourcePort<TestBuffer> {
  buffer: TestBuffer | null = null;
  starts = 0;
  stops = 0;
  start(): void {
    this.starts += 1;
  }
  stop(): void {
    this.stops += 1;
  }
  disconnect(): void {}
}

class TestContext
  extends EventTarget
  implements AudioContextPort<TestBuffer, TestSource>
{
  currentTime = 0;
  state = 'suspended';
  resumeCalls = 0;
  decodeCalls = 0;
  closeCalls = 0;
  resumeError: Error | null = null;
  resumeGate: Promise<void> | null = null;
  closeGate: Promise<void> | null = null;
  decode: () => Promise<TestBuffer> = async () => new TestBuffer(1000);
  readonly sources: TestSource[] = [];

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeError !== null) return Promise.reject(this.resumeError);
    if (this.resumeGate !== null) {
      return this.resumeGate.then(() => {
        this.state = 'running';
        this.dispatchEvent(new Event('statechange'));
      });
    }
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
    return Promise.resolve();
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeGate !== null) await this.closeGate;
    this.state = 'closed';
    this.dispatchEvent(new Event('statechange'));
  }

  decodeAudioData(): Promise<TestBuffer> {
    this.decodeCalls += 1;
    return this.decode();
  }

  createBufferSource(): TestSource {
    const source = new TestSource();
    this.sources.push(source);
    return source;
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
      resolvePromise?.(value);
    },
    reject(error) {
      rejectPromise?.(error);
    },
  };
}

function harness() {
  const contexts: TestContext[] = [];
  const fetched: string[] = [];
  const coordinator = createPerformanceCoordinator({
    createAudioContext() {
      const context = new TestContext();
      contexts.push(context);
      return context;
    },
    async fetchAudio(url) {
      fetched.push(url);
      return new ArrayBuffer(8);
    },
  });
  const song = SONG_CATALOG.songs[0];
  if (song === undefined) throw new Error('Expected a catalog song fixture.');
  return { coordinator, contexts, fetched, song };
}

describe('performance coordinator', () => {
  it('resumes synchronously in Play, loads only the selected song, and waits for gameplay readiness', async () => {
    const h = harness();
    const preparation = h.coordinator.prepare(h.song, 'normal');
    expect(h.contexts[0]?.resumeCalls).toBe(1);
    expect(h.coordinator.snapshot()).toMatchObject({
      songId: h.song.id,
      difficulty: 'normal',
      gameplayReady: false,
    });
    const prepared = await preparation;
    expect(prepared.controller?.audio.status).toBe('ready');
    expect(h.fetched).toEqual([h.song.audioUrl]);
    expect(h.contexts[0]?.sources).toHaveLength(0);

    await h.coordinator.markGameplayReady();
    expect(h.contexts[0]?.sources).toHaveLength(1);
  });

  it('cancels a decode logically on return and ignores late completion', async () => {
    const h = harness();
    const decodeGate = deferred<TestBuffer>();
    const context = new TestContext();
    context.decode = () => decodeGate.promise;
    h.contexts.push(context);
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => context,
      fetchAudio: async () => new ArrayBuffer(8),
    });
    const pending = coordinator.prepare(h.song, 'normal');
    await Promise.resolve();
    await Promise.resolve();
    expect(context.decodeCalls).toBe(1);
    await coordinator.returnToBrowser();
    decodeGate.resolve(new TestBuffer(1000));
    await pending;
    expect(coordinator.snapshot()).toMatchObject({ songId: null, error: null });
    expect(context.sources).toHaveLength(0);
    expect(context.closeCalls).toBe(1);
  });

  it('ignores stale fetch errors after selection returns to browsing', async () => {
    const h = harness();
    const fetchGate = deferred<ArrayBuffer>();
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => new TestContext(),
      fetchAudio: () => fetchGate.promise,
    });
    const pending = coordinator.prepare(h.song, 'normal');
    await Promise.resolve();
    await coordinator.returnToBrowser();
    fetchGate.reject(new Error('late network failure'));
    await pending;
    expect(coordinator.snapshot()).toMatchObject({ songId: null, error: null });
  });

  it('ignores a late context-resume rejection after returning during preparation', async () => {
    const h = harness();
    const resumeGate = deferred<void>();
    const context = new TestContext();
    context.resumeGate = resumeGate.promise;
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => context,
      fetchAudio: async () => new ArrayBuffer(8),
    });
    const pending = coordinator.prepare(h.song, 'normal');
    expect(context.resumeCalls).toBe(1);
    await coordinator.returnToBrowser();
    resumeGate.reject(new Error('late resume failure'));
    await pending;
    expect(coordinator.snapshot()).toMatchObject({ songId: null, error: null });
  });

  it('keeps a replacement song selected when an older fetch resolves late', async () => {
    const h = harness();
    const oldFetch = deferred<ArrayBuffer>();
    const replacement = SONG_CATALOG.songs[1];
    if (replacement === undefined)
      throw new Error('Expected replacement song fixture.');
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => new TestContext(),
      fetchAudio: (url) =>
        url === h.song.audioUrl
          ? oldFetch.promise
          : Promise.resolve(new ArrayBuffer(8)),
    });
    const oldPreparation = coordinator.prepare(h.song, 'normal');
    await Promise.resolve();
    const replacementPreparation = coordinator.prepare(replacement, 'normal');
    await replacementPreparation;
    expect(coordinator.snapshot().songId).toBe(replacement.id);
    oldFetch.resolve(new ArrayBuffer(8));
    await oldPreparation;
    expect(coordinator.snapshot()).toMatchObject({
      songId: replacement.id,
      error: null,
    });
  });

  it('rejects restart before renderer readiness and while selected audio is loading', async () => {
    const h = harness();
    const fetchGate = deferred<ArrayBuffer>();
    const contexts: TestContext[] = [];
    const coordinator = createPerformanceCoordinator({
      createAudioContext() {
        const context = new TestContext();
        contexts.push(context);
        return context;
      },
      fetchAudio: () => fetchGate.promise,
    });
    const preparing = coordinator.prepare(h.song, 'normal');
    await Promise.resolve();
    await coordinator.restart();
    expect(contexts[0]?.sources).toHaveLength(0);
    fetchGate.resolve(new ArrayBuffer(8));
    await preparing;
    await coordinator.restart();
    expect(contexts[0]?.sources).toHaveLength(0);
    await coordinator.markGameplayReady();
    expect(contexts[0]?.sources).toHaveLength(1);
  });

  it('exposes context resume failure without starting and allows a new preparation', async () => {
    const h = harness();
    const failedContext = new TestContext();
    failedContext.resumeError = new Error('gesture was rejected');
    const contexts = [failedContext, new TestContext()];
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => contexts.shift() ?? new TestContext(),
      fetchAudio: async () => new ArrayBuffer(8),
    });
    const failed = await coordinator.prepare(h.song, 'normal');
    expect(failed.error).toBe('gesture was rejected');
    await coordinator.markGameplayReady();
    expect(failedContext.sources).toHaveLength(0);

    await coordinator.prepare(h.song, 'normal');
    await coordinator.markGameplayReady();
    expect(coordinator.snapshot().error).toBeNull();
  });

  it('keeps renderer recovery paused until explicit resume or restart', async () => {
    const h = harness();
    let rendererFails = true;
    const context = new TestContext();
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => context,
      fetchAudio: async () => new ArrayBuffer(8),
      render() {
        if (rendererFails) throw new Error('renderer unavailable');
      },
    });
    await coordinator.prepare(h.song, 'normal');
    const failedStart = await coordinator.markGameplayReady();
    expect(failedStart).toMatchObject({
      gameplayReady: false,
      recoveryRequired: true,
    });
    expect(failedStart.error).toContain('renderer unavailable');
    expect(context.sources[0]?.buffer).toBeNull();
    expect(failedStart.controller?.audio.status).toBe('paused');

    await coordinator.markGameplayReady();
    expect(coordinator.snapshot()).toMatchObject({
      gameplayReady: true,
      recoveryRequired: true,
    });
    expect(context.sources).toHaveLength(1);
    expect(coordinator.snapshot().controller?.audio.status).toBe('paused');

    await coordinator.resume();
    expect(coordinator.snapshot()).toMatchObject({
      gameplayReady: false,
      recoveryRequired: true,
      controller: { audio: { status: 'paused' } },
    });
    expect(context.sources[1]?.buffer).toBeNull();

    rendererFails = false;
    await coordinator.markGameplayReady();
    expect(context.sources).toHaveLength(2);
    await coordinator.resume();
    expect(context.sources[2]?.buffer).not.toBeNull();
    context.currentTime = 4;
    coordinator.update();
    const progress = coordinator.snapshot().controller?.game.notes;
    expect(progress?.some((note) => note.outcome !== null)).toBe(true);

    rendererFails = true;
    coordinator.update();
    const pausedProgress = coordinator.snapshot().controller?.game.notes;
    expect(coordinator.snapshot()).toMatchObject({
      gameplayReady: false,
      recoveryRequired: true,
      controller: { audio: { status: 'paused' } },
    });
    expect(context.sources[2]?.buffer).toBeNull();

    rendererFails = false;
    await coordinator.markGameplayReady();
    expect(coordinator.snapshot()).toMatchObject({
      gameplayReady: true,
      recoveryRequired: true,
    });
    expect(context.sources).toHaveLength(3);
    expect(coordinator.snapshot().controller?.game.notes).toEqual(
      pausedProgress,
    );

    await coordinator.resume();
    expect(context.sources[3]?.buffer).not.toBeNull();
    expect(coordinator.snapshot().controller?.game.notes).toEqual(
      pausedProgress,
    );
    expect(coordinator.snapshot().recoveryRequired).toBe(false);

    rendererFails = true;
    const failedRestart = await coordinator.restart();
    expect(failedRestart).toMatchObject({
      gameplayReady: false,
      recoveryRequired: true,
      controller: { audio: { status: 'paused' } },
    });
    expect(context.sources[4]?.buffer).toBeNull();
    expect(
      failedRestart.controller?.game.notes.every(
        (note) => note.outcome === null,
      ),
    ).toBe(true);

    rendererFails = false;
    await coordinator.markGameplayReady();
    expect(coordinator.snapshot()).toMatchObject({
      gameplayReady: true,
      recoveryRequired: true,
    });
    expect(context.sources).toHaveLength(5);

    await coordinator.restart();
    expect(context.sources[5]?.buffer).not.toBeNull();
    expect(
      coordinator
        .snapshot()
        .controller?.game.notes.every((note) => note.outcome === null),
    ).toBe(true);
    expect(coordinator.snapshot().recoveryRequired).toBe(false);
  });

  it('restarts with the same decoded recording and a fresh game state', async () => {
    const h = harness();
    await h.coordinator.prepare(h.song, 'normal');
    expect(h.coordinator).not.toHaveProperty('controller');
    expect(h.coordinator).not.toHaveProperty('input');
    expect(h.coordinator.snapshot().difficulty).toBe('normal');
    await h.coordinator.restart();
    expect(h.contexts[0]?.sources).toHaveLength(0);
    await h.coordinator.markGameplayReady();
    const context = h.contexts[0];
    if (context === undefined) throw new Error('Expected an audio context.');
    const initial = h.coordinator.snapshot().controller?.game;
    if (initial === undefined)
      throw new Error('Expected a selected game snapshot.');
    context.currentTime = 4;
    h.coordinator.update();
    expect(
      h.coordinator
        .snapshot()
        .controller?.game.notes.some((note) => note.outcome !== null),
    ).toBe(true);

    await h.coordinator.restart();
    expect(
      h.coordinator
        .snapshot()
        .controller?.game.notes.every((note) => note.outcome === null),
    ).toBe(true);
    expect(h.coordinator.snapshot().difficulty).toBe('normal');
    expect(h.coordinator.snapshot().controller?.selectedDifficulty).toBe(
      'normal',
    );
    expect(context.decodeCalls).toBe(1);
    expect(context.sources).toHaveLength(2);
    expect(initial.notes.every((note) => note.outcome === null)).toBe(true);
  });

  it('stops scheduled countdown playback and releases its source when returning', async () => {
    const h = harness();
    await h.coordinator.prepare(h.song, 'normal');
    await h.coordinator.markGameplayReady();
    const context = h.contexts[0];
    if (context === undefined) throw new Error('Expected an audio context.');
    const source = context.sources[0];
    if (source === undefined) throw new Error('Expected a scheduled source.');
    expect(source.starts).toBe(1);
    expect(source.buffer).not.toBeNull();

    await h.coordinator.returnToBrowser();
    expect(source.buffer).toBeNull();
    expect(h.coordinator.snapshot()).toMatchObject({
      songId: null,
      controller: null,
    });
  });

  it('does not begin new playback until an old context has finished closing', async () => {
    const h = harness();
    const closeGate = deferred<void>();
    const firstContext = new TestContext();
    firstContext.closeGate = closeGate.promise;
    const secondContext = new TestContext();
    const contexts = [firstContext, secondContext];
    const coordinator = createPerformanceCoordinator({
      createAudioContext: () => contexts.shift() ?? new TestContext(),
      fetchAudio: async () => new ArrayBuffer(8),
    });
    await coordinator.prepare(h.song, 'normal');
    const returning = coordinator.returnToBrowser();
    const nextPreparation = coordinator.prepare(h.song, 'normal');
    await nextPreparation;
    const ready = coordinator.markGameplayReady();
    const restart = coordinator.restart();
    expect(contexts).toHaveLength(0);
    expect(secondContext.sources).toHaveLength(0);
    closeGate.resolve(undefined);
    await returning;
    await ready;
    await restart;
    expect(coordinator.snapshot().controller?.audio.status).toBe('starting');
    expect(secondContext.sources).toHaveLength(1);
  });
});
