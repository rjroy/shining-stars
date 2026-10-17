import {
  createAudioTransport,
  type AudioBufferPort,
  type AudioContextPort,
  type AudioSourcePort,
} from '../audio/audio';
import {
  createGameController,
  type ControllerDependencies,
  type ControllerSnapshot,
  type GameController,
} from '../game/controller';
import { validateChart, type ChartConfig } from '../game/chart';
import {
  createGame,
  getTheoreticalMaximumScore,
  type GameResult,
} from '../game/game';
import { isDifficulty, type Difficulty } from '../game/game-balance';
import type { SongCatalogEntry } from '../catalog/catalog';
import { getSongChart, getSongDifficulties } from '../catalog/catalog';

export interface PerformanceSnapshot {
  readonly songId: string | null;
  readonly difficulty: Difficulty | null;
  readonly gameplayReady: boolean;
  readonly controller: ControllerSnapshot | null;
  readonly error: string | null;
  readonly recoveryRequired: boolean;
  readonly disposed: boolean;
  /** Audio-clock time for rendering scheduled count-ins; null before Play. */
  readonly audioNow: number | null;
}

export interface TouchGameplayEnvironment {
  readonly anyPointerCoarse: boolean;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
}

export interface TouchGameplayEligibility {
  readonly touchEnabled: boolean;
  readonly gameplayAllowed: boolean;
}

/** Derive touch affordance and the orientation gate from the game surface. */
export function getTouchGameplayEligibility({
  anyPointerCoarse,
  surfaceWidth,
  surfaceHeight,
}: TouchGameplayEnvironment): TouchGameplayEligibility {
  const touchEnabled =
    anyPointerCoarse && Math.min(surfaceWidth, surfaceHeight) <= 600;
  return {
    touchEnabled,
    gameplayAllowed: !touchEnabled || surfaceHeight >= surfaceWidth,
  };
}

export interface PerformanceDependencies<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
> {
  /** Must synchronously return a fresh context; prepare calls resume immediately. */
  readonly createAudioContext: () => AudioContextPort<TBuffer, TSource>;
  readonly fetchAudio: (
    url: string,
    signal: AbortSignal,
  ) => Promise<ArrayBuffer>;
  readonly inputOffset?: number;
  readonly visualOffset?: number;
  readonly render?: ControllerDependencies['render'];
  readonly onRunCompleted?: (completion: {
    readonly songId: string;
    readonly result: GameResult;
  }) => void;
  readonly onTwilightDefeated?: (event: {
    readonly songId: string;
    readonly difficulty: Difficulty;
  }) => void;
}

export interface PerformanceCoordinator {
  snapshot(): PerformanceSnapshot;
  /** Call directly from the Play gesture; setup and resume begin synchronously. */
  prepare(
    song: SongCatalogEntry,
    difficulty: Difficulty,
  ): Promise<PerformanceSnapshot>;
  /** Playback is gated until the renderer reports that gameplay can be shown. */
  markGameplayReady(): Promise<PerformanceSnapshot>;
  pause(): PerformanceSnapshot;
  /** Gate gameplay while orientation is unsuitable; lifting it never resumes. */
  setGameplayAllowed(allowed: boolean): PerformanceSnapshot;
  resume(): Promise<PerformanceSnapshot>;
  restart(): Promise<PerformanceSnapshot>;
  keyDown(code: string, repeat?: boolean): ControllerSnapshot | null;
  keyUp(code: string): ControllerSnapshot | null;
  laneDown(lane: 0 | 1 | 2 | 3): ControllerSnapshot | null;
  laneUp(lane: 0 | 1 | 2 | 3): ControllerSnapshot | null;
  update(): ControllerSnapshot | null;
  returnToBrowser(): Promise<void>;
  dispose(): Promise<void>;
}

