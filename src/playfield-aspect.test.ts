import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { projectGameplayFrame, type GameplayLayout } from './gameplay-frame';
import { projectTimingWindowGeometry } from './note-projection';
import { createBrightvaleScene, type SceneRenderer } from './scene';
import type { SceneStateProjection } from './scene-state';

// The existing scene fixture is 480 × 240. Keep that tested desktop board
// proportion as the logical reference instead of introducing a new layout.
const LOGICAL_BOARD = { width: 480, height: 240 };

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
    'renders matching score-window heights for $difficulty on a $boardWidth×$boardHeight board without note bodies',
    ({ difficulty, boardWidth, boardHeight }) => {
      vi.stubGlobal('window', {
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const renderedScenes: THREE.Scene[] = [];
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
        setScissor: vi.fn(),
        setScissorTest: vi.fn(),
        clear: vi.fn(),
        clearDepth: vi.fn(),
        render: vi.fn((rendered: THREE.Scene) => renderedScenes.push(rendered)),
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
      const frame = projectGameplayFrame(
        {
          ...snapshot,
          game: { ...snapshot.game, difficulty },
        },
        chart,
        layoutFor(640, 480, board),
        false,
      );

      try {
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
        const one = (role: string): THREE.Mesh => {
          const mesh = meshes.get(role)?.[0];
          if (mesh === undefined) throw new Error(`missing ${role} mesh`);
          return mesh;
        };
        const noteGood = one('note-good-envelope');
        const notePerfect = one('note-perfect-envelope');
        const targetGood = one('good-band');
        const targetPerfect = one('perfect-band');

        expect(noteGood.scale.y).toBeCloseTo(targetGood.scale.y, 8);
        expect(notePerfect.scale.y).toBeCloseTo(targetPerfect.scale.y, 8);
        expect(noteGood.scale.x).not.toBe(targetGood.scale.x);
        expect(notePerfect.scale.x).not.toBe(targetPerfect.scale.x);
        expect(meshes.has('note')).toBe(false);
        expect(meshes.has('note-outline')).toBe(false);
        expect(frame.timingWindows.goodEnvelopeHeightPx).toBeCloseTo(
          targetGood.scale.y,
          8,
        );
        expect(frame.timingWindows.perfectEnvelopeHeightPx).toBeCloseTo(
          targetPerfect.scale.y,
          8,
        );
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
        setScissor: vi.fn(),
        setScissorTest: vi.fn(),
        clear: vi.fn(),
        clearDepth: vi.fn(),
        render: vi.fn((_rendered: THREE.Scene, camera: THREE.Camera) =>
          cameras.push(camera),
        ),
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
        const boardCamera = cameras.at(-1);
        if (!(boardCamera instanceof THREE.OrthographicCamera))
          throw new Error('the gameplay pass must use its orthographic camera');
        boardCamera.updateMatrixWorld(true);

        const origin = new THREE.Vector3(0, 0, 0).project(boardCamera);
        const unitX = new THREE.Vector3(1, 0, 0).project(boardCamera);
        const unitY = new THREE.Vector3(0, 1, 0).project(boardCamera);
        const projectedX = (Math.abs(unitX.x - origin.x) * width) / 2;
        const projectedY = (Math.abs(unitY.y - origin.y) * height) / 2;
        expect(projectedX).toBeCloseTo(projectedY, 8);
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
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clear: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn((rendered: THREE.Scene) => rendererScenes.push(rendered)),
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
          align: 'right',
          paintX: 88,
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
        'lane-key': [116, 164],
        'hit-label': [515, 553],
      };
      for (const expected of expectedPaints) {
        const mesh = textMesh(expected.role);
        const [left, right] = horizontalEdges[expected.role]!;
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
