import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { getDifficultyProfile } from './game-balance';
import {
  projectGameplayFrame,
  VISIBLE_NOTE_SECONDS,
  type GameplayLayout,
} from './gameplay-frame';
import { projectTimingWindowGeometry } from './note-projection';
import { createBrightvaleScene, type SceneRenderer } from './scene';
import type { SceneStateProjection } from './scene-state';

// The existing scene fixture is 480 × 240. Keep that tested desktop board
// proportion as the logical reference instead of introducing a new layout.
const LOGICAL_BOARD = { width: 480, height: 240 };

interface RenderViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function gameplayPassFor(
  cameras: readonly THREE.Camera[],
  viewports: readonly RenderViewport[],
  mesh: THREE.Mesh,
): { readonly camera: THREE.Camera; readonly viewport: RenderViewport } {
  for (let index = cameras.length - 1; index >= 0; index -= 1) {
    const camera = cameras[index];
    const viewport = viewports[index];
    if (
      camera !== undefined &&
      viewport !== undefined &&
      camera.layers.test(mesh.layers)
    )
      return { camera, viewport };
  }
  throw new Error(`no gameplay pass renders ${String(mesh.userData.gameplayRole)}`);
}

function projectedYBounds(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  viewport: RenderViewport,
  hostHeight: number,
): readonly [number, number] {
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute('position');
  const screenY: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    const point = new THREE.Vector3(
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index),
    )
      .applyMatrix4(mesh.matrixWorld)
      .project(camera);
    screenY.push(
      hostHeight - viewport.y - ((point.y + 1) * viewport.height) / 2,
    );
  }
  return [Math.min(...screenY), Math.max(...screenY)];
}

function projectedScreenCenter(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  viewport: RenderViewport,
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

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: 100,
  allowedDifficulties: ['normal', 'hard'],
  notes: [{ id: 'approaching-note', lane: 2, time: 12 }],
};

const snapshot: ControllerSnapshot = {
  audio: {
    status: 'playing',
    position: 12,
    duration: 20,
    scheduledWhen: null,
    hasActiveSource: true,
    loaded: true,
    disposed: false,
    error: null,
  },
  game: {
    transportTime: 12,
    phase: 'audience',
    status: 'playing',
    renown: 0,
    personalStrength: 100,
    twilightStrength: 100,
    difficulty: 'normal',
    notes: [{ id: 'approaching-note', phase: 'audience', outcome: null }],
    result: null,
  },
  inputOffset: 0,
  visualOffset: 0,
  selectedDifficulty: 'normal',
  feedback: null,
  pendingPlaybackRequests: false,
};

function layoutFor(
  viewportWidth: number,
  viewportHeight: number,
  availableBoard: GameplayLayout['board'],
): GameplayLayout {
  return {
    width: viewportWidth,
    height: viewportHeight,
    stage: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
    // This rect is the available CSS box. Projection must contain the logical
    // board in it; it must not inherit the box's changing aspect ratio.
    board: availableBoard,
    header: { x: 0, y: 0, width: viewportWidth, height: 24 },
    legend: { x: 0, y: viewportHeight - 40, width: viewportWidth, height: 24 },
    feedback: {
      x: 0,
      y: viewportHeight - 16,
      width: viewportWidth,
      height: 16,
    },
  };
}

