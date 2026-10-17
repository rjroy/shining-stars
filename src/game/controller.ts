import type { AudioTransport, AudioTransportSnapshot } from '../audio/audio';
import { isDifficulty, type Difficulty } from './game-balance';
import type { GameSession, GameSnapshot } from './game';

export interface ControllerSnapshot {
  readonly runId?: number;
  readonly audio: AudioTransportSnapshot;
  readonly game: GameSnapshot;
  readonly inputOffset: number;
  readonly visualOffset: number;
  /** Profile chosen for the next fresh run; a finished run keeps its own profile. */
  readonly selectedDifficulty: Difficulty;
  readonly feedback: readonly ControllerFeedbackEvent[];
  /** Pending public Start/Resume/Restart operations, including canceled ones. */
  readonly pendingPlaybackRequests: boolean;
}

/** Immutable judgment identity plus the original game press result. */
export interface ControllerFeedbackEvent {
  readonly noteId: string;
  readonly lane: 0 | 1 | 2 | 3;
  readonly quality: 'good' | 'perfect' | 'miss';
  readonly timingErrorSeconds?: number;
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
  laneDown(lane: 0 | 1 | 2 | 3): ControllerSnapshot;
  laneUp(lane: 0 | 1 | 2 | 3): ControllerSnapshot;
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
  const feedback = new Map<number, ControllerFeedbackEvent>();
  let eventId = 0;
  let runId = 1;
  const pressedKeys = new Set<string>();
  const pressedTouchLanes = new Set<0 | 1 | 2 | 3>();
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
      runId,
      inputOffset,
      visualOffset,
      selectedDifficulty,
      feedback: [...feedback.values()].map((event) => ({ ...event })),
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

    feedback.clear();
    pressedKeys.clear();
    pressedTouchLanes.clear();
    if (terminalAudioStopHandled) return;
    terminalAudioStopHandled = true;
    if (dependencies.audio.snapshot().hasActiveSource) {
      dependencies.audio.pause();
    }
  }

  function advanceGame(audioSnapshot: AudioTransportSnapshot): void {
    if (audioSnapshot.status === 'error') {
      feedback.clear();
    }
    if (
      game.snapshot().status === 'playing' &&
      (audioSnapshot.status === 'playing' ||
        audioSnapshot.status === 'results' ||
        audioSnapshot.status === 'paused')
    ) {
      const before = game.snapshot();
      const transportTime = currentGameTime(audioSnapshot);
      const after = game.advanceTo(transportTime);
      for (const note of after.notes) {
        const previous = before.notes.find(
          (candidate) => candidate.id === note.id,
        );
        if (previous?.outcome === null && note.outcome === 'miss') {
          feedback.set(
            note.lane,
            Object.freeze({
              noteId: note.id,
              lane: note.lane,
              quality: 'miss',
              eventId: ++eventId,
              runId,
              onsetTransportTime: transportTime,
            }),
          );
        }
      }
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
    pressedTouchLanes.clear();
    feedback.clear();
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
    pressedTouchLanes.clear();
    feedback.clear();
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
    pressedTouchLanes.clear();
    feedback.clear();
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
      pressedTouchLanes.clear();
      feedback.clear();
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
    pressedTouchLanes.clear();
    feedback.clear();
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
    pressedTouchLanes.clear();
    feedback.clear();
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

    return pressLane(lane);
  }

  function laneDown(lane: 0 | 1 | 2 | 3): ControllerSnapshot {
    if (disposed) return snapshot();
    if (game.snapshot().status === 'results') {
      stopAudioForTerminalGame();
      return publish();
    }
    if (pressedTouchLanes.has(lane)) return snapshot();
    pressedTouchLanes.add(lane);
    return pressLane(lane);
  }

  function pressLane(lane: 0 | 1 | 2 | 3): ControllerSnapshot {
    const audioSnapshot = dependencies.audio.update();
    if (audioSnapshot.status !== 'playing') {
      return publish();
    }

    const transportTime = currentGameTime(audioSnapshot);
    advanceGame(audioSnapshot);
    if (game.snapshot().status === 'playing') {
      const result = game.press(lane, transportTime);
      if (result !== null) {
        feedback.set(
          lane,
          Object.freeze({
            ...result,
            lane,
            eventId: ++eventId,
            runId,
            onsetTransportTime: transportTime,
          }),
        );
      }
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

  function laneUp(lane: 0 | 1 | 2 | 3): ControllerSnapshot {
    if (disposed) return snapshot();
    pressedTouchLanes.delete(lane);
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
    pressedTouchLanes.clear();
    feedback.clear();
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
    laneDown,
    laneUp,
    update,
    dispose,
  };
}
