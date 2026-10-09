import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrightvaleScene, type SceneRenderer } from './scene';
import type { SceneStateProjection } from './scene-state';

const state: SceneStateProjection = {
  phase: 'audience',
  cityIntensity: 0.4,
  cityBrightness: 0.532,
  transitionProgress: 0,
  motion: {
    powerLinePulse: false,
    buildingPulse: false,
    windTravel: false,
    cameraPush: 0,
  },
  playerDefiant: true,
  twilightConsumed: false,
};

class TestCanvas extends EventTarget {
  className = '';
  removed = false;
  readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  remove(): void {
    this.removed = true;
    parentCanvas = null;
  }
}

let parentCanvas: TestCanvas | null = null;

function makeHost(): HTMLElement {
  return {
    clientWidth: 640,
    clientHeight: 480,
    get firstChild() {
      return parentCanvas;
    },
    insertBefore(canvas: TestCanvas) {
      parentCanvas = canvas;
      return canvas;
    },
  } as unknown as HTMLElement;
}

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

interface RendererControls {
  renderer: SceneRenderer;
  readonly canvas: TestCanvas;
  failRender: boolean;
  failInitialSize: boolean;
  renderedScene: THREE.Scene | null;
  readonly disposalOrder: string[];
  rendererDisposeCount: number;
}

function makeRenderer(): RendererControls {
  const canvas = new TestCanvas();
  const controls: RendererControls = {
    canvas,
    failRender: false,
    failInitialSize: false,
    renderedScene: null,
    disposalOrder: [],
    rendererDisposeCount: 0,
    renderer: null as unknown as SceneRenderer,
  };
  controls.renderer = {
    domElement: canvas as unknown as HTMLCanvasElement,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(() => {
      if (controls.failInitialSize) throw new Error('size failed');
    }),
    render(scene: THREE.Scene) {
      controls.renderedScene = scene;
      if (controls.failRender) throw new Error('render failed');
    },
    dispose() {
      controls.rendererDisposeCount += 1;
      controls.disposalOrder.push('renderer');
    },
  };
  return controls;
}

function installSceneGlobals(): void {
  TestResizeObserver.instances = [];
  parentCanvas = null;
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Brightvale scene resource lifecycle', () => {
  it.each(['destroy', 'context-loss'] as const)(
    'disposes both instanced meshes once before renderer release on %s',
    (cleanupMode) => {
      installSceneGlobals();
      const controls = makeRenderer();
      const onUnavailable = vi.fn();
      const scene = createBrightvaleScene(
        makeHost(),
        onUnavailable,
        () => controls.renderer,
      );

      expect(scene).not.toBeNull();
      scene?.update(state, 1);
      expect(controls.renderedScene).not.toBeNull();

      const instancedMeshes: THREE.InstancedMesh[] = [];
      controls.renderedScene?.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) instancedMeshes.push(object);
      });
      expect(instancedMeshes).toHaveLength(2);

      const disposed: string[] = [];
      instancedMeshes.forEach((mesh, index) => {
        mesh.addEventListener('dispose', () => {
          const name = `instance-${index}`;
          disposed.push(name);
          controls.disposalOrder.push(name);
        });
      });

      if (cleanupMode === 'destroy') {
        scene?.destroy();
        scene?.destroy();
      } else {
        controls.canvas.dispatchEvent(
          new Event('webglcontextlost', { cancelable: true }),
        );
        scene?.destroy();
      }

      expect(disposed).toEqual(['instance-0', 'instance-1']);
      expect(controls.disposalOrder.indexOf('instance-0')).toBeLessThan(
        controls.disposalOrder.indexOf('renderer'),
      );
      expect(controls.disposalOrder.indexOf('instance-1')).toBeLessThan(
        controls.disposalOrder.indexOf('renderer'),
      );
      expect(controls.rendererDisposeCount).toBe(1);
      expect(controls.canvas.removed).toBe(true);
      expect(onUnavailable).toHaveBeenCalledTimes(
        cleanupMode === 'destroy' ? 0 : 1,
      );
    },
  );

  it('turns an initial renderer sizing failure into one recoverable fallback', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    controls.failInitialSize = true;
    const onUnavailable = vi.fn();

    expect(() =>
      createBrightvaleScene(makeHost(), onUnavailable, () => controls.renderer),
    ).not.toThrow();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(controls.rendererDisposeCount).toBe(1);
    expect(controls.canvas.removed).toBe(true);
    expect(parentCanvas).toBeNull();
  });

  it('converts a render failure during resize into one recoverable fallback', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const onUnavailable = vi.fn();
    const scene = createBrightvaleScene(
      makeHost(),
      onUnavailable,
      () => controls.renderer,
    );
    scene?.update(state, 1);
    controls.failRender = true;

    expect(() => TestResizeObserver.instances[0]?.trigger()).not.toThrow();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(controls.rendererDisposeCount).toBe(1);
    expect(controls.canvas.removed).toBe(true);
    expect(TestResizeObserver.instances[0]?.disconnected).toBe(true);
    scene?.destroy();
    expect(controls.rendererDisposeCount).toBe(1);
  });
});
