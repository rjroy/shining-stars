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
import { validateChart } from '../game/chart';
import { createGame } from '../game/game';
import { isDifficulty, type Difficulty } from '../game/game-balance';
import type { SongCatalogEntry } from '../catalog/catalog';

export interface PerformanceSnapshot {
  readonly songId: string | null;
  readonly difficulty: Difficulty | null;
  readonly gameplayReady: boolean;
  readonly controller: ControllerSnapshot | null;
  readonly error: string | null;
  readonly recoveryRequired: boolean;
  readonly disposed: boolean;
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
  resume(): Promise<PerformanceSnapshot>;
  restart(): Promise<PerformanceSnapshot>;
  keyDown(code: string, repeat?: boolean): ControllerSnapshot | null;
  keyUp(code: string): ControllerSnapshot | null;
  update(): ControllerSnapshot | null;
  returnToBrowser(): Promise<void>;
  dispose(): Promise<void>;
}

interface ActivePerformance {
  readonly generation: number;
  readonly song: SongCatalogEntry;
  readonly difficulty: Difficulty;
  readonly controller: GameController;
  readonly prepareTask: Promise<void>;
  gameplayReady: boolean;
  preparationDone: boolean;
  canStart: boolean;
  cleanupReady: boolean;
  startTask: Promise<void> | null;
  operationError: string | null;
  recoveryRequired: boolean;
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
  let active: ActivePerformance | null = null;
  let generation = 0;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let setupError: string | null = null;
  let setupSongId: string | null = null;
  let setupDifficulty: Difficulty | null = null;
  let cleanupBarrier: Promise<void> = Promise.resolve();

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
    };
  }

  function retireCurrent(): void {
    if (active === null) return;
    const previous = active;
    active = null;
    const close = previous.controller.dispose();
    cleanupBarrier = Promise.all([cleanupBarrier, close]).then(() => undefined);
  }

  function isCurrent(record: ActivePerformance): boolean {
    return !disposed && active === record && generation === record.generation;
  }

  function startWhenReady(record: ActivePerformance): Promise<void> {
    if (
      !isCurrent(record) ||
      !record.gameplayReady ||
      !record.canStart ||
      record.recoveryRequired
    ) {
      return Promise.resolve();
    }
    if (record.startTask !== null) return record.startTask;
    record.startTask = (async () => {
      try {
        await cleanupBarrier;
        if (!isCurrent(record)) return;
        record.cleanupReady = true;
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
    if (song.availability !== 'available') {
      throw new TypeError(`Song '${song.id}' is unavailable.`);
    }
    if (validateChart(song.chart).length > 0) {
      throw new TypeError(`Song '${song.id}' has an invalid chart.`);
    }
    if (
      !isDifficulty(difficulty) ||
      !song.chart.allowedDifficulties.includes(difficulty)
    ) {
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
        sourceStart: song.chart.sourceStart,
        duration: song.chart.duration,
      },
      {
        context,
        fetchAudio: (url, signal) =>
          dependencies.fetchAudio(url, signal ?? new AbortController().signal),
      },
    );
    const recordRef: { current: ActivePerformance | null } = { current: null };
    const controller = createGameController({
      audio,
      inputOffset: dependencies.inputOffset,
      visualOffset: dependencies.visualOffset,
      createGame: (inputOffset, requestedDifficulty) =>
        createGame(song.chart, inputOffset, requestedDifficulty ?? difficulty),
      render: (controllerSnapshot) => {
        try {
          dependencies.render?.(controllerSnapshot);
        } catch (error) {
          const currentRecord = recordRef.current;
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
    const activeRecord: ActivePerformance = {
      generation: requestGeneration,
      song,
      difficulty,
      controller,
      prepareTask,
      gameplayReady: false,
      preparationDone: false,
      canStart: false,
      cleanupReady: false,
      startTask: null,
      operationError: null,
      recoveryRequired: false,
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
      !current.preparationDone ||
      !current.canStart ||
      !current.gameplayReady
    )
      return snapshot();
    const recovering = current.recoveryRequired;
    try {
      if (!current.cleanupReady) {
        await cleanupBarrier;
        if (!isCurrent(current) || !current.gameplayReady) return snapshot();
        current.cleanupReady = true;
      }
      if (!isCurrent(current) || !current.gameplayReady) return snapshot();
      current.operationError = null;
      current.recoveryRequired = false;
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
