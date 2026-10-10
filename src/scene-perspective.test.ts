import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDifficultyProfile } from './game-balance';
import {
  projectTimingWindowGeometry,
  RUNWAY_HIT_LINE_BOTTOM_PERCENT,
  RUNWAY_TRAVEL_PERCENT,
} from './note-projection';
import { createBrightvaleScene, type SceneRenderer } from './scene';
import type { GameplayFrame, GameplayLayout } from './gameplay-frame';
import type { SceneStateProjection } from './scene-state';

const city: SceneStateProjection = {
  phase: 'audience',
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

const hosts = [
  {
    name: 'desktop',
    width: 640,
    height: 480,
    board: { x: 80, y: 80, width: 480, height: 240 },
  },
  {
    name: 'narrow',
    width: 390,
    height: 844,
    board: { x: 24, y: 96, width: 342, height: 171 },
  },
  {
    name: 'constrained height',
    width: 960,
    height: 360,
    board: { x: 240, y: 60, width: 480, height: 240 },
  },
] as const;

type HostCase = (typeof hosts)[number];

interface SceneViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function makeLayout(host: HostCase): GameplayLayout {
  return {
    width: host.width,
    height: host.height,
    stage: { x: 0, y: 0, width: host.width, height: host.height },
    board: host.board,
    header: { x: 0, y: 0, width: host.width, height: 24 },
    legend: { x: 0, y: host.height - 40, width: host.width, height: 24 },
    feedback: { x: 0, y: host.height - 16, width: host.width, height: 16 },
  };
}

function makeFrame(
  host: HostCase,
  difficulty: GameplayFrame['difficulty'],
  progress: number,
  transportTime = 1,
  laneIndex = 1,
): GameplayFrame {
  const layout = makeLayout(host);
  const board = layout.board;
  return {
    layout,
    transportTime,
    difficulty,
    playing: true,
    reducedMotion: false,
    lanes: [0, 1, 2, 3].map((index) => ({
      index: index as 0 | 1 | 2 | 3,
      x: board.x + (board.width * index) / 4,
      width: board.width / 4,
    })),
    notes: [
      {
        id: 'perspective-probe',
        lane: laneIndex,
        progress,
        bottomPercent:
          RUNWAY_HIT_LINE_BOTTOM_PERCENT +
          RUNWAY_TRAVEL_PERCENT * (1 - Math.min(progress, 1)),
      },
    ],
    noteCapacity: 1,
    timingWindows: projectTimingWindowGeometry(
      difficulty,
      board.height * 0.64,
      2.4,
    ),
    feedback: null,
    timeLabel: '00:01',
    legendLabel: 'timing windows',
    feedbackLabel: 'Notes meet the line here',
    countdownLabel: '',
  };
}

function rendererHarness(host: HostCase): {
  readonly scene: ReturnType<typeof createBrightvaleScene>;
  readonly cameras: THREE.Camera[];
  readonly viewports: SceneViewport[];
  readonly renderedScene: () => THREE.Scene | undefined;
} {
  const cameras: THREE.Camera[] = [];
  const viewports: SceneViewport[] = [];
  let viewport: SceneViewport = {
    x: 0,
    y: 0,
    width: host.width,
    height: host.height,
  };
  let latestScene: THREE.Scene | undefined;
  const canvas = Object.assign(new EventTarget(), {
    className: '',
    setAttribute: vi.fn(),
    remove: vi.fn(),
  });
  const renderer = {
    domElement: canvas,
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setViewport: vi.fn((x: number, y: number, width: number, height: number) => {
      viewport = { x, y, width, height };
    }),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    clear: vi.fn(),
    clearDepth: vi.fn(),
    render: vi.fn((rendered: THREE.Scene, camera: THREE.Camera) => {
      rendered.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      latestScene = rendered;
      cameras.push(camera);
      viewports.push(viewport);
    }),
    dispose: vi.fn(),
  } as unknown as SceneRenderer;
  const hostElement = {
    clientWidth: host.width,
    clientHeight: host.height,
    firstChild: null,
    insertBefore: vi.fn(),
  } as unknown as HTMLElement;
  const scene = createBrightvaleScene(hostElement, vi.fn(), () => renderer);
  return { scene, cameras, viewports, renderedScene: () => latestScene };
}

function meshByRole(scene: THREE.Scene, role: string, index = 0): THREE.Mesh {
  const matches = meshesByRole(scene, role);
  const mesh = matches[index];
  if (mesh === undefined) throw new Error(`missing ${role} mesh ${index}`);
  return mesh;
}

function meshesByRole(scene: THREE.Scene, role: string): THREE.Mesh[] {
  const matches: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.userData.gameplayRole === role
    )
      matches.push(object);
  });
  return matches;
}

