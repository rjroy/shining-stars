import { describe, expect, it } from 'vitest';
import {
  createAudioTransport,
  type AudioBufferPort,
  type AudioContextPort,
  type AudioSourcePort,
} from '../audio/audio';
import { createGameController, type ControllerSnapshot } from './controller';
import type { ChartConfig } from './chart';
import { createGame } from './game';
import { getDifficultyProfile } from './game-balance';

class TestBuffer implements AudioBufferPort {
  constructor(
    readonly duration: number,
    readonly sampleRate = 48_000,
  ) {}
}

class TestSource extends EventTarget implements AudioSourcePort<TestBuffer> {
  buffer: TestBuffer | null = null;
  startCalls = 0;
  stopCalls = 0;

  start(): void {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
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
  nextResumeGate: Promise<void> | null = null;
  readonly sources: TestSource[] = [];

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    const gate = this.nextResumeGate;
    this.nextResumeGate = null;
    if (gate !== null) await gate;
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.dispatchEvent(new Event('statechange'));
  }

  async decodeAudioData(): Promise<TestBuffer> {
    return new TestBuffer(10);
  }

  createBufferSource(): TestSource {
    const source = new TestSource();
    this.sources.push(source);
    return source;
  }
}

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 10,
  twilightAt: 5,
  allowedDifficulties: ['normal'],
  notes: [{ id: 'early-note', time: 0.5, lane: 0 }],
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function cancelWithoutPublishing(
  controller: ReturnType<typeof createGameController>,
): ControllerSnapshot {
  const operation = (
    controller as unknown as {
      pauseWithoutPublishing?: () => ControllerSnapshot;
    }
  ).pauseWithoutPublishing;
  expect(operation).toBeTypeOf('function');
  return operation === undefined
    ? controller.snapshot()
    : operation.call(controller);
}

