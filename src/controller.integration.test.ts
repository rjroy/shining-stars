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

  start(): void {}

  stop(): void {}

  disconnect(): void {}
}

class TestContext
  extends EventTarget
  implements AudioContextPort<TestBuffer, TestSource>
{
  currentTime = 0;
  state = 'suspended';

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
    return new TestSource();
  }
}

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 10,
  twilightAt: 5,
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
});