interface ActivePerformance<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
> {
  readonly generation: number;
  readonly selection: Readonly<{
    song: SongCatalogEntry;
    difficulty: Difficulty;
    chart: ChartConfig;
  }>;
  readonly song: SongCatalogEntry;
  readonly difficulty: Difficulty;
  readonly chart: ChartConfig;
  readonly controller: GameController;
  readonly context: AudioContextPort<TBuffer, TSource>;
  readonly prepareTask: Promise<void>;
  gameplayReady: boolean;
  preparationDone: boolean;
  canStart: boolean;
  cleanupReady: boolean;
  startTask: Promise<void> | null;
  operationError: string | null;
  recoveryRequired: boolean;
  completionReported: boolean;
  readonly twilightDefeatRunsReported: Set<number>;
  needsExplicitPlaybackAction: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns one selected song performance; browser selection state remains external. */
export function createPerformanceCoordinator<
  TBuffer extends AudioBufferPort,
  TSource extends AudioSourcePort<TBuffer>,
>(
  dependencies: PerformanceDependencies<TBuffer, TSource>,
): PerformanceCoordinator {
  let active: ActivePerformance<TBuffer, TSource> | null = null;
  let generation = 0;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let setupError: string | null = null;
  let setupSongId: string | null = null;
  let setupDifficulty: Difficulty | null = null;
  let cleanupBarrier: Promise<void> = Promise.resolve();
  let gameplayAllowed = true;

  function snapshot(): PerformanceSnapshot {
    const current = active;
    return {
      songId: current?.song.id ?? setupSongId,
      difficulty: current?.difficulty ?? setupDifficulty,
      gameplayReady: current?.gameplayReady ?? false,
      controller: current?.controller.snapshot() ?? null,
      error:
        current?.operationError ??
        current?.controller.snapshot().audio.error ??
        setupError,
      recoveryRequired: current?.recoveryRequired ?? false,
      disposed,
      audioNow: current?.context.currentTime ?? null,
    };
  }

  function retireCurrent(): void {
    if (active === null) return;
    const previous = active;
    active = null;
    const close = previous.controller.dispose();
    cleanupBarrier = Promise.all([cleanupBarrier, close]).then(() => undefined);
  }

  function isCurrent(record: ActivePerformance<TBuffer, TSource>): boolean {
    return !disposed && active === record && generation === record.generation;
  }

  function startWhenReady(
    record: ActivePerformance<TBuffer, TSource>,
  ): Promise<void> {
    if (
      !isCurrent(record) ||
      !record.gameplayReady ||
      !record.canStart ||
      record.recoveryRequired ||
      record.needsExplicitPlaybackAction ||
      !gameplayAllowed
    ) {
      return Promise.resolve();
    }
    if (record.startTask !== null) return record.startTask;
    record.startTask = (async () => {
      try {
        await cleanupBarrier;
        if (!isCurrent(record) || !gameplayAllowed) return;
        record.cleanupReady = true;
        if (!gameplayAllowed) return;
        await record.controller.start();
      } catch (error) {
        if (isCurrent(record)) {
          record.operationError = errorMessage(error);
        }
      }
    })();
    return record.startTask;
  }

  function prepare(
    song: SongCatalogEntry,
    difficulty: Difficulty,
  ): Promise<PerformanceSnapshot> {
    if (disposed) return Promise.resolve(snapshot());
    if (!gameplayAllowed) return Promise.resolve(snapshot());
    if (song.availability !== 'available') {
      throw new TypeError(`Song '${song.id}' is unavailable.`);
    }
    if (!getSongDifficulties(song).includes(difficulty)) {
      throw new RangeError(
        `Difficulty '${String(difficulty)}' is not supported by '${song.id}'.`,
      );
    }
    const chart = getSongChart(song, difficulty);
    const normalChart = getSongDifficulties(song).includes('normal')
      ? getSongChart(song, 'normal')
      : chart;
    const normalMaximum =
      song.scoring.normalMaximum ??
      getTheoreticalMaximumScore(normalChart.notes.length);
    if (validateChart(chart).length > 0) {
      throw new TypeError(`Song '${song.id}' has an invalid chart.`);
    }
    if (!isDifficulty(difficulty)) {
      throw new RangeError(
        `Difficulty '${String(difficulty)}' is not supported by '${song.id}'.`,
      );
    }

    generation += 1;
    retireCurrent();
    setupError = null;
    setupSongId = song.id;
    setupDifficulty = difficulty;
    const requestGeneration = generation;
    const selection = Object.freeze({ song, difficulty, chart });

    let context: AudioContextPort<TBuffer, TSource>;
    try {
      context = dependencies.createAudioContext();
    } catch (error) {
      setupError = errorMessage(error);
      return Promise.resolve(snapshot());
    }

    // Invoke resume before any await so browsers still see the Play gesture.
    let resumeAttempt: Promise<{ readonly error: string | null }>;
    try {
      resumeAttempt = Promise.resolve(context.resume()).then(
        () => ({ error: null }),
        (error: unknown) => ({ error: errorMessage(error) }),
      );
    } catch (error) {
      resumeAttempt = Promise.resolve({ error: errorMessage(error) });
    }

    const audio = createAudioTransport(
      {
        sourceUrl: song.audioUrl,
        sourceStart: chart.sourceStart,
        duration: chart.duration,
      },
      {
        context,
        fetchAudio: (url, signal) =>
          dependencies.fetchAudio(url, signal ?? new AbortController().signal),
      },
    );
    const recordRef: { current: ActivePerformance<TBuffer, TSource> | null } = {
      current: null,
    };
    const controller = createGameController({
      audio,
      inputOffset: dependencies.inputOffset,
      visualOffset: dependencies.visualOffset,
      createGame: (inputOffset, requestedDifficulty) =>
        createGame(
          chart,
          inputOffset,
          requestedDifficulty ?? difficulty,
          normalMaximum,
        ),
      render: (controllerSnapshot) => {
        const currentRecord = recordRef.current;
        const result = controllerSnapshot.game.result;
        if (currentRecord !== null && isCurrent(currentRecord)) {
          if (
            controllerSnapshot.game.victory &&
            !currentRecord.twilightDefeatRunsReported.has(controllerSnapshot.runId ?? 1)
          ) {
            currentRecord.twilightDefeatRunsReported.add(controllerSnapshot.runId ?? 1);
            if (dependencies.onTwilightDefeated !== undefined) {
              const event = {
                songId: currentRecord.song.id,
                difficulty: controllerSnapshot.game.difficulty,
              };
              console.info('[Performance] Twilight defeat callback attempt', event);
              try {
                dependencies.onTwilightDefeated(event);
                console.info('[Performance] Twilight defeat callback succeeded', event);
              } catch (error) {
                console.error('[Performance] Twilight defeat callback failed', {
                  ...event,
                  error: errorMessage(error),
                });
              }
            }
          }
          if (controllerSnapshot.game.status !== 'results') {
            currentRecord.completionReported = false;
          } else if (result !== null && !currentRecord.completionReported) {
            currentRecord.completionReported = true;
            if (dependencies.onRunCompleted !== undefined) {
              const completion = {
                songId: currentRecord.song.id,
                result,
              };
              console.info('[Performance] run completion callback attempt', {
                songId: completion.songId,
                difficulty: result.difficulty,
                outcome: result.outcome,
              });
              try {
                dependencies.onRunCompleted(completion);
                console.info(
                  '[Performance] run completion callback succeeded',
                  {
                    songId: completion.songId,
                    difficulty: result.difficulty,
                    outcome: result.outcome,
                  },
                );
              } catch (error) {
                console.error('[Performance] run completion callback failed', {
                  songId: completion.songId,
                  difficulty: result.difficulty,
                  outcome: result.outcome,
                  error: errorMessage(error),
                });
              }
            }
          }
        }
        try {
          dependencies.render?.(controllerSnapshot);
        } catch (error) {
          if (currentRecord === null || !isCurrent(currentRecord)) return;
          currentRecord.operationError = `Gameplay renderer failed: ${errorMessage(error)}`;
          currentRecord.gameplayReady = false;
          currentRecord.recoveryRequired = true;
          currentRecord.startTask = null;
          try {
            currentRecord.controller.pauseWithoutPublishing();
          } catch {
            // The failed renderer must not block best-effort audio shutdown.
          }
        }
      },
    });

    const prepareTask = (async () => {
      const [resumeResult, loadResult] = await Promise.allSettled([
        resumeAttempt,
        audio.load(),
      ]);
      const currentRecord = recordRef.current;
      if (currentRecord === null || !isCurrent(currentRecord)) return;
      // A load already in flight can settle back to `ready` after orientation
      // cancellation paused the transport; restore the paused state before
      // exposing the completed preparation.
      if (!gameplayAllowed) currentRecord.controller.pause();
      if (resumeResult.status === 'rejected') {
        currentRecord.operationError = errorMessage(resumeResult.reason);
      } else if (resumeResult.value.error !== null) {
        currentRecord.operationError = resumeResult.value.error;
      }
      if (loadResult.status === 'rejected') {
        currentRecord.operationError = errorMessage(loadResult.reason);
      }
      currentRecord.canStart =
        currentRecord.operationError === null &&
        loadResult.status === 'fulfilled' &&
        loadResult.value.status === 'ready';
      currentRecord.preparationDone = true;
      await startWhenReady(currentRecord);
    })();
    const activeRecord: ActivePerformance<TBuffer, TSource> = {
      generation: requestGeneration,
      selection,
      song: selection.song,
      difficulty: selection.difficulty,
      chart: selection.chart,
      controller,
      context,
      prepareTask,
      gameplayReady: false,
      preparationDone: false,
      canStart: false,
      cleanupReady: false,
      startTask: null,
      operationError: null,
      recoveryRequired: false,
      completionReported: false,
      twilightDefeatRunsReported: new Set(),
      needsExplicitPlaybackAction: false,
    };
    recordRef.current = activeRecord;
    active = activeRecord;
    return prepareTask.then(() => snapshot());
  }

  async function markGameplayReady(): Promise<PerformanceSnapshot> {
    const current = active;
    if (current === null) return snapshot();
    current.gameplayReady = true;
    if (!current.preparationDone) await current.prepareTask;
    if (!isCurrent(current)) return snapshot();
    await startWhenReady(current);
    return snapshot();
  }

  async function runControllerAction(
    action: 'resume' | 'restart',
  ): Promise<PerformanceSnapshot> {
    const current = active;
    if (
      current === null ||
      !isCurrent(current) ||
      !gameplayAllowed ||
      !current.preparationDone ||
      !current.canStart ||
      !current.gameplayReady
    )
      return snapshot();
    const recovering = current.recoveryRequired;
    try {
      if (!current.cleanupReady) {
        await cleanupBarrier;
        if (!isCurrent(current) || !current.gameplayReady || !gameplayAllowed)
          return snapshot();
        current.cleanupReady = true;
      }
      if (!isCurrent(current) || !current.gameplayReady || !gameplayAllowed)
        return snapshot();
      current.operationError = null;
      current.recoveryRequired = false;
      current.needsExplicitPlaybackAction = false;
      await current.controller[action]();
    } catch (error) {
      if (isCurrent(current)) {
        current.operationError = errorMessage(error);
        current.recoveryRequired = recovering;
      }
    }
    return snapshot();
  }

  async function returnToBrowser(): Promise<void> {
    if (disposed) return;
    generation += 1;
    setupError = null;
    setupSongId = null;
    setupDifficulty = null;
    retireCurrent();
    await cleanupBarrier;
  }

  function dispose(): Promise<void> {
    if (disposePromise !== null) return disposePromise;
    generation += 1;
    disposed = true;
    setupSongId = null;
    setupDifficulty = null;
    retireCurrent();
    disposePromise = cleanupBarrier;
    return disposePromise;
  }

  return {
    snapshot,
    prepare,
    markGameplayReady,
    pause: () => {
      active?.controller.pause();
      return snapshot();
    },
    setGameplayAllowed: (allowed) => {
      const wasAllowed = gameplayAllowed;
      gameplayAllowed = allowed;
      if (wasAllowed && !allowed && active !== null) {
        active.needsExplicitPlaybackAction = true;
        active.controller.pause();
      }
      return snapshot();
    },
    resume: () => runControllerAction('resume'),
    restart: () => runControllerAction('restart'),
    keyDown: (code, repeat) => {
      const current = active;
      if (current === null || !current.gameplayReady || !current.canStart)
        return null;
      return current.controller.keyDown(code, repeat);
    },
    keyUp: (code) => {
      const current = active;
      if (current === null || !current.gameplayReady || !current.canStart)
        return null;
      return current.controller.keyUp(code);
    },
    laneDown: (lane) => {
      const current = active;
      if (
        current === null ||
        !current.gameplayReady ||
        !current.canStart ||
        !gameplayAllowed
      )
        return null;
      return current.controller.laneDown(lane);
    },
    laneUp: (lane) => {
      const current = active;
      if (current === null || !current.gameplayReady || !current.canStart)
        return null;
      return current.controller.laneUp(lane);
    },
    update: () => {
      const current = active;
      if (current === null || !current.gameplayReady || !current.canStart)
        return null;
      return current.controller.update();
    },
    returnToBrowser,
    dispose,
  };
}
