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
  TSource extends AudioSourcePort<TBuffer>,
  TDestination,
> extends AudioContextPort<TBuffer, TSource> {
  readonly destination: TDestination;
}

/** Adapt a browser-like context to the transport's injectable audio ports. */
export function createBrowserAudioContextAdapter<
  TBuffer extends AudioBufferPort,
  TDestination,
  TSource extends DestinationAudioSource<TBuffer, TDestination>,
>(
  nativeContext: NativeAudioContextPort<TBuffer, TSource, TDestination>,
): AudioContextPort<TBuffer, TSource> {
  return {
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
      source.connect(nativeContext.destination);
      return source;
    },
    addEventListener: (type, listener, options) =>
      nativeContext.addEventListener(type, listener, options),
    removeEventListener: (type, listener, options) =>
      nativeContext.removeEventListener(type, listener, options),
    dispatchEvent: (event) => nativeContext.dispatchEvent(event),
  };
}
