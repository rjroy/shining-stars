import { beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  actions: null as null | Record<string, () => unknown>,
  listeners: new Map<string, (event: unknown) => void>(),
  snapshot: null as null | {
    audio: { status: string };
    game: { status: string };
  },
  controller: null as null | Record<string, (...args: unknown[]) => unknown>,
  scene: null as null | Record<string, (...args: unknown[]) => unknown>,
  gameplayFrame: { gameplayProjection: true },
  sceneCreated: false,
  renderSnapshot: null as null | ((snapshot: unknown) => void),
}));

vi.mock('./styles.css', () => ({}));
vi.mock('./audio', () => ({ createAudioTransport: vi.fn(() => ({})) }));
vi.mock('./browser-audio', () => ({
  createBrowserAudioContextAdapter: vi.fn(() => ({})),
}));
vi.mock('./controller', () => ({
  createGameController: vi.fn((dependencies) => {
    harness.renderSnapshot = dependencies.render;
    return harness.controller;
  }),
}));
vi.mock('./game', () => ({ createGame: vi.fn() }));
vi.mock('./scene', () => ({
  createBrightvaleScene: vi.fn(() => {
    harness.sceneCreated = true;
    return harness.scene;
  }),
}));
vi.mock('./scene-state', () => ({
  projectSceneState: vi.fn(() => ({ cityProjection: true })),
}));
vi.mock('./gameplay-frame', () => ({
  projectGameplayFrame: vi.fn(() => harness.gameplayFrame),
}));
vi.mock('./ui', () => ({
  createGameUI: vi.fn((_root, _chart, actions) => {
    harness.actions = actions;
    return {
      render: vi.fn(),
      setBusy: vi.fn(),
      setSceneFallback: vi.fn(),
      setRendererStatus: vi.fn(),
      getGameplayLayout: vi.fn(() => ({ cached: true })),
      showFatal: vi.fn(),
      destroy: vi.fn(),
    };
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
      dispose: vi.fn(async () => undefined),
    };
    harness.scene = {
      update: vi.fn(),
      updateFrame: vi.fn(),
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
    harness.renderSnapshot?.(harness.snapshot);
    expect(harness.scene?.updateFrame).toHaveBeenCalled();
    expect(harness.scene?.update).not.toHaveBeenCalled();
    expect(harness.scene?.updateFrame).toHaveBeenCalledWith({
      city: { cityProjection: true },
      gameplay: { gameplayProjection: true },
    });

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

    action.pause();
    laneKeydown?.({
      code: 'Escape',
      target: new TestHTMLElement(),
      preventDefault: vi.fn(),
    });
    expect.soft(harness.controller.pause).toHaveBeenCalled();
  });
});
