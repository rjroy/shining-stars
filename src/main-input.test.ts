import { beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  actions: null as null | Record<string, () => unknown>,
  listeners: new Map<string, (event: unknown) => void>(),
  snapshot: null as null | {
    audio: { status: string };
    game: { status: string };
  },
  controller: null as null | Record<string, (...args: unknown[]) => unknown>,
}));

vi.mock('./styles.css', () => ({}));
vi.mock('./audio', () => ({ createAudioTransport: vi.fn(() => ({})) }));
vi.mock('./browser-audio', () => ({
  createBrowserAudioContextAdapter: vi.fn(() => ({})),
}));
vi.mock('./controller', () => ({
  createGameController: vi.fn(() => harness.controller),
}));
vi.mock('./game', () => ({ createGame: vi.fn() }));
vi.mock('./scene', () => ({ createBrightvaleScene: vi.fn() }));
vi.mock('./scene-state', () => ({ projectSceneState: vi.fn() }));
vi.mock('./ui', () => ({
  createGameUI: vi.fn((_root, _chart, actions) => {
    harness.actions = actions;
    return {
      render: vi.fn(),
      setBusy: vi.fn(),
      setSceneFallback: vi.fn(),
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
    const appRoot = { querySelector: () => null };
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

  it('resumes a normal pause but restarts when results are terminal and audio is paused', async () => {
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
    expect(harness.controller.resume).toHaveBeenCalledTimes(1);
    expect(harness.controller.restart).not.toHaveBeenCalled();

    harness.snapshot = {
      audio: { status: 'paused' },
      game: { status: 'results' },
    };
    enter();
    expect(harness.controller.restart).toHaveBeenCalledTimes(1);
    expect(harness.controller.resume).toHaveBeenCalledTimes(1);
  });
});
