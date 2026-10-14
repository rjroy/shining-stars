import { afterEach, describe, expect, it, vi } from 'vitest';

interface AppSnapshot {
  readonly audio: {
    readonly status: string;
    readonly error: string | null;
    readonly loaded: boolean;
  };
  readonly game: { readonly status: string };
  readonly feedback: unknown;
  readonly pendingPlaybackRequests: boolean;
}

interface AppActions {
  readonly start: () => unknown;
  readonly resume: () => unknown;
  readonly restart: () => unknown;
  readonly onRendererRetry?: () => unknown;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const harness = vi.hoisted(() => ({
  actions: null as AppActions | null,
  controller: null as null | Record<string, ReturnType<typeof vi.fn>>,
  snapshot: null as AppSnapshot | null,
  renderSnapshot: null as null | ((snapshot: AppSnapshot) => void),
  ui: null as null | Record<string, ReturnType<typeof vi.fn>>,
  audio: null as null | Record<string, unknown>,
  audioDependencies: null as null | Record<string, unknown>,
  sceneModes: [] as string[],
  frameStatuses: [] as string[],
  sceneCallbacks: [] as Array<() => void>,
  sceneHosts: [] as unknown[],
  scenes: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  scene: null as null | Record<string, ReturnType<typeof vi.fn>>,
  windowListeners: new Map<string, (event: unknown) => void>(),
  documentListeners: new Map<string, (event: unknown) => void>(),
  events: [] as string[],
  inSceneUpdate: false,
  uiRenderedDuringSceneUpdate: false,
  failNextFrame: false,
  requestFrameCalls: [] as Array<() => void>,
  requestFrameIds: [] as number[],
  fetchCalls: 0,
  host: {} as object,
}));

vi.mock('./ui/styles.css', () => ({}));
vi.mock('./audio/audio', () => ({
  createAudioTransport: vi.fn((_config, dependencies) => {
    harness.audioDependencies = dependencies;
    return harness.audio;
  }),
}));
vi.mock('./audio/browser-audio', () => ({
  createBrowserAudioContextAdapter: vi.fn(() => ({})),
}));
vi.mock('./game/controller', () => ({
  createGameController: vi.fn((dependencies) => {
    harness.renderSnapshot = dependencies.render;
    return harness.controller;
  }),
}));
vi.mock('./game/game', () => ({ createGame: vi.fn() }));
vi.mock('./rendering/scene', () => ({
  createBrightvaleScene: vi.fn((host, onUnavailable) => {
    harness.sceneHosts.push(host);
    harness.sceneCallbacks.push(onUnavailable);
    const mode = harness.sceneModes.shift() ?? 'success';
    harness.events.push(`scene-create:${mode}`);
    if (mode === 'create-fails') {
      onUnavailable();
      return null;
    }

    let firstFrame = true;
    const scene = {
      update: vi.fn(),
      updateFrame: vi.fn(() => {
        harness.events.push('scene-frame');
        const shouldFail =
          (mode === 'first-frame-fails' && firstFrame) || harness.failNextFrame;
        firstFrame = false;
        if (shouldFail) {
          harness.failNextFrame = false;
          harness.inSceneUpdate = true;
          try {
            onUnavailable();
          } finally {
            harness.inSceneUpdate = false;
          }
        }
        return harness.frameStatuses.shift() ?? 'rendered';
      }),
      destroy: vi.fn(),
    };
    harness.scenes.push(scene);
    harness.scene = scene;
    return scene;
  }),
}));
vi.mock('./rendering/scene-state', () => ({
  projectSceneState: vi.fn(() => ({ cityProjection: true })),
}));
vi.mock('./rendering/gameplay-frame', () => ({
  projectGameplayFrame: vi.fn(() => ({ gameplayProjection: true })),
}));
vi.mock('./ui/ui', () => ({
  createGameUI: vi.fn((_root, _chart, actions) => {
    harness.actions = actions;
    const ui = {
      render: vi.fn(() => {
        if (harness.inSceneUpdate) harness.uiRenderedDuringSceneUpdate = true;
      }),
      setBusy: vi.fn(),
      setRendererStatus: vi.fn((status: string) => {
        harness.events.push(`renderer-status:${status}`);
      }),
      getGameplayLayout: vi.fn(() => ({ cached: true })),
      showFatal: vi.fn(),
      destroy: vi.fn(),
    };
    harness.ui = ui;
    return ui;
  }),
}));

class TestHTMLElement {
  readonly isContentEditable = false;

