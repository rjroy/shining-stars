import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIGHTVALE_ASSET_NAMES,
  type BrightvaleAssetName,
  type BrightvaleAssets,
} from './brightvale/assets';
import {
  BRIGHTVALE_PRODUCTION_ASSET_URLS,
  loadBrightvaleRuntimeAssets,
} from './brightvale/assets-runtime';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './brightvale/layout';
import * as brightvaleProjection from './brightvale/projection';
import type { BrightvaleShellComposition } from './brightvale/scene-shell';
import type {
  BrightvaleRendererStatus,
  BrightvaleViewportLayout,
} from './brightvale/viewport';
import { createBrightvaleScene, type SceneRenderer } from './scene';
import { FEEDBACK_VISIBLE_SECONDS, type GameplayFrame } from './gameplay-frame';
import type { SceneStateProjection } from './scene-state';
import { projectTimingWindowHalfProgress } from './note-projection';

const productionFiles: Record<BrightvaleAssetName, string> = {
  city: '../../assets/production/brightvale-distant-city/city.glb',
  highway: '../../assets/production/brightvale-highway/highway.glb',
  platform: '../../assets/production/brightvale-platform/platform.glb',
  endcaps: '../../assets/production/brightvale-platform-endcaps/endcaps.glb',
  crowd: '../../assets/production/brightvale-crowd/crowd.glb',
  framingLong: '../../assets/production/brightvale-outer-framing/long.glb',
  framingPost: '../../assets/production/brightvale-outer-framing/post.glb',
};

function productionFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const name = BRIGHTVALE_ASSET_NAMES.find(
      (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
    );
    if (name === undefined)
      throw new Error(`Unexpected production URL: ${url}`);
    const bytes = await readFile(
      new URL(productionFiles[name], import.meta.url),
    );
    return new Response(new Uint8Array(bytes), { status: 200 });
  }) as typeof fetch;
}

const city: SceneStateProjection = {
  phase: 'audience',
  victory: false,
  cityIntensity: 0.4,
  cityBrightness: 0.5,
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

interface SceneFrame {
  readonly city: SceneStateProjection;
  readonly gameplay: GameplayFrame;
}

interface SceneDependencies {
  readonly loadAssets: (signal: AbortSignal) => Promise<BrightvaleAssets>;
  readonly createComposition: (
    assets: BrightvaleAssets,
    world: THREE.Scene,
  ) => BrightvaleShellComposition;
}

interface SceneFacade {
  updateFrame(frame: SceneFrame): BrightvaleRendererStatus;
  updateObservatoryFrame(frame: {
    readonly width: number;
    readonly height: number;
    readonly elapsedSeconds: number;
    readonly reducedMotion: boolean;
  }): BrightvaleRendererStatus;
  getObservatoryAnchors(): readonly {
    readonly collectionId: string;
    readonly x: number;
    readonly y: number;
    readonly visible: boolean;
  }[];
  destroy(): void;
}

const makeScene = createBrightvaleScene as unknown as (
  host: HTMLElement,
  onUnavailable: () => void,
  rendererFactory: () => SceneRenderer,
  dependencies: SceneDependencies,
  collections?: readonly {
    id: string;
    title: string;
    sortOrder: number;
    songIds: readonly string[];
  }[],
) => SceneFacade | null;

function makeLayout(width = 1600, height = 900): BrightvaleViewportLayout {
  return {
    width,
    height,
    persistentHudExclusions: [
      { x: 0, y: 0, width, height: 54 },
      { x: 0, y: height - 72, width, height: 72 },
    ],
    labels: {
      time: { x: width - 160, y: 12, width: 120, height: 26 },
      countdown: { x: width / 2 - 90, y: height - 140, width: 180, height: 32 },
      legend: { x: 120, y: height - 110, width: width - 240, height: 24 },
      feedback: { x: width / 2 - 130, y: height - 170, width: 260, height: 28 },
    },
  };
}

function makeFrame(
  layout = makeLayout(),
  playing = true,
  notes: GameplayFrame['notes'] = [],
  timingWindows: GameplayFrame['timingWindows'] = {
    goodHalfProgress: 0.5,
    perfectHalfProgress: 0.25,
  },
): SceneFrame {
  return {
    city,
    gameplay: {
      layout,
      transportTime: 1,
      difficulty: 'easy',
      playing,
      reducedMotion: false,
      lanes: [0, 1, 2, 3].map((index) => ({ index: index as 0 | 1 | 2 | 3 })),
      notes,
      noteCapacity: notes.length,
      timingWindows,
      feedback: [],
      timeLabel: '00:01',
      legendLabel: 'Good ±500 ms · Perfect ±250 ms',
      countdownLabel: '',
    },
  };
}

function makeAssets(dispose = vi.fn()): BrightvaleAssets {
  const roots = Object.fromEntries(
    BRIGHTVALE_ASSET_NAMES.map((name) => [name, new THREE.Group()]),
  ) as unknown as BrightvaleAssets['roots'];
  for (const name of ['highway', 'platform'] as const) {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 100),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = name === 'highway' ? 0.41 : 0.43;
    roots[name].add(road);
  }
  return { roots, dispose };
}

interface RendererHarness {
  renderer: SceneRenderer;
  readonly calls: Array<{ scene: THREE.Scene; camera: THREE.Camera }>;
  readonly setSizes: Array<readonly [number, number, boolean | undefined]>;
  readonly pixelRatios: number[];
  viewport: readonly [number, number, number, number];
  scissor: readonly [number, number, number, number];
  scissorTest: boolean;
  readonly canvas: EventTarget & {
    className: string;
    removed: boolean;
    setAttribute(name: string, value: string): void;
    remove(): void;
  };
  failRender: boolean;
  failSize: boolean;
  disposeCount: number;
  readonly disposalOrder: string[];
}

function makeRenderer(order?: string[]): RendererHarness {
  const canvas = Object.assign(new EventTarget(), {
    className: '',
    removed: false,
    setAttribute() {},
    remove() {
      this.removed = true;
    },
  });
  const harness: RendererHarness = {
    canvas,
    calls: [],
    setSizes: [],
    pixelRatios: [],
    viewport: [0, 0, 1600, 900],
    scissor: [0, 0, 1600, 900],
    scissorTest: false,
    failRender: false,
    failSize: false,
    disposeCount: 0,
    disposalOrder: [],
    renderer: null as unknown as SceneRenderer,
  };
  harness.renderer = {
    domElement: canvas as unknown as HTMLCanvasElement,
    autoClear: true,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    setClearColor: vi.fn(),
    setPixelRatio: (value: number) => harness.pixelRatios.push(value),
    setSize: (width: number, height: number, updateStyle?: boolean) => {
      harness.setSizes.push([width, height, updateStyle]);
      if (harness.failSize) throw new Error('renderer sizing failed');
    },
    setViewport: (x: number, y: number, width: number, height: number) => {
      harness.viewport = [x, y, width, height];
    },
    setScissor: (x: number, y: number, width: number, height: number) => {
      harness.scissor = [x, y, width, height];
    },
    setScissorTest: (enabled: boolean) => {
      harness.scissorTest = enabled;
    },
    clear: vi.fn(),
    clearDepth: vi.fn(),
    render(scene: THREE.Scene, camera: THREE.Camera) {
      harness.calls.push({ scene, camera });
      if (harness.failRender) throw new Error('renderer frame failed');
    },
    dispose() {
      harness.disposeCount += 1;
      harness.disposalOrder.push('renderer');
      order?.push('renderer');
    },
  };
  return harness;
}