describe('responsive logical playfield projection', () => {
  it.each([
    {
      name: 'wide desktop',
      layout: layoutFor(1440, 900, {
        x: 220,
        y: 180,
        width: 1000,
        height: 500,
      }),
    },
    {
      name: 'tall mobile',
      layout: layoutFor(390, 844, { x: 24, y: 96, width: 342, height: 560 }),
    },
    {
      name: 'resized compact desktop',
      layout: layoutFor(960, 720, { x: 80, y: 140, width: 800, height: 360 }),
    },
  ])(
    '$name contains and centers the same logical board uniformly',
    ({ layout }) => {
      const frame = projectGameplayFrame(snapshot, chart, layout, false);
      const board = frame.layout.board;
      const available = layout.board;
      const logicalScaleX = board.width / LOGICAL_BOARD.width;
      const logicalScaleY = board.height / LOGICAL_BOARD.height;

      expect(logicalScaleX).toBeGreaterThan(0);
      expect(logicalScaleX).toBeCloseTo(logicalScaleY, 8);
      expect(board.width / board.height).toBeCloseTo(2, 8);
      expect(board.x + board.width / 2).toBeCloseTo(
        available.x + available.width / 2,
        8,
      );
      expect(board.y + board.height / 2).toBeCloseTo(
        available.y + available.height / 2,
        8,
      );
      expect(board.x).toBeGreaterThanOrEqual(available.x - 1e-8);
      expect(board.y).toBeGreaterThanOrEqual(available.y - 1e-8);
      expect(board.x + board.width).toBeLessThanOrEqual(
        available.x + available.width + 1e-8,
      );
      expect(board.y + board.height).toBeLessThanOrEqual(
        available.y + available.height + 1e-8,
      );

      // Lane geometry follows the fitted board, not the un-fitted CSS box.
      expect(frame.lanes.map(({ x, width }) => [x, width])).toEqual(
        [0, 1, 2, 3].map((index) => [
          board.x + (board.width * index) / 4,
          board.width / 4,
        ]),
      );
      expect(frame.notes[0]).toMatchObject({ lane: 2, progress: 1 });

      // Timing-window pixels scale with the same fitted logical runway while
      // preserving the profile's seconds-to-logical-pixels mapping.
      const expectedWindows = projectTimingWindowGeometry(
        'normal',
        board.height * 0.64,
        2.4,
      );
      expect(frame.timingWindows).toEqual(expectedWindows);
      expect(
        frame.timingWindows.goodEnvelopeHeightPx / board.height,
      ).toBeCloseTo(
        projectTimingWindowGeometry('normal', 153.6, 2.4).goodEnvelopeHeightPx /
          LOGICAL_BOARD.height,
        8,
      );
      expect(
        frame.timingWindows.goodEnvelopeHeightPx / logicalScaleY,
      ).toBeCloseTo(
        projectTimingWindowGeometry('normal', 153.6, 2.4).goodEnvelopeHeightPx,
        8,
      );
    },
  );

  it.each([
    { boardWidth: 480, boardHeight: 240 },
    { boardWidth: 320, boardHeight: 160 },
  ])(
    'keeps projected note centers aligned with the hit line across a $boardWidth×$boardHeight board',
    ({ boardWidth, boardHeight }) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const renderedScenes: THREE.Scene[] = [];
      const renderedCameras: THREE.Camera[] = [];
      const renderedViewports: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
      }> = [];
      let viewport = { x: 0, y: 0, width: 640, height: 480 };
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
        setViewport: vi.fn(
          (x: number, y: number, width: number, height: number) => {
            viewport = { x, y, width, height };
          },
        ),
        setScissor: vi.fn(),
        setScissorTest: vi.fn(),
        clear: vi.fn(),
        clearDepth: vi.fn(),
        render: vi.fn((rendered: THREE.Scene, camera: THREE.Camera) => {
          rendered.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          renderedScenes.push(rendered);
          renderedCameras.push(camera);
          renderedViewports.push(viewport);
        }),
        dispose: vi.fn(),
      } as unknown as SceneRenderer;
      const host = {
        clientWidth: 640,
        clientHeight: 480,
        firstChild: null,
        insertBefore: vi.fn(),
      } as unknown as HTMLElement;
      const scene = createBrightvaleScene(host, vi.fn(), () => renderer);
      if (scene === null)
        throw new Error('scene renderer failed to initialize');

      const layout = layoutFor(640, 480, {
        x: 80,
        y: 80,
        width: boardWidth,
        height: boardHeight,
      });
      const noteTime = VISIBLE_NOTE_SECONDS;
      const scenarioChart = {
        ...chart,
        notes: chart.notes.map((note) => ({ ...note, time: noteTime })),
      };
      const samples = [
        { label: 'approach endpoint', time: 0 },
        { label: 'halfway approach', time: VISIBLE_NOTE_SECONDS / 2 },
        { label: 'onset', time: noteTime },
        { label: 'overdue', time: noteTime + 1 },
      ];

      try {
        const projectedCenters: number[] = [];
        for (const sample of samples) {
          const frame = projectGameplayFrame(
            {
              ...snapshot,
              game: { ...snapshot.game, transportTime: sample.time },
            },
            scenarioChart,
            layout,
            false,
          );
          scene.updateFrame({ city, gameplay: frame });
          const renderedScene = renderedScenes.at(-1);
          if (renderedScene === undefined)
            throw new Error('gameplay scene must be submitted to the renderer');
          const byRole = (role: string): THREE.Mesh => {
            let result: THREE.Mesh | undefined;
            renderedScene.traverse((object) => {
              if (
                result === undefined &&
                object instanceof THREE.Mesh &&
                object.userData.gameplayRole === role
              )
                result = object;
            });
            if (result === undefined) throw new Error(`missing ${role} mesh`);
            return result;
          };
          const note = byRole('note-good-envelope');
          let gameplayPass = -1;
          for (let index = renderedCameras.length - 1; index >= 0; index -= 1) {
            const camera = renderedCameras[index];
            if (camera !== undefined && camera.layers.test(note.layers)) {
              gameplayPass = index;
              break;
            }
          }
          const camera = renderedCameras[gameplayPass];
          const viewport = renderedViewports[gameplayPass];
          if (camera === undefined || viewport === undefined)
            throw new Error('the rendered note must have a gameplay camera pass');
          const progress = frame.notes[0]?.progress;
          expect(progress, sample.label).toBe(
            sample.label === 'approach endpoint'
              ? 0
              : sample.label === 'halfway approach'
                ? 0.5
                : 1,
          );
          const projectedY = note
            .getWorldPosition(new THREE.Vector3())
            .project(camera).y;
          projectedCenters.push(
            frame.layout.height -
              viewport.y -
              ((projectedY + 1) * viewport.height) / 2,
          );
        }
        const [startY, middleY, onsetY, overdueY] = projectedCenters;
        if (
          startY === undefined ||
          middleY === undefined ||
          onsetY === undefined ||
          overdueY === undefined
        )
          throw new Error('all runway samples must render');
        expect(startY).toBeLessThan(middleY);
        expect(middleY).toBeLessThan(onsetY);
        expect(onsetY).toBeCloseTo(overdueY, 8);
      } finally {
        scene.destroy();
      }
    },
  );

  it('uses the fitted board rect for the actual gameplay render scissor', () => {
    const viewport = layoutFor(390, 844, {
      x: 24,
      y: 96,
      width: 342,
      height: 560,
    });
    const frame = projectGameplayFrame(snapshot, chart, viewport, false);
    const expectedBoard = {
      x: 24,
      y: 96 + (560 - 342 / 2) / 2,
      width: 342,
      height: 171,
    };
    const scissorCalls: number[][] = [];
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
      setViewport: vi.fn(),
      setScissor: vi.fn((x: number, y: number, width: number, height: number) =>
        scissorCalls.push([x, y, width, height]),
      ),
      setScissorTest: vi.fn(),
      clear: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as SceneRenderer;
    const host = {
      clientWidth: viewport.width,
      clientHeight: viewport.height,
      firstChild: null,
      insertBefore: vi.fn(),
    } as unknown as HTMLElement;
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const scene = createBrightvaleScene(host, vi.fn(), () => renderer);
    if (scene === null) throw new Error('scene renderer failed to initialize');

    try {
      scene.updateFrame({ city, gameplay: frame });
      const board = frame.layout.board;
      expect(board).toEqual(expectedBoard);
      expect(scissorCalls).toContainEqual([
        expectedBoard.x,
        viewport.height - expectedBoard.y - expectedBoard.height,
        expectedBoard.width,
        expectedBoard.height,
      ]);
    } finally {
      scene.destroy();
    }
  });

  it.each([
    { difficulty: 'normal' as const, boardWidth: 480, boardHeight: 240 },
    { difficulty: 'normal' as const, boardWidth: 320, boardHeight: 160 },
    { difficulty: 'hard' as const, boardWidth: 480, boardHeight: 240 },
    { difficulty: 'hard' as const, boardWidth: 320, boardHeight: 160 },
  ])(
    'renders nested timing windows on the actual $difficulty perspective runway for a $boardWidth×$boardHeight board',
    ({ difficulty, boardWidth, boardHeight }) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const renderedScenes: THREE.Scene[] = [];
      const renderedCameras: THREE.Camera[] = [];
      const renderedViewports: RenderViewport[] = [];
      let viewport: RenderViewport = { x: 0, y: 0, width: 640, height: 480 };
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
          renderedScenes.push(rendered);
          renderedCameras.push(camera);
          renderedViewports.push(viewport);
        }),
        dispose: vi.fn(),
      } as unknown as SceneRenderer;
      const host = {
        clientWidth: 640,
        clientHeight: 480,
        firstChild: null,
        insertBefore: vi.fn(),
      } as unknown as HTMLElement;
      const scene = createBrightvaleScene(host, vi.fn(), () => renderer);
      if (scene === null)
        throw new Error('scene renderer failed to initialize');

      const board = {
        x: 80,
        y: 80,
        width: boardWidth,
        height: boardHeight,
      };
      const layout = layoutFor(640, 480, board);
      const onsetTime = VISIBLE_NOTE_SECONDS;
      const timingChart = {
        ...chart,
        notes: chart.notes.map((note) => ({ ...note, time: onsetTime })),
      };
      const approachFrame = projectGameplayFrame(
        {
          ...snapshot,
          game: {
            ...snapshot.game,
            difficulty,
            transportTime: 0,
          },
        },
        timingChart,
        layout,
        false,
      );
      const frame = projectGameplayFrame(
        {
          ...snapshot,
          game: {
            ...snapshot.game,
            difficulty,
            transportTime: onsetTime,
          },
        },
        timingChart,
        layout,
        false,
      );

      try {
        expect(approachFrame.notes[0]?.progress).toBe(0);
        scene.updateFrame({ city, gameplay: approachFrame });
        const approachScene = renderedScenes.at(-1);
        if (approachScene === undefined)
          throw new Error('approach frame must render');
        const findRole = (rendered: THREE.Scene, role: string): THREE.Mesh => {
          let result: THREE.Mesh | undefined;
          rendered.traverse((object) => {
            if (
              result === undefined &&
              object instanceof THREE.Mesh &&
              object.userData.gameplayRole === role
            )
              result = object;
          });
          if (result === undefined) throw new Error(`missing ${role} mesh`);
          return result;
        };
        const startMesh = findRole(approachScene, 'note-good-envelope');
        expect(startMesh.visible).toBe(true);
        const start = startMesh.getWorldPosition(new THREE.Vector3());

        expect(frame.notes[0]?.progress).toBe(1);
        scene.updateFrame({ city, gameplay: frame });
        const renderedScene = renderedScenes.at(-1);
        if (renderedScene === undefined)
          throw new Error('scene must render the compound gameplay frame');
        const meshes = new Map<string, THREE.Mesh[]>();
        renderedScene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const role = object.userData.gameplayRole;
          if (typeof role !== 'string') return;
          const roleMeshes = meshes.get(role) ?? [];
          roleMeshes.push(object);
          meshes.set(role, roleMeshes);
        });
        const noteGood = findRole(renderedScene, 'note-good-envelope');
        expect(noteGood.visible).toBe(true);
        const notePerfect = findRole(renderedScene, 'note-perfect-envelope');
        const targetGood = findRole(renderedScene, 'good-band');
        const targetPerfect = findRole(renderedScene, 'perfect-band');
        const { camera, viewport: passViewport } = gameplayPassFor(
          renderedCameras,
          renderedViewports,
          noteGood,
        );
        expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
        const hit = noteGood.getWorldPosition(new THREE.Vector3());
        const profile = projectTimingWindowGeometry(
          difficulty,
          frame.layout.board.height * 0.64,
          VISIBLE_NOTE_SECONDS,
        );
        expect(frame.timingWindows).toEqual(profile);

        const goodBounds = projectedYBounds(
          noteGood,
          camera,
          passViewport,
          frame.layout.height,
        );
        const targetGoodBounds = projectedYBounds(
          targetGood,
          camera,
          passViewport,
          frame.layout.height,
        );
        const perfectBounds = projectedYBounds(
          notePerfect,
          camera,
          passViewport,
          frame.layout.height,
        );
        const targetPerfectBounds = projectedYBounds(
          targetPerfect,
          camera,
          passViewport,
          frame.layout.height,
        );
        expect(goodBounds[0]).toBeCloseTo(targetGoodBounds[0], 8);
        expect(goodBounds[1]).toBeCloseTo(targetGoodBounds[1], 8);
        expect(perfectBounds[0]).toBeCloseTo(targetPerfectBounds[0], 8);
        expect(perfectBounds[1]).toBeCloseTo(targetPerfectBounds[1], 8);
        expect(targetGoodBounds[0]).toBeLessThan(targetPerfectBounds[0]);
        expect(targetGoodBounds[1]).toBeGreaterThan(targetPerfectBounds[1]);
        expect(targetGoodBounds[0]).toBeGreaterThanOrEqual(0);
        expect(targetGoodBounds[1]).toBeLessThanOrEqual(frame.layout.height);
        const progressAt = (progress: number): number => {
          const point = start.clone().lerp(hit, progress).project(camera);
          return (
            frame.layout.height -
            passViewport.y -
            ((point.y + 1) * passViewport.height) / 2
          );
        };
        const sortedEdges = (halfProgress: number): [number, number] =>
          [progressAt(1 - halfProgress), progressAt(1 + halfProgress)].sort(
            (first, second) => first - second,
          ) as [number, number];
        const goodHalfProgress =
          getDifficultyProfile(difficulty).timing.goodWindowSeconds /
          VISIBLE_NOTE_SECONDS;
        const perfectHalfProgress =
          getDifficultyProfile(difficulty).timing.perfectWindowSeconds /
          VISIBLE_NOTE_SECONDS;
        const expectedGood = sortedEdges(goodHalfProgress);
        const expectedPerfect = sortedEdges(perfectHalfProgress);
        expect(targetGoodBounds[0]).toBeCloseTo(expectedGood[0], 8);
        expect(targetGoodBounds[1]).toBeCloseTo(expectedGood[1], 8);
        expect(targetPerfectBounds[0]).toBeCloseTo(expectedPerfect[0], 8);
        expect(targetPerfectBounds[1]).toBeCloseTo(expectedPerfect[1], 8);
        expect(meshes.has('note')).toBe(false);
        expect(meshes.has('note-outline')).toBe(false);
        expect(hit.toArray().every(Number.isFinite)).toBe(true);
        expect(start.toArray().every(Number.isFinite)).toBe(true);
      } finally {
        scene.destroy();
      }
    },
  );

  it.each([
    { name: 'wide', width: 1440, height: 900 },
    { name: 'tall mobile', width: 390, height: 844 },
  ])(
    'projects a world-space unit square uniformly in the $name scene',
    ({ width, height }) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const cameras: THREE.Camera[] = [];
      const renderedScenes: THREE.Scene[] = [];
      const renderedViewports: RenderViewport[] = [];
      let currentViewport: RenderViewport = { x: 0, y: 0, width, height };
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
        setViewport: vi.fn(
          (
            x: number,
            y: number,
            viewportWidth: number,
            viewportHeight: number,
          ) => {
            currentViewport = {
              x,
              y,
              width: viewportWidth,
              height: viewportHeight,
            };
          },
        ),
        setScissor: vi.fn(),
        setScissorTest: vi.fn(),
        clear: vi.fn(),
        clearDepth: vi.fn(),
        render: vi.fn((rendered: THREE.Scene, camera: THREE.Camera) => {
          rendered.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          renderedScenes.push(rendered);
          cameras.push(camera);
          renderedViewports.push(currentViewport);
        }),
        dispose: vi.fn(),
      } as unknown as SceneRenderer;
      const host = {
        clientWidth: width,
        clientHeight: height,
        firstChild: null,
        insertBefore: vi.fn(),
      } as unknown as HTMLElement;
      const scene = createBrightvaleScene(host, vi.fn(), () => renderer);
      if (scene === null)
        throw new Error('scene renderer failed to initialize');

      try {
        const available = {
          x: 16,
          y: 24,
          width: width - 32,
          height: height - 48,
        };
        const layout = layoutFor(width, height, available);
        const frame = projectGameplayFrame(snapshot, chart, layout, false);
        scene.updateFrame({ city, gameplay: frame });
        const rendered = renderedScenes.at(-1);
        if (rendered === undefined)
          throw new Error('the gameplay scene must be rendered');
        const lane = (() => {
          let match: THREE.Mesh | undefined;
          rendered.traverse((object) => {
            if (
              match === undefined &&
              object instanceof THREE.Mesh &&
              object.userData.gameplayRole === 'lane'
            )
              match = object;
          });
          if (match === undefined) throw new Error('perspective lane is missing');
          return match;
        })();
        const pass = gameplayPassFor(cameras, renderedViewports, lane);
        expect(pass.camera).toBeInstanceOf(THREE.PerspectiveCamera);
        const center = lane
          .getWorldPosition(new THREE.Vector3())
          .project(pass.camera);
        const screenX =
          pass.viewport.x + ((center.x + 1) * pass.viewport.width) / 2;
        const screenY =
          height -
          pass.viewport.y -
          ((center.y + 1) * pass.viewport.height) / 2;
        expect(Number.isFinite(screenX) && Number.isFinite(screenY)).toBe(true);
        expect(screenX).toBeGreaterThanOrEqual(pass.viewport.x);
        expect(screenX).toBeLessThanOrEqual(
          pass.viewport.x + pass.viewport.width,
        );
        expect(screenY).toBeGreaterThanOrEqual(
          height - pass.viewport.y - pass.viewport.height,
        );
        expect(screenY).toBeLessThanOrEqual(height - pass.viewport.y);
      } finally {
        scene.destroy();
      }
    },
  );

  it('preserves intrinsic canvas aspect on every projected GPU text plane', () => {
    const paints: Array<{
      value: string;
      font: string;
      fillStyle: string;
      textAlign: string;
      x: number;
      y: number;
      maxWidth: number;
    }> = [];
    const textContext = {
      clearRect: vi.fn(),
      fillText: vi.fn(
        (value: string, x: number, y: number, maxWidth: number) => {
          paints.push({
            value,
            font: textContext.font,
            fillStyle: textContext.fillStyle,
            textAlign: textContext.textAlign,
            x,
            y,
            maxWidth,
          });
        },
      ),
      measureText: vi.fn(() => ({ width: 80 })),
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
    };
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => textContext,
      }),
    });
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const rendererScenes: THREE.Scene[] = [];
    const rendererCameras: THREE.Camera[] = [];
    const rendererViewports: RenderViewport[] = [];
    let viewport: RenderViewport = { x: 0, y: 0, width: 640, height: 480 };
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
      setViewport: vi.fn(
        (x: number, y: number, width: number, height: number) => {
          viewport = { x, y, width, height };
        },
      ),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clear: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn((rendered: THREE.Scene, camera: THREE.Camera) => {
        rendered.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        rendererScenes.push(rendered);
        rendererCameras.push(camera);
        rendererViewports.push(viewport);
      }),
      dispose: vi.fn(),
    } as unknown as SceneRenderer;
    const host = {
      clientWidth: 640,
      clientHeight: 480,
      firstChild: null,
      insertBefore: vi.fn(),
    } as unknown as HTMLElement;
    const scene = createBrightvaleScene(host, vi.fn(), () => renderer);
    if (scene === null) throw new Error('scene renderer failed to initialize');

    try {
      const layout = {
        width: 640,
        height: 480,
        stage: { x: 20, y: 30, width: 600, height: 400 },
        board: { x: 80, y: 80, width: 480, height: 240 },
        header: { x: 40, y: 40, width: 520, height: 24 },
        legend: { x: 80, y: 340, width: 480, height: 30 },
        feedback: { x: 80, y: 380, width: 480, height: 25 },
      } satisfies GameplayLayout;
      const frame = projectGameplayFrame(snapshot, chart, layout, false);
      scene.updateFrame({ city, gameplay: frame });
      const renderedScene = rendererScenes.at(-1);
      if (renderedScene === undefined)
        throw new Error('gameplay scene must be submitted to the renderer');

      const textMeshes: THREE.Mesh[] = [];
      renderedScene.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          [
            'stage-label',
            'time-label',
            'timing-legend',
            'feedback',
            'lane-key',
            'hit-label',
          ].includes(String(object.userData.gameplayRole))
        )
          textMeshes.push(object);
      });
      expect(textMeshes.length).toBeGreaterThan(0);
      for (const mesh of textMeshes) {
        const material = (
          Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        ) as THREE.MeshBasicMaterial | undefined;
        const texture = material?.map;
        if (!(texture instanceof THREE.CanvasTexture))
          throw new Error(
            `${String(mesh.userData.gameplayRole)} needs a canvas texture`,
          );
        expect(
          mesh.scale.x / mesh.scale.y,
          `${String(mesh.userData.gameplayRole)} must preserve canvas glyph proportions`,
        ).toBeCloseTo(texture.image.width / texture.image.height, 4);
      }

      const paint = (value: string) => {
        const result = paints.find((entry) => entry.value === value);
        if (result === undefined) throw new Error(`missing paint for ${value}`);
        return result;
      };
      const textMesh = (role: string): THREE.Mesh => {
        const result = textMeshes.find(
          (mesh) => mesh.userData.gameplayRole === role,
        );
        if (result === undefined) throw new Error(`missing ${role} mesh`);
        return result;
      };
      const meshByRole = (role: string, index = 0): THREE.Mesh => {
        const matches: THREE.Mesh[] = [];
        renderedScene.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            object.userData.gameplayRole === role
          )
            matches.push(object);
        });
        const result = matches[index];
        if (result === undefined) throw new Error(`missing ${role} mesh ${index}`);
        return result;
      };
      const expectedPaints = [
        {
          value: 'Onset-derived chart · play-test timing',
          role: 'stage-label',
          fontSize: 12,
          color: '#bbc6d3',
          align: 'left',
          paintX: 8,
        },
        {
          value: frame.timeLabel,
          role: 'time-label',
          fontSize: 14,
          color: '#f4f0df',
          align: 'right',
          paintX: 88,
        },
        {
          value: frame.legendLabel,
          role: 'timing-legend',
          fontSize: 13,
          color: '#d7e7df',
          align: 'left',
          paintX: 8,
        },
        {
          value: 'Notes meet the line here',
          role: 'feedback',
          fontSize: 14,
          color: '#bbc6d3',
          align: 'right',
          paintX: 88,
        },
        {
          value: 'D',
          role: 'lane-key',
          fontSize: 12,
          color: '#e5e5d9',
          align: 'center',
          paintX: 48,
        },
        {
          value: 'HIT',
          role: 'hit-label',
          fontSize: 10,
          color: '#ffd475',
          align: 'center',
          paintX: 48,
        },
      ];
      for (const expected of expectedPaints) {
        const actual = paint(expected.value);
        expect(actual.fillStyle, expected.role).toBe(expected.color);
        expect(actual.textAlign, expected.role).toBe(expected.align);
        expect(actual.font, expected.role).toMatch(
          /^500 [\d.]+px Manrope, sans-serif$/,
        );
        expect(Number.parseFloat(actual.font.split(' ')[1] ?? '')).toBeCloseTo(
          (expected.fontSize * 128) /
            ({
              'stage-label': 24,
              'time-label': 24,
              'timing-legend': 30,
              feedback: 25,
              'lane-key': 22,
              'hit-label': 14,
            }[expected.role] ?? 1),
          5,
        );
        expect(actual.x, expected.role).toBe(expected.paintX);
        expect(actual.y, expected.role).toBe(64);
        expect(actual.maxWidth, expected.role).toBe(80);
      }

      const horizontalEdges: Record<string, [number, number]> = {
        'stage-label': [40, 435.2],
        'time-label': [445.6, 560],
        'timing-legend': [80, 560],
        feedback: [80, 560],
      };
      for (const expected of expectedPaints) {
        if (expected.role === 'lane-key' || expected.role === 'hit-label')
          continue;
        const mesh = textMesh(expected.role);
        const edges = horizontalEdges[expected.role];
        if (edges === undefined)
          throw new Error(`missing screen-space bounds for ${expected.role}`);
        const [left, right] = edges;
        if (expected.align === 'left') {
          expect(mesh.position.x - mesh.scale.x / 2, expected.role).toBeCloseTo(
            left,
            5,
          );
        } else if (expected.align === 'right') {
          expect(mesh.position.x + mesh.scale.x / 2, expected.role).toBeCloseTo(
            right,
            5,
          );
        } else {
          expect(mesh.position.x, expected.role).toBeCloseTo(
            (left + right) / 2,
            5,
          );
        }
      }

      const laneKeyMeshes = textMeshes.filter(
        (mesh) => mesh.userData.gameplayRole === 'lane-key',
      );
      expect(laneKeyMeshes).toHaveLength(4);
      const overlayPass = gameplayPassFor(
        rendererCameras,
        rendererViewports,
        textMesh('lane-key'),
      );
      for (let lane = 0; lane < 4; lane += 1) {
        const key = laneKeyMeshes[lane];
        if (key === undefined) throw new Error(`missing lane-key ${lane}`);
        const target = meshByRole('good-band', lane);
        const runwayPass = gameplayPassFor(
          rendererCameras,
          rendererViewports,
          target,
        );
        const keyCenter = projectedScreenCenter(
          key,
          overlayPass.camera,
          overlayPass.viewport,
          frame.layout.height,
        );
        const targetCenter = projectedScreenCenter(
          target,
          runwayPass.camera,
          runwayPass.viewport,
          frame.layout.height,
        );
        expect(
          Math.abs(keyCenter.x - targetCenter.x),
          `lane ${lane} key must track its projected lane`,
        ).toBeLessThanOrEqual(Math.max(18, frame.layout.board.width * 0.08));
        expect(
          Math.abs(keyCenter.y - targetCenter.y),
          `lane ${lane} key must remain near its projected onset anchor`,
        ).toBeLessThanOrEqual(Math.max(20, frame.layout.board.height * 0.15));
      }

      const hitLabel = textMesh('hit-label');
      const rightTarget = meshByRole('good-band', 3);
      const rightTargetPass = gameplayPassFor(
        rendererCameras,
        rendererViewports,
        rightTarget,
      );
      const hitCenter = projectedScreenCenter(
        hitLabel,
        overlayPass.camera,
        overlayPass.viewport,
        frame.layout.height,
      );
      const onsetCenter = projectedScreenCenter(
        rightTarget,
        rightTargetPass.camera,
        rightTargetPass.viewport,
        frame.layout.height,
      );
      expect(Math.abs(hitCenter.x - onsetCenter.x)).toBeLessThanOrEqual(
        Math.max(20, frame.layout.board.width * 0.12),
      );
      expect(Math.abs(hitCenter.y - onsetCenter.y)).toBeLessThanOrEqual(
        Math.max(24, frame.layout.board.height * 0.18),
      );

      const paintCount = paints.length;
      const measureCount = textContext.measureText.mock.calls.length;
      const clearCount = textContext.clearRect.mock.calls.length;
      scene.updateFrame({ city, gameplay: frame });
      expect(paints).toHaveLength(paintCount);
      expect(textContext.measureText).toHaveBeenCalledTimes(measureCount);
      expect(textContext.clearRect).toHaveBeenCalledTimes(clearCount);
    } finally {
      scene.destroy();
    }
  });
});

afterEach(() => vi.unstubAllGlobals());