function gameplayRenderPass(
  harness: Pick<ReturnType<typeof rendererHarness>, 'cameras' | 'viewports'>,
  scene: THREE.Scene,
  role: string,
): { readonly camera: THREE.Camera; readonly viewport: SceneViewport } {
  const mesh = meshByRole(scene, role);
  for (let index = harness.cameras.length - 1; index >= 0; index -= 1) {
    const camera = harness.cameras[index];
    const viewport = harness.viewports[index];
    if (
      camera !== undefined &&
      viewport !== undefined &&
      camera.layers.test(mesh.layers)
    )
      return { camera, viewport };
  }
  throw new Error(`no rendered camera pass includes ${role}`);
}

function projectedVerticalBounds(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  viewport: SceneViewport,
  viewportHeight: number,
): readonly [number, number] {
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute('position');
  const projectedY: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    const point = new THREE.Vector3(
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index),
    )
      .applyMatrix4(mesh.matrixWorld)
      .project(camera);
    projectedY.push(
      viewportHeight -
        viewport.y -
        ((point.y + 1) * viewport.height) / 2,
    );
  }
  return [Math.min(...projectedY), Math.max(...projectedY)];
}

function projectedScreenBounds(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  viewport: SceneViewport,
  hostHeight: number,
): readonly [number, number, number, number] {
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute('position');
  const screenX: number[] = [];
  const screenY: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    const point = new THREE.Vector3(
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index),
    )
      .applyMatrix4(mesh.matrixWorld)
      .project(camera);
    screenX.push(viewport.x + ((point.x + 1) * viewport.width) / 2);
    screenY.push(
      hostHeight - viewport.y - ((point.y + 1) * viewport.height) / 2,
    );
  }
  return [
    Math.min(...screenX),
    Math.max(...screenX),
    Math.min(...screenY),
    Math.max(...screenY),
  ];
}

function projectedScreenCenter(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  viewport: SceneViewport,
  hostHeight: number,
): THREE.Vector2 {
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld(true);
  const center = mesh.getWorldPosition(new THREE.Vector3()).project(camera);
  return new THREE.Vector2(
    viewport.x + ((center.x + 1) * viewport.width) / 2,
    hostHeight - viewport.y - ((center.y + 1) * viewport.height) / 2,
  );
}

function visibleWorldMeshes(
  scene: THREE.Scene,
  role: string,
  camera: THREE.Camera,
): THREE.Mesh[] {
  return meshesByRole(scene, role).filter(
    (mesh) => mesh.visible && camera.layers.test(mesh.layers),
  );
}

function closeBounds(
  actual: readonly [number, number],
  expected: readonly [number, number],
): void {
  expect(actual[0]).toBeCloseTo(expected[0], 4);
  expect(actual[1]).toBeCloseTo(expected[1], 4);
}

function expectInsideBoard(
  bounds: readonly [number, number, number, number],
  viewport: SceneViewport,
  host: HostCase,
  description: string,
): void {
  const top = host.height - viewport.y - viewport.height;
  const bottom = host.height - viewport.y;
  expect(bounds[0], `${description} left edge`).toBeGreaterThanOrEqual(
    viewport.x,
  );
  expect(bounds[1], `${description} right edge`).toBeLessThanOrEqual(
    viewport.x + viewport.width,
  );
  expect(bounds[2], `${description} top edge`).toBeGreaterThanOrEqual(top);
  expect(bounds[3], `${description} bottom edge`).toBeLessThanOrEqual(bottom);
}