  matches(): boolean {
    return false;
  }
}

function makeSnapshot(
  audioStatus = 'ready',
  gameStatus = 'playing',
  audioError: string | null = null,
): AppSnapshot {
  return {
    audio: {
      status: audioStatus,
      error: audioError,
      loaded: !['loading', 'error'].includes(audioStatus),
    },
    game: { status: gameStatus },
    feedback: [],
    pendingPlaybackRequests: false,
  };
}

async function mountMain(
  sceneModes: string[],
  frameStatuses: string[] = [],
): Promise<void> {
  vi.resetModules();
  harness.actions = null;
  harness.controller = null;
  harness.snapshot = makeSnapshot();
  harness.renderSnapshot = null;
  harness.ui = null;
  harness.audioDependencies = null;
  harness.sceneModes = [...sceneModes];
  harness.frameStatuses = [...frameStatuses];
  harness.sceneCallbacks = [];
  harness.sceneHosts = [];
  harness.scenes = [];
  harness.scene = null;
  harness.windowListeners.clear();
  harness.documentListeners.clear();
  harness.events = [];
  harness.inSceneUpdate = false;
  harness.uiRenderedDuringSceneUpdate = false;
  harness.failNextFrame = false;
  harness.requestFrameCalls = [];
  harness.requestFrameIds = [];
  harness.fetchCalls = 0;
  harness.host = {};

  const appRoot = {
    querySelector: (selector: string) =>
      selector === '.play-surface' ? harness.host : null,
  };
  const documentStub = {
    body: new TestHTMLElement(),
    visibilityState: 'visible',
    querySelector: (selector: string) => (selector === '#app' ? appRoot : null),
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      harness.documentListeners.set(name, listener);
    },
    removeEventListener: (name: string) => {
      harness.documentListeners.delete(name);
    },
  };
  const windowStub = {
    AudioContext: class {
      currentTime = 0;
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      harness.windowListeners.set(name, listener);
    },
    removeEventListener: (name: string) => {
      harness.windowListeners.delete(name);
    },
  };
  harness.audio = {
    load: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    pause: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(async () => undefined),
  };
  harness.controller = {
    snapshot: vi.fn(() => harness.snapshot),
    start: vi.fn(async () => harness.snapshot),
    resume: vi.fn(async () => harness.snapshot),
    restart: vi.fn(async () => harness.snapshot),
    pause: vi.fn(),
    blur: vi.fn(),
    keyDown: vi.fn(),
    keyUp: vi.fn(),
    update: vi.fn(),
    pauseWithoutPublishing: vi.fn(() => {
      const current = harness.snapshot;
      if (current === null) return current;
      if (
        current.audio.status === 'starting' ||
        current.audio.status === 'playing'
      ) {
        harness.snapshot = {
          ...current,
          audio: { ...current.audio, status: 'paused', error: null },
          feedback: [],
        };
      } else {
        harness.snapshot = { ...current, feedback: [] };
      }
      return harness.snapshot;
    }),
    dispose: vi.fn(async () => undefined),
  };

  let requestId = 0;
  const fetchStub = vi.fn(async () => {
    harness.fetchCalls += 1;
    return { ok: true };
  });
  vi.stubGlobal('HTMLElement', TestHTMLElement);
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    const id = ++requestId;
    harness.requestFrameCalls.push(callback);
    harness.requestFrameIds.push(id);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  await import('./main');
}

function fireKey(code: string): void {
  const listener = harness.windowListeners.get('keydown');
  listener?.({
    code,
    target: new TestHTMLElement(),
    repeat: false,
    preventDefault: vi.fn(),
  });
}

async function callAction(
  name: 'start' | 'resume' | 'restart' | 'onRendererRetry',
): Promise<void> {
  const action = harness.actions?.[name];
  if (action === undefined) throw new Error(`Missing UI action ${name}.`);
  await action();
}