interface TestHost extends HTMLElement {
  width: number;
  height: number;
}

function makeHost(): TestHost {
  const children: unknown[] = [];
  const host = Object.assign(new EventTarget(), { width: 1600, height: 900 });
  Object.defineProperties(host, {
    clientWidth: { get: () => host.width },
    clientHeight: { get: () => host.height },
    firstChild: { get: () => children[0] ?? null },
  });
  Object.assign(host, {
    insertBefore(child: unknown) {
      children.unshift(child);
      return child;
    },
  });
  return host as unknown as TestHost;
}

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  disconnected = false;
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  observe(): void {}
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

function installSceneGlobals(): void {
  TestResizeObserver.instances = [];
  vi.stubGlobal('window', {
    devicePixelRatio: 2,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function dependencies(
  loadAssets: SceneDependencies['loadAssets'],
  createComposition: SceneDependencies['createComposition'],
): SceneDependencies {
  return { loadAssets, createComposition };
}

afterEach(() => vi.unstubAllGlobals());

async function renderWithProductionAssets(
  layout = makeLayout(1120, 700),
): Promise<{
  readonly assets: BrightvaleAssets;
  readonly camera?: THREE.Camera;
  readonly frame: SceneFrame;
  readonly fetch: typeof fetch;
  readonly renderer: RendererHarness;
  readonly scene: SceneFacade;
  readonly overlay?: THREE.Scene;
  readonly overlayCamera?: THREE.Camera;
  readonly status: BrightvaleRendererStatus;
  readonly world?: THREE.Scene;
  readonly unavailable: ReturnType<typeof vi.fn>;
}> {
  installSceneGlobals();
  const fetch = productionFetch();
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const assets = await loadBrightvaleRuntimeAssets(
    new AbortController().signal,
  );
  const renderer = makeRenderer();
  const unavailable = vi.fn();
  const scene = createBrightvaleScene(
    makeHost(),
    unavailable,
    () => renderer.renderer,
  );
  if (scene === null) {
    assets.dispose();
    throw new Error('production scene renderer failed to initialize');
  }
  const frame = makeFrame(
    layout,
    true,
    [
      { id: 'runway-start', lane: 0, progress: 0 },
      { id: 'junction', lane: 1, progress: 0.9742 },
      { id: 'target', lane: 2, progress: 1 },
    ],
    projectTimingWindowHalfProgress('easy'),
  );
  try {
    const status = await vi.waitFor(
      (): BrightvaleRendererStatus => {
        const nextStatus = scene.updateFrame(frame);
        if (nextStatus === 'loading')
          throw new Error('production assets loading');
        return nextStatus;
      },
      { timeout: 10_000 },
    );
    const worldRender = renderer.calls.at(-2);
    const overlayRender = renderer.calls.at(-1);
    if (
      status === 'rendered' &&
      (worldRender === undefined || overlayRender === undefined)
    )
      throw new Error('production scene did not issue both render passes');
    return {
      assets,
      camera: worldRender?.camera,
      fetch,
      frame,
      renderer,
      scene,
      overlay: overlayRender?.scene,
      overlayCamera: overlayRender?.camera,
      status,
      world: worldRender?.scene,
      unavailable,
    };
  } catch (error) {
    scene.destroy();
    assets.dispose();
    throw error;
  }
}

function productionSurfaceHeightAt(
  roots: BrightvaleAssets['roots'],
  localX: number,
  localZ: number,
): number | null {
  let highest: number | null = null;
  for (const root of [roots.highway, roots.platform]) {
    root.updateMatrixWorld(true);
    const inverseRoot = root.matrixWorld.clone().invert();
    const bounds = new THREE.Box3()
      .setFromObject(root)
      .applyMatrix4(inverseRoot);
    if (
      localX < bounds.min.x - 1e-5 ||
      localX > bounds.max.x + 1e-5 ||
      localZ < bounds.min.z - 1e-5 ||
      localZ > bounds.max.z + 1e-5
    )
      continue;
    const origin = new THREE.Vector3(
      localX,
      bounds.max.y + 1,
      localZ,
    ).applyMatrix4(root.matrixWorld);
    const direction = new THREE.Vector3(0, -1, 0).transformDirection(
      root.matrixWorld,
    );
    const raycaster = new THREE.Raycaster(origin, direction, 0, 1000);
    for (const hit of raycaster.intersectObject(root, true)) {
      const point = hit.point.applyMatrix4(inverseRoot);
      if (
        Math.abs(point.x - localX) > 1e-4 ||
        Math.abs(point.z - localZ) > 1e-4
      )
        continue;
      highest = highest === null ? point.y : Math.max(highest, point.y);
    }
  }
  return highest;
}

describe('Brightvale scene facade and renderer lifecycle', () => {
  it('stays loading until bundle resolution, then reports rendered only after both passes succeed', async () => {
    installSceneGlobals();
    const host = makeHost();
    const unavailable = vi.fn();
    const disposalOrder: string[] = [];
    const renderer = makeRenderer(disposalOrder);
    const bundleDispose = vi.fn(() => disposalOrder.push('assets'));
    const bundle = makeAssets(bundleDispose);
    const load = deferred<BrightvaleAssets>();
    const compositionRoot = new THREE.Group();
    const compositionDispose = vi.fn(() => disposalOrder.push('composition'));
    const createComposition = vi.fn(() => ({
      root: compositionRoot,
      dispose: compositionDispose,
    }));
    const scene = makeScene(
      host,
      unavailable,
      () => renderer.renderer,
      dependencies(() => load.promise, createComposition),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');

    expect.soft(scene.updateFrame(makeFrame())).toBe('loading');
    expect.soft(renderer.calls).toHaveLength(0);
    expect.soft(createComposition).not.toHaveBeenCalled();

    load.resolve(bundle);
    await Promise.resolve();
    await Promise.resolve();
    expect.soft(scene.updateFrame(makeFrame())).toBe('rendered');
    expect.soft(createComposition).toHaveBeenCalledTimes(1);
    expect.soft(renderer.calls).toHaveLength(2);
    expect
      .soft(renderer.calls[0]?.camera)
      .toBeInstanceOf(THREE.PerspectiveCamera);
    expect
      .soft(renderer.calls[1]?.camera)
      .toBeInstanceOf(THREE.OrthographicCamera);
    expect.soft(renderer.calls[0]?.scene).not.toBe(renderer.calls[1]?.scene);
    expect.soft(renderer.setSizes).toContainEqual([1600, 900, false]);
    expect.soft(renderer.pixelRatios).toContain(1.5);
    expect.soft(unavailable).not.toHaveBeenCalled();

    scene.destroy();
    expect(compositionDispose).toHaveBeenCalledTimes(1);
    expect(bundleDispose).toHaveBeenCalledTimes(1);
    expect(disposalOrder).toEqual(['composition', 'assets', 'renderer']);
  });

  it('initializes Observatory directly through one renderer and keeps projected anchors in CSS pixels', async () => {
    const host = makeHost();
    const renderer = makeRenderer();
    const assets = makeAssets();
    const scene = makeScene(
      host,
      vi.fn(),
      () => renderer.renderer,
      {
        loadAssets: vi.fn(async () => assets),
        createComposition: vi.fn(() => ({
          root: new THREE.Group(),
          dispose: vi.fn(),
        })),
      },
      [
        {
          id: 'test-collection',
          title: 'Test Collection',
          sortOrder: 10,
          songIds: ['song'],
        },
      ],
    );
    expect(scene).not.toBeNull();
    if (scene === null) throw new Error('scene did not initialize');
    expect(
      scene.updateObservatoryFrame({
        width: 1600,
        height: 900,
        elapsedSeconds: 0,
        reducedMotion: false,
      }),
    ).toBe('loading');
    await Promise.resolve();
    await Promise.resolve();
    expect(
      scene.updateObservatoryFrame({
        width: 1600,
        height: 900,
        elapsedSeconds: 2,
        reducedMotion: true,
      }),
    ).toBe('rendered');
    const observatoryRender = renderer.calls.at(-1)!;
    expect(observatoryRender.camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect(renderer.calls).toHaveLength(1);
    expect(scene.getObservatoryAnchors()).toMatchObject([
      { collectionId: 'test-collection', visible: true },
    ]);

    scene.destroy();
    expect(renderer.disposeCount).toBe(1);
    expect(assets.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the active Observatory mode on a late gameplay layout measurement until gameplay is explicitly selected', async () => {
    const host = makeHost();
    const renderer = makeRenderer();
    const assets = makeAssets();
    const scene = makeScene(
      host,
      vi.fn(),
      () => renderer.renderer,
      {
        loadAssets: vi.fn(async () => assets),
        createComposition: vi.fn(() => ({
          root: new THREE.Group(),
          dispose: vi.fn(),
        })),
      },
      [
        {
          id: 'test-collection',
          title: 'Test Collection',
          sortOrder: 10,
          songIds: ['song'],
        },
      ],
    );
    if (scene === null) throw new Error('scene did not initialize');

    expect(scene.updateFrame(makeFrame())).toBe('loading');
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.updateFrame(makeFrame())).toBe('rendered');
    expect(
      scene.updateObservatoryFrame({
        width: 1600,
        height: 900,
        elapsedSeconds: 1,
        reducedMotion: false,
      }),
    ).toBe('rendered');
    const observatoryScene = renderer.calls.at(-1)?.scene;
    const renderCount = renderer.calls.length;

    host.dispatchEvent(
      new CustomEvent('brightvale-layout-measured', {
        detail: makeLayout(1200, 800),
      }),
    );
    expect(renderer.calls).toHaveLength(renderCount + 1);
    expect(renderer.calls.at(-1)?.scene).toBe(observatoryScene);
    expect(renderer.calls.at(-1)?.camera).toBeInstanceOf(
      THREE.OrthographicCamera,
    );
    expect(renderer.setSizes.at(-1)).toEqual([1200, 800, false]);
    const resizedRender = renderer.calls.at(-1)!;
    const resizedCamera = resizedRender.camera as THREE.OrthographicCamera;
    expect(resizedCamera.left).toBeCloseTo(-12);
    expect(resizedCamera.right).toBeCloseTo(12);
    expect(resizedCamera.top).toBeCloseTo(5);
    expect(resizedCamera.bottom).toBeCloseTo(-5);
    const constellation = resizedRender.scene.getObjectByName(
      'Observatory.CollectionAnchor.test-collection',
    );
    if (constellation === undefined)
      throw new Error('resized Observatory constellation is missing');
    resizedRender.scene.updateMatrixWorld(true);
    const projectedAnchor = new THREE.Vector3(0, 0, 0)
      .applyMatrix4(constellation.matrixWorld)
      .project(resizedCamera);
    const [anchor] = scene.getObservatoryAnchors();
    expect(anchor?.collectionId).toBe('test-collection');
    expect(anchor?.x).toBeCloseTo(((projectedAnchor.x + 1) / 2) * 1200);
    expect(anchor?.y).toBeCloseTo(((1 - projectedAnchor.y) / 2) * 800);
    expect(anchor?.visible).toBe(true);

    expect(scene.updateFrame(makeFrame(makeLayout(1200, 800)))).toBe(
      'rendered',
    );
    expect(renderer.calls.at(-2)?.camera).toBeInstanceOf(
      THREE.PerspectiveCamera,
    );
    scene.destroy();
  });

  it('suspends at zero raw dimensions without disposal, then resumes on a non-playing frame', async () => {
    installSceneGlobals();
    const renderer = makeRenderer();
    const bundle = makeAssets();
    const compositionDispose = vi.fn();
    const scene = makeScene(
      makeHost(),
      vi.fn(),
      () => renderer.renderer,
      dependencies(
        async () => bundle,
        () => ({ root: new THREE.Group(), dispose: compositionDispose }),
      ),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');
    await Promise.resolve();
    await Promise.resolve();
    expect.soft(scene.updateFrame(makeFrame())).toBe('rendered');
    expect
      .soft(scene.updateFrame(makeFrame(makeLayout(0, 0), true)))
      .toBe('suspended');
    // Scene rendering only receives the gameplay frame. DOM modal visibility
    // is verified by the real-browser GameUI tests, not inferred here.
    expect
      .soft(scene.updateFrame(makeFrame(makeLayout(), false)))
      .toBe('rendered');
    expect.soft(renderer.calls).toHaveLength(4);
    expect(bundle.dispose).not.toHaveBeenCalled();
    expect(compositionDispose).not.toHaveBeenCalled();
    scene.destroy();
    expect(compositionDispose).toHaveBeenCalledTimes(1);
  });

  it('suspends on a positive viewport exhausted by persistent HUD and resumes with the same composition', async () => {
    installSceneGlobals();
    const renderer = makeRenderer();
    const bundle = makeAssets();
    const compositionDispose = vi.fn();
    const composition = {
      root: new THREE.Group(),
      dispose: compositionDispose,
    };
    const createComposition = vi.fn(() => composition);
    const unavailable = vi.fn();
    const scene = makeScene(
      makeHost(),
      unavailable,
      () => renderer.renderer,
      dependencies(async () => bundle, createComposition),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(scene.updateFrame(makeFrame())).toBe('rendered');

      const baseLayout = makeLayout(1600, 900);
      const exhausted: BrightvaleViewportLayout = {
        ...baseLayout,
        persistentHudExclusions: [
          { x: 0, y: 0, width: 1600, height: 500 },
          { x: 0, y: 400, width: 1600, height: 500 },
        ],
      };
      expect(exhausted.width).toBeGreaterThan(0);
      expect(exhausted.height).toBeGreaterThan(0);
      expect(
        exhausted.persistentHudExclusions[0]!.height,
      ).toBeGreaterThanOrEqual(
        exhausted.height - exhausted.persistentHudExclusions[1]!.y,
      );
      expect(
        exhausted.labels.time.y + exhausted.labels.time.height,
      ).toBeLessThan(exhausted.persistentHudExclusions[0]!.height);
      expect(scene.updateFrame(makeFrame(exhausted))).toBe('suspended');
      expect(renderer.calls).toHaveLength(2);
      expect(unavailable).not.toHaveBeenCalled();
      expect(compositionDispose).not.toHaveBeenCalled();
      expect(bundle.dispose).not.toHaveBeenCalled();

      expect(scene.updateFrame(makeFrame())).toBe('rendered');
      expect(createComposition).toHaveBeenCalledTimes(1);
      expect(compositionDispose).not.toHaveBeenCalled();
      expect(scene.updateFrame(makeFrame(makeLayout(0, 0)))).toBe('suspended');
      scene.destroy();
      expect(compositionDispose).toHaveBeenCalledTimes(1);
      expect(bundle.dispose).toHaveBeenCalledTimes(1);
      expect(unavailable).not.toHaveBeenCalled();
    } finally {
      scene.destroy();
    }
  });

  it('keeps real rendered timing-envelope vertices above sampled production road surfaces', async () => {
    const rendered = await renderWithProductionAssets();
    try {
      if (rendered.world === undefined)
        throw new Error('production scene did not render its world pass');
      const inversePlayfield = new THREE.Matrix4()
        .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor])
        .invert();
      rendered.world.updateMatrixWorld(true);
      const envelopes = rendered.world.children.filter(
        (object) => object.userData.gameplayRole === 'note-good-envelope',
      ) as THREE.Mesh[];
      expect(envelopes).toHaveLength(rendered.frame.gameplay.notes.length);
      const measuredClearances: Array<{
        readonly clearance: number;
        readonly lane: number;
        readonly noteId: string;
        readonly progress: number;
      }> = [];
      for (const [noteIndex, envelope] of envelopes.entries()) {
        const note = rendered.frame.gameplay.notes[noteIndex]!;
        const lane = note.lane;
        const positions = envelope.geometry.getAttribute('position');
        const segmentCount = positions.count / 2 - 1;
        expect(positions.count).toBeGreaterThan(0);
        for (let index = 0; index + 1 < positions.count; index += 2) {
          const sampleProgress =
            note.progress -
            rendered.frame.gameplay.timingWindows.goodHalfProgress +
            (index / 2 / segmentCount) *
              rendered.frame.gameplay.timingWindows.goodHalfProgress *
              2;
          if (sampleProgress > 1 || sampleProgress < 0) continue;
          for (const vertexIndex of [index, index + 1]) {
            const localVertex = new THREE.Vector3()
              .fromBufferAttribute(positions, vertexIndex)
              .applyMatrix4(envelope.matrixWorld)
              .applyMatrix4(inversePlayfield);
            const roadHeight = productionSurfaceHeightAt(
              rendered.assets.roots,
              localVertex.x,
              localVertex.z,
            );
            // No extrapolation beyond actual road meshes or the hit target.
            if (roadHeight !== null)
              measuredClearances.push({
                clearance: localVertex.y - roadHeight,
                lane,
                noteId: note.id,
                progress: sampleProgress,
              });
          }
        }
      }
      expect(measuredClearances.length).toBeGreaterThan(0);
      const minimum = measuredClearances.reduce((lowest, sample) =>
        sample.clearance < lowest.clearance ? sample : lowest,
      );
      expect(
        minimum.clearance,
        `note ${minimum.noteId} lane ${minimum.lane} at progress ${minimum.progress}`,
      ).toBeGreaterThan(0.005);
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
  });

  it('fits the overlay camera to CSS pixels before projecting labels on the first rendered frame', async () => {
    const rendered = await renderWithProductionAssets();
    try {
      if (
        rendered.overlay === undefined ||
        !(rendered.overlayCamera instanceof THREE.OrthographicCamera)
      )
        throw new Error('first production overlay pass was not captured');
      const layout = rendered.frame.gameplay.layout;
      rendered.overlayCamera.updateMatrixWorld(true);
      for (const name of ['time', 'countdown', 'legend'] as const) {
        const label = rendered.overlay.children.find(
          (object) => object.name === `Brightvale.Label.${name}`,
        );
        if (label === undefined)
          throw new Error(`first overlay pass is missing ${name} label`);
        const rect = layout.labels[name];
        const projected = label.position
          .clone()
          .project(rendered.overlayCamera);
        const screenX = ((projected.x + 1) * layout.width) / 2;
        const screenY = ((1 - projected.y) * layout.height) / 2;
        expect(projected.x).toBeGreaterThanOrEqual(-1);
        expect(projected.x).toBeLessThanOrEqual(1);
        expect(projected.y).toBeGreaterThanOrEqual(-1);
        expect(projected.y).toBeLessThanOrEqual(1);
        expect(screenX).toBeCloseTo(rect.x + rect.width / 2, 5);
        expect(screenY).toBeCloseTo(rect.y + rect.height / 2, 5);
      }
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
  });

  it('renders lane-local impact rings and readable judgments, reusing the bounded pool through expiry and reduced motion', async () => {
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.stubGlobal('document', {
      createElement: () => ({ width: 1, height: 1, getContext: () => context }),
    });
    const rendered = await renderWithProductionAssets();
    try {
      const canvasTextureFor = (
        overlay: THREE.Scene | undefined,
        lane: number,
      ) => {
        const judgmentLabel = overlay?.children.find(
          (object) => object.name === `Brightvale.Label.judgment-${lane}`,
        ) as THREE.Mesh | undefined;
        return (judgmentLabel?.material as THREE.MeshBasicMaterial | undefined)
          ?.map;
      };
      const initialTextures = [0, 2, 3].map((lane) =>
        canvasTextureFor(rendered.renderer.calls.at(-1)?.scene, lane),
      );
      expect(
        initialTextures.every(
          (texture) => texture instanceof THREE.CanvasTexture,
        ),
      ).toBe(true);
      const activeFrame: SceneFrame = {
        ...rendered.frame,
        gameplay: {
          ...rendered.frame.gameplay,
          feedback: [
            {
              eventId: 1,
              runId: 1,
              noteId: 'perfect-note',
              lane: 0,
              quality: 'perfect',
              onsetTransportTime: 1,
              age: 0,
            },
            {
              eventId: 2,
              runId: 1,
              noteId: 'good-note',
              lane: 2,
              quality: 'good',
              onsetTransportTime: 1,
              age: 0,
            },
            {
              eventId: 3,
              runId: 1,
              noteId: 'miss-note',
              lane: 3,
              quality: 'miss',
              onsetTransportTime: 1,
              age: 0,
            },
          ],
        },
      };
      expect(rendered.scene.updateFrame(activeFrame)).toBe('rendered');
      const world = rendered.renderer.calls.at(-2)?.scene;
      const overlay = rendered.renderer.calls.at(-1)?.scene;
      expect([0, 2, 3].map((lane) => canvasTextureFor(overlay, lane))).toEqual(
        initialTextures,
      );
      const impacts = world?.children.filter(
        (object) => object.userData.gameplayRole === 'lane-judgment-effect',
      ) as THREE.Group[] | undefined;
      expect(impacts).toHaveLength(4);
      expect(impacts?.map((impact) => impact.visible)).toEqual([
        true,
        false,
        true,
        true,
      ]);
      for (const [lane, text] of [
        [0, 'PERFECT'],
        [2, 'GOOD'],
        [3, 'MISS'],
      ] as const) {
        const labelMesh = overlay?.children.find(
          (object) => object.name === `Brightvale.Label.judgment-${lane}`,
        );
        expect(labelMesh).toBeInstanceOf(THREE.Mesh);
        expect(labelMesh?.visible).toBe(true);
        expect(labelMesh?.userData.gameplayRole).toBe('screen-label');
        expect(context.fillText).toHaveBeenCalledWith(
          text,
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        );
      }
      const rayMaterial = impacts?.[0]?.children.find(
        (object) => object.userData.gameplayRole === 'lane-judgment-rays',
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(rayMaterial.visible).toBe(true);
      expect(rayMaterial.geometry.getAttribute('position').count).toBe(24);
      expect(rayMaterial.material.opacity).toBeGreaterThan(0);
      expect(rayMaterial.material.depthTest).toBe(true);
      const missRays = impacts?.[3]?.children.find(
        (object) => object.userData.gameplayRole === 'lane-judgment-rays',
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(missRays.visible).toBe(true);
      expect(missRays.material.opacity).toBeLessThan(
        rayMaterial.material.opacity,
      );
      expect(missRays.scale.x).toBeLessThan(1);

      const ring = impacts?.[0]?.children.find(
        (object) => object.userData.gameplayRole === 'lane-judgment-ring',
      ) as THREE.Mesh;
      const initialGeometry = ring.geometry;
      const initialScale = impacts?.[0]?.scale.x ?? 0;
      const initialOpacity = (ring.material as THREE.MeshBasicMaterial).opacity;
      const nextFrame: SceneFrame = {
        ...activeFrame,
        gameplay: {
          ...activeFrame.gameplay,
          reducedMotion: true,
          feedback: activeFrame.gameplay.feedback.map((event) => ({
            ...event,
            age: 0.3,
          })),
        },
      };
      expect(rendered.scene.updateFrame(nextFrame)).toBe('rendered');
      const nextWorld = rendered.renderer.calls.at(-2)?.scene;
      expect(
        [0, 2, 3].map((lane) =>
          canvasTextureFor(rendered.renderer.calls.at(-1)?.scene, lane),
        ),
      ).toEqual(initialTextures);
      const nextImpact = nextWorld?.children.find(
        (object) =>
          object.userData.gameplayRole === 'lane-judgment-effect' &&
          object.name.endsWith('.0'),
      ) as THREE.Group;
      const nextRing = nextImpact.children.find(
        (object) => object.userData.gameplayRole === 'lane-judgment-ring',
      ) as THREE.Mesh;
      const nextRays = nextImpact.children.find(
        (object) => object.userData.gameplayRole === 'lane-judgment-rays',
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(nextRing.geometry).toBe(initialGeometry);
      expect(nextImpact.scale.x).toBe(initialScale);
      expect(
        (nextRing.material as THREE.MeshBasicMaterial).opacity,
      ).toBeLessThan(initialOpacity);
      expect(nextRays.material.opacity).toBeCloseTo(
        Math.pow(1 - 0.3 / FEEDBACK_VISIBLE_SECONDS, 0.25),
      );
      const nextReducedOpacity = nextRays.material.opacity;

      const laterReducedFrame: SceneFrame = {
        ...nextFrame,
        gameplay: {
          ...nextFrame.gameplay,
          feedback: nextFrame.gameplay.feedback.map((event) => ({
            ...event,
            age: 0.6,
          })),
        },
      };
      expect(rendered.scene.updateFrame(laterReducedFrame)).toBe('rendered');
      const laterWorld = rendered.renderer.calls.at(-2)?.scene;
      const laterImpact = laterWorld?.children.find(
        (object) =>
          object.userData.gameplayRole === 'lane-judgment-effect' &&
          object.name.endsWith('.0'),
      ) as THREE.Group;
      const laterRays = laterImpact.children.find(
        (object) => object.userData.gameplayRole === 'lane-judgment-rays',
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(laterRays.material.opacity).toBeCloseTo(
        Math.pow(1 - 0.6 / FEEDBACK_VISIBLE_SECONDS, 0.25),
      );
      expect(laterRays.material.opacity).toBeLessThan(nextReducedOpacity);

      const expired: SceneFrame = {
        ...laterReducedFrame,
        gameplay: { ...laterReducedFrame.gameplay, feedback: [] },
      };
      expect(rendered.scene.updateFrame(expired)).toBe('rendered');
      const expiredWorld = rendered.renderer.calls.at(-2)?.scene;
      expect(
        expiredWorld?.children
          .filter(
            (object) => object.userData.gameplayRole === 'lane-judgment-effect',
          )
          .every((object) => !object.visible),
      ).toBe(true);
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
  });

  it('submits front-facing overlay label triangles with upright texture UVs on first and resized frames', async () => {
    const rendered = await renderWithProductionAssets();
    try {
      const inspectOverlayLabels = (
        overlay: THREE.Scene | undefined,
        camera: THREE.Camera | undefined,
        layout: BrightvaleViewportLayout,
      ): {
        readonly uvFailures: string[];
        readonly windingFailures: string[];
      } => {
        if (overlay === undefined || camera === undefined)
          throw new Error('production overlay pass was not captured');
        overlay.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        const names = [
          'time',
          'countdown',
          'legend',
          'judgment-0',
          'judgment-1',
          'judgment-2',
          'judgment-3',
          'lane-0',
          'lane-1',
          'lane-2',
          'lane-3',
        ];
        const labels = names.map((name) => {
          const label = overlay.children.find(
            (object) => object.name === `Brightvale.Label.${name}`,
          );
          if (!(label instanceof THREE.Mesh))
            throw new Error(`production overlay ${name} mesh is missing`);
          return label;
        });
        expect(labels).toHaveLength(names.length);
        expect(
          overlay.children.some(
            (object) => object.name === 'Brightvale.Label.hit',
          ),
        ).toBe(false);
        const uvFailures: string[] = [];
        const windingFailures: string[] = [];
        for (const label of labels) {
          const positions = label.geometry.getAttribute('position');
          const uvs = label.geometry.getAttribute('uv');
          const indices = label.geometry.getIndex();
          const materials = Array.isArray(label.material)
            ? label.material
            : [label.material];
          expect(positions.count).toBeGreaterThan(0);
          expect(uvs.count).toBe(positions.count);
          expect(indices).not.toBeNull();
          expect(
            materials.every((material) => material.side === THREE.FrontSide),
          ).toBe(true);
          let topY = 0;
          let topCount = 0;
          let bottomY = 0;
          let bottomCount = 0;
          for (let vertex = 0; vertex < positions.count; vertex += 1) {
            const uv = uvs.getY(vertex);
            const world = new THREE.Vector3()
              .fromBufferAttribute(positions, vertex)
              .applyMatrix4(label.matrixWorld);
            const screenY = ((1 - world.project(camera).y) * layout.height) / 2;
            if (uv > 0.5) {
              topY += screenY;
              topCount += 1;
            } else {
              bottomY += screenY;
              bottomCount += 1;
            }
          }
          expect(topCount).toBeGreaterThan(0);
          expect(bottomCount).toBeGreaterThan(0);
          if (topY / topCount >= bottomY / bottomCount)
            uvFailures.push(
              `${label.name}: texture top screenY=${topY / topCount}, bottom screenY=${bottomY / bottomCount}`,
            );

          if (indices === null)
            throw new Error('label geometry must be indexed');
          const areas: number[] = [];
          for (let triangle = 0; triangle < indices.count; triangle += 3) {
            const points = [0, 1, 2].map((offset) => {
              const vertex = indices.getX(triangle + offset);
              return new THREE.Vector3()
                .fromBufferAttribute(positions, vertex)
                .applyMatrix4(label.matrixWorld)
                .project(camera);
            });
            const a = points[0]!;
            const b = points[1]!;
            const c = points[2]!;
            areas.push((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
          }
          expect(areas.length).toBeGreaterThan(0);
          if (!areas.every((area) => area > 0))
            windingFailures.push(
              `${label.name}: signed projected areas ${JSON.stringify(areas)}`,
            );
          for (const material of materials) {
            const mapped = material as THREE.Material & {
              map?: THREE.Texture | null;
            };
            if (mapped.map !== undefined && mapped.map !== null)
              expect(mapped.map.image).toBeDefined();
          }
        }
        return { uvFailures, windingFailures };
      };

      const firstFrame = inspectOverlayLabels(
        rendered.overlay,
        rendered.renderer.calls.at(-1)?.camera,
        rendered.frame.gameplay.layout,
      );
      const resizedLayout = makeLayout(1024, 768);
      const resizedFrame: SceneFrame = {
        ...rendered.frame,
        gameplay: {
          ...rendered.frame.gameplay,
          layout: resizedLayout,
        },
      };
      expect(rendered.scene.updateFrame(resizedFrame)).toBe('rendered');
      const resized = inspectOverlayLabels(
        rendered.renderer.calls.at(-1)?.scene,
        rendered.renderer.calls.at(-1)?.camera,
        resizedLayout,
      );
      expect({ firstFrame, resized }).toEqual({
        firstFrame: { uvFailures: [], windingFailures: [] },
        resized: { uvFailures: [], windingFailures: [] },
      });
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
  });

  it('reuses unchanged-size label textures and disposes each texture once when resizing', async () => {
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.stubGlobal('document', {
      createElement: () => ({ width: 1, height: 1, getContext: () => context }),
    });
    const rendered = await renderWithProductionAssets();
    const textureFor = (name: string): THREE.CanvasTexture => {
      const overlay = rendered.renderer.calls.at(-1)?.scene;
      const label = overlay?.children.find(
        (object) => object.name === `Brightvale.Label.${name}`,
      );
      if (!(label instanceof THREE.Mesh))
        throw new Error(`production label ${name} is missing`);
      const material = label.material as THREE.Material & {
        map?: THREE.Texture | null;
      };
      if (!(material.map instanceof THREE.CanvasTexture))
        throw new Error(`production label ${name} has no canvas texture`);
      return material.map;
    };
    let resizedTextureDispose = vi.fn();
    let sameSizeTexture: THREE.CanvasTexture | undefined;
    let resizedTexture: THREE.CanvasTexture | undefined;
    try {
      sameSizeTexture = textureFor('time');
      const originalVersion = sameSizeTexture.version;
      const sameSizeDispose = vi.fn();
      sameSizeTexture.addEventListener('dispose', sameSizeDispose);
      const changedTextFrame: SceneFrame = {
        ...rendered.frame,
        gameplay: { ...rendered.frame.gameplay, timeLabel: '00:02' },
      };
      expect(rendered.scene.updateFrame(changedTextFrame)).toBe('rendered');
      expect(textureFor('time')).toBe(sameSizeTexture);
      expect(sameSizeTexture.version).toBeGreaterThan(originalVersion);
      expect(sameSizeDispose).not.toHaveBeenCalled();

      const originalLegendTexture = textureFor('legend');
      const replacedTextureDispose = vi.fn();
      originalLegendTexture.addEventListener('dispose', replacedTextureDispose);
      const resizedFrame: SceneFrame = {
        ...changedTextFrame,
        gameplay: {
          ...changedTextFrame.gameplay,
          layout: makeLayout(1024, 768),
        },
      };
      expect(rendered.scene.updateFrame(resizedFrame)).toBe('rendered');
      resizedTexture = textureFor('legend');
      expect(resizedTexture).not.toBe(originalLegendTexture);
      expect(replacedTextureDispose).toHaveBeenCalledTimes(1);
      resizedTexture.addEventListener('dispose', resizedTextureDispose);
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
    expect(resizedTextureDispose).toHaveBeenCalledTimes(1);
  });

  it('fits every actual rendered early, junction, and target envelope vertex within the viewport and HUD', async () => {
    const rendered = await renderWithProductionAssets();
    try {
      if (rendered.world === undefined || rendered.camera === undefined)
        throw new Error('production scene did not capture its world render');
      rendered.world.updateMatrixWorld(true);
      const layout = rendered.frame.gameplay.layout;
      const envelopes = rendered.world.children.filter(
        (object) => object.userData.gameplayRole === 'note-good-envelope',
      ) as THREE.Mesh[];
      expect(envelopes).toHaveLength(3);
      for (const envelope of envelopes) {
        const positions = envelope.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index += 1) {
          const clip = new THREE.Vector3()
            .fromBufferAttribute(positions, index)
            .applyMatrix4(envelope.matrixWorld)
            .project(rendered.camera);
          const x = ((clip.x + 1) * layout.width) / 2;
          const y = ((1 - clip.y) * layout.height) / 2;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(layout.width);
          expect(y).toBeGreaterThan(layout.persistentHudExclusions[0]!.height);
          expect(y).toBeLessThan(
            layout.height - layout.persistentHudExclusions[1]!.height,
          );
        }
      }
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
  });

  it('suspends a positive viewport that cannot contain the four fixed lane labels and resumes without rebuilding', async () => {
    const rendered = await renderWithProductionAssets();
    try {
      if (rendered.world === undefined || rendered.overlay === undefined)
        throw new Error('initial production frame was not rendered');
      const originalWorld = rendered.world;
      const ownedResources = new Set<THREE.BufferGeometry | THREE.Material>();
      originalWorld.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        ownedResources.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          ownedResources.add(material);
      });
      expect(ownedResources.size).toBeGreaterThan(0);
      const resourceDispose = vi.fn();
      for (const resource of ownedResources)
        resource.addEventListener('dispose', resourceDispose);
      const initialRenderCount = rendered.renderer.calls.length;
      const initialFetchCount = vi.mocked(rendered.fetch).mock.calls.length;
      const tooNarrow: BrightvaleViewportLayout = {
        width: 120,
        height: 200,
        persistentHudExclusions: [],
        labels: {
          time: { x: 4, y: 4, width: 112, height: 20 },
          countdown: { x: 10, y: 35, width: 100, height: 24 },
          legend: { x: 4, y: 160, width: 112, height: 24 },
          feedback: { x: 10, y: 128, width: 100, height: 24 },
        },
      };
      const status = rendered.scene.updateFrame(makeFrame(tooNarrow));
      let slotEvidence = 'scene did not render an overlay at the tiny viewport';
      if (status === 'rendered') {
        const overlay = rendered.renderer.calls.at(-1)?.scene;
        const laneLabels = overlay?.children.filter((object) =>
          /^Brightvale\.Label\.lane-[0-3]$/.test(object.name),
        );
        expect(laneLabels).toHaveLength(4);
        const rects = laneLabels!.map((label) => ({
          left: label.position.x - label.scale.x / 2,
          right: label.position.x + label.scale.x / 2,
        }));
        const outside = rects.some(
          (rect) => rect.left < 0 || rect.right > tooNarrow.width,
        );
        const overlaps = rects.some((rect, index) =>
          rects
            .slice(index + 1)
            .some(
              (other) =>
                Math.max(rect.left, other.left) <
                Math.min(rect.right, other.right),
            ),
        );
        slotEvidence = JSON.stringify({
          width: tooNarrow.width,
          rects,
          outside,
          overlaps,
        });
        expect(
          outside || overlaps,
          'the rendered fixed-width lane labels must demonstrate the unusable viewport',
        ).toBe(true);
      }
      expect(status, slotEvidence).toBe('suspended');
      expect(rendered.renderer.calls).toHaveLength(initialRenderCount);
      expect(rendered.fetch).toHaveBeenCalledTimes(initialFetchCount);
      expect(rendered.unavailable).not.toHaveBeenCalled();
      expect(resourceDispose).not.toHaveBeenCalled();

      expect(rendered.scene.updateFrame(makeFrame(makeLayout(1120, 700)))).toBe(
        'rendered',
      );
      expect(rendered.renderer.calls).toHaveLength(initialRenderCount + 2);
      expect(rendered.renderer.calls.at(-2)?.scene).toBe(originalWorld);
      expect(rendered.fetch).toHaveBeenCalledTimes(initialFetchCount);
      expect(rendered.unavailable).not.toHaveBeenCalled();
      expect(resourceDispose).not.toHaveBeenCalled();
    } finally {
      rendered.scene.destroy();
      rendered.assets.dispose();
    }
  });

  it('fits the real scene camera for the full early-note through late-good-envelope progress range', async () => {
    const projectionSpy = vi.spyOn(
      brightvaleProjection,
      'createBrightvaleCameraProjection',
    );
    let rendered: Awaited<
      ReturnType<typeof renderWithProductionAssets>
    > | null = null;
    try {
      rendered = await renderWithProductionAssets();
      const goodHalf = rendered.frame.gameplay.timingWindows.goodHalfProgress;
      expect(projectionSpy).toHaveBeenCalled();
      const ranges = projectionSpy.mock.calls.map(([, , range]) => range);
      expect(ranges.at(-1)).toEqual({
        minimum: -goodHalf,
        maximum: 1 + goodHalf,
      });
    } finally {
      rendered?.scene.destroy();
      rendered?.assets.dispose();
      projectionSpy.mockRestore();
    }
  });

  it('does not retry the same failed production camera fit on repeated suspended frames', async () => {
    const projectionFactory = vi.spyOn(
      brightvaleProjection,
      'createBrightvaleCameraProjection',
    );
    let rendered: Awaited<
      ReturnType<typeof renderWithProductionAssets>
    > | null = null;
    let resizeSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      rendered = await renderWithProductionAssets();
      const projection = projectionFactory.mock.results.at(-1)?.value;
      if (projection === undefined)
        throw new Error('production camera projection was not created');
      resizeSpy = vi.spyOn(projection, 'resize');
      const unusable: BrightvaleViewportLayout = {
        width: 120,
        height: 200,
        persistentHudExclusions: [],
        labels: {
          time: { x: 4, y: 4, width: 112, height: 20 },
          countdown: { x: 10, y: 35, width: 100, height: 24 },
          legend: { x: 4, y: 160, width: 112, height: 24 },
          feedback: { x: 10, y: 128, width: 100, height: 24 },
        },
      };
      const frameWithLayout = (
        layout: BrightvaleViewportLayout,
      ): SceneFrame => ({
        ...rendered!.frame,
        gameplay: { ...rendered!.frame.gameplay, layout },
      });
      const suspendedFrame = frameWithLayout(unusable);
      expect(rendered.scene.updateFrame(suspendedFrame)).toBe('suspended');
      expect(resizeSpy).toHaveBeenCalledTimes(1);
      expect(rendered.scene.updateFrame(suspendedFrame)).toBe('suspended');
      expect(resizeSpy).toHaveBeenCalledTimes(1);
      expect(rendered.unavailable).not.toHaveBeenCalled();

      expect(
        rendered.scene.updateFrame(
          frameWithLayout(rendered.frame.gameplay.layout),
        ),
      ).toBe('rendered');
      expect(resizeSpy).toHaveBeenCalledTimes(2);
      expect(rendered.unavailable).not.toHaveBeenCalled();
    } finally {
      rendered?.scene.destroy();
      rendered?.assets.dispose();
      resizeSpy?.mockRestore();
      projectionFactory.mockRestore();
    }
  });

  it('refits the real scene when only a measured fixed-label rectangle moves into the lane-label area', async () => {
    const projectionFactory = vi.spyOn(
      brightvaleProjection,
      'createBrightvaleCameraProjection',
    );
    let rendered: Awaited<
      ReturnType<typeof renderWithProductionAssets>
    > | null = null;
    let resizeSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      rendered = await renderWithProductionAssets();
      const projection = projectionFactory.mock.results.at(-1)?.value;
      if (projection === undefined || rendered.overlay === undefined)
        throw new Error(
          'production camera projection or overlay was not captured',
        );
      resizeSpy = vi.spyOn(projection, 'resize');
      const original = rendered.frame.gameplay.layout;
      const laneZero = rendered.overlay.children.find(
        (object) => object.name === 'Brightvale.Label.lane-0',
      );
      if (laneZero === undefined)
        throw new Error('production lane-zero label was not rendered');
      const time = original.labels.time;
      const x = THREE.MathUtils.clamp(
        laneZero.position.x - time.width / 2,
        0,
        original.width - time.width,
      );
      const y = THREE.MathUtils.clamp(
        laneZero.position.y - time.height / 2,
        0,
        original.height - time.height,
      );
      const obstructed: BrightvaleViewportLayout = {
        ...original,
        labels: {
          ...original.labels,
          time: { ...time, x, y },
        },
      };
      const frameWithLayout = (
        layout: BrightvaleViewportLayout,
      ): SceneFrame => ({
        ...rendered!.frame,
        gameplay: { ...rendered!.frame.gameplay, layout },
      });
      expect(obstructed.width).toBe(original.width);
      expect(obstructed.height).toBe(original.height);
      expect(obstructed.persistentHudExclusions).toEqual(
        original.persistentHudExclusions,
      );
      expect(obstructed.labels.time.width).toBe(time.width);
      expect(obstructed.labels.time.height).toBe(time.height);
      expect(
        Math.max(obstructed.labels.time.x, laneZero.position.x - 18) <
          Math.min(
            obstructed.labels.time.x + obstructed.labels.time.width,
            laneZero.position.x + 18,
          ) &&
          Math.max(obstructed.labels.time.y, laneZero.position.y - 12) <
            Math.min(
              obstructed.labels.time.y + obstructed.labels.time.height,
              laneZero.position.y + 12,
            ),
      ).toBe(true);
      const status = rendered.scene.updateFrame(frameWithLayout(obstructed));
      expect(resizeSpy).toHaveBeenCalledTimes(1);
      const fitted = resizeSpy.mock.results.at(-1)?.value;
      expect(fitted).toBeTypeOf('boolean');
      expect(status).toBe(fitted ? 'rendered' : 'suspended');
      expect(rendered.unavailable).not.toHaveBeenCalled();

      expect(rendered.scene.updateFrame(frameWithLayout(original))).toBe(
        'rendered',
      );
      expect(resizeSpy).toHaveBeenCalledTimes(2);
      expect(rendered.unavailable).not.toHaveBeenCalled();
    } finally {
      rendered?.scene.destroy();
      rendered?.assets.dispose();
      resizeSpy?.mockRestore();
      projectionFactory.mockRestore();
    }
  });

  it('keeps the cached UI layout unchanged on host resize until a fresh measured frame arrives', async () => {
    installSceneGlobals();
    const animationFrame = vi.fn(() => 1);
    vi.stubGlobal('window', {
      devicePixelRatio: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: animationFrame,
      cancelAnimationFrame: vi.fn(),
    });
    const renderer = makeRenderer();
    const host = makeHost();
    const bundle = makeAssets();
    const scene = makeScene(
      host,
      vi.fn(),
      () => renderer.renderer,
      dependencies(
        async () => bundle,
        () => ({ root: new THREE.Group(), dispose: vi.fn() }),
      ),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');
    await Promise.resolve();
    await Promise.resolve();
    expect.soft(scene.updateFrame(makeFrame())).toBe('rendered');
    expect.soft(renderer.calls).toHaveLength(2);

    host.width = 1200;
    host.height = 800;
    TestResizeObserver.instances[0]?.trigger();

    expect.soft(renderer.setSizes.at(-1)).toEqual([1200, 800, false]);
    expect.soft(renderer.calls).toHaveLength(2);
    const cachedCamera = renderer.calls[0]?.camera;
    expect(cachedCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    if (!(cachedCamera instanceof THREE.PerspectiveCamera))
      throw new Error('cached world camera is not perspective');
    expect(cachedCamera.aspect).toBeCloseTo(1600 / 900);
    expect(animationFrame).not.toHaveBeenCalled();
    expect(TestResizeObserver.instances[0]?.disconnected).toBe(false);

    const freshMeasuredLayout = makeLayout(1200, 800);
    expect(scene.updateFrame(makeFrame(freshMeasuredLayout))).toBe('rendered');
    expect(renderer.calls).toHaveLength(4);
    const measuredCamera = renderer.calls.at(-2)?.camera;
    expect(measuredCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    if (!(measuredCamera instanceof THREE.PerspectiveCamera))
      throw new Error('measured world camera is not perspective');
    expect(measuredCamera.aspect).toBeCloseTo(1200 / 800);
    const timeLabel = renderer.calls
      .at(-1)
      ?.scene.children.find(
        (object) => object.name === 'Brightvale.Label.time',
      );
    expect(timeLabel).toBeDefined();
    expect(timeLabel?.position.x).toBeCloseTo(
      freshMeasuredLayout.labels.time.x +
        freshMeasuredLayout.labels.time.width / 2,
    );
    expect(timeLabel?.position.y).toBeCloseTo(
      freshMeasuredLayout.labels.time.y +
        freshMeasuredLayout.labels.time.height / 2,
    );
    expect(animationFrame).not.toHaveBeenCalled();
    scene.destroy();
  });

  it('cleans canvas and renderer when initial sizing fails before assets load', () => {
    installSceneGlobals();
    const renderer = makeRenderer();
    renderer.failSize = true;
    const host = makeHost();
    const loadAssets = vi.fn(async () => makeAssets());
    const unavailable = vi.fn();

    const scene = makeScene(
      host,
      unavailable,
      () => renderer.renderer,
      dependencies(loadAssets, () => ({
        root: new THREE.Group(),
        dispose: vi.fn(),
      })),
    );

    expect(scene).toBeNull();
    expect(loadAssets).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(renderer.disposeCount).toBe(1);
    expect(renderer.canvas.removed).toBe(true);
  });

  it('disposes composition and asset bundle once before releasing the renderer', async () => {
    installSceneGlobals();
    const order: string[] = [];
    const renderer = makeRenderer(order);
    const bundleDispose = vi.fn(() => order.push('assets'));
    const bundle = makeAssets(bundleDispose);
    const compositionDispose = vi.fn(() => order.push('composition'));
    const scene = makeScene(
      makeHost(),
      vi.fn(),
      () => renderer.renderer,
      dependencies(
        async () => bundle,
        () => ({ root: new THREE.Group(), dispose: compositionDispose }),
      ),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');
    await Promise.resolve();
    await Promise.resolve();
    scene.updateFrame(makeFrame());

    scene.destroy();
    scene.destroy();

    expect(compositionDispose).toHaveBeenCalledTimes(1);
    expect(bundleDispose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['composition', 'assets', 'renderer']);
    expect(renderer.canvas.removed).toBe(true);
  });

  it('turns a failed resize replay into one fallback and disconnects resize observation', async () => {
    installSceneGlobals();
    const renderer = makeRenderer();
    const unavailable = vi.fn();
    const bundle = makeAssets();
    const scene = makeScene(
      makeHost(),
      unavailable,
      () => renderer.renderer,
      dependencies(
        async () => bundle,
        () => ({ root: new THREE.Group(), dispose: vi.fn() }),
      ),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');
    await Promise.resolve();
    await Promise.resolve();
    scene.updateFrame(makeFrame());
    renderer.failRender = true;

    expect(() => TestResizeObserver.instances[0]?.trigger()).not.toThrow();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(renderer.disposeCount).toBe(1);
    expect(renderer.canvas.removed).toBe(true);
    expect(TestResizeObserver.instances[0]?.disconnected).toBe(true);
    scene.destroy();
    expect(renderer.disposeCount).toBe(1);
  });

  it('restores renderer state after the world and overlay passes', async () => {
    installSceneGlobals();
    const renderer = makeRenderer();
    renderer.renderer.autoClear = true;
    const bundle = makeAssets();
    const scene = makeScene(
      makeHost(),
      vi.fn(),
      () => renderer.renderer,
      dependencies(
        async () => bundle,
        () => ({ root: new THREE.Group(), dispose: vi.fn() }),
      ),
    );
    if (scene === null)
      throw new Error('renderer fixture failed to initialize');
    await Promise.resolve();
    await Promise.resolve();

    expect.soft(scene.updateFrame(makeFrame())).toBe('rendered');
    expect.soft(renderer.calls).toHaveLength(2);
    expect.soft(renderer.renderer.autoClear).toBe(true);
    expect
      .soft(renderer.renderer.toneMapping)
      .toBe(THREE.ACESFilmicToneMapping);
    expect.soft(renderer.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect.soft(renderer.viewport).toEqual([0, 0, 1600, 900]);
    expect.soft(renderer.scissor).toEqual([0, 0, 1600, 900]);
    expect.soft(renderer.scissorTest).toBe(false);
    scene.destroy();
  });

  it.each(['render', 'context-loss'] as const)(
    'cleans owned scene resources and reports unavailable once on %s failure',
    async (failure) => {
      installSceneGlobals();
      const renderer = makeRenderer();
      const bundle = makeAssets();
      const compositionDispose = vi.fn();
      const unavailable = vi.fn();
      const scene = makeScene(
        makeHost(),
        unavailable,
        () => renderer.renderer,
        dependencies(
          async () => bundle,
          () => ({ root: new THREE.Group(), dispose: compositionDispose }),
        ),
      );
      if (scene === null)
        throw new Error('renderer fixture failed to initialize');
      await Promise.resolve();
      await Promise.resolve();

      if (failure === 'render') {
        renderer.failRender = true;
        expect.soft(scene.updateFrame(makeFrame())).toBe('unavailable');
      } else {
        expect.soft(scene.updateFrame(makeFrame())).toBe('rendered');
        renderer.canvas.dispatchEvent(
          new Event('webglcontextlost', { cancelable: true }),
        );
      }
      scene.destroy();
      expect(unavailable).toHaveBeenCalledTimes(1);
      expect(compositionDispose).toHaveBeenCalledTimes(1);
      expect(bundle.dispose).toHaveBeenCalledTimes(1);
      expect(renderer.disposeCount).toBe(1);
      expect(renderer.canvas.removed).toBe(true);
    },
  );
});
