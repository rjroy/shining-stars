import { afterEach, describe, expect, it, vi } from 'vitest';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface Snapshot {
  readonly audio: {
    readonly status: string;
    readonly error: string | null;
    readonly loaded?: boolean;
  };
  readonly game: { readonly status: string };
  readonly pendingPlaybackRequests?: boolean;
  readonly selectedDifficulty?: string;
}

interface Actions {
  readonly start: () => unknown;
  readonly pause: () => unknown;
  readonly resume: () => unknown;
  readonly restart: () => unknown;
  readonly selectDifficulty: (difficulty: string) => unknown;
  readonly onRendererRetry?: () => unknown;
}

const harness = vi.hoisted(() => ({
  actions: null as Actions | null,
  snapshots: [] as Snapshot[],
  rendererCallbacks: [] as Array<() => void>,
  sceneModes: [] as string[],
  frameStatuses: [] as string[],
  scenes: [] as Array<{ updateFrame: () => void; destroy: () => void }>,
  listeners: new Map<string, (event: unknown) => void>(),
  documentListeners: new Map<string, (event: unknown) => void>(),
  fetchCalls: 0,
  fetchGate: null as
    | null
    | (() => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>),
  decodeFailures: 0,
  contexts: [] as Array<{
    readonly sources: Array<{
      startCalls: number;
      stopCalls: number;
      connections: unknown[];
    }>;
    readonly gains: Array<{ gain: { value: number }; connections: unknown[] }>;
    currentTime: number;
  }>,
  ui: null as null | { destroy: () => unknown },
  uiEvents: [] as string[],
  frameCallbacks: [] as Array<() => void>,
  uiRendererAvailable: false,
}));

vi.mock('./styles.css', () => ({}));
vi.mock('./scene', () => ({
  createBrightvaleScene: vi.fn((_host, onUnavailable) => {
    harness.rendererCallbacks.push(onUnavailable);
    const mode = harness.sceneModes.shift() ?? 'success';
    if (mode === 'create-fails') {
      onUnavailable();
      return null;
    }
    let frameCount = 0;
    const scene = {
      updateFrame: vi.fn(() => {
        frameCount += 1;
        harness.uiEvents.push('scene-frame');
        if (
          (mode === 'first-frame-fails' && frameCount === 1) ||
          (mode === 'pre-action-render-fails' && frameCount === 2)
        ) {
          onUnavailable();
        }
        return harness.frameStatuses.shift() ?? 'rendered';
      }),
      destroy: vi.fn(),
    };
    harness.scenes.push(scene);
    return scene;
  }),
}));
vi.mock('./scene-state', () => ({ projectSceneState: vi.fn(() => ({})) }));
vi.mock('./gameplay-frame', () => ({
  projectGameplayFrame: vi.fn(() => ({})),
}));
vi.mock('./ui', () => ({
  createGameUI: vi.fn((_root, _chart, actions) => {
    harness.actions = actions;
    const ui = {
      render: vi.fn((snapshot: Snapshot) => {
        harness.snapshots.push(snapshot);
        harness.uiEvents.push(
          `render:${harness.uiRendererAvailable}:${snapshot.audio.status}:${snapshot.game.status}`,
        );
      }),
      setBusy: vi.fn((message: string | null) => {
        harness.uiEvents.push(`busy:${message === null ? 'clear' : 'set'}`);
      }),
      setRendererStatus: vi.fn((status: string) => {
        harness.uiRendererAvailable = status === 'rendered';
        harness.uiEvents.push(`renderer:${harness.uiRendererAvailable}`);
      }),
      getGameplayLayout: vi.fn(() => ({ cached: true })),
      showFatal: vi.fn(),
      destroy: vi.fn(),
    };
    harness.ui = ui;
    return ui;
  }),
}));

class TestBuffer {
  readonly duration = 200;
}

class TestSource extends EventTarget {
  buffer: TestBuffer | null = null;
  startCalls = 0;
  stopCalls = 0;
  readonly connections: unknown[] = [];

  connect(destination: unknown): void {
    this.connections.push(destination);
  }
  start(): void {
    this.startCalls += 1;
  }
  stop(): void {
    this.stopCalls += 1;
  }
  disconnect(): void {}
}

class TestGain {
  readonly gain = { value: 1 };
  readonly connections: unknown[] = [];

  connect(destination: unknown): void {
    this.connections.push(destination);
  }
}

