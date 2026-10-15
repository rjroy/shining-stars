export interface AudioBufferPort {
  readonly duration: number;
}

export interface AudioSourcePort<
  TBuffer extends AudioBufferPort,
> extends EventTarget {
  buffer: TBuffer | null;
  start(when: number, offset: number, duration: number): void;
  stop(when?: number): void;
  disconnect(): void;
}

export interface AudioContextPort<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
> extends EventTarget {
  readonly currentTime: number;
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(audioData: ArrayBuffer): Promise<TBuffer>;
  createBufferSource(): TSource;
}

export interface AudioTransportConfig {
  readonly sourceUrl: string;
  readonly sourceStart: number;
  readonly duration: number;
}

export type AudioTransportStatus =
  'loading' | 'ready' | 'starting' | 'playing' | 'paused' | 'results' | 'error';

export interface AudioTransportSnapshot {
  readonly status: AudioTransportStatus;
  readonly position: number;
  readonly duration: number;
  readonly scheduledWhen: number | null;
  readonly hasActiveSource: boolean;
  /** True once the source buffer has decoded successfully and remains reusable. */
  readonly loaded: boolean;
  readonly disposed: boolean;
  readonly error: string | null;
}

export type AudioLogOperation =
  | 'fetch'
  | 'decode'
  | 'duration-validation'
  | 'context-resume'
  | 'source-schedule'
  | 'source-stop'
  | 'state-transition';

export interface AudioLogEntry {
  readonly operation: AudioLogOperation;
  readonly outcome: 'attempt' | 'success' | 'failure';
  readonly position?: number;
  readonly epoch?: number;
  readonly trigger?: string;
  readonly fromStatus?: AudioTransportStatus;
  readonly toStatus?: AudioTransportStatus;
}

export interface AudioTransportDependencies<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
> {
  readonly context: AudioContextPort<TBuffer, TSource>;
  readonly fetchAudio: (
    sourceUrl: string,
    signal?: AbortSignal,
  ) => Promise<ArrayBuffer>;
  readonly log?: (entry: AudioLogEntry) => void;
}

export interface AudioTransport {
  snapshot(): AudioTransportSnapshot;
  load(): Promise<AudioTransportSnapshot>;
  /** Abort an in-flight fetch and invalidate any decode already underway. */
  cancelLoad(): AudioTransportSnapshot;
  start(): Promise<AudioTransportSnapshot>;
  resume(): Promise<AudioTransportSnapshot>;
  pause(): AudioTransportSnapshot;
  restart(): Promise<AudioTransportSnapshot>;
  update(): AudioTransportSnapshot;
  dispose(): Promise<void>;
}

interface ActiveSource<TSource> {
  readonly source: TSource;
  readonly epoch: number;
  readonly scheduledEnd: number;
  intentional: boolean;
  endedListener: EventListener;
}

const COUNTDOWN_SECONDS = 2;
const MAX_INPUT_TIME_ULPS = 8;

