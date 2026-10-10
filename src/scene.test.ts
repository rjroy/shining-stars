import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrightvaleScene, type SceneRenderer } from './scene';
import { type GameplayFrame, type GameplayLayout } from './gameplay-frame';
import { projectTimingWindowGeometry } from './note-projection';
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

const gameplayLayout: GameplayLayout = {
  width: 640,
  height: 480,
  stage: { x: 20, y: 30, width: 600, height: 400 },
  board: { x: 80, y: 80, width: 480, height: 240 },
  header: { x: 40, y: 40, width: 520, height: 24 },
  legend: { x: 80, y: 340, width: 480, height: 30 },
  feedback: { x: 80, y: 380, width: 480, height: 25 },
};

function makeGameplayFrame(
  overrides: Partial<GameplayFrame> = {},
): GameplayFrame {
  return {
    layout: gameplayLayout,
    transportTime: 4.25,
    difficulty: 'normal',
    playing: true,
    reducedMotion: false,
    lanes: [0, 1, 2, 3].map((index) => ({
      index: index as 0 | 1 | 2 | 3,
      x: 80 + index * 120,
      width: 120,
    })),
    notes: [],
    noteCapacity: 0,
    timingWindows: projectTimingWindowGeometry('normal', 153.6, 2.4),
    feedback: null,
    timeLabel: '00:04',
    legendLabel: 'Good ±150 ms · Perfect ±75 ms',
    feedbackLabel: 'Notes meet the line here',
    countdownLabel: '',
    ...overrides,
  };
}

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
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  const layout = {
    '.stage-frame': { getBoundingClientRect: () => rect(20, 30, 600, 400) },
    '.lane-board': { getBoundingClientRect: () => rect(80, 80, 480, 240) },
  };
  return {
    clientWidth: 640,
    clientHeight: 480,
    querySelector: (selector: string) =>
      layout[selector as keyof typeof layout] ?? null,
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
  readonly calls: Array<readonly [string, ...number[]]>;
  readonly renderedCameras: THREE.Camera[];
  readonly renderedViewports: THREE.Vector4[];
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
    calls: [],
    renderedCameras: [],
    renderedViewports: [],
    renderer: null as unknown as SceneRenderer,
  };
  let viewport = new THREE.Vector4(0, 0, 640, 480);
  controls.renderer = {
    domElement: canvas as unknown as HTMLCanvasElement,
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(() => {
      if (controls.failInitialSize) throw new Error('size failed');
    }),
    setViewport: vi.fn((x: number, y: number, width: number, height: number) => {
      controls.calls.push(['viewport', x, y, width, height]);
      viewport = new THREE.Vector4(x, y, width, height);
    }),
    setScissor: vi.fn((x: number, y: number, width: number, height: number) =>
      controls.calls.push(['scissor', x, y, width, height]),
    ),
    setScissorTest: vi.fn((enabled: boolean) =>
      controls.calls.push(['scissor-test', Number(enabled)]),
    ),
    clearDepth: vi.fn(() => controls.calls.push(['clear-depth'])),
    clear: vi.fn((color = true, depth = true, stencil = true) =>
      controls.calls.push([
        'clear',
        Number(color),
        Number(depth),
        Number(stencil),
      ]),
    ),
    render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      controls.calls.push(['render']);
      controls.renderedScene = scene;
      controls.renderedCameras.push(camera);
      controls.renderedViewports.push(viewport.clone());
      if (controls.failRender) throw new Error('render failed');
    }),
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
  it('accepts a single compound city and gameplay frame on the shared scene', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');
    const updateFrame = Reflect.get(scene, 'updateFrame');

    expect(
      updateFrame,
      'scene must expose the compound-frame entry point',
    ).toEqual(expect.any(Function));
    if (typeof updateFrame !== 'function') return;

    const frame = {
      city: state,
      gameplay: makeGameplayFrame({
        noteCapacity: 1,
        notes: [
          {
            id: 'sample',
            lane: 1,
            progress: 0.5,
            bottomPercent: 50,
          },
        ],
      }),
    };
    updateFrame.call(scene, frame);

    expect(controls.renderedScene).not.toBeNull();
    expect(controls.renderer.render).toHaveBeenCalledTimes(4);
    const gameplayRoles: string[] = [];
    controls.renderedScene?.traverse((object) => {
      const role = object.userData.gameplayRole;
      if (typeof role === 'string') gameplayRoles.push(role);
    });
    expect(gameplayRoles).toEqual(
      expect.arrayContaining([
        'lane',
        'hit-line',
        'good-band',
        'perfect-band',
        'note-good-envelope',
        'note-perfect-envelope',
      ]),
    );
    expect(gameplayRoles).not.toContain('note');
    expect(gameplayRoles).not.toContain('note-outline');
    scene?.destroy();
  });

  it('replays the cached compound city and gameplay frame on resize', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');

    scene.updateFrame({
      city: state,
      gameplay: makeGameplayFrame({
        noteCapacity: 1,
        notes: [
          { id: 'resize-probe', lane: 2, progress: 0.5, bottomPercent: 55 },
        ],
      }),
    });
    const firstFrameRenderCount = controls.renderedCameras.length;
    expect(firstFrameRenderCount).toBe(4);

    TestResizeObserver.instances[0]?.trigger();

    expect(controls.renderedCameras).toHaveLength(firstFrameRenderCount + 4);
    expect(controls.renderedCameras.slice(-4)[0]).toBeInstanceOf(
      THREE.PerspectiveCamera,
    );
    expect(controls.renderedCameras.slice(-4)[1]).toBeInstanceOf(
      THREE.OrthographicCamera,
    );
    expect(controls.renderedCameras.slice(-4)[2]).toBeInstanceOf(
      THREE.PerspectiveCamera,
    );
    expect(controls.renderedCameras.at(-1)).toBeInstanceOf(
      THREE.OrthographicCamera,
    );
    const gameplayRoles: string[] = [];
    controls.renderedScene?.traverse((object) => {
      if (typeof object.userData.gameplayRole === 'string')
        gameplayRoles.push(object.userData.gameplayRole);
    });
    expect(gameplayRoles).toContain('lane');
    expect(gameplayRoles).toContain('note-good-envelope');
    expect(gameplayRoles).toContain('note-perfect-envelope');
    scene.destroy();
  });

  it('keeps perspective runway geometry visible and GPU text upright', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');
    const updateFrame = Reflect.get(scene, 'updateFrame');
    expect(updateFrame, 'scene must accept projected gameplay frames').toEqual(
      expect.any(Function),
    );
    if (typeof updateFrame !== 'function') return;

    updateFrame.call(scene, {
      city: state,
      gameplay: makeGameplayFrame({
        noteCapacity: 1,
        notes: [
          {
            id: 'orientation-probe',
            lane: 1,
            progress: 0.5,
            bottomPercent: 50,
          },
        ],
      }),
    });

    const renderedScene = controls.renderedScene;
    if (renderedScene === null)
      throw new Error('city and gameplay passes must render');
    renderedScene.updateMatrixWorld(true);

    const gameplayMeshes: THREE.Mesh[] = [];
    const roleObjects = new Map<string, THREE.Mesh[]>();
    const cityMaterials: THREE.Material[] = [];
    renderedScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const role = object.userData.gameplayRole;
      if (typeof role === 'string') {
        gameplayMeshes.push(object);
        const roleList = roleObjects.get(role) ?? [];
        roleList.push(object);
        roleObjects.set(role, roleList);
      } else {
        cityMaterials.push(
          ...(Array.isArray(object.material)
            ? object.material
            : [object.material]),
        );
      }
    });

    expect(gameplayMeshes.length).toBeGreaterThan(0);
    const materialUsesFog = (material: THREE.Material) =>
      (material as THREE.Material & { fog?: boolean }).fog;
    expect
      .soft(
        gameplayMeshes
          .flatMap((mesh) =>
            Array.isArray(mesh.material) ? mesh.material : [mesh.material],
          )
          .every((material) => materialUsesFog(material) === false),
        'playfield materials must not inherit city fog',
      )
      .toBe(true);
    expect
      .soft(
        cityMaterials.some((material) => materialUsesFog(material) === true),
      )
      .toBe(true);
    expect(
      roleObjects.get('good-edge')?.every((mesh) => !mesh.visible),
      'legacy orthographic Good edges must not be visible over the perspective runway',
    ).toBe(true);
    expect(
      roleObjects.get('perfect-edge')?.every((mesh) => !mesh.visible),
      'legacy orthographic Perfect edges must not be visible over the perspective runway',
    ).toBe(true);

    const lane = roleObjects
      .get('lane')
      ?.find((mesh) => mesh.visible);
    if (lane === undefined) throw new Error('gameplay lane mesh is missing');
    const perspectiveTimingMeshes = [
      lane,
      roleObjects.get('good-band')?.find((mesh) => mesh.visible),
      roleObjects.get('perfect-band')?.find((mesh) => mesh.visible),
      roleObjects.get('note-good-envelope')?.find((mesh) => mesh.visible),
      roleObjects.get('note-perfect-envelope')?.find((mesh) => mesh.visible),
      roleObjects.get('note-bar')?.find((mesh) => mesh.visible),
    ].filter((mesh): mesh is THREE.Mesh => mesh !== undefined);
    expect
      .soft(
        perspectiveTimingMeshes
          .flatMap((mesh) =>
            Array.isArray(mesh.material) ? mesh.material : [mesh.material],
          )
          .every((material) => materialUsesFog(material) === false),
        'visible perspective runway and note materials must not inherit city fog',
      )
      .toBe(true);
    const gameplayPassIndex = controls.renderedCameras.findIndex((camera) =>
      camera.layers.test(lane.layers),
    );
    const gameplayCamera = controls.renderedCameras[gameplayPassIndex];
    const gameplayViewport = controls.renderedViewports[gameplayPassIndex];
    if (gameplayCamera === undefined || gameplayViewport === undefined)
      throw new Error('the perspective lane camera pass must be captured');
    expect(gameplayCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    gameplayCamera.updateMatrixWorld(true);
    const laneScreenCenter = lane
      .getWorldPosition(new THREE.Vector3())
      .project(gameplayCamera);
    const laneScreenX =
      gameplayViewport.x +
      ((laneScreenCenter.x + 1) * gameplayViewport.z) / 2;
    const laneScreenY =
      gameplayLayout.height -
      gameplayViewport.y -
      ((laneScreenCenter.y + 1) * gameplayViewport.w) / 2;
    expect(Number.isFinite(laneScreenX) && Number.isFinite(laneScreenY)).toBe(
      true,
    );
    expect(laneScreenX).toBeGreaterThanOrEqual(gameplayViewport.x);
    expect(laneScreenX).toBeLessThanOrEqual(
      gameplayViewport.x + gameplayViewport.z,
    );
    expect(laneScreenY).toBeGreaterThanOrEqual(
      gameplayLayout.height - gameplayViewport.y - gameplayViewport.w,
    );
    expect(laneScreenY).toBeLessThanOrEqual(
      gameplayLayout.height - gameplayViewport.y,
    );
    const positions = lane.geometry.getAttribute('position');
    const indices = lane.geometry.getIndex();
    if (indices === null) throw new Error('lane mesh must have indexed faces');
    const triangle = [indices.getX(0), indices.getX(1), indices.getX(2)].map(
      (index) =>
        new THREE.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        )
          .applyMatrix4(lane.matrixWorld)
          .project(gameplayCamera),
    );
    const [a, b, c] = triangle;
    if (a === undefined || b === undefined || c === undefined)
      throw new Error('lane triangle projection failed');
    const signedArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect
      .soft(
        signedArea,
        'front-facing lane triangles must remain counter-clockwise after projection',
      )
      .toBeGreaterThan(0);

    const label = roleObjects.get('stage-label')?.[0];
    if (label === undefined) throw new Error('stage text mesh is missing');
    const stagePassIndex = controls.renderedCameras.findIndex((camera) =>
      camera.layers.test(label.layers),
    );
    const stageCamera = controls.renderedCameras[stagePassIndex];
    if (stageCamera === undefined)
      throw new Error('the stage text camera pass must be captured');
    stageCamera.updateMatrixWorld(true);
    const textPositions = label.geometry.getAttribute('position');
    const textUvs = label.geometry.getAttribute('uv');
    const highV = new THREE.Vector3();
    const lowV = new THREE.Vector3();
    for (let index = 0; index < textUvs.count; index += 1) {
      const v = textUvs.getY(index);
      const point = new THREE.Vector3(
        textPositions.getX(index),
        textPositions.getY(index),
        textPositions.getZ(index),
      )
        .applyMatrix4(label.matrixWorld)
        .project(stageCamera);
      if (v > 0.5) highV.copy(point);
      else lowV.copy(point);
    }
    const screenY = (point: THREE.Vector3) => (1 - point.y) / 2;
    expect
      .soft(
        screenY(highV),
        'the top of each glyph texture must project above its bottom',
      )
      .toBeLessThan(screenY(lowV));
    scene.destroy();
  });

  it('pools per-note score windows and expires feedback on the transport clock', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');
    const updateFrame = Reflect.get(scene, 'updateFrame');
    expect(updateFrame, 'scene must accept projected gameplay frames').toEqual(
      expect.any(Function),
    );
    if (typeof updateFrame !== 'function') return;

    const notes = Array.from({ length: 120 }, (_, index) => ({
      id: `dense-${index}`,
      lane: index % 4,
      progress: index / 120,
      bottomPercent: 82 - (index / 120) * 64,
    }));
    const frame = {
      city: state,
      gameplay: makeGameplayFrame({
        transportTime: 10,
        difficulty: 'normal',
        notes,
        noteCapacity: notes.length,
        feedback: {
          eventId: 1,
          runId: 2,
          noteId: 'dense-119',
          quality: 'perfect',
          onsetTransportTime: 10,
        },
      }),
    };
    updateFrame.call(scene, frame);
    const goodWindows: THREE.Object3D[] = [];
    const perfectWindows: THREE.Object3D[] = [];
    const feedbackObjects: THREE.Object3D[] = [];
    controls.renderedScene?.traverse((object) => {
      if (object.userData.gameplayRole === 'note-good-envelope')
        goodWindows.push(object);
      if (object.userData.gameplayRole === 'note-perfect-envelope')
        perfectWindows.push(object);
      if (object.userData.gameplayRole === 'feedback')
        feedbackObjects.push(object);
    });
    expect(goodWindows.length).toBeGreaterThanOrEqual(notes.length);
    expect(perfectWindows.length).toBeGreaterThanOrEqual(notes.length);
    expect(
      [...goodWindows, ...perfectWindows].every((object) => object.visible),
      'only Good and Perfect score windows should appear around note targets',
    ).toBe(true);
    expect(feedbackObjects.length).toBeGreaterThan(0);
    expect(feedbackObjects.some((object) => object.visible)).toBe(true);
    const identities = new Set([...goodWindows, ...perfectWindows]);

    updateFrame.call(scene, {
      ...frame,
      gameplay: { ...frame.gameplay, transportTime: 10.64 },
    });
    const windowsAfterUpdate: THREE.Object3D[] = [];
    controls.renderedScene?.traverse((object) => {
      if (
        object.userData.gameplayRole === 'note-good-envelope' ||
        object.userData.gameplayRole === 'note-perfect-envelope'
      )
        windowsAfterUpdate.push(object);
    });
    expect(new Set(windowsAfterUpdate)).toEqual(identities);
    controls.renderedScene?.traverse((object) => {
      if (object.userData.gameplayRole === 'feedback') {
        expect(object.visible).toBe(true);
      }
    });

    updateFrame.call(scene, {
      ...frame,
      gameplay: { ...frame.gameplay, transportTime: 10.66 },
    });
    const feedbackAfterExpiry: THREE.Object3D[] = [];
    controls.renderedScene?.traverse((object) => {
      if (object.userData.gameplayRole === 'feedback')
        feedbackAfterExpiry.push(object);
    });
    expect(
      feedbackAfterExpiry.every(
        (object) => object.userData.activeJudgement === false,
      ),
    ).toBe(true);
    scene?.destroy();
  });

  it('shows feedback from exact onset until the exclusive transport-age limit', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');

    const feedback = {
      eventId: 9,
      runId: 2,
      noteId: 'scene-feedback',
      quality: 'good' as const,
      onsetTransportTime: 1,
    };
    const samples = [
      { transportTime: 0.999, onsetTransportTime: 1, active: false },
      { transportTime: 1, onsetTransportTime: 1, active: true },
      { transportTime: 1.649, onsetTransportTime: 1, active: true },
      { transportTime: 0.65, onsetTransportTime: 0, active: false },
      {
        transportTime: 1.2,
        onsetTransportTime: 1,
        active: false,
        playing: false,
      },
    ];

    try {
      for (const sample of samples) {
        scene.updateFrame({
          city: state,
          gameplay: makeGameplayFrame({
            transportTime: sample.transportTime,
            playing: sample.playing ?? true,
            feedback: {
              ...feedback,
              onsetTransportTime: sample.onsetTransportTime,
            },
          }),
        });
        let feedbackMesh: THREE.Object3D | undefined;
        let backdrop: THREE.Object3D | undefined;
        controls.renderedScene?.traverse((object) => {
          if (object.userData.gameplayRole === 'feedback')
            feedbackMesh = object;
          if (object.userData.gameplayRole === 'feedback-backdrop')
            backdrop = object;
        });
        expect(feedbackMesh?.userData.activeJudgement).toBe(sample.active);
        expect(backdrop?.visible).toBe(sample.active);
      }
    } finally {
      scene.destroy();
    }
  });

  it('disposes shared gameplay meshes, geometry, and materials once', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');
    const updateFrame = Reflect.get(scene, 'updateFrame');
    expect(updateFrame, 'scene must build GPU gameplay resources').toEqual(
      expect.any(Function),
    );
    if (typeof updateFrame !== 'function') return;
    updateFrame.call(scene, {
      city: state,
      gameplay: makeGameplayFrame({
        noteCapacity: 2,
        notes: [
          { id: 'one', lane: 0, progress: 0.4, bottomPercent: 56 },
          { id: 'two', lane: 3, progress: 0.8, bottomPercent: 31 },
        ],
      }),
    });

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    controls.renderedScene?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
        }
      }
    });
    const geometryDisposals = new Map<THREE.BufferGeometry, number>();
    const materialDisposals = new Map<THREE.Material, number>();
    geometries.forEach((geometry) =>
      geometry.addEventListener('dispose', () =>
        geometryDisposals.set(
          geometry,
          (geometryDisposals.get(geometry) ?? 0) + 1,
        ),
      ),
    );
    materials.forEach((material) =>
      material.addEventListener('dispose', () =>
        materialDisposals.set(
          material,
          (materialDisposals.get(material) ?? 0) + 1,
        ),
      ),
    );

    scene.destroy();
    scene.destroy();
    expect([...geometryDisposals.values()]).toHaveLength(geometries.size);
    expect([...geometryDisposals.values()].every((count) => count === 1)).toBe(
      true,
    );
    expect([...materialDisposals.values()]).toHaveLength(materials.size);
    expect([...materialDisposals.values()].every((count) => count === 1)).toBe(
      true,
    );
    expect(controls.rendererDisposeCount).toBe(1);
  });

  it('renders city, stage, and nested gameplay in ordered scissor passes and restores state', () => {
    installSceneGlobals();
    const controls = makeRenderer();
    vi.stubGlobal('window', {
      devicePixelRatio: 1.5,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const scene = createBrightvaleScene(
      makeHost(),
      vi.fn(),
      () => controls.renderer,
    );
    if (scene === null) throw new Error('scene renderer failed to initialize');
    const updateFrame = Reflect.get(scene, 'updateFrame');
    expect(updateFrame, 'compound frame rendering is required').toEqual(
      expect.any(Function),
    );
    if (typeof updateFrame !== 'function') return;
    expect(controls.renderer.setPixelRatio).toHaveBeenCalledWith(1.5);
    controls.calls.length = 0;

    updateFrame.call(scene, {
      city: state,
      gameplay: makeGameplayFrame({
        transportTime: 4.25,
        difficulty: 'normal',
        notes: [],
        noteCapacity: 0,
        feedback: null,
      }),
    });

    const order = controls.calls.map(([name]) => name);
    expect(order.filter((name) => name === 'render')).toHaveLength(4);
    expect(controls.renderer.autoClear).toBe(false);
    expect(order).toEqual([
      'viewport',
      'scissor',
      'scissor-test',
      'clear',
      'render',
      'viewport',
      'scissor',
      'scissor-test',
      'clear-depth',
      'render',
      'viewport',
      'scissor',
      'clear-depth',
      'render',
      'viewport',
      'clear-depth',
      'render',
      'scissor-test',
      'viewport',
      'scissor',
    ]);
    expect(controls.calls.filter(([name]) => name === 'scissor')).toEqual([
      ['scissor', 0, 0, 640, 480],
      ['scissor', 20, 50, 600, 400],
      ['scissor', 80, 160, 480, 240],
      ['scissor', 0, 0, 640, 480],
    ]);
    expect(controls.calls.filter(([name]) => name === 'viewport')).toEqual([
      ['viewport', 0, 0, 640, 480],
      ['viewport', 0, 0, 640, 480],
      ['viewport', 80, 160, 480, 240],
      ['viewport', 0, 0, 640, 480],
      ['viewport', 0, 0, 640, 480],
    ]);
    expect(controls.calls.filter(([name]) => name === 'clear')).toEqual([
      ['clear', 1, 1, 1],
    ]);
    expect(controls.calls.filter(([name]) => name === 'scissor-test')).toEqual([
      ['scissor-test', 0],
      ['scissor-test', 1],
      ['scissor-test', 0],
    ]);
    expect(
      controls.calls.filter(([name]) => name === 'viewport').at(-1),
    ).toEqual(['viewport', 0, 0, 640, 480]);
    expect(controls.renderedCameras[0]).toBeInstanceOf(
      THREE.PerspectiveCamera,
    );
    expect(controls.renderedCameras[1]).toBeInstanceOf(
      THREE.OrthographicCamera,
    );
    expect(controls.renderedCameras[2]).toBeInstanceOf(
      THREE.PerspectiveCamera,
    );
    expect(controls.renderedCameras[3]).toBeInstanceOf(
      THREE.OrthographicCamera,
    );
    scene?.destroy();
  });

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
      scene?.updateFrame({ city: state, gameplay: makeGameplayFrame() });
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
    scene?.updateFrame({ city: state, gameplay: makeGameplayFrame() });
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