describe('audio and controller timing integration', () => {
  it('holds the Radiant projection through pause/resume and resets it on restart', async () => {
    const context = new TestContext();
    const { controller } = createIntegrationController(context, [
      { id: 'audience', time: 1, lane: 0 },
      { id: 'twilight-one', time: 3, lane: 0 },
      { id: 'twilight-two', time: 4, lane: 1 },
      { id: 'twilight-three', time: 5, lane: 2 },
      { id: 'twilight-four', time: 6, lane: 3 },
      { id: 'twilight-five', time: 7, lane: 0 },
      { id: 'twilight-six', time: 8, lane: 1 },
    ]);
    await beginPlayback(context, controller);

    context.currentTime = 6;
    controller.keyDown('KeyD');
    controller.keyUp('KeyD');
    context.currentTime = 7;
    controller.update();
    const targetBeforePause = controller.snapshot().game.radiantTarget;
    expect(targetBeforePause).toBe(7);

    context.currentTime = 7.25;
    controller.pause();
    expect(controller.snapshot().game.radiantTarget).toBe(targetBeforePause);
    context.currentTime = 50;
    controller.update();
    expect(controller.snapshot().game.radiantTarget).toBe(targetBeforePause);

    await controller.resume();
    expect(controller.snapshot().game.radiantTarget).toBe(targetBeforePause);
    await controller.restart();
    expect(controller.snapshot().game.radiantTarget).toBe(targetBeforePause);

    await controller.dispose();
  });

  it('judges from fresh audio time on keydown without waiting for an update frame', async () => {
    const context = new TestContext();
    const audio = createAudioTransport(
      {
        sourceUrl: 'synthetic://controller-timing',
        sourceStart: 0,
        duration: 10,
      },
      {
        context,
        fetchAudio: async () => new ArrayBuffer(8),
      },
    );
    const controller = createGameController({
      audio,
      createGame: (inputOffset) => createGame(chart, inputOffset),
    });

    await audio.load();
    await controller.start();

    context.currentTime = 1.9;
    controller.keyDown('KeyD');
    expect(controller.snapshot().game.notes[0]?.outcome).toBeNull();

    controller.keyUp('KeyD');
    context.currentTime = 5.5;
    controller.keyDown('KeyD');

    expect(controller.snapshot().game.notes[0]?.outcome).toBe('perfect');
    expect(controller.snapshot().audio.status).toBe('playing');

    await controller.dispose();
  });

  it('stops playback once at a zero-Renown handoff and keeps pending notes unresolved', async () => {
    const context = new TestContext();
    const { audio, controller } = createIntegrationController(context, [
      { id: 'pending-one', time: 3, lane: 0 },
      { id: 'pending-two', time: 4, lane: 0 },
    ]);
    await beginPlayback(context, controller);
    context.currentTime = 7; // Excerpt-relative transport time 2: Twilight handoff.

    const terminal = controller.update();

    expect(terminal.game.result).toMatchObject({ outcome: 'defeat' });
    expect(terminal.game.notes.map((note) => note.outcome)).toEqual([
      null,
      null,
    ]);
    expect(audio.snapshot().hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(1);

    context.currentTime = 11;
    controller.update();
    controller.keyDown('KeyD');
    controller.pause();
    expect(controller.snapshot().game).toEqual(terminal.game);
    expect(context.sources[0]?.stopCalls).toBe(1);

    await controller.dispose();
  });

  it('continues playback and judging after victory until natural end, then restarts cleanly', async () => {
    const context = new TestContext();
    const profile = getDifficultyProfile('normal');
    const setupCount = Array.from(
      { length: 100 },
      (_, index) => index + 1,
    ).find(
      (count) =>
        Math.ceil((count + 5) * (profile.twilightStrengthPercent / 100)) ===
        count + 1,
    );
    if (setupCount === undefined) {
      throw new Error(
        'Could not construct a pre-victory setup for this profile.',
      );
    }
    const chartNotes: ChartConfig['notes'] = [
      { id: 'audience', time: 1, lane: 0 },
      ...Array.from({ length: setupCount }, (_, index) => ({
        id: `setup-${index}`,
        time: 6.5 - (setupCount - index - 1) * 0.25,
        lane: 0 as const,
      })),
      { id: 'victory-hit', time: 6.75, lane: 0 },
      { id: 'post-victory-hit', time: 7.25, lane: 1 },
      { id: 'post-victory-miss', time: 7.75, lane: 2 },
      { id: 'post-recovery-hit', time: 8.5, lane: 3 },
      { id: 'final-miss', time: 9, lane: 0 },
    ];
    const { audio, controller } = createIntegrationController(
      context,
      chartNotes,
    );
    await beginPlayback(context, controller);

    context.currentTime = 6; // Audience note at transport time 1.
    controller.keyDown('KeyD');
    controller.keyUp('KeyD');
    context.currentTime = 7; // Handoff at transport time 2.
    const handoff = controller.update();
    const expectedInitialStrength = Math.ceil(
      (setupCount + 5) *
        profile.twilight.perfect.damage *
        (profile.twilightStrengthPercent / 100),
    );
    expect(handoff.game.twilightStrength).toBe(expectedInitialStrength);
    for (const setupNote of chartNotes.slice(1, setupCount + 1)) {
      context.currentTime = setupNote.time + 5;
      controller.keyDown('KeyD');
      controller.keyUp('KeyD');
    }
    expect(controller.snapshot().game).toMatchObject({
      victory: false,
      twilightStrength: profile.twilight.perfect.damage,
    });
    context.currentTime = 11.75; // Victory note at transport time 6.75.
    const afterVictory = controller.keyDown('KeyD');

    expect(afterVictory.game).toMatchObject({
      victory: true,
      status: 'playing',
      phase: 'twilight',
      personalStrength: 3,
      result: null,
    });
    expect(audio.snapshot()).toMatchObject({
      status: 'playing',
      hasActiveSource: true,
    });
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.stopCalls).toBe(0);

    controller.keyUp('KeyD');
    context.currentTime = 12.35; // Good post-victory judgment at position 7.35.
    const postVictoryHit = controller.keyDown('KeyF');
    expect(postVictoryHit.game.notes[setupCount + 2]?.outcome).toBe('good');
    expect(postVictoryHit.feedback).toMatchObject([
      { noteId: 'victory-hit', lane: 0, quality: 'perfect' },
      { noteId: 'post-victory-hit', lane: 1, quality: 'good' },
    ]);
    expect(postVictoryHit.game).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 3,
    });
    controller.keyUp('KeyF');

    context.currentTime = 12.901; // Miss the note at position 7.75.
    const postVictoryMiss = controller.update();
    expect(postVictoryMiss.game).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 3,
    });
    expect(postVictoryMiss.game.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'post-victory-hit', outcome: 'good' }),
        expect.objectContaining({ id: 'post-victory-miss', outcome: 'miss' }),
      ]),
    );
    expect(postVictoryMiss.feedback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          noteId: 'post-victory-hit',
          quality: 'good',
        }),
        expect.objectContaining({
          noteId: 'post-victory-miss',
          lane: 2,
          quality: 'miss',
        }),
      ]),
    );
    expect(audio.snapshot()).toMatchObject({
      status: 'playing',
      hasActiveSource: true,
    });
    expect(context.sources[0]?.stopCalls).toBe(0);

    controller.pause();
    expect(controller.snapshot().game).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 3,
    });
    expect(audio.snapshot().status).toBe('paused');
    expect(context.sources[0]?.stopCalls).toBe(1);
    await controller.resume();
    const resumedSchedule = audio.snapshot().scheduledWhen;
    if (resumedSchedule === null)
      throw new Error('Expected a scheduled source after victory resume.');
    context.currentTime = resumedSchedule + (8.6 - audio.snapshot().position);
    const resumedHit = controller.keyDown('KeyK');
    expect(resumedHit.game.notes[setupCount + 4]?.outcome).toBe('good');
    expect(resumedHit.game).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 3,
    });
    controller.keyUp('KeyK');

    // A renderer-loss cancellation pauses without publishing; restoration can
    // resume the victorious run and carry it to the natural audio boundary.
    const cancelledForRecovery = cancelWithoutPublishing(controller);
    expect(cancelledForRecovery.audio.status).toBe('paused');
    expect(cancelledForRecovery.game).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 3,
    });
    expect(context.sources[1]?.stopCalls).toBe(1);
    await controller.resume();
    const recoveredSchedule = audio.snapshot().scheduledWhen;
    if (recoveredSchedule === null)
      throw new Error('Expected a scheduled source after renderer recovery.');
    context.currentTime = recoveredSchedule + (10 - audio.snapshot().position);
    const completed = controller.update();

    expect(completed.game).toMatchObject({
      victory: true,
      phase: 'twilight',
      status: 'results',
      personalStrength: 3,
      result: {
        outcome: 'victory',
        personalStrength: 3,
        twilight: { perfect: setupCount + 1, good: 2, miss: 2 },
      },
    });
    expect(completed.audio).toMatchObject({
      status: 'results',
      hasActiveSource: false,
    });
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2]?.stopCalls).toBe(0);

    const restarted = await controller.restart();
    expect(restarted.game).toMatchObject({
      victory: false,
      status: 'playing',
      renown: 0,
      personalStrength: 0,
      notes: chartNotes.map(({ id }) => ({ id, outcome: null })),
    });
    expect(restarted.audio.hasActiveSource).toBe(true);
    expect(context.sources).toHaveLength(4);
    expect(context.sources[3]?.startCalls).toBe(1);
    expect(context.sources[2]?.stopCalls).toBe(0);

    await controller.dispose();
  });

  it('stops playback once when a Twilight miss causes defeat during delayed update', async () => {
    const context = new TestContext();
    const { audio, controller } = createIntegrationController(context, [
      { id: 'audience', time: 1, lane: 0 },
      { id: 'miss', time: 3, lane: 0 },
      { id: 'pending', time: 4, lane: 0 },
    ]);
    await beginPlayback(context, controller);

    context.currentTime = 6;
    controller.keyDown('KeyD');
    controller.keyUp('KeyD');
    context.currentTime = 7;
    controller.update();
    context.currentTime = 8.151; // Past the 150 ms miss deadline at position 3.
    const terminal = controller.update();

    expect(terminal.game.result).toMatchObject({ outcome: 'defeat' });
    expect(terminal.game.notes.map((note) => note.outcome)).toEqual([
      'perfect',
      'miss',
      null,
    ]);
    expect(audio.snapshot().hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(1);

    context.currentTime = 10;
    controller.update();
    controller.keyDown('KeyD');
    controller.pause();
    expect(controller.snapshot().game).toEqual(terminal.game);
    expect(context.sources[0]?.stopCalls).toBe(1);

    await controller.dispose();
  });

  it('keeps natural excerpt completion distinct from early combat stopping', async () => {
    const context = new TestContext();
    const { controller } = createIntegrationController(context, [
      { id: 'audience', time: 1, lane: 0 },
    ]);
    await beginPlayback(context, controller);

    context.currentTime = 6;
    controller.keyDown('KeyD');
    context.currentTime = 15; // Natural end at excerpt position 10.
    const completed = controller.update();

    expect(completed.game.result).toMatchObject({ outcome: 'survived' });
    expect(completed.audio.status).toBe('results');
    expect(completed.audio.hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(0);

    await controller.dispose();
  });

  it('does not start audio when a pending load completes after silent cancellation', async () => {
    const context = new TestContext();
    const fetch = deferred<ArrayBuffer>();
    const { audio, controller, rendered } = createIntegrationController(
      context,
      [{ id: 'pending-load-note', time: 1, lane: 0 }],
      () => fetch.promise,
    );
    const pendingStart = controller.start();
    await Promise.resolve();
    expect(audio.snapshot().status).toBe('loading');
    const pendingSnapshot = controller.snapshot() as ControllerSnapshot & {
      readonly pendingPlaybackRequests?: boolean;
      readonly audio: ControllerSnapshot['audio'] & {
        readonly loaded?: boolean;
      };
    };
    expect(pendingSnapshot.pendingPlaybackRequests).toBe(true);
    expect(pendingSnapshot.audio.loaded).toBe(false);

    const rendersBeforeCancel = rendered.length;
    const cancelled = cancelWithoutPublishing(controller);
    expect(cancelled.audio.status).toBe('loading');
    expect(rendered).toHaveLength(rendersBeforeCancel);
    fetch.resolve(new ArrayBuffer(8));

    const completion = (await pendingStart) as ControllerSnapshot & {
      readonly pendingPlaybackRequests?: boolean;
      readonly audio: ControllerSnapshot['audio'] & {
        readonly loaded?: boolean;
      };
    };

    expect(audio.snapshot().status).toBe('ready');
    expect(
      (
        audio.snapshot() as ControllerSnapshot['audio'] & {
          readonly loaded?: boolean;
        }
      ).loaded,
    ).toBe(true);
    expect(completion.pendingPlaybackRequests).toBe(false);
    expect(completion.audio.loaded).toBe(true);
    expect(controller.snapshot().pendingPlaybackRequests).toBe(false);
    expect(audio.snapshot().hasActiveSource).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(rendered).toHaveLength(rendersBeforeCancel);

    await controller.dispose();
  });

  it.each(['start', 'resume', 'restart'] as const)(
    'silently cancels a pending %s gesture without scheduling or overlapping audio',
    async (action) => {
      const context = new TestContext();
      const { audio, controller, rendered } = createIntegrationController(
        context,
        [{ id: 'pending-action-note', time: 1, lane: 0 }],
      );
      await audio.load();

      if (action === 'resume') {
        await controller.start();
        context.currentTime = 1;
        controller.update();
        controller.pause();
        expect(audio.snapshot().status).toBe('paused');
      }

      const existingSources = context.sources.length;
      const resumesBeforeAction = context.resumeCalls;
      const gesture = deferred<void>();
      context.nextResumeGate = gesture.promise;

      const pendingAction =
        action === 'start'
          ? controller.start()
          : action === 'resume'
            ? controller.resume()
            : controller.restart();
      if (action === 'start') await Promise.resolve();
      expect(context.resumeCalls).toBe(resumesBeforeAction + 1);

      const rendersBeforeCancel = rendered.length;
      const cancelled = cancelWithoutPublishing(controller);
      expect(rendered).toHaveLength(rendersBeforeCancel);
      expect(cancelled.audio.status).toBe('paused');
      expect(cancelled.feedback).toEqual([]);
      expect(audio.snapshot().hasActiveSource).toBe(false);

      gesture.resolve();
      await pendingAction;

      expect(audio.snapshot().status).toBe('paused');
      expect(audio.snapshot().hasActiveSource).toBe(false);
      expect(context.sources).toHaveLength(existingSources);
      expect(
        context.sources.every(
          (source) => source.startCalls === source.stopCalls,
        ),
      ).toBe(true);
      expect(rendered).toHaveLength(rendersBeforeCancel);

      await controller.dispose();
    },
  );

  it('does not resurrect playback when a canceled context-resume gesture rejects', async () => {
    const context = new TestContext();
    const { audio, controller, rendered } = createIntegrationController(
      context,
      [{ id: 'pending-action-note', time: 1, lane: 0 }],
    );
    await audio.load();
    const gesture = deferred<void>();
    context.nextResumeGate = gesture.promise;
    const pendingStart = controller.start();
    await Promise.resolve();
    expect(context.resumeCalls).toBe(1);

    const rendersBeforeCancel = rendered.length;
    const cancelled = cancelWithoutPublishing(controller);
    expect(cancelled.audio.status).toBe('paused');
    expect(rendered).toHaveLength(rendersBeforeCancel);
    gesture.reject(new Error('synthetic gesture rejection after cancellation'));

    await expect(pendingStart).resolves.toMatchObject({
      audio: { status: 'paused', hasActiveSource: false },
      feedback: [],
    });
    expect(context.sources).toHaveLength(0);
    expect(audio.snapshot().status).toBe('paused');
    expect(rendered).toHaveLength(rendersBeforeCancel);

    await controller.dispose();
  });
});

function createIntegrationController(
  context: TestContext,
  notes: ChartConfig['notes'],
  fetchAudio: () => Promise<ArrayBuffer> = async () => new ArrayBuffer(8),
) {
  const chart: ChartConfig = {
    sourceStart: 0,
    duration: 10,
    twilightAt: 2,
    allowedDifficulties: ['normal'],
    notes,
  };
  const audio = createAudioTransport(
    {
      sourceUrl: 'synthetic://combat-lifecycle',
      sourceStart: 0,
      duration: chart.duration,
    },
    {
      context,
      fetchAudio,
    },
  );
  const rendered: ControllerSnapshot[] = [];
  const controller = createGameController({
    audio,
    createGame: (inputOffset) => createGame(chart, inputOffset),
    render: (snapshot) => rendered.push(snapshot),
  });
  return { audio, controller, rendered };
}

async function beginPlayback(
  context: TestContext,
  controller: ReturnType<typeof createGameController>,
): Promise<void> {
  await controller.start();
  context.currentTime = 5;
  controller.update();
  expect(controller.snapshot().audio.status).toBe('playing');
}
