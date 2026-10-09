import { describe, expect, it, vi } from 'vitest';
import type { AudioTransport, AudioTransportSnapshot } from './audio';
import { createGameController, type ControllerSnapshot } from './controller';
import type { ChartConfig, ChartLane } from './chart';
import { createGame, type GameSession } from './game';

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 4,
  twilightAt: 2,
  twilightStrength: 100,
  allowedDifficulties: ['normal', 'hard'],
  notes: [
    { id: 'a1', time: 0.5, lane: 0 },
    { id: 'a2', time: 1, lane: 0 },
    { id: 'a3', time: 0.9, lane: 1 },
    { id: 't1', time: 3, lane: 2 },
  ],
} as ChartConfig;

type TestDifficulty = 'easy' | 'normal' | 'hard';

const createGameWithDifficulty = createGame as unknown as (
  chart: ChartConfig,
  inputOffset: number,
  difficulty?: TestDifficulty,
) => GameSession;

class FakeAudio implements AudioTransport {
  state: AudioTransportSnapshot;
  readonly calls: string[] = [];

  constructor(status: AudioTransportSnapshot['status'] = 'ready') {
    this.state = {
      status,
      position: 0,
      duration: 4,
      scheduledWhen: null,
      hasActiveSource: false,
      disposed: false,
      error: null,
    };
  }

  snapshot(): AudioTransportSnapshot {
    return { ...this.state };
  }

  async load(): Promise<AudioTransportSnapshot> {
    this.calls.push('load');
    return this.snapshot();
  }

  async start(): Promise<AudioTransportSnapshot> {
    this.calls.push('start');
    this.state = { ...this.state, status: 'starting' };
    return this.snapshot();
  }

  async resume(): Promise<AudioTransportSnapshot> {
    this.calls.push('resume');
    this.state = { ...this.state, status: 'starting' };
    return this.snapshot();
  }

  pause(): AudioTransportSnapshot {
    this.calls.push('pause');
    this.state = { ...this.state, status: 'paused' };
    return this.snapshot();
  }

  async restart(): Promise<AudioTransportSnapshot> {
    this.calls.push('restart');
    this.state = { ...this.state, status: 'starting', position: 0 };
    return this.snapshot();
  }

  update(): AudioTransportSnapshot {
    this.calls.push('update');
    if (
      this.state.status === 'playing' &&
      this.state.position >= this.state.duration
    ) {
      this.state = { ...this.state, status: 'results' };
    }
    return this.snapshot();
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose');
    this.state = { ...this.state, disposed: true };
  }
}

interface Harness {
  readonly audio: FakeAudio;
  readonly controller: ReturnType<typeof createGameController>;
  readonly games: GameSession[];
  readonly render: ReturnType<
    typeof vi.fn<(snapshot: ControllerSnapshot) => void>
  >;
}

function createHarness(audio = new FakeAudio()): Harness {
  const games: GameSession[] = [];
  const render = vi.fn<(snapshot: ControllerSnapshot) => void>();
  const controller = createGameController({
    audio,
    inputOffset: 0.1,
    visualOffset: -0.05,
    createGame(inputOffset, difficulty) {
      const game =
        difficulty === undefined
          ? createGame(chart, inputOffset)
          : createGameWithDifficulty(chart, inputOffset, difficulty);
      games.push(game);
      return game;
    },
    render,
  });

  return { audio, controller, games, render };
}

