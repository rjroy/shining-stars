import type { AudioTransport, AudioTransportSnapshot } from './audio';
import { isDifficulty, type Difficulty } from './game-balance';
import type { GameSession, GameSnapshot, PressResult } from './game';

export interface ControllerSnapshot {
  readonly audio: AudioTransportSnapshot;
  readonly game: GameSnapshot;
  readonly inputOffset: number;
  readonly visualOffset: number;
  /** Profile chosen for the next fresh run; a finished run keeps its own profile. */
  readonly selectedDifficulty: Difficulty;
  readonly feedback: ControllerFeedbackEvent | null;
  /** Pending public Start/Resume/Restart operations, including canceled ones. */
  readonly pendingPlaybackRequests: boolean;
}

/** Immutable judgment identity plus the original game press result. */
export interface ControllerFeedbackEvent extends PressResult {
  readonly eventId: number;
  readonly runId: number;
  readonly onsetTransportTime: number;
}

export interface ControllerDependencies {
  readonly audio: AudioTransport;
  readonly createGame: (
    inputOffset: number,
    difficulty?: Difficulty,
  ) => GameSession;
  readonly inputOffset?: number;
  readonly visualOffset?: number;
  readonly render?: (snapshot: ControllerSnapshot) => void;
}

export interface GameController {
  snapshot(): ControllerSnapshot;
  start(): Promise<ControllerSnapshot>;
  resume(): Promise<ControllerSnapshot>;
  restart(): Promise<ControllerSnapshot>;
  selectDifficulty(difficulty: Difficulty): ControllerSnapshot;
  pause(): ControllerSnapshot;
  pauseWithoutPublishing(): ControllerSnapshot;
  blur(): ControllerSnapshot;
  keyDown(code: string, repeat?: boolean): ControllerSnapshot;
  keyUp(code: string): ControllerSnapshot;
  update(): ControllerSnapshot;
  dispose(): Promise<void>;
}

const KEY_LANES: Readonly<Record<string, 0 | 1 | 2 | 3>> = {
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
};

