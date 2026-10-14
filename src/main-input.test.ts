import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  actions: null as null | Record<string, () => unknown>,
  ui: null as null | Record<string, (...args: unknown[]) => unknown>,
  listeners: new Map<string, (event: unknown) => void>(),
  snapshot: null as null | {
    audio: { status: string };
    game: { status: string };
  },
  controller: null as null | Record<string, ReturnType<typeof vi.fn>>,
  disposeController: null as null | (() => Promise<void>),
  scene: null as null | Record<string, (...args: unknown[]) => unknown>,
  gameplayFrame: { gameplayProjection: true },
  frameStatus: 'rendered',
  sceneCreated: false,
  renderSnapshot: null as null | ((snapshot: unknown) => void),
  rendererUnavailable: null as null | (() => void),
}));

vi.mock('./ui/styles.css', () => ({}));
vi.mock('./audio/audio', () => ({ createAudioTransport: vi.fn(() => ({})) }));
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
  createBrightvaleScene: vi.fn((_host, onUnavailable) => {
    harness.sceneCreated = true;
    harness.rendererUnavailable = onUnavailable;
    return harness.scene;
  }),
}));
vi.mock('./rendering/scene-state', () => ({
  projectSceneState: vi.fn(() => ({ cityProjection: true })),
}));
vi.mock('./rendering/gameplay-frame', () => ({
  projectGameplayFrame: vi.fn(() => harness.gameplayFrame),
}));
vi.mock('./ui/ui', () => ({
  createGameUI: vi.fn((_root, _chart, actions) => {
    harness.actions = actions;
    const ui = {
      render: vi.fn(),
      setBusy: vi.fn(),
      setRendererStatus: vi.fn(),
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

describe('main keyboard routing', () => {
  beforeAll(async () => {
    const appRoot = {
      querySelector: (selector: string) =>
        selector === '.play-surface' ? {} : null,
    };
    const documentStub = {
      body: new TestHTMLElement(),
      visibilityState: 'visible',
      querySelector: (selector: string) =>
        selector === '#app' ? appRoot : null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
        harness.listeners.set(name, listener);
      },
      removeEventListener: vi.fn(),
    };

    harness.snapshot = {
      audio: { status: 'paused' },
      game: { status: 'playing' },
    };
    const disposeController = vi.fn(async () => undefined);
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
      dispose: disposeController,
      pauseWithoutPublishing: vi.fn(() => harness.snapshot),
    };
    harness.disposeController = disposeController;
    harness.scene = {
      update: vi.fn(),
      updateFrame: vi.fn(() => harness.frameStatus),
      destroy: vi.fn(),
    };

    vi.stubGlobal('HTMLElement', TestHTMLElement);
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    await import('./main');
  });

  it('keeps every playback route closed while renderer availability is false', async () => {
    expect(harness.sceneCreated).toBe(true);
    if (harness.snapshot === null) throw new Error('snapshot not initialized');

    for (const status of ['loading', 'suspended'] as const) {
      harness.frameStatus = status;
      harness.renderSnapshot?.(harness.snapshot);
      const keydown = harness.listeners.get('keydown');
      const keyup = harness.listeners.get('keyup');
      harness.actions?.start();
      harness.actions?.resume();
      harness.actions?.restart();
      keydown?.({
        code: 'Enter',
        target: new TestHTMLElement(),
        preventDefault: vi.fn(),
      });
      for (const code of ['KeyD', 'KeyF', 'KeyJ', 'KeyK']) {
        keydown?.({
          code,
          target: new TestHTMLElement(),
          repeat: false,
          preventDefault: vi.fn(),
        });
        keyup?.({ code });
      }
    }
    expect.soft(harness.controller?.start).not.toHaveBeenCalled();
    expect.soft(harness.controller?.resume).not.toHaveBeenCalled();
    expect.soft(harness.controller?.restart).not.toHaveBeenCalled();
    expect.soft(harness.controller?.keyDown).not.toHaveBeenCalled();
    expect.soft(harness.controller?.keyUp).not.toHaveBeenCalled();
    harness.controller?.start.mockClear();
    harness.controller?.resume.mockClear();
    harness.controller?.restart.mockClear();
    harness.controller?.keyDown.mockClear();
    harness.controller?.keyUp.mockClear();
    harness.frameStatus = 'rendered';
    harness.renderSnapshot?.(harness.snapshot);

    harness.rendererUnavailable?.();
    expect(harness.ui?.setRendererStatus).toHaveBeenLastCalledWith(
      'unavailable',
      expect.any(String),
    );

    const keydown = harness.listeners.get('keydown');
    if (keydown === undefined || harness.controller === null) {
      throw new Error('main keyboard listener was not installed');
    }
    const enter = () =>
      keydown({
        code: 'Enter',
        target: new TestHTMLElement(),
        preventDefault: vi.fn(),
      });

    harness.snapshot = {
      audio: { status: 'paused' },
      game: { status: 'playing' },
    };
    enter();
    expect.soft(harness.controller.resume).not.toHaveBeenCalled();
    expect.soft(harness.controller.restart).not.toHaveBeenCalled();

    harness.snapshot = {
      audio: { status: 'paused' },
      game: { status: 'results' },
    };
    enter();
    expect.soft(harness.controller.restart).not.toHaveBeenCalled();
    expect.soft(harness.controller.resume).not.toHaveBeenCalled();

    for (const audioStatus of ['ready', 'loading', 'error']) {
      harness.snapshot = {
        audio: { status: audioStatus },
        game: { status: 'ready' },
      };
      enter();
    }
    expect.soft(harness.controller.start).not.toHaveBeenCalled();
    expect.soft(harness.controller.restart).not.toHaveBeenCalled();

    const action = harness.actions;
    if (action === null) throw new Error('UI actions were not installed');
    action.start();
    action.resume();
    action.restart();
    expect.soft(harness.controller.start).not.toHaveBeenCalled();
    expect.soft(harness.controller.resume).not.toHaveBeenCalled();
    expect.soft(harness.controller.restart).not.toHaveBeenCalled();

    const laneKeydown = harness.listeners.get('keydown');
    const keyup = harness.listeners.get('keyup');
    laneKeydown?.({
      code: 'KeyD',
      target: new TestHTMLElement(),
      repeat: false,
      preventDefault: vi.fn(),
    });
    keyup?.({ code: 'KeyD' });
    expect.soft(harness.controller.keyDown).not.toHaveBeenCalled();
    expect.soft(harness.controller.keyUp).not.toHaveBeenCalled();

    harness.snapshot = {
      audio: { status: 'playing' },
      game: { status: 'playing' },
    };
    const escapePreventDefault = vi.fn();
    laneKeydown?.({
      code: 'Escape',
      target: new TestHTMLElement(),
      preventDefault: escapePreventDefault,
    });
    expect.soft(harness.controller.pause).toHaveBeenCalled();
    expect.soft(escapePreventDefault).toHaveBeenCalledOnce();
  });

  afterAll(async () => {
    for (const [name, listener] of harness.listeners) {
      window.removeEventListener(name, listener as EventListener);
    }
    cancelAnimationFrame(1);
    harness.scene?.destroy();
    harness.ui?.destroy();
    await harness.disposeController?.();
    harness.listeners.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