afterEach(async () => {
  for (const name of harness.windowListeners.keys()) {
    window.removeEventListener(name, (() => undefined) as EventListener);
  }
  for (const name of harness.documentListeners.keys()) {
    document.removeEventListener(name, (() => undefined) as EventListener);
  }
  if (harness.requestFrameIds.length > 0) {
    cancelAnimationFrame(harness.requestFrameIds.at(-1) ?? 0);
  }
  for (const scene of harness.scenes) (scene.destroy as () => void)();
  await (harness.controller?.dispose as (() => Promise<void>) | undefined)?.();
  (harness.ui?.destroy as (() => void) | undefined)?.();
  harness.windowListeners.clear();
  harness.documentListeners.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('main renderer availability lifecycle', () => {
  it('keeps playback and input gated through repeated loading frames until rendered', async () => {
    await mountMain(
      ['success'],
      Array.from({ length: 20 }, () => 'loading'),
    );
    expect.soft(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
      'loading',
      expect.any(String),
    );

    await callAction('start');
    await callAction('resume');
    await callAction('restart');
    fireKey('Enter');
    fireKey('KeyD');
    harness.windowListeners.get('keyup')?.({ code: 'KeyD' });
    expect.soft(harness.controller?.start).not.toHaveBeenCalled();
    expect.soft(harness.controller?.resume).not.toHaveBeenCalled();
    expect.soft(harness.controller?.restart).not.toHaveBeenCalled();
    expect.soft(harness.controller?.keyDown).not.toHaveBeenCalled();
    expect.soft(harness.controller?.keyUp).not.toHaveBeenCalled();

    harness.renderSnapshot?.(harness.snapshot!);
    expect.soft(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
      'loading',
      expect.any(String),
    );
    harness.frameStatuses = ['rendered'];
    harness.renderSnapshot?.(harness.snapshot!);
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
    expect(harness.controller?.start).not.toHaveBeenCalled();
    expect(harness.controller?.resume).not.toHaveBeenCalled();
    expect(harness.controller?.restart).not.toHaveBeenCalled();
  });

  it('gates every route through create failure and first-frame failure, then retries without starting audio', async () => {
    await mountMain(['create-fails', 'first-frame-fails', 'success']);
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
      'unavailable',
      expect.any(String),
    );
    expect(harness.scenes).toHaveLength(0);
    expect(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(1);

    expect(harness.audioDependencies).not.toBeNull();
    expect(harness.fetchCalls).toBe(0);

    for (const audioStatus of ['ready', 'loading', 'paused', 'error']) {
      harness.snapshot = makeSnapshot(
        audioStatus,
        audioStatus === 'paused' ? 'playing' : 'ready',
        audioStatus === 'error' ? 'decode failed' : null,
      );
      await callAction('start');
      await callAction('resume');
      await callAction('restart');
      fireKey('Enter');
    }
    fireKey('KeyD');
    harness.windowListeners.get('keyup')?.({ code: 'KeyD' });
    expect(harness.controller?.start).not.toHaveBeenCalled();
    expect(harness.controller?.resume).not.toHaveBeenCalled();
    expect(harness.controller?.restart).not.toHaveBeenCalled();
    expect(harness.controller?.keyDown).not.toHaveBeenCalled();
    expect(harness.controller?.keyUp).not.toHaveBeenCalled();

    harness.snapshot = makeSnapshot('playing', 'playing');
    fireKey('Escape');
    harness.snapshot = makeSnapshot('playing', 'playing');
    fireKey('Escape');
    expect(harness.controller?.pause).toHaveBeenCalledTimes(2);

    const retry = harness.actions?.onRendererRetry;
    expect(retry).toBeTypeOf('function');
    if (retry === undefined) return;
    await retry(); // Retry renderer: its first frame fails; audio stays locked.
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
      'unavailable',
      expect.any(String),
    );
    expect(harness.controller?.start).not.toHaveBeenCalled();
    expect(harness.controller?.resume).not.toHaveBeenCalled();
    expect(harness.controller?.restart).not.toHaveBeenCalled();

    const staleFailure = harness.sceneCallbacks[1];
    harness.events = [];
    await retry(); // Second renderer retry succeeds on its first required frame.
    expect(harness.sceneHosts).toHaveLength(3);
    expect(harness.sceneHosts.every((host) => host === harness.host)).toBe(
      true,
    );
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
    expect(harness.events.indexOf('scene-frame')).toBeLessThan(
      harness.events.indexOf('renderer-status:rendered'),
    );
    expect(harness.requestFrameCalls).toHaveLength(1);
    expect(harness.controller?.start).not.toHaveBeenCalled();
    expect(harness.controller?.resume).not.toHaveBeenCalled();
    expect(harness.controller?.restart).not.toHaveBeenCalled();

    staleFailure?.();
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');

    fireKey('KeyD');
    expect(harness.controller?.keyDown).toHaveBeenCalledWith('KeyD', false);

    harness.snapshot = makeSnapshot('paused', 'playing');
    fireKey('Enter');
    await Promise.resolve();
    expect(harness.controller?.resume).toHaveBeenCalledTimes(1);
    harness.snapshot = makeSnapshot('results', 'results');
    fireKey('Enter');
    await Promise.resolve();
    expect(harness.controller?.restart).toHaveBeenCalledTimes(1);
    harness.snapshot = makeSnapshot('error', 'ready', 'decode failed');
    await callAction('start'); // Audio Retry is distinct from Retry 3D.
    expect(harness.controller?.restart).toHaveBeenCalledTimes(2);
  });

  it('does not start playback when the readiness-check frame fails before the action', async () => {
    await mountMain(['success', 'success']);
    harness.failNextFrame = true;

    await callAction('start');

    expect(harness.controller?.start).not.toHaveBeenCalled();
    expect(harness.controller?.restart).not.toHaveBeenCalled();
    expect(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(1);
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
      'unavailable',
      expect.any(String),
    );

    await callAction('onRendererRetry');
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
    expect(harness.controller?.start).not.toHaveBeenCalled();
  });

  it('publishes the canceled controller snapshot after a playing-frame failure', async () => {
    await mountMain(['success']);
    const playingSnapshot: AppSnapshot = {
      ...makeSnapshot('playing', 'playing'),
      feedback: [{
        noteId: 'event-note',
        lane: 0,
        quality: 'perfect',
        eventId: 7,
        runId: 2,
        onsetTransportTime: 4.2,
      }],
    };
    harness.snapshot = playingSnapshot;
    harness.ui?.render.mockClear();
    harness.uiRenderedDuringSceneUpdate = false;
    harness.failNextFrame = true;

    harness.renderSnapshot?.(playingSnapshot);

    const lastUiSnapshot = harness.ui?.render.mock.calls.at(-1)?.[0] as
      AppSnapshot | undefined;
    expect(lastUiSnapshot).toMatchObject({
      audio: { status: 'paused' },
      game: { status: 'playing' },
      feedback: [],
    });
    expect(harness.ui?.render).toHaveBeenCalledTimes(2);
    expect(harness.uiRenderedDuringSceneUpdate).toBe(false);
    expect(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(1);
    expect(harness.controller?.pause).not.toHaveBeenCalled();
    expect(harness.requestFrameCalls).toHaveLength(1);
  });

  it.each([
    {
      name: 'pending audio load/start',
      status: 'loading',
      game: 'playing',
      action: 'start',
      method: 'start',
    },
    {
      name: 'start count-in',
      status: 'starting',
      game: 'playing',
      action: 'start',
      method: 'start',
    },
    {
      name: 'pending resume gesture',
      status: 'paused',
      game: 'playing',
      action: 'resume',
      method: 'resume',
    },
    {
      name: 'pending results restart gesture',
      status: 'results',
      game: 'results',
      action: 'restart',
      method: 'restart',
    },
    {
      name: 'pending audio retry gesture',
      status: 'error',
      game: 'ready',
      action: 'start',
      method: 'restart',
    },
  ] as const)(
    'cancels $name on renderer loss without publishing recursively or replaying stale work',
    async ({ status, game, action, method }) => {
      await mountMain(['success', 'success']);
      expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
      harness.snapshot = makeSnapshot(
        status,
        game,
        status === 'error' ? 'decode failed' : null,
      );
      const pending = deferred<AppSnapshot>();
      harness.controller?.[method].mockImplementation(() => pending.promise);

      const pendingAction = Promise.resolve(harness.actions?.[action]?.());
      expect(harness.controller?.[method]).toHaveBeenCalledTimes(1);

      harness.failNextFrame = true;
      harness.renderSnapshot?.(harness.snapshot);

      expect(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(
        1,
      );
      expect(harness.controller?.pause).not.toHaveBeenCalled();
      expect(harness.uiRenderedDuringSceneUpdate).toBe(false);
      expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
        'unavailable',
        expect.any(String),
      );
      const playbackCallsBeforeResolve = {
        start: harness.controller?.start.mock.calls.length,
        resume: harness.controller?.resume.mock.calls.length,
        restart: harness.controller?.restart.mock.calls.length,
      };

      pending.resolve(makeSnapshot('ready', game));
      await pendingAction;

      expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
        'unavailable',
        expect.any(String),
      );
      expect(harness.controller?.start).toHaveBeenCalledTimes(
        playbackCallsBeforeResolve.start ?? 0,
      );
      expect(harness.controller?.resume).toHaveBeenCalledTimes(
        playbackCallsBeforeResolve.resume ?? 0,
      );
      expect(harness.controller?.restart).toHaveBeenCalledTimes(
        playbackCallsBeforeResolve.restart ?? 0,
      );

      await callAction('onRendererRetry');
      expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
      expect(harness.controller?.start).toHaveBeenCalledTimes(
        playbackCallsBeforeResolve.start ?? 0,
      );
      expect(harness.controller?.resume).toHaveBeenCalledTimes(
        playbackCallsBeforeResolve.resume ?? 0,
      );
      expect(harness.controller?.restart).toHaveBeenCalledTimes(
        playbackCallsBeforeResolve.restart ?? 0,
      );
      if (status === 'error') {
        expect(harness.snapshot?.audio).toMatchObject({
          status: 'error',
          error: 'decode failed',
        });
      }
    },
  );

  it.each([
    {
      name: 'start',
      status: 'loading',
      game: 'playing',
      action: 'start',
      method: 'start',
    },
    {
      name: 'resume',
      status: 'paused',
      game: 'playing',
      action: 'resume',
      method: 'resume',
    },
    {
      name: 'restart',
      status: 'results',
      game: 'results',
      action: 'restart',
      method: 'restart',
    },
  ] as const)(
    'suspension during pending $name pauses once, invalidates late work, and requires explicit resume after rendering',
    async ({ status, game, action, method }) => {
      await mountMain(['success']);
      const retainedScene = harness.scene;
      harness.snapshot = makeSnapshot(status, game);
      const pending = deferred<AppSnapshot>();
      harness.controller?.[method].mockImplementation(() => pending.promise);

      const pendingAction = Promise.resolve(harness.actions?.[action]?.());
      expect(harness.controller?.[method]).toHaveBeenCalledTimes(1);
      harness.frameStatuses = Array.from({ length: 20 }, () => 'suspended');
      harness.renderSnapshot?.(harness.snapshot);
      expect.soft(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
        'suspended',
        expect.any(String),
      );
      expect.soft(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(
        1,
      );
      expect.soft(harness.ui?.setBusy).toHaveBeenLastCalledWith(null);
      const busyClearsOnSuspend =
        harness.ui?.setBusy.mock.calls.filter(([message]) => message === null)
          .length ?? 0;
      harness.renderSnapshot?.(harness.snapshot);
      expect.soft(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(
        1,
      );
      expect(harness.ui?.setBusy.mock.calls.filter(([message]) => message === null))
        .toHaveLength(busyClearsOnSuspend);
      expect(harness.scene).toBe(retainedScene);
      expect(harness.scene?.destroy).not.toHaveBeenCalled();

      pending.resolve(makeSnapshot('ready', game));
      await pendingAction;
      expect.soft(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
        'suspended',
        expect.any(String),
      );
      expect(harness.ui?.setBusy.mock.calls.filter(([message]) => message === null))
        .toHaveLength(busyClearsOnSuspend);
      expect(harness.scene).toBe(retainedScene);

      harness.frameStatuses = ['rendered'];
      harness.snapshot = makeSnapshot('paused', game);
      harness.renderSnapshot?.(harness.snapshot);
      expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
      expect(harness.controller?.start).toHaveBeenCalledTimes(
        method === 'start' ? 1 : 0,
      );
      expect(harness.controller?.resume).toHaveBeenCalledTimes(
        method === 'resume' ? 1 : 0,
      );
      expect(harness.controller?.restart).toHaveBeenCalledTimes(
        method === 'restart' ? 1 : 0,
      );
      await callAction('resume');
      expect(harness.controller?.resume).toHaveBeenCalledTimes(
        method === 'resume' ? 2 : 1,
      );
      expect(harness.scene).toBe(retainedScene);
    },
  );

  it('treats failure during suspension as terminal and retries with a fresh generation', async () => {
    await mountMain(['success', 'success']);
    const oldScene = harness.scene;
    const staleFailure = harness.sceneCallbacks[0];
    harness.frameStatuses = ['suspended'];
    harness.renderSnapshot?.(harness.snapshot!);
    expect.soft(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
        'suspended',
      expect.any(String),
    );

    harness.sceneCallbacks[0]?.();
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
        'unavailable',
      expect.any(String),
    );
    expect(harness.controller?.pauseWithoutPublishing).toHaveBeenCalledTimes(1);

    await callAction('onRendererRetry');
    const replacement = harness.scene;
    expect(replacement).not.toBe(oldScene);
    expect(harness.scenes).toHaveLength(2);
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
    expect(harness.controller?.start).not.toHaveBeenCalled();
    expect(harness.controller?.resume).not.toHaveBeenCalled();
    expect(harness.controller?.restart).not.toHaveBeenCalled();

    staleFailure?.();
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith('rendered');
    expect(harness.scene).toBe(replacement);
  });
});
