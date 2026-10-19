import { describe, expect, it } from 'vitest';
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
  readonly gain = { value: 1 };
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

  it('sets output volume before source connection and preserves it through playback lifecycle', () => {
    const nativeContext = new FakeNativeContext();
    const adapter = createBrowserAudioContextAdapter(nativeContext, 0);
    expect(nativeContext.gains[0]?.gain.value).toBe(0);

    const first = adapter.createBufferSource();
    expect(first.connections).toEqual([nativeContext.gains[0]]);
    expect(nativeContext.gains[0]?.gain.value).toBe(0);

    adapter.setOutputVolume(0.4);
    expect(adapter.createBufferSource().connections).toEqual([
      nativeContext.gains[0],
    ]);
    expect(nativeContext.gains[0]?.gain.value).toBe(0.4);
    adapter.setOutputVolume(0);
    expect(nativeContext.gains[0]?.gain.value).toBe(0);
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
