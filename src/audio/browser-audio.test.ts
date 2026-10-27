import { describe, expect, it, vi } from 'vitest';
import type {
  AudioBufferPort,
  AudioContextPort,
  AudioSourcePort,
} from './audio';
import { createBrowserAudioContextAdapter } from './browser-audio';

class FakeBuffer implements AudioBufferPort {
  constructor(
    readonly duration: number,
    readonly sampleRate = 48_000,
  ) {}
}

class FakeDestination {}

class FakeGain extends FakeDestination {
  readonly gain = {
    value: 1,
    cancelScheduledValues: vi.fn<(startTime: number) => void>(),
    setTargetAtTime: vi.fn<(target: number, startTime: number, timeConstant: number) => void>(),
  };
  readonly connections: FakeDestination[] = [];

  connect(destination: FakeDestination): void {
    this.connections.push(destination);
  }
}

class FakeSource extends EventTarget implements AudioSourcePort<FakeBuffer> {
  buffer: FakeBuffer | null = null;
  readonly connections: FakeDestination[] = [];

  connect(destination: FakeDestination): FakeDestination {
    this.connections.push(destination);
    return destination;
  }

  start(): void {}

  stop(): void {}

  disconnect(): void {}
}

class FakeNativeContext
  extends EventTarget
  implements AudioContextPort<FakeBuffer, FakeSource>
{
  currentTime = 0;
  state = 'suspended';
  readonly destination = new FakeDestination();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly decodeInputs: ArrayBuffer[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.setState('running');
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.setState('closed');
  }

  async decodeAudioData(audioData: ArrayBuffer): Promise<FakeBuffer> {
    this.decodeInputs.push(audioData);
    return new FakeBuffer(10);
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  setState(state: string): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

describe('browser audio context adapter', () => {
  it('connects every distinct fresh source to the native destination exactly once', () => {
    const nativeContext = new FakeNativeContext();
    const adapter = createBrowserAudioContextAdapter(nativeContext);

    const first = adapter.createBufferSource();
    const second = adapter.createBufferSource();

    expect(first).not.toBe(second);
    expect(first.connections).toEqual([nativeContext.gains[0]]);
    expect(second.connections).toEqual([nativeContext.gains[0]]);
    expect(nativeContext.gains[0]?.connections).toEqual([
      nativeContext.destination,
    ]);
  });

  it('smoothly applies live output volume changes to the existing gain stage', () => {
    const nativeContext = new FakeNativeContext();
    const adapter = createBrowserAudioContextAdapter(nativeContext, 0);
    expect(nativeContext.gains[0]?.gain.value).toBe(0);

    const first = adapter.createBufferSource();
    expect(first.connections).toEqual([nativeContext.gains[0]]);

    nativeContext.currentTime = 12.5;
    adapter.setOutputVolume(0.4);
    adapter.setOutputVolume(0.7);
    adapter.setOutputVolume(0);

    const gain = nativeContext.gains[0]?.gain;
    expect(gain?.cancelScheduledValues.mock.calls).toEqual([
      [12.5],
      [12.5],
      [12.5],
    ]);
    expect(gain?.setTargetAtTime.mock.calls).toHaveLength(3);
    expect(gain?.setTargetAtTime.mock.calls.map(([target]) => target)).toEqual([
      0.4,
      0.7,
      0,
    ]);
    for (const [, startTime, timeConstant] of gain?.setTargetAtTime.mock.calls ?? []) {
      expect(startTime).toBe(12.5);
      expect(timeConstant).toBeGreaterThan(0);
      expect(timeConstant).toBeLessThanOrEqual(0.1);
    }
    expect(first.connections).toEqual([nativeContext.gains[0]]);
    expect(nativeContext.sources).toHaveLength(1);
  });

  it('delegates decode and lifecycle calls while exposing live clock and state', async () => {
    const nativeContext = new FakeNativeContext();
    const adapter = createBrowserAudioContextAdapter(nativeContext);
    let stateChanges = 0;
    adapter.addEventListener('statechange', () => {
      stateChanges += 1;
    });
    const payload = new ArrayBuffer(8);

    nativeContext.currentTime = 2.5;
    expect(adapter.currentTime).toBe(2.5);
    await adapter.decodeAudioData(payload);
    await adapter.resume();
    expect(adapter.currentTime).toBe(2.5);
    expect(adapter.state).toBe('running');
    await adapter.close();

    expect(nativeContext.decodeInputs).toEqual([payload]);
    expect(nativeContext.resumeCalls).toBe(1);
    expect(nativeContext.closeCalls).toBe(1);
    expect(stateChanges).toBe(2);
    expect(adapter.state).toBe('closed');
  });
});