function setPlaying(audio: FakeAudio, position: number): void {
  audio.state = { ...audio.state, status: 'playing', position };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('game controller', () => {
  it('freezes configured offsets into the game and exposes them in snapshots', () => {
    const harness = createHarness();

    expect(harness.controller.snapshot()).toMatchObject({
      inputOffset: 0.1,
      visualOffset: -0.05,
    });
    expect(harness.games).toHaveLength(1);
  });

  it('starts through the transport and does not accept input during countdown', async () => {
    const harness = createHarness();
    await harness.controller.start();
    const before = harness.controller.snapshot().game;

    harness.controller.keyDown('KeyD');

    expect(harness.audio.calls).toContain('start');
    expect(harness.controller.snapshot().game).toEqual(before);
  });

  it('samples fresh transport position for mapped lane input', async () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);

    harness.controller.keyDown('KeyD');

    expect(harness.controller.snapshot().game.notes[0]?.outcome).toBe(
      'perfect',
    );
  });

  it.each([
    ['KeyD', 0],
    ['KeyF', 1],
    ['KeyJ', 2],
    ['KeyK', 3],
  ])('maps %s to lane %i', (code, lane) => {
    const harness = createHarness();
    const laneChart: ChartConfig = {
      ...chart,
      notes: [{ id: 'target', time: 1, lane: lane as ChartLane }],
    };
    const game = createGame(laneChart, 0);
    const controller = createGameController({
      audio: harness.audio,
      createGame: () => game,
    });
    setPlaying(harness.audio, 1);

    controller.keyDown(code);

    expect(controller.snapshot().game.notes[0]?.outcome).toBe('perfect');
  });

  it('ignores repeats and duplicate held keys until keyup', () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);

    harness.controller.keyDown('KeyD');
    harness.audio.state = { ...harness.audio.state, position: 1.1 };
    harness.controller.keyDown('KeyD', true);
    harness.controller.keyDown('KeyD');

    expect(
      harness.controller.snapshot().game.notes.map((note) => note.outcome),
    ).toEqual(['perfect', null, null, null]);

    harness.controller.keyUp('KeyD');
    harness.controller.keyDown('KeyD');
    expect(harness.controller.snapshot().game.notes[1]?.outcome).toBe(
      'perfect',
    );
  });

  it('ignores unsupported keys and leaves unmatched lanes without penalties', () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);

    harness.controller.keyDown('KeyA');
    harness.controller.keyDown('KeyK');

    expect(
      harness.controller.snapshot().game.notes.map((note) => note.outcome),
    ).toEqual([null, null, null, null]);
    expect(harness.controller.snapshot().game.renown).toBe(0);
  });

  it('pauses from the freshest audio position and clears held-key state', async () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);
    harness.controller.keyDown('KeyD');
    harness.controller.pause();

    expect(harness.audio.calls).toContain('pause');
    expect(harness.controller.snapshot().game.transportTime).toBe(0.6);

    await harness.controller.resume();
    setPlaying(harness.audio, 1.1);
    harness.controller.keyDown('KeyD');
    expect(harness.controller.snapshot().game.notes[1]?.outcome).toBe(
      'perfect',
    );
  });

  it('treats blur as pause without automatically resuming when focus returns', () => {
    const harness = createHarness();
    setPlaying(harness.audio, 1);

    harness.controller.blur();
    harness.audio.state = { ...harness.audio.state, status: 'playing' };
    harness.controller.update();

    expect(
      harness.audio.calls.filter((call) => call === 'resume'),
    ).toHaveLength(0);
    expect(harness.controller.snapshot().game.transportTime).toBe(1);
  });

  it('resumes audio without replacing game progress or frozen offsets', async () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);
    harness.controller.keyDown('KeyD');
    harness.controller.pause();
    const before = harness.controller.snapshot().game;

    await harness.controller.resume();

    expect(harness.audio.calls).toContain('resume');
    expect(harness.games).toHaveLength(1);
    expect(harness.controller.snapshot().game.notes[0]?.outcome).toBe(
      before.notes[0]?.outcome,
    );
    expect(harness.controller.snapshot().inputOffset).toBe(0.1);
  });

  it('restarts audio and creates a fresh game with the same frozen input offset', async () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);
    harness.controller.keyDown('KeyD');

    await harness.controller.restart();

    expect(harness.audio.calls).toContain('restart');
    expect(harness.games).toHaveLength(2);
    expect(harness.controller.snapshot().game.notes[0]?.outcome).toBeNull();
  });

  it('allows allowed profile changes only while idle or at results, freezing each run', async () => {
    const harness = createHarness();
    const selectDifficulty = (
      harness.controller as unknown as {
        selectDifficulty(difficulty: TestDifficulty): ControllerSnapshot;
      }
    ).selectDifficulty.bind(harness.controller);

    expect(harness.controller.snapshot()).toHaveProperty(
      'selectedDifficulty',
      'normal',
    );
    const originalNoteIds = harness.controller
      .snapshot()
      .game.notes.map((note) => note.id);
    expect(() => selectDifficulty('easy')).toThrow();
    expect(() => selectDifficulty('expert' as TestDifficulty)).toThrow();
    expect(harness.controller.snapshot()).toHaveProperty(
      'selectedDifficulty',
      'normal',
    );

    const selectedHard = selectDifficulty('hard');
    expect(selectedHard).toHaveProperty('selectedDifficulty', 'hard');
    expect(selectedHard.game).toHaveProperty('difficulty', 'hard');
    expect(selectedHard.game.notes.map((note) => note.id)).toEqual(
      originalNoteIds,
    );
    await harness.controller.start();
    expect(harness.controller.snapshot().game).toHaveProperty(
      'difficulty',
      'hard',
    );

    for (const status of [
      'loading',
      'starting',
      'playing',
      'paused',
      'error',
    ] as const) {
      harness.audio.state = { ...harness.audio.state, status, position: 0.6 };
      expect(() => selectDifficulty('normal')).toThrow();
      expect(harness.controller.snapshot()).toHaveProperty(
        'selectedDifficulty',
        'hard',
      );
    }

    setPlaying(harness.audio, 4);
    const terminal = harness.controller.update().game;
    expect(terminal.status).toBe('results');
    expect(terminal.result).toHaveProperty('difficulty', 'hard');
    const selectedNormal = selectDifficulty('normal');
    expect(selectedNormal).toHaveProperty('selectedDifficulty', 'normal');
    expect(selectedNormal.game).toEqual(terminal);

    await harness.controller.restart();
    expect(harness.controller.snapshot().game).toHaveProperty(
      'difficulty',
      'normal',
    );
  });

  it('allows selection during constructor loading before any transport request', () => {
    const audio = new FakeAudio('loading');
    const harness = createHarness(audio);
    const selectDifficulty = (
      harness.controller as unknown as {
        selectDifficulty(difficulty: TestDifficulty): ControllerSnapshot;
      }
    ).selectDifficulty.bind(harness.controller);

    expect(harness.controller.snapshot().audio.status).toBe('loading');
    expect(audio.calls).toEqual([]);
    expect(selectDifficulty('hard')).toHaveProperty(
      'selectedDifficulty',
      'hard',
    );
    expect(harness.controller.snapshot().game).toHaveProperty(
      'difficulty',
      'hard',
    );
    expect(audio.calls).toEqual([]);
  });

  it('freezes selection while load/start requests are pending and after cancellation', async () => {
    const audio = new FakeAudio();
    const harness = createHarness(audio);
    const selectDifficulty = (
      harness.controller as unknown as {
        selectDifficulty(difficulty: TestDifficulty): ControllerSnapshot;
      }
    ).selectDifficulty.bind(harness.controller);
    selectDifficulty('hard');

    const loadRequest = deferred<AudioTransportSnapshot>();
    const startRequest = deferred<AudioTransportSnapshot>();
    vi.spyOn(audio, 'load').mockImplementation(() => {
      audio.calls.push('load');
      return loadRequest.promise;
    });
    vi.spyOn(audio, 'start').mockImplementation(() => {
      audio.calls.push('start');
      audio.state = { ...audio.state, status: 'starting' };
      return startRequest.promise;
    });

    const pendingStart = harness.controller.start();
    expect(audio.calls).toEqual(['load']);
    let loadSelectionRejected = false;
    try {
      selectDifficulty('normal');
    } catch {
      loadSelectionRejected = true;
    }
    const selectedDuringLoad = harness.controller.snapshot().selectedDifficulty;

    audio.state = { ...audio.state, status: 'ready' };
    loadRequest.resolve(audio.snapshot());
    await Promise.resolve();
    expect(audio.calls).toEqual(['load', 'start']);
    let startSelectionRejected = false;
    try {
      selectDifficulty('normal');
    } catch {
      startSelectionRejected = true;
    }
    const selectedDuringStart =
      harness.controller.snapshot().selectedDifficulty;

    harness.controller.pause();
    let pausedSelectionRejected = false;
    try {
      selectDifficulty('normal');
    } catch {
      pausedSelectionRejected = true;
    }
    const selectedAfterCancellation =
      harness.controller.snapshot().selectedDifficulty;

    startRequest.resolve(audio.snapshot());
    await pendingStart;
    expect(loadSelectionRejected).toBe(true);
    expect(selectedDuringLoad).toBe('hard');
    expect(startSelectionRejected).toBe(true);
    expect(selectedDuringStart).toBe('hard');
    expect(pausedSelectionRejected).toBe(true);
    expect(selectedAfterCancellation).toBe('hard');
    expect(harness.controller.snapshot()).toHaveProperty(
      'selectedDifficulty',
      'hard',
    );
    expect(harness.controller.snapshot().game).toHaveProperty(
      'difficulty',
      'hard',
    );
  });

  it('advances phases and catches up end/results from transport time once', () => {
    const harness = createHarness();
    setPlaying(harness.audio, 4);

    const first = harness.controller.update();
    const second = harness.controller.update();

    expect(first.game.status).toBe('results');
    expect(first.game.phase).toBe('twilight');
    expect(first.audio.status).toBe('results');
    expect(first.game.result).toEqual(second.game.result);
  });

  it('does not advance the game beyond the audio excerpt position', () => {
    const harness = createHarness();
    setPlaying(harness.audio, 0.6);
    harness.controller.keyDown('KeyD');
    harness.audio.state = { ...harness.audio.state, position: 1 };
    harness.controller.keyDown('KeyF');
    harness.audio.state = { ...harness.audio.state, position: 1.1 };
    harness.controller.keyUp('KeyD');
    harness.controller.keyDown('KeyD');
    harness.audio.state = {
      ...harness.audio.state,
      status: 'playing',
      position: 9,
    };

    const snapshot = harness.controller.update();

    expect(snapshot.game.transportTime).toBe(4);
  });

  it('publishes the unified snapshot to the render consumer on control updates', () => {
    const harness = createHarness();

    harness.controller.update();

    expect(harness.render).toHaveBeenCalledWith(harness.controller.snapshot());
  });

  it('disposes audio and prevents late updates from changing game state', async () => {
    const harness = createHarness();
    setPlaying(harness.audio, 1);
    await harness.controller.dispose();
    const afterDispose = harness.controller.snapshot();

    harness.audio.state = {
      ...harness.audio.state,
      status: 'playing',
      position: 2,
    };
    harness.controller.update();

    expect(harness.audio.calls).toContain('dispose');
    expect(harness.controller.snapshot().game).toEqual(afterDispose.game);
  });
});