function projectProgress(
  start: THREE.Vector3,
  hit: THREE.Vector3,
  progress: number,
  camera: THREE.Camera,
  viewport: SceneViewport,
  viewportHeight: number,
): number {
  const worldPoint = start.clone().lerp(hit, progress);
  const ndcY = worldPoint.project(camera).y;
  return viewportHeight - viewport.y - ((ndcY + 1) * viewport.height) / 2;
}

afterEach(() => vi.unstubAllGlobals());

describe('perspective gameplay runway geometry', () => {
  it.each(hosts)(
    'renders gameplay geometry through a real perspective camera on $name host',
    (host) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const harness = rendererHarness(host);
      if (harness.scene === null)
        throw new Error('scene renderer failed to initialize');

      try {
        harness.scene.updateFrame({
          city,
          gameplay: makeFrame(host, 'normal', 0.5),
        });
        const scene = harness.renderedScene();
        if (scene === undefined)
          throw new Error('gameplay perspective pass was not rendered');

        const { camera: gameplayCamera } = gameplayRenderPass(
          harness,
          scene,
          'note-good-envelope',
        );
        expect(gameplayCamera).toBeInstanceOf(THREE.PerspectiveCamera);
        const note = meshByRole(scene, 'note-good-envelope');
        const lane = meshByRole(scene, 'lane', 1);
        const noteCenter = note
          .getWorldPosition(new THREE.Vector3())
          .project(gameplayCamera);
        const laneCenter = lane
          .getWorldPosition(new THREE.Vector3())
          .project(gameplayCamera);
        expect(noteCenter.toArray().every(Number.isFinite)).toBe(true);
        expect(laneCenter.toArray().every(Number.isFinite)).toBe(true);
      } finally {
        harness.scene.destroy();
      }
    },
  );

  it.each(hosts)(
    'keeps onset centers, nested target bands, and unclipped window extents for every difficulty on $name host',
    (host) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const harness = rendererHarness(host);
      if (harness.scene === null)
        throw new Error('scene renderer failed to initialize');

      try {
        for (const difficulty of ['easy', 'normal', 'hard'] as const) {
          const centerAt = (progress: number): {
            readonly center: THREE.Vector3;
          } => {
            harness.scene?.updateFrame({
              city,
              gameplay: makeFrame(host, difficulty, progress),
            });
            const renderedScene = harness.renderedScene();
            if (renderedScene === undefined)
              throw new Error('runway sample was not rendered');
            gameplayRenderPass(
              harness,
              renderedScene,
              'note-good-envelope',
            );
            return {
              center: meshByRole(
                renderedScene,
                'note-good-envelope',
              ).getWorldPosition(new THREE.Vector3()),
            };
          };
          const start = centerAt(0).center;
          const hit = centerAt(1);
          harness.scene.updateFrame({
            city,
            gameplay: makeFrame(host, difficulty, 0.5),
          });
          const scene = harness.renderedScene();
          if (scene === undefined)
            throw new Error('gameplay pass was not rendered');
          const { camera, viewport } = gameplayRenderPass(
            harness,
            scene,
            'note-good-envelope',
          );

          const noteGood = meshByRole(scene, 'note-good-envelope');
          const notePerfect = meshByRole(scene, 'note-perfect-envelope');
          const targetGood = meshByRole(scene, 'good-band', 1);
          const targetPerfect = meshByRole(scene, 'perfect-band', 1);
          const targetGoodBounds = projectedVerticalBounds(
            targetGood,
            camera,
            viewport,
            host.height,
          );
          const targetPerfectBounds = projectedVerticalBounds(
            targetPerfect,
            camera,
            viewport,
            host.height,
          );
          const goodHalfProgress =
            getDifficultyProfile(difficulty).timing.goodWindowSeconds / 2.4;
          const perfectHalfProgress =
            getDifficultyProfile(difficulty).timing.perfectWindowSeconds / 2.4;
          const expectedEdges = (halfProgress: number) =>
            [
              projectProgress(
                start,
                hit.center,
                1 - halfProgress,
                camera,
                viewport,
                host.height,
              ),
              projectProgress(
                start,
                hit.center,
                1 + halfProgress,
                camera,
                viewport,
                host.height,
              ),
            ].sort((first, second) => first - second) as [number, number];
          closeBounds(targetGoodBounds, expectedEdges(goodHalfProgress));
          closeBounds(
            targetPerfectBounds,
            expectedEdges(perfectHalfProgress),
          );
          const noteGoodBounds = projectedVerticalBounds(
            noteGood,
            camera,
            viewport,
            host.height,
          );
          const notePerfectBounds = projectedVerticalBounds(
            notePerfect,
            camera,
            viewport,
            host.height,
          );
          const movingEdges = (halfProgress: number) =>
            [
              projectProgress(
                start,
                hit.center,
                0.5 - halfProgress,
                camera,
                viewport,
                host.height,
              ),
              projectProgress(
                start,
                hit.center,
                0.5 + halfProgress,
                camera,
                viewport,
                host.height,
              ),
            ].sort((first, second) => first - second) as [number, number];
          closeBounds(noteGoodBounds, movingEdges(goodHalfProgress));
          closeBounds(notePerfectBounds, movingEdges(perfectHalfProgress));

          expect(targetGoodBounds[0]).toBeLessThan(targetPerfectBounds[0]);
          expect(targetGoodBounds[1]).toBeGreaterThan(targetPerfectBounds[1]);
          expect(targetGoodBounds[0]).toBeGreaterThanOrEqual(0);
          expect(targetGoodBounds[1]).toBeLessThanOrEqual(host.height);
          expect(targetPerfectBounds[0]).toBeGreaterThanOrEqual(0);
          expect(targetPerfectBounds[1]).toBeLessThanOrEqual(host.height);

          harness.scene.updateFrame({
            city,
            gameplay: makeFrame(host, difficulty, 1),
          });
          const onsetScene = harness.renderedScene();
          if (onsetScene === undefined)
            throw new Error('onset pass was not rendered');
          const { camera: onsetCamera, viewport: onsetViewport } =
            gameplayRenderPass(harness, onsetScene, 'note-good-envelope');
          const onsetGood = meshByRole(onsetScene, 'note-good-envelope');
          const onsetPerfect = meshByRole(onsetScene, 'note-perfect-envelope');
          const onsetTarget = meshByRole(onsetScene, 'good-band', 1);
          const targetCenterY = onsetTarget
            .getWorldPosition(new THREE.Vector3())
            .project(onsetCamera).y;
          const onsetCenterY = onsetGood
            .getWorldPosition(new THREE.Vector3())
            .project(onsetCamera).y;
          expect(onsetCenterY).toBeCloseTo(targetCenterY, 8);
          closeBounds(
            projectedVerticalBounds(
              onsetGood,
              onsetCamera,
              onsetViewport,
              host.height,
            ),
            targetGoodBounds,
          );
          closeBounds(
            projectedVerticalBounds(
              onsetPerfect,
              onsetCamera,
              onsetViewport,
              host.height,
            ),
            targetPerfectBounds,
          );
          const hitPixelY = host.height - onsetViewport.y -
            ((targetCenterY + 1) * onsetViewport.height) / 2;
          expect(targetGoodBounds[0]).toBeLessThan(hitPixelY);
          expect(targetGoodBounds[1]).toBeGreaterThan(hitPixelY);
          expect(targetPerfectBounds[0]).toBeLessThan(hitPixelY);
          expect(targetPerfectBounds[1]).toBeGreaterThan(hitPixelY);
        }
      } finally {
        harness.scene.destroy();
      }
    },
  );

  it.each(hosts)(
    'projects unclipped onset and approach endpoints within the actual board viewport for all lanes and difficulties on $name host',
    (host) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const harness = rendererHarness(host);
      if (harness.scene === null)
        throw new Error('scene renderer failed to initialize');

      try {
        for (const difficulty of ['easy', 'normal', 'hard'] as const) {
          const halfGood =
            getDifficultyProfile(difficulty).timing.goodWindowSeconds / 2.4;
          const halfPerfect =
            getDifficultyProfile(difficulty).timing.perfectWindowSeconds / 2.4;
          for (let lane = 0; lane < 4; lane += 1) {
            const centerAt = (progress: number): THREE.Vector3 => {
              harness.scene?.updateFrame({
                city,
                gameplay: makeFrame(host, difficulty, progress, 1, lane),
              });
              const rendered = harness.renderedScene();
              if (rendered === undefined)
                throw new Error('runway sample was not rendered');
              gameplayRenderPass(harness, rendered, 'note-good-envelope');
              return meshByRole(rendered, 'note-good-envelope').getWorldPosition(
                new THREE.Vector3(),
              );
            };
            const start = centerAt(0);
            const hit = centerAt(1);
            harness.scene.updateFrame({
              city,
              gameplay: makeFrame(host, difficulty, 0, 1, lane),
            });
            const rendered = harness.renderedScene();
            if (rendered === undefined)
              throw new Error('approach endpoint frame was not rendered');
            const { camera, viewport } = gameplayRenderPass(
              harness,
              rendered,
              'note-good-envelope',
            );
            const expectedEdges = (center: number, halfProgress: number) =>
              [
                projectProgress(
                  start,
                  hit,
                  center - halfProgress,
                  camera,
                  viewport,
                  host.height,
                ),
                projectProgress(
                  start,
                  hit,
                  center + halfProgress,
                  camera,
                  viewport,
                  host.height,
                ),
              ].sort((first, second) => first - second) as [number, number];
            const noteGood = meshByRole(rendered, 'note-good-envelope');
            const notePerfect = meshByRole(rendered, 'note-perfect-envelope');
            const targetGood = meshByRole(rendered, 'good-band', lane);
            const targetPerfect = meshByRole(rendered, 'perfect-band', lane);
            const noteGoodBounds = projectedVerticalBounds(
              noteGood,
              camera,
              viewport,
              host.height,
            );
            const notePerfectBounds = projectedVerticalBounds(
              notePerfect,
              camera,
              viewport,
              host.height,
            );
            const targetGoodBounds = projectedVerticalBounds(
              targetGood,
              camera,
              viewport,
              host.height,
            );
            const targetPerfectBounds = projectedVerticalBounds(
              targetPerfect,
              camera,
              viewport,
              host.height,
            );

            closeBounds(noteGoodBounds, expectedEdges(0, halfGood));
            closeBounds(notePerfectBounds, expectedEdges(0, halfPerfect));
            closeBounds(targetGoodBounds, expectedEdges(1, halfGood));
            closeBounds(targetPerfectBounds, expectedEdges(1, halfPerfect));
            for (const [role, mesh] of [
              ['Good approach envelope', noteGood],
              ['Perfect approach envelope', notePerfect],
              ['Good onset window', targetGood],
              ['Perfect onset window', targetPerfect],
            ] as const) {
              expectInsideBoard(
                projectedScreenBounds(
                  mesh,
                  camera,
                  viewport,
                  host.height,
                ),
                viewport,
                host,
                `${difficulty} lane ${lane} ${role}`,
              );
            }
          }
        }
      } finally {
        harness.scene.destroy();
      }
    },
  );

  it('renders four distinct lane-local hit accents on the perspective runway', () => {
    const host = hosts[0];
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const harness = rendererHarness(host);
    if (harness.scene === null)
      throw new Error('scene renderer failed to initialize');

    try {
      harness.scene.updateFrame({
        city,
        gameplay: makeFrame(host, 'easy', 1, 1, 0),
      });
      const rendered = harness.renderedScene();
      if (rendered === undefined)
        throw new Error('onset frame was not rendered');
      const { camera } = gameplayRenderPass(
        harness,
        rendered,
        'note-bar',
      );
      const accents = meshesByRole(rendered, 'hit-line').filter(
        (mesh) => mesh.visible && camera.layers.test(mesh.layers),
      );
      expect(accents).toHaveLength(4);
      const centers = accents
        .map((mesh) => mesh.getWorldPosition(new THREE.Vector3()).x)
        .sort((first, second) => first - second);
      expect(new Set(centers).size).toBe(4);
      const [first, second, third, fourth] = centers;
      if (
        first === undefined ||
        second === undefined ||
        third === undefined ||
        fourth === undefined
      )
        throw new Error('four lane accent centers must be rendered');
      expect(first).toBeLessThan(second);
      expect(second).toBeLessThan(third);
      expect(third).toBeLessThan(fourth);
    } finally {
      harness.scene.destroy();
    }
  });

  it('aligns each visible onset bar with its lane target and hit accent', () => {
    const host = hosts[0];
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const harness = rendererHarness(host);
    if (harness.scene === null)
      throw new Error('scene renderer failed to initialize');

    try {
      for (let lane = 0; lane < 4; lane += 1) {
        harness.scene.updateFrame({
          city,
          gameplay: makeFrame(host, 'easy', 1, 1, lane),
        });
        const rendered = harness.renderedScene();
        if (rendered === undefined)
          throw new Error('onset frame was not rendered');
        const { camera } = gameplayRenderPass(harness, rendered, 'note-bar');
        const bar = meshByRole(rendered, 'note-bar');
        const target = meshByRole(rendered, 'good-band', lane);
        const targetCenter = target
          .getWorldPosition(new THREE.Vector3())
          .project(camera);
        const barCenter = bar
          .getWorldPosition(new THREE.Vector3())
          .project(camera);
        expect(barCenter.x, `lane ${lane} bar/target x`).toBeCloseTo(
          targetCenter.x,
          8,
        );
        expect(barCenter.y, `lane ${lane} bar/target y`).toBeCloseTo(
          targetCenter.y,
          8,
        );

        const accents = meshesByRole(rendered, 'hit-line').filter(
          (mesh) => mesh.visible && camera.layers.test(mesh.layers),
        );
        const targetX = target.getWorldPosition(new THREE.Vector3()).x;
        const accent = accents
          .slice()
          .sort(
            (first, second) =>
              Math.abs(first.getWorldPosition(new THREE.Vector3()).x - targetX) -
              Math.abs(second.getWorldPosition(new THREE.Vector3()).x - targetX),
          )[0];
        if (accent === undefined) continue;
        const accentCenter = accent
          .getWorldPosition(new THREE.Vector3())
          .project(camera);
        expect(barCenter.x, `lane ${lane} bar/accent x`).toBeCloseTo(
          accentCenter.x,
          8,
        );
        expect(barCenter.y, `lane ${lane} bar/accent y`).toBeCloseTo(
          accentCenter.y,
          8,
        );
      }
    } finally {
      harness.scene.destroy();
    }
  });

  it('orders coplanar runway materials deterministically without depth-writing the translucent surface', () => {
    const host = hosts[0];
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const harness = rendererHarness(host);
    if (harness.scene === null)
      throw new Error('scene renderer failed to initialize');

    try {
      harness.scene.updateFrame({
        city,
        gameplay: makeFrame(host, 'normal', 0.5),
      });
      const rendered = harness.renderedScene();
      if (rendered === undefined)
        throw new Error('runway frame was not rendered');
      const { camera } = gameplayRenderPass(
        harness,
        rendered,
        'note-bar',
      );
      const surface = visibleWorldMeshes(rendered, 'runway-surface', camera);
      const structural = [
        ...visibleWorldMeshes(rendered, 'lane', camera),
        ...visibleWorldMeshes(rendered, 'lane-divider', camera),
      ];
      const timing = [
        ...visibleWorldMeshes(rendered, 'good-band', camera),
        ...visibleWorldMeshes(rendered, 'perfect-band', camera),
        ...visibleWorldMeshes(rendered, 'note-good-envelope', camera),
        ...visibleWorldMeshes(rendered, 'note-perfect-envelope', camera),
      ];
      const accents = visibleWorldMeshes(rendered, 'hit-line', camera);
      const bars = visibleWorldMeshes(rendered, 'note-bar', camera);
      const groups = [surface, structural, timing, accents, bars];
      for (const [index, group] of groups.entries()) {
        expect(group.length, `render-order group ${index} must be present`).toBeGreaterThan(0);
      }

      for (const [leftIndex, rightIndex] of [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ] as const) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        if (left === undefined || right === undefined)
          throw new Error('runway draw-order groups must exist');
        expect(
          Math.max(...left.map((mesh) => mesh.renderOrder)),
          `draw-order group ${leftIndex} must precede ${rightIndex}`,
        ).toBeLessThan(Math.min(...right.map((mesh) => mesh.renderOrder)));
      }

      const stripMeshes = groups.flat();
      const laterMaterials = groups.slice(1).flatMap((group) =>
        group.flatMap((mesh) =>
          Array.isArray(mesh.material) ? mesh.material : [mesh.material],
        ),
      );
      const laterQueues = new Set(
        laterMaterials.map((material) => material.transparent),
      );
      expect(
        laterQueues.size,
        'timing, accent, and note layers must share a deterministic renderer queue',
      ).toBe(1);
      const laterQueue = laterMaterials[0]?.transparent;
      if (laterQueue === undefined)
        throw new Error('later runway materials must exist');
      const surfaceMaterial = surface[0]?.material;
      const surfaceMaterials = Array.isArray(surfaceMaterial)
        ? surfaceMaterial
        : surfaceMaterial === undefined
          ? []
          : [surfaceMaterial];
      expect(
        surfaceMaterials.every(
          (material) => !material.transparent || !material.depthWrite,
        ),
        'a translucent runway base must not pre-empt coplanar layers in the depth buffer',
      ).toBe(true);
      expect(
        surfaceMaterials.every(
          (material) => !material.transparent || material.transparent === laterQueue,
        ),
        'the surface must not be deferred behind opaque layers',
      ).toBe(true);
      expect(
        !laterQueue || laterMaterials.every((material) => !material.depthWrite),
        'transparent coplanar gameplay layers must not occlude one another in depth',
      ).toBe(true);
      const runwayY = surface[0]?.position.y;
      if (runwayY === undefined) throw new Error('runway surface is missing');
      expect(
        stripMeshes.every((mesh) => Math.abs(mesh.position.y - runwayY) < 1e-8),
        'draw ordering must not depend on moving strips off the canonical runway plane',
      ).toBe(true);
    } finally {
      harness.scene.destroy();
    }
  });

  it.each(hosts)(
    'anchors overlay lane keys and the hit label to the projected runway on $name host',
    (host) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const harness = rendererHarness(host);
      if (harness.scene === null)
        throw new Error('scene renderer failed to initialize');

      try {
        const frame = makeFrame(host, 'normal', 1);
        harness.scene.updateFrame({ city, gameplay: frame });
        const rendered = harness.renderedScene();
        if (rendered === undefined)
          throw new Error('onset frame was not rendered');
        const laneKeys = meshesByRole(rendered, 'lane-key').filter(
          (mesh) => mesh.visible,
        );
        expect(laneKeys).toHaveLength(4);
        for (let lane = 0; lane < 4; lane += 1) {
          const key = laneKeys[lane];
          if (key === undefined)
            throw new Error(`lane ${lane} key label is missing`);
          const target = meshByRole(rendered, 'good-band', lane);
          const targetPass = gameplayRenderPass(
            harness,
            rendered,
            'good-band',
          );
          const keyPass = gameplayRenderPass(harness, rendered, 'lane-key');
          const targetCenter = projectedScreenCenter(
            target,
            targetPass.camera,
            targetPass.viewport,
            host.height,
          );
          const keyCenter = projectedScreenCenter(
            key,
            keyPass.camera,
            keyPass.viewport,
            host.height,
          );
          expect(
            Math.abs(keyCenter.x - targetCenter.x),
            `lane ${lane} key horizontal anchor`,
          ).toBeLessThanOrEqual(Math.max(18, host.board.width * 0.08));
          expect(
            Math.abs(keyCenter.y - targetCenter.y),
            `lane ${lane} key onset offset`,
          ).toBeLessThanOrEqual(Math.max(20, host.board.height * 0.15));
        }

        const hitLabel = meshByRole(rendered, 'hit-label');
        const rightTarget = meshByRole(rendered, 'good-band', 3);
        const hitPass = gameplayRenderPass(harness, rendered, 'hit-label');
        const targetPass = gameplayRenderPass(harness, rendered, 'good-band');
        const labelCenter = projectedScreenCenter(
          hitLabel,
          hitPass.camera,
          hitPass.viewport,
          host.height,
        );
        const onsetCenter = projectedScreenCenter(
          rightTarget,
          targetPass.camera,
          targetPass.viewport,
          host.height,
        );
        expect(Math.abs(labelCenter.x - onsetCenter.x)).toBeLessThanOrEqual(
          Math.max(20, host.board.width * 0.12),
        );
        expect(Math.abs(labelCenter.y - onsetCenter.y)).toBeLessThanOrEqual(
          Math.max(24, host.board.height * 0.18),
        );

        const key = laneKeys[3];
        if (key === undefined)
          throw new Error('rightmost lane key label is missing');
        const keyPass = gameplayRenderPass(harness, rendered, 'lane-key');
        const keyBounds = projectedScreenBounds(
          key,
          keyPass.camera,
          keyPass.viewport,
          host.height,
        );
        const hitBounds = projectedScreenBounds(
          hitLabel,
          hitPass.camera,
          hitPass.viewport,
          host.height,
        );
        const board = frame.layout.board;
        for (const [name, bounds] of [
          ['K lane key', keyBounds],
          ['HIT label', hitBounds],
        ] as const) {
          expect(bounds[0], `${name} left edge`).toBeGreaterThanOrEqual(
            board.x,
          );
          expect(bounds[1], `${name} right edge`).toBeLessThanOrEqual(
            board.x + board.width,
          );
          expect(bounds[2], `${name} top edge`).toBeGreaterThanOrEqual(
            board.y,
          );
          expect(bounds[3], `${name} bottom edge`).toBeLessThanOrEqual(
            board.y + board.height,
          );
        }
        const labelClearancePx = 3;
        const textQuadsSeparated =
          keyBounds[1] + labelClearancePx <= hitBounds[0] ||
          hitBounds[1] + labelClearancePx <= keyBounds[0] ||
          keyBounds[3] + labelClearancePx <= hitBounds[2] ||
          hitBounds[3] + labelClearancePx <= keyBounds[2];
        expect(
          textQuadsSeparated,
          'the K lane key and HIT label need distinct projected text-plane space',
        ).toBe(true);
      } finally {
        harness.scene.destroy();
      }
    },
  );

  it('keeps the note center clamped at onset during late grace while its envelope remains attached', () => {
    const host = hosts[0];
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const harness = rendererHarness(host);
    if (harness.scene === null)
      throw new Error('scene renderer failed to initialize');

    try {
      const centers: number[] = [];
      let onsetBounds: readonly [number, number] | undefined;
      let lateBounds: readonly [number, number] | undefined;
      const samples = [
        { progress: 0.75, lateGrace: false },
        { progress: 1, lateGrace: false },
        // Runtime projectNotes clamps overdue unresolved notes to progress 1.
        { progress: 1, lateGrace: true },
      ] as const;
      for (const sample of samples) {
        harness.scene.updateFrame({
          city,
          gameplay: makeFrame(
            host,
            'easy',
            sample.progress,
            sample.lateGrace ? 2 : 1,
          ),
        });
        const scene = harness.renderedScene();
        if (scene === undefined)
          throw new Error('gameplay pass was not rendered');
        const { camera, viewport } = gameplayRenderPass(
          harness,
          scene,
          'note-good-envelope',
        );
        const envelope = meshByRole(scene, 'note-good-envelope');
        centers.push(
          envelope.getWorldPosition(new THREE.Vector3()).project(camera).y,
        );
        if (sample.progress === 1 && !sample.lateGrace)
          onsetBounds = projectedVerticalBounds(
            envelope,
            camera,
            viewport,
            host.height,
          );
        if (sample.lateGrace)
          lateBounds = projectedVerticalBounds(
            envelope,
            camera,
            viewport,
            host.height,
          );
      }

      const onsetCenter = centers[1];
      const lateCenter = centers[2];
      if (
        onsetCenter === undefined ||
        lateCenter === undefined ||
        onsetBounds === undefined ||
        lateBounds === undefined
      )
        throw new Error('onset and late-grace geometry must be rendered');
      expect(onsetCenter).toBeCloseTo(lateCenter, 5);
      expect(centers[0]).not.toBeCloseTo(onsetCenter, 5);
      closeBounds(lateBounds, onsetBounds);
    } finally {
      harness.scene.destroy();
    }
  });
});