class TestAudioContext extends EventTarget {
  currentTime = 0;
  state = 'suspended';
  readonly destination = {};
  readonly sources: TestSource[] = [];
  readonly gains: TestGain[] = [];

  constructor() {
    super();
    harness.contexts.push(this);
  }

  async resume(): Promise<void> {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.dispatchEvent(new Event('statechange'));
  }

  async decodeAudioData(): Promise<TestBuffer> {
    if (harness.decodeFailures > 0) {
      harness.decodeFailures -= 1;
      throw new Error('decode failed');
    }
    return new TestBuffer();
  }

  createBufferSource(): TestSource {
    const source = new TestSource();
    this.sources.push(source);
    return source;
  }

  createGain(): TestGain {
    const gain = new TestGain();
    this.gains.push(gain);
    return gain;
  }
}

class TestHTMLElement {
  readonly isContentEditable = false;
  matches(): boolean {
    return false;
  }
}

async function mountMain(sceneModes: string[]): Promise<void> {
  vi.resetModules();
  harness.actions = null;
  harness.snapshots = [];
  harness.rendererCallbacks = [];
  harness.sceneModes = [...sceneModes];
  harness.frameStatuses = [];
  harness.scenes = [];
  harness.listeners.clear();
  harness.documentListeners.clear();
  harness.fetchCalls = 0;
  harness.fetchGate = null;
  harness.decodeFailures = 0;
  harness.contexts = [];
  harness.ui = null;
  harness.uiEvents = [];
  harness.frameCallbacks = [];
  harness.uiRendererAvailable = false;

  const host = {};
  const appRoot = {
    querySelector: (selector: string) =>
      selector === '.play-surface' ? host : null,
  };
  const documentStub = {
    body: new TestHTMLElement(),
    visibilityState: 'visible',
    querySelector: (selector: string) => (selector === '#app' ? appRoot : null),
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      harness.documentListeners.set(name, listener),
    removeEventListener: (name: string) =>
      harness.documentListeners.delete(name),
  };
  const windowStub = {
    AudioContext: TestAudioContext,
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      harness.listeners.set(name, listener),
    removeEventListener: (name: string) => harness.listeners.delete(name),
  };
  vi.stubGlobal('HTMLElement', TestHTMLElement);
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('fetch', async () => {
    harness.fetchCalls += 1;
    if (harness.fetchGate !== null) return harness.fetchGate();
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    harness.frameCallbacks.push(callback);
    return harness.frameCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  await import('./main');
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function triggerRendererFailure(index = 0): void {
  const callback = harness.rendererCallbacks[index];
  if (callback === undefined)
    throw new Error('Renderer callback was not installed.');
  callback();
}

async function invoke(
  action: 'start' | 'pause' | 'resume' | 'restart' | 'onRendererRetry',
): Promise<void> {
  const callback = harness.actions?.[action];
  if (callback === undefined) throw new Error(`Missing action ${action}.`);
  await callback();
}

function enter(): void {
  harness.listeners.get('keydown')?.({
    code: 'Enter',
    target: new TestHTMLElement(),
    repeat: false,
    preventDefault: vi.fn(),
  });
}

afterEach(async () => {
  for (const name of harness.listeners.keys()) {
    window.removeEventListener(name, (() => undefined) as EventListener);
  }
  for (const name of harness.documentListeners.keys()) {
    document.removeEventListener(name, (() => undefined) as EventListener);
  }
  for (const scene of harness.scenes) (scene.destroy as () => void)();
  await harness.ui?.destroy();
  harness.listeners.clear();
  harness.documentListeners.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('main renderer failures with real audio transport and controller', () => {
  it('uses VITE_SONG_VOLUME on the stable output path across start, pause/resume, and restart', async () => {
    vi.stubEnv('VITE_SONG_VOLUME', '0');
    await mountMain(['success']);
    const context = harness.contexts[0];
    expect(context?.gains[0]?.gain.value).toBe(0);
    expect(context?.gains[0]?.connections).toEqual([{}]);

    await invoke('start');
    expect(context?.sources[0]?.connections).toEqual([context?.gains[0]]);
    expect(context?.gains[0]?.gain.value).toBe(0);
    await invoke('pause');
    await invoke('resume');
    expect(context?.sources[1]?.connections).toEqual([context?.gains[0]]);
    await invoke('restart');
    expect(context?.sources[2]?.connections).toEqual([context?.gains[0]]);
    expect(context?.gains[0]?.gain.value).toBe(0);
  });

  it('retains a decode error across renderer failure and makes Audio Retry available after 3D recovery', async () => {
    await mountMain(['success', 'success']);
    harness.decodeFailures = 1;

    await invoke('start');
    expect.soft(harness.snapshots.at(-1)?.audio).toMatchObject({
      status: 'error',
      error: 'decode failed',
    });

    triggerRendererFailure();
    expect.soft(harness.snapshots.at(-1)?.audio).toMatchObject({
      status: 'error',
      error: 'decode failed',
    });
    await invoke('onRendererRetry');
    expect.soft(harness.snapshots.at(-1)?.audio).toMatchObject({
      status: 'error',
      error: 'decode failed',
    });
    expect.soft(harness.fetchCalls).toBe(1);

    await invoke('start');
    expect.soft(harness.fetchCalls).toBe(2);
    expect.soft(harness.snapshots.at(-1)?.audio.status).not.toBe('error');
  });

  it('keeps an unstarted game loadable after initial renderer failure and recovers difficulty selection', async () => {
    await mountMain(['first-frame-fails', 'success']);
    expect(harness.fetchCalls).toBe(0);

    await invoke('onRendererRetry');
    expect.soft(harness.snapshots.at(-1)?.audio.status).toBe('loading');
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect.soft(harness.snapshots.at(-1)?.audio.loaded).toBe(false);
    let selectionError: unknown;
    try {
      harness.actions?.selectDifficulty('hard');
    } catch (error) {
      selectionError = error;
    }
    expect.soft(selectionError).toBeUndefined();

    const keydown = harness.listeners.get('keydown');
    keydown?.({
      code: 'Enter',
      target: new TestHTMLElement(),
      repeat: false,
      preventDefault: vi.fn(),
    });
    await flushMicrotasks();
    expect.soft(harness.fetchCalls).toBe(1);
  });

  it('keeps Start, Enter, and difficulty selection gated while a canceled initial load is still pending', async () => {
    await mountMain(['success', 'success']);
    const fetchGate = deferred<{
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>();
    harness.fetchGate = () => fetchGate.promise;

    const pendingStart = invoke('start');
    await flushMicrotasks();
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(true);
    expect.soft(harness.snapshots.at(-1)?.audio.loaded).toBe(false);
    triggerRendererFailure();
    await invoke('onRendererRetry');
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(true);

    const repeatedStart = invoke('start');
    enter();
    let selectionError: unknown;
    try {
      harness.actions?.selectDifficulty('hard');
    } catch (error) {
      selectionError = error;
    }
    expect.soft(selectionError).toBeUndefined();
    fetchGate.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    await Promise.all([pendingStart, repeatedStart]);
    await flushMicrotasks();

    expect.soft(harness.contexts[0]?.sources).toHaveLength(0);
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect.soft(harness.snapshots.at(-1)?.audio).toMatchObject({
      status: 'ready',
      loaded: true,
      error: null,
    });
    expect.soft(harness.snapshots.at(-1)?.selectedDifficulty).toBe('normal');

    harness.actions?.selectDifficulty('hard');
    expect(harness.snapshots.at(-1)?.selectedDifficulty).toBe('hard');
    await invoke('start');
    expect(harness.contexts[0]?.sources[0]?.startCalls).toBe(1);
  });

  it('keeps audio Retry pending and does not treat canceled unloaded audio as resumable', async () => {
    await mountMain(['success', 'success']);
    harness.decodeFailures = 1;
    await invoke('start');
    expect(harness.snapshots.at(-1)?.audio.status).toBe('error');

    const fetchGate = deferred<{
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>();
    harness.fetchGate = () => fetchGate.promise;
    const pendingRetry = invoke('start');
    await flushMicrotasks();
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(true);
    expect.soft(harness.snapshots.at(-1)?.audio.loaded).toBe(false);
    triggerRendererFailure();
    await invoke('onRendererRetry');
    expect.soft(harness.snapshots.at(-1)?.audio.status).toBe('paused');
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(true);
    expect.soft(harness.snapshots.at(-1)?.audio.loaded).toBe(false);

    const repeatedRetry = invoke('start');
    enter();
    let selectionError: unknown;
    try {
      harness.actions?.selectDifficulty('hard');
    } catch (error) {
      selectionError = error;
    }
    expect.soft(selectionError).toBeUndefined();
    fetchGate.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    await Promise.all([pendingRetry, repeatedRetry]);
    await flushMicrotasks();

    expect.soft(harness.contexts[0]?.sources).toHaveLength(0);
    expect.soft(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect.soft(harness.snapshots.at(-1)?.audio).toMatchObject({
      status: 'ready',
      loaded: true,
      error: null,
    });
    enter();
    await flushMicrotasks();
    expect(harness.contexts[0]?.sources[0]?.startCalls).toBe(1);
  });

  it('silently pauses an actually scheduled source on renderer loss without auto-resuming after retry', async () => {
    await mountMain(['success', 'success']);
    await invoke('start');
    const context = harness.contexts[0];
    expect(context?.sources[0]?.startCalls).toBe(1);
    expect(harness.snapshots.at(-1)?.audio.status).toBe('starting');
    expect(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect(harness.snapshots.at(-1)?.audio.loaded).toBe(true);

    triggerRendererFailure();
    expect(context?.sources[0]?.stopCalls).toBe(1);
    expect(harness.snapshots.at(-1)?.audio.status).toBe('paused');
    expect(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect(harness.snapshots.at(-1)?.audio.loaded).toBe(true);
    await invoke('onRendererRetry');
    expect(context?.sources).toHaveLength(1);
    expect(context?.sources[0]?.startCalls).toBe(1);

    enter();
    await flushMicrotasks();
    expect(context?.sources).toHaveLength(2);
    expect(context?.sources[1]?.startCalls).toBe(1);
  });

  it('pauses an actually scheduled source once during suspension and waits for explicit playback after restoration', async () => {
    await mountMain(['success']);
    await invoke('start');
    const context = harness.contexts[0];
    const scene = harness.scenes[0];
    expect(context?.sources[0]?.startCalls).toBe(1);
    expect(harness.snapshots.at(-1)?.audio.status).toBe('starting');

    harness.frameStatuses = ['suspended', 'suspended', 'rendered'];
    harness.frameCallbacks[0]?.();
    expect(harness.uiRendererAvailable).toBe(false);
    expect(context?.sources[0]?.stopCalls).toBe(1);
    expect(harness.snapshots.at(-1)?.audio.status).toBe('paused');
    expect(scene?.destroy).not.toHaveBeenCalled();

    harness.frameCallbacks.at(-1)?.();
    expect(harness.uiRendererAvailable).toBe(false);
    expect(context?.sources[0]?.stopCalls).toBe(1);
    expect(scene?.destroy).not.toHaveBeenCalled();

    harness.frameCallbacks.at(-1)?.();
    expect(harness.uiRendererAvailable).toBe(true);
    expect(context?.sources).toHaveLength(1);
    expect(context?.sources[0]?.startCalls).toBe(1);
    expect(harness.snapshots.at(-1)?.audio.status).toBe('paused');

    enter();
    await flushMicrotasks();
    expect(context?.sources).toHaveLength(2);
    expect(context?.sources[1]?.startCalls).toBe(1);
  });

  it('keeps results available across renderer recovery and allows a new run', async () => {
    await mountMain(['success', 'success']);
    await invoke('start');
    const context = harness.contexts[0];
    if (context === undefined)
      throw new Error('Audio context was not created.');
    context.currentTime = 70;
    harness.frameCallbacks[0]?.();
    expect(harness.snapshots.at(-1)?.game.status).toBe('results');

    triggerRendererFailure();
    expect(harness.snapshots.at(-1)?.game.status).toBe('results');
    await invoke('onRendererRetry');
    expect(harness.uiRendererAvailable).toBe(true);
    expect(harness.snapshots.at(-1)?.game.status).toBe('results');

    await invoke('restart');
    expect(context.sources.at(-1)?.startCalls).toBe(1);
  });

  it('cancels an in-flight Audio Retry after renderer loss without starting its late-loaded source', async () => {
    await mountMain(['success', 'success']);
    harness.decodeFailures = 1;
    await invoke('start');
    expect(harness.snapshots.at(-1)?.audio.status).toBe('error');

    const fetchGate = deferred<{
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>();
    harness.fetchGate = () => fetchGate.promise;
    const pendingRetry = invoke('start');
    await flushMicrotasks();
    expect(harness.fetchCalls).toBe(2);

    triggerRendererFailure();
    await invoke('onRendererRetry');
    fetchGate.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    await pendingRetry;

    const context = harness.contexts[0];
    expect(context?.sources).toHaveLength(0);
    expect(harness.snapshots.at(-1)?.audio.status).toBe('ready');
    await invoke('start');
    expect(context?.sources[0]?.startCalls).toBe(1);
  });

  it('does not auto-start a late load and publishes ready after renderer recovery', async () => {
    await mountMain(['success', 'success']);
    const fetchGate = deferred<{
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>();
    harness.fetchGate = () => fetchGate.promise;

    const pendingStart = invoke('start');
    await flushMicrotasks();
    expect(harness.fetchCalls).toBe(1);
    triggerRendererFailure();
    await invoke('onRendererRetry');

    fetchGate.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    await pendingStart;
    await flushMicrotasks();
    expect.soft(harness.contexts[0]?.sources).toHaveLength(0);
    expect(harness.uiEvents).toContain('render:true:ready:playing');
    expect(harness.snapshots.at(-1)).toMatchObject({
      audio: { status: 'ready', loaded: true, error: null },
      pendingPlaybackRequests: false,
    });

    await invoke('start');
    expect(harness.contexts[0]?.sources[0]?.startCalls).toBe(1);
  });

  it('publishes a load completed while unavailable and leaves Start available after retry', async () => {
    await mountMain(['success', 'success']);
    const fetchGate = deferred<{
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>();
    harness.fetchGate = () => fetchGate.promise;

    const pendingStart = invoke('start');
    await flushMicrotasks();
    triggerRendererFailure();
    fetchGate.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    await pendingStart;
    expect(harness.contexts[0]?.sources).toHaveLength(0);
    expect(harness.uiEvents).toContain('render:false:ready:playing');

    await invoke('onRendererRetry');
    expect(harness.uiRendererAvailable).toBe(true);
    expect(harness.uiEvents).toContain('render:true:ready:playing');
    expect(harness.snapshots.at(-1)).toMatchObject({
      audio: { status: 'ready', loaded: true, error: null },
      pendingPlaybackRequests: false,
    });
    expect(harness.contexts[0]?.sources).toHaveLength(0);

    await invoke('start');
    expect(harness.contexts[0]?.sources[0]?.startCalls).toBe(1);
  });

  it('keeps Start and difficulty available after a pre-action renderer recovery', async () => {
    await mountMain(['pre-action-render-fails', 'success']);

    await invoke('start');
    expect(harness.fetchCalls).toBe(0);
    expect(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);

    await invoke('onRendererRetry');
    expect(harness.uiRendererAvailable).toBe(true);
    expect(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect(harness.fetchCalls).toBe(0);
    let selectionError: unknown;
    try {
      harness.actions?.selectDifficulty('hard');
    } catch (error) {
      selectionError = error;
    }
    expect(selectionError).toBeUndefined();
    expect(harness.snapshots.at(-1)?.selectedDifficulty).toBe('hard');

    await invoke('start');
    expect(harness.fetchCalls).toBe(1);
    expect(harness.contexts[0]?.sources[0]?.startCalls).toBe(1);
  });

  it('blocks a newer Start while the canceled controller request remains pending', async () => {
    await mountMain(['success', 'success']);
    const fetchGate = deferred<{
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>();
    harness.fetchGate = () => fetchGate.promise;

    const canceledStart = invoke('start');
    await flushMicrotasks();
    triggerRendererFailure();
    await invoke('onRendererRetry');
    const busyCallsBeforeRetry = harness.uiEvents.filter((event) =>
      event.startsWith('busy:'),
    ).length;
    const extraStart = invoke('start');
    enter();
    expect(
      harness.uiEvents.filter((event) => event.startsWith('busy:')),
    ).toHaveLength(busyCallsBeforeRetry);
    expect(harness.fetchCalls).toBe(1);

    fetchGate.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    await Promise.all([canceledStart, extraStart]);
    await flushMicrotasks();

    expect(harness.contexts[0]?.sources).toHaveLength(0);
    expect(harness.snapshots.at(-1)?.pendingPlaybackRequests).toBe(false);
    expect(harness.snapshots.at(-1)?.audio).toMatchObject({
      status: 'ready',
      loaded: true,
      error: null,
    });

    await invoke('start');
    expect(harness.contexts[0]?.sources[0]?.startCalls).toBe(1);
  });
});
