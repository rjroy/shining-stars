import { describe, expect, it } from 'vitest';
import {
  createAudioTransport,
  type AudioBufferPort,
  type AudioContextPort,
  type AudioSourcePort,
} from './audio';
import { createGameController } from './controller';
import type { ChartConfig } from './chart';
import { createGame } from './game';

class TestBuffer implements AudioBufferPort {
  constructor(readonly duration: number) {}
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
  readonly sources: TestSource[] = [];

  async resume(): Promise<void> {
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
  twilightStrength: 100,
  notes: [{ id: 'early-note', time: 0.5, lane: 0 }],
};

describe('audio and controller timing integration', () => {
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
    context.currentTime = 2.5;
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
    context.currentTime = 4; // Excerpt-relative transport time 2: Twilight handoff.

    const terminal = controller.update();

    expect(terminal.game.result).toMatchObject({ outcome: 'defeat' });
    expect(terminal.game.notes.map((note) => note.outcome)).toEqual([
      null,
      null,
    ]);
    expect(audio.snapshot().hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(1);

    context.currentTime = 8;
    controller.update();
    controller.keyDown('KeyD');
    controller.pause();
    expect(controller.snapshot().game).toEqual(terminal.game);
    expect(context.sources[0]?.stopCalls).toBe(1);

    await controller.dispose();
  });

  it('stops once on a synchronous victory press and allows a clean fresh restart', async () => {
    const context = new TestContext();
    const { audio, controller } = createIntegrationController(
      context,
      [
        { id: 'audience', time: 1, lane: 0 },
        { id: 'victory-hit', time: 3, lane: 0 },
        { id: 'pending', time: 4, lane: 0 },
      ],
      3,
    );
    await beginPlayback(context, controller);

    context.currentTime = 3; // Audience note at transport time 1.
    controller.keyDown('KeyD');
    controller.keyUp('KeyD');
    context.currentTime = 4; // Handoff at transport time 2.
    controller.update();
    context.currentTime = 5; // Victory note at transport time 3.
    const terminal = controller.keyDown('KeyD');

    expect(terminal.game.result).toMatchObject({ outcome: 'victory' });
    expect(terminal.game.notes.at(-1)?.outcome).toBeNull();
    expect(audio.snapshot().hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(1);

    context.currentTime = 7;
    controller.update();
    controller.keyUp('KeyD');
    controller.keyDown('KeyD');
    controller.pause();
    expect(controller.snapshot().game).toEqual(terminal.game);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.stopCalls).toBe(1);

    const restarted = await controller.restart();
    expect(restarted.game).toMatchObject({
      status: 'playing',
      renown: 0,
      personalStrength: 0,
      twilightStrength: 3,
      notes: [
        { id: 'audience', outcome: null },
        { id: 'victory-hit', outcome: null },
        { id: 'pending', outcome: null },
      ],
    });
    expect(restarted.audio.hasActiveSource).toBe(true);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1]?.startCalls).toBe(1);
    expect(context.sources[0]?.stopCalls).toBe(1);

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

    context.currentTime = 3;
    controller.keyDown('KeyD');
    controller.keyUp('KeyD');
    context.currentTime = 4;
    controller.update();
    context.currentTime = 5.151; // Past the 150 ms miss deadline at position 3.
    const terminal = controller.update();

    expect(terminal.game.result).toMatchObject({ outcome: 'defeat' });
    expect(terminal.game.notes.map((note) => note.outcome)).toEqual([
      'perfect',
      'miss',
      null,
    ]);
    expect(audio.snapshot().hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(1);

    context.currentTime = 7;
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

    context.currentTime = 3;
    controller.keyDown('KeyD');
    context.currentTime = 12; // Natural end at excerpt position 10.
    const completed = controller.update();

    expect(completed.game.result).toMatchObject({ outcome: 'survived' });
    expect(completed.audio.status).toBe('results');
    expect(completed.audio.hasActiveSource).toBe(false);
    expect(context.sources[0]?.stopCalls).toBe(0);

    await controller.dispose();
  });
});

function createIntegrationController(
  context: TestContext,
  notes: ChartConfig['notes'],
  twilightStrength = 100,
) {
  const chart: ChartConfig = {
    sourceStart: 0,
    duration: 10,
    twilightAt: 2,
    twilightStrength,
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
      fetchAudio: async () => new ArrayBuffer(8),
    },
  );
  const controller = createGameController({
    audio,
    createGame: (inputOffset) => createGame(chart, inputOffset),
  });
  return { audio, controller };
}

async function beginPlayback(
  context: TestContext,
  controller: ReturnType<typeof createGameController>,
): Promise<void> {
  await controller.start();
  context.currentTime = 2;
  controller.update();
  expect(controller.snapshot().audio.status).toBe('playing');
}