function compareClockValues(left: number, right: number): -1 | 0 | 1 {
  const difference = left - right;
  const precision =
    Number.EPSILON *
    MAX_INPUT_TIME_ULPS *
    Math.max(1, Math.abs(left), Math.abs(right));

  if (Math.abs(difference) <= precision) {
    return 0;
  }

  return difference < 0 ? -1 : 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Create a reusable decoded excerpt transport backed by an injected Web Audio context. */
export function createAudioTransport<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
>(
  config: AudioTransportConfig,
  dependencies: AudioTransportDependencies<TBuffer, TSource>,
): AudioTransport {
  const { context } = dependencies;
  let status: AudioTransportStatus = 'loading';
  let position = 0;
  let scheduledWhen: number | null = null;
  let scheduledPosition = 0;
  let activeSource: ActiveSource<TSource> | null = null;
  let decodedBuffer: TBuffer | null = null;
  let error: string | null = null;
  let disposed = false;
  let playbackEpoch = 0;
  let pendingResumeEpoch: number | null = null;
  let loadEpoch = 0;
  let loadPromise: Promise<AudioTransportSnapshot> | null = null;
  let loadAbortController: AbortController | null = null;
  let disposePromise: Promise<void> | null = null;

  function log(entry: AudioLogEntry): void {
    try {
      dependencies.log?.({
        ...entry,
        epoch: entry.epoch ?? playbackEpoch,
        position: entry.position ?? position,
      });
    } catch {
      // Logging must not interrupt the audio transport.
    }
  }

  function transition(nextStatus: AudioTransportStatus, trigger: string): void {
    if (status === nextStatus) {
      return;
    }

    const previousStatus = status;
    status = nextStatus;
    log({
      operation: 'state-transition',
      outcome: 'success',
      trigger,
      fromStatus: previousStatus,
      toStatus: nextStatus,
    });
  }

  function clampPosition(value: number): number {
    return Math.max(0, Math.min(config.duration, value));
  }

  function positionAtCurrentTime(): number {
    if (scheduledWhen === null) {
      return position;
    }

    return clampPosition(
      scheduledPosition + Math.max(0, context.currentTime - scheduledWhen),
    );
  }

  function snapshot(): AudioTransportSnapshot {
    const currentPosition =
      status === 'playing' && context.state === 'running'
        ? positionAtCurrentTime()
        : position;

    return {
      status,
      position: currentPosition,
      duration: config.duration,
      scheduledWhen,
      hasActiveSource: activeSource !== null,
      loaded: decodedBuffer !== null,
      disposed,
      error,
    };
  }

  function detachSource(record: ActiveSource<TSource>): void {
    record.intentional = true;
    if (activeSource === record) {
      activeSource = null;
    }
    record.source.removeEventListener('ended', record.endedListener);
  }

  function disconnectSource(record: ActiveSource<TSource>): void {
    record.source.buffer = null;
    try {
      record.source.disconnect();
    } catch {
      // A disconnected or already-ended source needs no further recovery.
    }
  }

  function stopActiveSource(): string | null {
    const record = activeSource;
    if (record === null) {
      return null;
    }

    detachSource(record);
    log({ operation: 'source-stop', outcome: 'attempt' });
    let stopError: string | null = null;
    try {
      record.source.stop();
      log({ operation: 'source-stop', outcome: 'success' });
    } catch (stopFailure) {
      stopError = errorMessage(stopFailure);
      log({ operation: 'source-stop', outcome: 'failure' });
    } finally {
      disconnectSource(record);
    }

    return stopError;
  }

  function completeAtEnd(record?: ActiveSource<TSource>): void {
    if (record !== undefined) {
      detachSource(record);
      disconnectSource(record);
    }
    position = config.duration;
    scheduledWhen = null;
    scheduledPosition = position;
    error = null;
    transition('results', 'excerpt-ended');
  }

  function failPlayback(message: string, trigger: string): void {
    playbackEpoch += 1;
    const stopError = stopActiveSource();
    scheduledWhen = null;
    error =
      stopError === null
        ? message
        : `${message} Source cleanup failed: ${stopError}`;
    transition('error', trigger);
  }

  function handleSourceEnded(record: ActiveSource<TSource>): void {
    if (
      disposed ||
      record.intentional ||
      activeSource !== record ||
      record.epoch !== playbackEpoch
    ) {
      return;
    }

    if (compareClockValues(context.currentTime, record.scheduledEnd) >= 0) {
      completeAtEnd(record);
      return;
    }

    position = positionAtCurrentTime();
    failPlayback(
      'Audio source ended before the excerpt finished.',
      'early-source-end',
    );
  }

  function handleContextStateChange(): void {
    if (disposed || context.state === 'running') {
      return;
    }

    if (status !== 'starting' && status !== 'playing') {
      return;
    }
    if (
      context.state === 'suspended' &&
      status === 'starting' &&
      pendingResumeEpoch === playbackEpoch
    ) {
      return;
    }

    playbackEpoch += 1;
    if (
      status === 'playing' ||
      (scheduledWhen !== null && context.currentTime >= scheduledWhen)
    ) {
      position = positionAtCurrentTime();
    }
    scheduledPosition = position;
    scheduledWhen = null;
    const stopError = stopActiveSource();

    if (context.state === 'closed') {
      error = stopError ?? 'Audio context closed unexpectedly.';
      transition('error', 'context-closed');
    } else {
      error = stopError;
      transition('paused', 'context-suspended');
    }
  }

  const contextStateListener: EventListener = () => {
    handleContextStateChange();
  };
  context.addEventListener('statechange', contextStateListener);

  async function performLoad(
    requestEpoch: number,
    abortController: AbortController,
  ): Promise<AudioTransportSnapshot> {
    let operation: 'fetch' | 'decode' | 'duration-validation' = 'fetch';
    try {
      if (disposed || requestEpoch !== loadEpoch) {
        return snapshot();
      }

      log({ operation: 'fetch', outcome: 'attempt' });
      const audioData = await dependencies.fetchAudio(
        config.sourceUrl,
        abortController.signal,
      );
      log({ operation: 'fetch', outcome: 'success' });
      if (disposed || requestEpoch !== loadEpoch) {
        return snapshot();
      }

      operation = 'decode';
      log({ operation, outcome: 'attempt' });
      const buffer = await context.decodeAudioData(audioData);
      log({ operation, outcome: 'success' });
      if (disposed || requestEpoch !== loadEpoch) {
        return snapshot();
      }

      operation = 'duration-validation';
      log({ operation, outcome: 'attempt' });
      const requiredSourceEnd = config.sourceStart + config.duration;
      if (
        !Number.isFinite(buffer.duration) ||
        buffer.duration < requiredSourceEnd
      ) {
        throw new Error(
          `Decoded audio duration ${buffer.duration}s is shorter than the requested source interval ending at ${requiredSourceEnd}s.`,
        );
      }
      log({ operation, outcome: 'success' });

      decodedBuffer = buffer;
      position = 0;
      scheduledPosition = 0;
      error = null;
      transition('ready', 'audio-loaded');
      return snapshot();
    } catch (loadFailure) {
      const message = errorMessage(loadFailure);
      log({ operation, outcome: 'failure' });
      if (disposed || requestEpoch !== loadEpoch) {
        return snapshot();
      }
      error = message;
      transition('error', `${operation}-failed`);
      throw loadFailure;
    } finally {
      if (requestEpoch === loadEpoch) {
        loadPromise = null;
        loadAbortController = null;
      }
    }
  }

  function load(): Promise<AudioTransportSnapshot> {
    if (disposed) {
      return Promise.resolve(snapshot());
    }
    if (decodedBuffer !== null) {
      return Promise.resolve(snapshot());
    }
    if (loadPromise !== null) {
      return loadPromise;
    }

    loadEpoch += 1;
    const requestEpoch = loadEpoch;
    error = null;
    transition('loading', 'load-requested');
    const abortController = new AbortController();
    loadAbortController = abortController;
    const pending = Promise.resolve().then(() =>
      performLoad(requestEpoch, abortController),
    );
    loadPromise = pending;
    return pending;
  }

  function cancelLoad(): AudioTransportSnapshot {
    if (loadPromise === null || disposed) return snapshot();
    loadEpoch += 1;
    loadPromise = null;
    loadAbortController?.abort();
    loadAbortController = null;
    error = null;
    if (status === 'loading') transition('paused', 'load-cancelled');
    return snapshot();
  }

  function finishExpectedSource(record: ActiveSource<TSource>): void {
    if (activeSource !== record || record.intentional) {
      return;
    }
    completeAtEnd(record);
  }

  function update(): AudioTransportSnapshot {
    if (disposed || (status !== 'starting' && status !== 'playing')) {
      return snapshot();
    }

    if (context.state !== 'running') {
      handleContextStateChange();
      return snapshot();
    }

    if (!Number.isFinite(context.currentTime)) {
      failPlayback('Audio context time is not finite.', 'invalid-context-time');
      return snapshot();
    }

    if (status === 'starting') {
      if (scheduledWhen === null) {
        return snapshot();
      }
      if (context.currentTime < scheduledWhen) {
        return snapshot();
      }
      transition('playing', 'scheduled-audio-start');
    }

    const record = activeSource;
    if (
      record !== null &&
      compareClockValues(context.currentTime, record.scheduledEnd) >= 0
    ) {
      finishExpectedSource(record);
      return snapshot();
    }

    position = positionAtCurrentTime();
    return snapshot();
  }

  function validateOperationTime(): void {
    if (!Number.isFinite(context.currentTime) || context.currentTime < 0) {
      throw new RangeError(
        'Audio context time must be finite and non-negative.',
      );
    }
  }

  async function beginPlayback(
    savedPosition: number,
    trigger: 'start' | 'resume' | 'restart',
  ): Promise<AudioTransportSnapshot> {
    if (disposed) {
      return snapshot();
    }
    if (decodedBuffer === null) {
      throw new Error('Audio must be loaded before playback can start.');
    }

    playbackEpoch += 1;
    const requestEpoch = playbackEpoch;
    const stopError = stopActiveSource();
    if (stopError !== null) {
      error = `Could not stop the previous audio source: ${stopError}`;
      transition('error', 'source-replacement-failed');
      return snapshot();
    }

    position = clampPosition(savedPosition);
    scheduledPosition = position;
    scheduledWhen = null;
    error = null;
    transition('starting', trigger);

    log({ operation: 'context-resume', outcome: 'attempt' });
    pendingResumeEpoch = requestEpoch;
    try {
      await context.resume();
    } catch (resumeFailure) {
      if (pendingResumeEpoch === requestEpoch) {
        pendingResumeEpoch = null;
      }
      const message = errorMessage(resumeFailure);
      log({ operation: 'context-resume', outcome: 'failure' });
      if (disposed || requestEpoch !== playbackEpoch || status !== 'starting') {
        return snapshot();
      }
      failPlayback(message, 'context-resume-failed');
      throw resumeFailure;
    }

    if (pendingResumeEpoch === requestEpoch) {
      pendingResumeEpoch = null;
    }
    if (disposed || requestEpoch !== playbackEpoch || status !== 'starting') {
      return snapshot();
    }

    if (context.state !== 'running') {
      log({ operation: 'context-resume', outcome: 'failure' });
      scheduledWhen = null;
      scheduledPosition = position;
      error = 'Audio context did not enter the running state.';
      transition('paused', 'context-not-running');
      return snapshot();
    }

    log({ operation: 'context-resume', outcome: 'success' });
    try {
      validateOperationTime();
    } catch (timeFailure) {
      failPlayback(errorMessage(timeFailure), 'invalid-context-time');
      throw timeFailure;
    }

    if (position >= config.duration) {
      position = config.duration;
      transition('results', 'excerpt-already-ended');
      return snapshot();
    }

    const when = context.currentTime + COUNTDOWN_SECONDS;
    const remainingDuration = config.duration - position;
    log({ operation: 'source-schedule', outcome: 'attempt' });
    let record: ActiveSource<TSource> | null = null;
    try {
      const source = context.createBufferSource();
      const activeRecord: ActiveSource<TSource> = {
        source,
        epoch: requestEpoch,
        scheduledEnd: when + remainingDuration,
        intentional: false,
        endedListener: () => undefined,
      };
      activeRecord.endedListener = () => handleSourceEnded(activeRecord);
      record = activeRecord;
      source.buffer = decodedBuffer;
      activeSource = record;
      scheduledWhen = when;
      scheduledPosition = position;
      source.addEventListener('ended', record.endedListener);
      source.start(when, config.sourceStart + position, remainingDuration);
      log({ operation: 'source-schedule', outcome: 'success' });
    } catch (scheduleFailure) {
      log({ operation: 'source-schedule', outcome: 'failure' });
      if (record !== null) {
        detachSource(record);
        try {
          record.source.stop();
        } catch {
          // Cleanup remains best-effort after a source failed to schedule.
        }
        disconnectSource(record);
      }
      scheduledWhen = null;
      error = errorMessage(scheduleFailure);
      transition('error', 'source-schedule-failed');
      throw scheduleFailure;
    }

    return snapshot();
  }

  function pause(): AudioTransportSnapshot {
    if (disposed || status === 'results') {
      return snapshot();
    }

    playbackEpoch += 1;
    if (
      status === 'playing' ||
      (status === 'starting' &&
        scheduledWhen !== null &&
        context.currentTime >= scheduledWhen)
    ) {
      position = positionAtCurrentTime();
    }
    scheduledPosition = position;
    scheduledWhen = null;
    const stopError = stopActiveSource();
    error = stopError;
    transition(stopError === null ? 'paused' : 'error', 'explicit-pause');
    return snapshot();
  }

  async function start(): Promise<AudioTransportSnapshot> {
    if (disposed) {
      return snapshot();
    }
    if (status !== 'ready') {
      throw new Error('Audio transport must be ready before start.');
    }
    return beginPlayback(0, 'start');
  }

  async function resume(): Promise<AudioTransportSnapshot> {
    if (disposed) {
      return snapshot();
    }
    if (status !== 'paused') {
      throw new Error('Audio transport must be paused before resume.');
    }
    return beginPlayback(position, 'resume');
  }

  async function restart(): Promise<AudioTransportSnapshot> {
    if (disposed) {
      return snapshot();
    }

    playbackEpoch += 1;
    const requestEpoch = playbackEpoch;
    const stopError = stopActiveSource();
    scheduledWhen = null;
    position = 0;
    scheduledPosition = 0;
    error = stopError;

    if (stopError !== null) {
      transition('error', 'restart-stop-failed');
      return snapshot();
    }

    if (decodedBuffer === null) {
      try {
        await load();
      } catch {
        return snapshot();
      }
      if (
        disposed ||
        requestEpoch !== playbackEpoch ||
        decodedBuffer === null
      ) {
        return snapshot();
      }
    } else {
      transition('ready', 'restart-reset');
    }

    if (disposed || requestEpoch !== playbackEpoch) {
      return snapshot();
    }
    return beginPlayback(0, 'restart');
  }

  function dispose(): Promise<void> {
    if (disposePromise !== null) {
      return disposePromise;
    }

    disposed = true;
    playbackEpoch += 1;
    loadEpoch += 1;
    loadAbortController?.abort();
    loadAbortController = null;
    loadPromise = null;
    context.removeEventListener('statechange', contextStateListener);
    scheduledWhen = null;
    const stopError = stopActiveSource();
    decodedBuffer = null;
    error = stopError;
    if (status !== 'results' && status !== 'error') {
      transition('paused', 'dispose');
    }

    disposePromise = Promise.resolve().then(() => context.close());
    return disposePromise;
  }

  return {
    snapshot,
    load,
    cancelLoad,
    start,
    resume,
    pause,
    restart,
    update,
    dispose,
  };
}