/** Coordinate audio transport, deterministic game state, and an optional renderer. */
export function createGameController(
  dependencies: ControllerDependencies,
): GameController {
  const inputOffset = dependencies.inputOffset ?? 0;
  const visualOffset = dependencies.visualOffset ?? 0;
  let game = dependencies.createGame(inputOffset);
  let selectedDifficulty = game.snapshot().difficulty;
  let feedback: ControllerFeedbackEvent | null = null;
  let eventId = 0;
  let runId = 1;
  const pressedKeys = new Set<string>();
  let controlEpoch = 0;
  let pendingTransportRequests = 0;
  let hasTransportRequestBeenMade = false;
  let pendingRestartEpoch: number | null = null;
  let disposed = false;
  let terminalAudioStopHandled = false;
  let disposePromise: Promise<void> | null = null;

  function snapshot(): ControllerSnapshot {
    return {
      audio: dependencies.audio.snapshot(),
      game: game.snapshot(),
      inputOffset,
      visualOffset,
      selectedDifficulty,
      feedback: feedback === null ? null : { ...feedback },
      pendingPlaybackRequests: pendingTransportRequests > 0,
    };
  }

  function publish(): ControllerSnapshot {
    const current = snapshot();
    if (!disposed) {
      dependencies.render?.(current);
    }
    return current;
  }

  function currentGameTime(audioSnapshot: AudioTransportSnapshot): number {
    const gameTime = game.snapshot().transportTime;
    if (
      !Number.isFinite(audioSnapshot.position) ||
      !Number.isFinite(audioSnapshot.duration) ||
      audioSnapshot.duration < 0
    ) {
      return gameTime;
    }

    return Math.min(
      audioSnapshot.duration,
      Math.max(0, audioSnapshot.position),
    );
  }

  function stopAudioForTerminalGame(): void {
    if (game.snapshot().status !== 'results') return;

    feedback = null;
    pressedKeys.clear();
    if (terminalAudioStopHandled) return;
    terminalAudioStopHandled = true;
    if (dependencies.audio.snapshot().hasActiveSource) {
      dependencies.audio.pause();
    }
  }

  function advanceGame(audioSnapshot: AudioTransportSnapshot): void {
    if (audioSnapshot.status === 'error') {
      feedback = null;
    }
    if (
      game.snapshot().status === 'playing' &&
      (audioSnapshot.status === 'playing' ||
        audioSnapshot.status === 'results' ||
        audioSnapshot.status === 'paused')
    ) {
      game.advanceTo(currentGameTime(audioSnapshot));
    }
    stopAudioForTerminalGame();
  }

  function beginControlAction(): number {
    controlEpoch += 1;
    return controlEpoch;
  }

  function isCurrentAction(epoch: number): boolean {
    return !disposed && epoch === controlEpoch;
  }

  async function start(): Promise<ControllerSnapshot> {
    if (disposed) {
      return snapshot();
    }
    if (game.snapshot().status === 'results') {
      stopAudioForTerminalGame();
      return publish();
    }

    const requestEpoch = beginControlAction();
    hasTransportRequestBeenMade = true;
    pendingTransportRequests += 1;
    pressedKeys.clear();
    feedback = null;
    try {
      const loaded = await dependencies.audio.load();
      if (isCurrentAction(requestEpoch) && loaded.status === 'ready') {
        await dependencies.audio.start();
      }
    } finally {
      pendingTransportRequests -= 1;
    }
    if (!isCurrentAction(requestEpoch)) return snapshot();
    stopAudioForTerminalGame();
    return publish();
  }

  async function resume(): Promise<ControllerSnapshot> {
    if (disposed) {
      return snapshot();
    }
    if (game.snapshot().status === 'results') {
      stopAudioForTerminalGame();
      return publish();
    }

    const requestEpoch = beginControlAction();
    hasTransportRequestBeenMade = true;
    pendingTransportRequests += 1;
    pressedKeys.clear();
    feedback = null;
    try {
      await dependencies.audio.resume();
    } finally {
      pendingTransportRequests -= 1;
    }
    if (!isCurrentAction(requestEpoch)) return snapshot();
    stopAudioForTerminalGame();
    return publish();
  }

  async function restart(): Promise<ControllerSnapshot> {
    if (disposed) {
      return snapshot();
    }

    const requestEpoch = beginControlAction();
    hasTransportRequestBeenMade = true;
    pendingTransportRequests += 1;
    pendingRestartEpoch = requestEpoch;
    pressedKeys.clear();
    feedback = null;
    game = dependencies.createGame(inputOffset, selectedDifficulty);
    runId += 1;
    terminalAudioStopHandled = false;
    try {
      await dependencies.audio.restart();
    } finally {
      pendingTransportRequests -= 1;
      if (pendingRestartEpoch === requestEpoch) {
        pendingRestartEpoch = null;
      }
    }
    if (!isCurrentAction(requestEpoch)) return snapshot();
    return publish();
  }

  function selectDifficulty(difficulty: Difficulty): ControllerSnapshot {
    if (disposed) return snapshot();
    if (!isDifficulty(difficulty)) {
      throw new RangeError(`Unknown difficulty '${String(difficulty)}'.`);
    }
    if (difficulty === selectedDifficulty) return snapshot();

    const gameAtResults = game.snapshot().status === 'results';
    const audioStatus = dependencies.audio.snapshot().status;
    const loadingBeforeAnyRequest =
      audioStatus === 'loading' &&
      !hasTransportRequestBeenMade &&
      pendingTransportRequests === 0;
    if (
      pendingTransportRequests > 0 ||
      (!gameAtResults && audioStatus !== 'ready' && !loadingBeforeAnyRequest)
    ) {
      throw new RangeError(
        'Difficulty can only change while idle or after the run has finished.',
      );
    }

    // Construct first so unknown/disallowed choices cannot partially mutate
    // controller selection or discard the previous idle game.
    const nextGame = dependencies.createGame(inputOffset, difficulty);
    selectedDifficulty = difficulty;
    if (!gameAtResults) {
      game = nextGame;
      runId += 1;
      pressedKeys.clear();
      feedback = null;
    }
    return publish();
  }

  function pause(): ControllerSnapshot {
    if (disposed) {
      return snapshot();
    }

    if (game.snapshot().status === 'results') {
      stopAudioForTerminalGame();
      return publish();
    }

    beginControlAction();
    pressedKeys.clear();
    feedback = null;
    const pausedAudio = dependencies.audio.pause();
    advanceGame(pausedAudio);
    return publish();
  }

  function pauseWithoutPublishing(): ControllerSnapshot {
    if (disposed) {
      return snapshot();
    }

    beginControlAction();
    pressedKeys.clear();
    feedback = null;
    const audioSnapshot = dependencies.audio.snapshot();
    const pausedAudio =
      audioSnapshot.status === 'starting' ||
      audioSnapshot.status === 'playing' ||
      audioSnapshot.hasActiveSource ||
      (audioSnapshot.status === 'loading' && pendingRestartEpoch !== null)
        ? dependencies.audio.pause()
        : audioSnapshot;
    advanceGame(pausedAudio);
    return snapshot();
  }

  function keyDown(code: string, repeat = false): ControllerSnapshot {
    if (disposed) {
      return snapshot();
    }
    if (game.snapshot().status === 'results') {
      stopAudioForTerminalGame();
      return publish();
    }

    const lane = KEY_LANES[code];
    if (lane === undefined || repeat || pressedKeys.has(code)) {
      return snapshot();
    }
    pressedKeys.add(code);

    const audioSnapshot = dependencies.audio.update();
    if (audioSnapshot.status !== 'playing') {
      return publish();
    }

    const transportTime = currentGameTime(audioSnapshot);
    advanceGame(audioSnapshot);
    if (game.snapshot().status === 'playing') {
      const result = game.press(lane, transportTime);
      feedback =
        result === null
          ? null
          : Object.freeze({
              ...result,
              eventId: ++eventId,
              runId,
              onsetTransportTime: transportTime,
            });
      stopAudioForTerminalGame();
    }
    return publish();
  }

  function keyUp(code: string): ControllerSnapshot {
    if (disposed) {
      return snapshot();
    }
    pressedKeys.delete(code);
    return snapshot();
  }

  function update(): ControllerSnapshot {
    if (disposed) {
      return snapshot();
    }
    if (game.snapshot().status === 'results') {
      stopAudioForTerminalGame();
      return publish();
    }

    const audioSnapshot = dependencies.audio.update();
    advanceGame(audioSnapshot);
    return publish();
  }

  function dispose(): Promise<void> {
    if (disposePromise !== null) {
      return disposePromise;
    }

    disposed = true;
    beginControlAction();
    pressedKeys.clear();
    feedback = null;
    disposePromise = dependencies.audio.dispose();
    return disposePromise;
  }

  return {
    snapshot,
    start,
    resume,
    restart,
    selectDifficulty,
    pause,
    pauseWithoutPublishing,
    blur: pause,
    keyDown,
    keyUp,
    update,
    dispose,
  };
}
