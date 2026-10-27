import type {
  AudioBufferPort,
  AudioContextPort,
  AudioSourcePort,
} from './audio';

export type DestinationAudioSource<
  TBuffer extends AudioBufferPort,
  TDestination,
> = AudioSourcePort<TBuffer> & {
  connect(destination: TDestination): unknown;
};

export interface NativeAudioContextPort<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer> & {
    connect(destination: TOutput): unknown;
  },
  TDestination,
  TOutput extends {
    readonly gain: {
      value: number;
      cancelScheduledValues(startTime: number): unknown;
      setTargetAtTime(
        target: number,
        startTime: number,
        timeConstant: number,
      ): unknown;
    };
    connect(destination: TDestination): unknown;
  },
> extends AudioContextPort<TBuffer, TSource> {
  readonly destination: TDestination;
  createGain(): TOutput;
}

export interface BrowserAudioContextAdapter<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
> extends AudioContextPort<TBuffer, TSource> {
  setOutputVolume(volume: number): void;
}

/** Adapt a browser-like context to the transport's injectable audio ports. */
export function createBrowserAudioContextAdapter<
  TBuffer extends AudioBufferPort,
  TDestination,
  TOutput extends {
    readonly gain: {
      value: number;
      cancelScheduledValues(startTime: number): unknown;
      setTargetAtTime(
        target: number,
        startTime: number,
        timeConstant: number,
      ): unknown;
    };
    connect(destination: TDestination): unknown;
  },
  TSource extends AudioSourcePort<TBuffer> & {
    connect(destination: TOutput): unknown;
  },
>(
  nativeContext: NativeAudioContextPort<
    TBuffer,
    TSource,
    TDestination,
    TOutput
  >,
  initialOutputVolume = 1,
): BrowserAudioContextAdapter<TBuffer, TSource> {
  if (
    !Number.isFinite(initialOutputVolume) ||
    initialOutputVolume < 0 ||
    initialOutputVolume > 1
  ) {
    throw new RangeError('Song output volume must be between 0 and 1.');
  }
  const outputVolumeTimeConstant = 0.03;
  const output = nativeContext.createGain();
  output.gain.value = initialOutputVolume;
  output.connect(nativeContext.destination);
  return {
    setOutputVolume: (volume) => {
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new RangeError('Song output volume must be between 0 and 1.');
      }
      const now = nativeContext.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setTargetAtTime(volume, now, outputVolumeTimeConstant);
    },
    get currentTime() {
      return nativeContext.currentTime;
    },
    get state() {
      return nativeContext.state;
    },
    resume: () => nativeContext.resume(),
    close: () => nativeContext.close(),
    decodeAudioData: (audioData) => nativeContext.decodeAudioData(audioData),
    createBufferSource: () => {
      const source = nativeContext.createBufferSource();
      source.connect(output);
      return source;
    },
    addEventListener: (type, listener, options) =>
      nativeContext.addEventListener(type, listener, options),
    removeEventListener: (type, listener, options) =>
      nativeContext.removeEventListener(type, listener, options),
    dispatchEvent: (event) => nativeContext.dispatchEvent(event),
  };
}
