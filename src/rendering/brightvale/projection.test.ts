import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDifficultyProfile } from '../../game/game-balance';
import { VISIBLE_NOTE_SECONDS } from '../gameplay-frame';
import type { BrightvaleAssets } from './assets';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './layout';
import { createBrightvalePlayfieldContract } from './playfield';
import { loadBrightvaleProductionAssets } from './test-assets';
import {
  createBrightvaleCameraProjection,
  createBrightvaleSurfaceProfile,
  getFrontPlatformProgress,
} from './projection';
import type { BrightvaleViewportLayout } from './viewport';

let assets: BrightvaleAssets;

beforeAll(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  assets = await loadBrightvaleProductionAssets();
});

afterAll(() => {
  assets?.dispose();
  vi.restoreAllMocks();
});

function viewport(
  width: number,
  height: number,
  topHeight: number,
  bottomHeight: number,
): BrightvaleViewportLayout {
  return {
    width,
    height,
    persistentHudExclusions: [
      { x: 0, y: 0, width, height: topHeight },
      { x: 0, y: height - bottomHeight, width, height: bottomHeight },
    ],
    labels: {
      time: { x: width * 0.7, y: topHeight / 2, width: 80, height: 24 },
      countdown: { x: width * 0.4, y: height * 0.8, width: 160, height: 32 },
      legend: {
        x: width * 0.3,
        y: height - bottomHeight - 30,
        width: width * 0.4,
        height: 24,
      },
      feedback: {
        x: width * 0.35,
        y: height - bottomHeight - 64,
        width: width * 0.3,
        height: 28,
      },
    },
  };
}

function controlledPlayfieldViewport(): BrightvaleViewportLayout {
  return {
    width: 1494,
    height: 715,
    persistentHudExclusions: [{ x: 11, y: 232, width: 1470, height: 23 }],
    labels: {
      time: { x: 1370, y: 20, width: 96, height: 24 },
      countdown: { x: 1290, y: 660, width: 176, height: 32 },
      legend: { x: 24, y: 674, width: 480, height: 24 },
      feedback: { x: 950, y: 595, width: 260, height: 28 },
    },
  };
}

function authoredScaleWitnessViewport(): BrightvaleViewportLayout {
  return {
    width: 1494,
    height: 715,
    persistentHudExclusions: [{ x: 11, y: 232, width: 1470, height: 23 }],
    labels: {
      time: { x: 1370, y: 20, width: 96, height: 24 },
      countdown: { x: 1290, y: 660, width: 176, height: 32 },
      legend: { x: 24, y: 24, width: 480, height: 24 },
      feedback: { x: 24, y: 660, width: 260, height: 28 },
    },
  };
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

const ENVELOPE_HALF_WIDTH = 2.55 / 2;
const ENVELOPE_CLEARANCE = 0.03;

function measuredEnvelopePoints(
  playfield: ReturnType<typeof createBrightvalePlayfieldContract>,
  profile: ReturnType<typeof createBrightvaleSurfaceProfile>,
  range: { readonly minimum: number; readonly maximum: number },
): {
  readonly points: THREE.Vector3[];
  readonly measuredSurfaceSamples: number;
  readonly fallbackSamples: number;
} {
  const parent = new THREE.Matrix4().fromArray([
    ...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor,
  ]);
  const inverseParent = parent.clone().invert();
  const samplesPerLane = 48;
  const points: THREE.Vector3[] = [];
  let measuredSurfaceSamples = 0;
  let fallbackSamples = 0;
  const sampleSurface = (lane: number, x: number, z: number): number | null => {
    const direct = profile.surfaceHeightAt(lane, z, x);
    if (direct !== null) {
      measuredSurfaceSamples += 1;
      return direct;
    }
    const direction = z < -1.45 ? 1 : -1;
    const nearZ = z + direction * 0.025;
    const farZ = z + direction * 0.075;
    const near = profile.surfaceHeightAt(lane, nearZ, x);
    const far = profile.surfaceHeightAt(lane, farZ, x);
    if (near !== null && far !== null) {
      measuredSurfaceSamples += 1;
      return near + ((near - far) / (nearZ - farZ)) * (z - nearZ);
    }
    if (near !== null) {
      measuredSurfaceSamples += 1;
      return near;
    }
    return null;
  };

  for (let lane = 0; lane < 4; lane += 1) {
    for (let index = 0; index <= samplesPerLane; index += 1) {
      const progress = THREE.MathUtils.lerp(
        range.minimum,
        range.maximum,
        index / samplesPerLane,
      );
      const center = playfield
        .point(lane, progress)
        .applyMatrix4(inverseParent);
      for (const offset of [-ENVELOPE_HALF_WIDTH, 0, ENVELOPE_HALF_WIDTH]) {
        const x = center.x + offset;
        const measured = sampleSurface(lane, x, center.z);
        if (measured === null) fallbackSamples += 1;
        const point = new THREE.Vector3(
          x,
          measured === null ? center.y + 0.025 : measured + ENVELOPE_CLEARANCE,
          center.z,
        );
        points.push(point.applyMatrix4(parent));
      }
    }
  }
  return { points, measuredSurfaceSamples, fallbackSamples };
}

describe('Brightvale source-geometry projection', () => {
  it('rejects a viewport fully covered by overlapping persistent HUD regions without searching camera fits', () => {
    const layout = viewport(1600, 900, 500, 500);
    const projection = createBrightvaleCameraProjection(
      createBrightvalePlayfieldContract(),
      layout,
      { minimum: -0.5, maximum: 1.5 },
    );

    expect(projection.usable).toBe(false);
    expect(projection.resize(layout, { minimum: -0.5, maximum: 1.5 })).toBe(
      false,
    );
  });

  it('derives the physical road and raised target profile from loaded GLB meshes', () => {
    const profile = createBrightvaleSurfaceProfile(assets.roots);
    const playfield = createBrightvalePlayfieldContract(profile);

    for (let lane = 0; lane < 4; lane += 1) {
      const physicalSamples = [0.97, 0.975, 0.98, 0.99, 1];
      const measuredHeights = physicalSamples.map((progress) => {
        const point = playfield.point(lane, progress);
        const localZ = -1.45 - 42 * (1 - progress);
        const height = profile.surfaceHeightAt(lane, localZ);
        expect(height, `lane ${lane}, progress ${progress}`).not.toBeNull();
        expect(Number.isFinite(height)).toBe(true);
        expect(playfield.clearanceAt(lane, progress)).toBeGreaterThan(0);
        expect(point.toArray().every(Number.isFinite)).toBe(true);
        return height as number;
      });

      expect(Math.max(...measuredHeights)).toBeGreaterThan(
        (measuredHeights.at(-1) as number) + 0.04,
      );
      const logicalTarget = playfield.hitAnchor(lane);
      const visualNoteCenter = playfield.visualPoint(lane, 1);
      expect(playfield.point(lane, 1).distanceTo(logicalTarget)).toBeLessThan(
        1e-8,
      );
      expect(visualNoteCenter.distanceTo(logicalTarget)).toBeGreaterThan(0.04);
      expect(playfield.clearanceAt(lane, 1)).toBeCloseTo(0.055, 3);
    }
  });

  it.each([
    {
      name: 'reference desktop',
      layout: viewport(1600, 900, 54, 72),
    },
    {
      name: 'narrow desktop sample',
      layout: viewport(1120, 700, 66, 66),
    },
  ])(
    'fits all lane endpoints around persistent HUD and projects CSS anchors monotonically at $name',
    ({ layout }) => {
      const playfield = createBrightvalePlayfieldContract();
      const halfProgress =
        getDifficultyProfile('easy').timing.goodWindowSeconds /
        VISIBLE_NOTE_SECONDS;
      const progress = {
        minimum: 1 - halfProgress,
        maximum: 1 + halfProgress,
      };
      const projection = createBrightvaleCameraProjection(
        playfield,
        layout,
        progress,
      );
      const camera = projection.camera;
      const expectedQuaternion = new THREE.Quaternion()
        .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.camera.quaternionXyzw])
        .normalize();
      expect(camera.quaternion.angleTo(expectedQuaternion)).toBeLessThan(1e-7);

      for (let lane = 0; lane < 4; lane += 1) {
        const ordered = [progress.minimum, 1, progress.maximum].map((value) =>
          projection.project(playfield.point(lane, value)),
        );
        for (const point of ordered) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(
            true,
          );
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(layout.width);
          expect(point.y).toBeGreaterThan(
            layout.persistentHudExclusions[0]!.height,
          );
          expect(point.y).toBeLessThan(
            layout.height - layout.persistentHudExclusions[1]!.height,
          );
        }
        expect(ordered[0]!.y).toBeLessThan(ordered[1]!.y);
        expect(ordered[1]!.y).toBeLessThan(ordered[2]!.y);
        expect(projection.project(playfield.hitAnchor(lane)).y).toBeCloseTo(
          ordered[1]!.y,
          8,
        );
        for (const progressValue of [progress.minimum, progress.maximum]) {
          const center = playfield.point(lane, progressValue);
          for (const halfLane of [-1.375, 1.375]) {
            const edge = projection.project(
              center.clone().add(new THREE.Vector3(halfLane, 0, 0)),
            );
            expect(edge.x).toBeGreaterThanOrEqual(0);
            expect(edge.x).toBeLessThanOrEqual(layout.width);
            expect(edge.y).toBeGreaterThan(
              layout.persistentHudExclusions[0]!.height,
            );
            expect(edge.y).toBeLessThan(
              layout.height - layout.persistentHudExclusions[1]!.height,
            );
          }
        }
      }
    },
  );

  it.each([
    { name: 'reference desktop', layout: viewport(1600, 900, 100, 0) },
    { name: 'constrained desktop', layout: viewport(1120, 700, 100, 0) },
  ])('places key labels at the measured front lip on $name', ({ layout }) => {
    const surface = createBrightvaleSurfaceProfile(assets.roots);
    const playfield = createBrightvalePlayfieldContract(surface);
    const frontProgress = getFrontPlatformProgress(playfield, surface);
    expect(frontProgress).toBeGreaterThan(1);
    const projection = createBrightvaleCameraProjection(
      playfield,
      layout,
      { minimum: 0, maximum: frontProgress },
      surface,
    );
    expect(projection.usable).toBe(true);
    for (let lane = 0; lane < 4; lane += 1) {
      const hitLine = projection.project(playfield.hitAnchor(lane));
      const frontLip = projection.project(playfield.point(lane, frontProgress));
      expect(frontLip.y).toBeGreaterThan(hitLine.y + 40);
      expect(frontLip.x).toBeGreaterThanOrEqual(0);
      expect(frontLip.x).toBeLessThanOrEqual(layout.width);
      expect(frontLip.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it.each([
    {
      name: '1120×700 measured content box',
      layout: {
        width: 1028.4,
        height: 661.6,
        persistentHudExclusions: [
          { x: 0, y: 25.8, width: 383.328, height: 69.188 },
          { x: 574.044, y: 47.988, width: 100, height: 47 },
          { x: 864.747, y: 0, width: 163.656, height: 95 },
          { x: 11.997, y: 234.972, width: 254.891, height: 18.844 },
          { x: 938.169, y: 230.972, width: 78.234, height: 26.844 },
        ],
        labels: {
          time: { x: 920.403, y: 116.972, width: 96, height: 14 },
          countdown: { x: 840.403, y: 192.378, width: 176, height: 22.391 },
          legend: { x: 11.997, y: 139.175, width: 1004.406, height: 40 },
          feedback: { x: 11.997, y: 189.175, width: 1004.406, height: 28.797 },
        },
      },
    },
    {
      name: '1600×900 measured content box',
      layout: {
        width: 1494,
        height: 851.2,
        persistentHudExclusions: [
          { x: 0, y: 25.803, width: 383.328, height: 69.188 },
          { x: 806.844, y: 47.991, width: 100, height: 47 },
          { x: 1330.344, y: 0, width: 163.656, height: 95 },
          { x: 12, y: 237.772, width: 254.891, height: 18.844 },
          { x: 1403.766, y: 233.772, width: 78.234, height: 26.844 },
        ],
        labels: {
          time: { x: 1386, y: 119.772, width: 96, height: 14 },
          countdown: { x: 1306, y: 195.178, width: 176, height: 22.391 },
          legend: { x: 12, y: 141.975, width: 1470, height: 40 },
          feedback: { x: 12, y: 191.975, width: 1470, height: 28.797 },
        },
      },
    },
  ])(
    'keeps every physical platform and endcap vertex in the playfield at $name',
    ({ layout }) => {
      const profile = createBrightvaleSurfaceProfile(assets.roots);
      const playfield = createBrightvalePlayfieldContract(profile);
      const halfProgress =
        getDifficultyProfile('normal').timing.goodWindowSeconds /
        VISIBLE_NOTE_SECONDS;
      const projection = createBrightvaleCameraProjection(
        playfield,
        layout,
        { minimum: -halfProgress, maximum: 1 + halfProgress },
        profile,
      );
      let outsideVertices = 0;
      let bottommostOutside = Number.NEGATIVE_INFINITY;
      const playfieldMatrix = new THREE.Matrix4().fromArray([
        ...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor,
      ]);

      for (const name of ['platform', 'endcaps'] as const) {
        const root = assets.roots[name];
        root.updateMatrixWorld(true);
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const positions = object.geometry.getAttribute('position');
          if (positions === undefined) return;
          for (let index = 0; index < positions.count; index += 1) {
            const world = new THREE.Vector3(
              positions.getX(index),
              positions.getY(index),
              positions.getZ(index),
            )
              .applyMatrix4(object.matrixWorld)
              .applyMatrix4(playfieldMatrix);
            const screen = projection.project(world);
            if (
              !Number.isFinite(screen.x) ||
              !Number.isFinite(screen.y) ||
              screen.x < 0 ||
              screen.x > layout.width ||
              screen.y < 0 ||
              screen.y > layout.height
            )
              outsideVertices += 1;
            if (screen.y > layout.height)
              bottommostOutside = Math.max(bottommostOutside, screen.y);
          }
        });
      }

      expect(projection.usable).toBe(true);
      expect(
        outsideVertices,
        `${outsideVertices} platform/endcap vertices exceed content bounds; bottommost=${bottommostOutside}`,
      ).toBe(0);
    },
  );

  it.each(['normal', 'hard', 'easy'] as const)(
    'preserves a readable %s approach at the wide-short measured layout',
    (difficulty) => {
      const layout: BrightvaleViewportLayout = {
        width: 1814,
        height: 566.8,
        persistentHudExclusions: [
          { x: 0, y: 25.8, width: 383.33, height: 69.19 },
          { x: 966.84, y: 47.99, width: 100, height: 47 },
          { x: 1650.34, y: 0, width: 163.66, height: 95 },
          { x: 12, y: 233.57, width: 254.89, height: 18.84 },
          { x: 1723.77, y: 229.57, width: 78.23, height: 26.84 },
        ],
        labels: {
          time: { x: 1706, y: 115.57, width: 96, height: 14 },
          countdown: { x: 1626, y: 190.98, width: 176, height: 22.39 },
          legend: { x: 12, y: 137.78, width: 1790, height: 40 },
          feedback: { x: 12, y: 187.78, width: 1790, height: 28.8 },
        },
      };
      const profile = createBrightvaleSurfaceProfile(assets.roots);
      const playfield = createBrightvalePlayfieldContract(profile);
      const halfProgress =
        getDifficultyProfile(difficulty).timing.goodWindowSeconds /
        VISIBLE_NOTE_SECONDS;
      const projection = createBrightvaleCameraProjection(
        playfield,
        layout,
        { minimum: -halfProgress, maximum: 1 + halfProgress },
        profile,
      );
      const approach = Array.from({ length: 32 }, (_, index) =>
        projection.project(
          playfield.point(1, -halfProgress + ((1 + halfProgress) * index) / 31),
        ),
      );
      const approachSpan = Math.abs(approach.at(-1)!.y - approach[0]!.y);
      const playfieldMatrix = new THREE.Matrix4().fromArray([
        ...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor,
      ]);
      const noteCenter = playfield
        .point(1, 0.5)
        .applyMatrix4(playfieldMatrix.clone().invert());
      const noteLength = 0.3; // Production scene BoxGeometry's longitudinal dimension.
      const noteEnds = [-1, 1].map((direction) => {
        const local = noteCenter.clone();
        local.z += (direction * noteLength) / 2;
        const height = profile.surfaceHeightAt(1, local.z, local.x);
        if (height !== null) local.y = height + 0.03;
        return projection.project(local.applyMatrix4(playfieldMatrix));
      });
      const projectedNoteLength = Math.abs(noteEnds[1]!.y - noteEnds[0]!.y);
      const platform = assets.roots.platform;
      platform.updateMatrixWorld(true);
      let platformMinY = Number.POSITIVE_INFINITY;
      let platformMaxY = Number.NEGATIVE_INFINITY;
      platform.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute('position');
        if (!positions) return;
        for (let index = 0; index < positions.count; index += 1) {
          const screen = projection.project(
            new THREE.Vector3(
              positions.getX(index),
              positions.getY(index),
              positions.getZ(index),
            )
              .applyMatrix4(object.matrixWorld)
              .applyMatrix4(playfieldMatrix),
          );
          platformMinY = Math.min(platformMinY, screen.y);
          platformMaxY = Math.max(platformMaxY, screen.y);
        }
      });
      const projectedLandingDeckDepth = platformMaxY - platformMinY;

      expect(projection.usable).toBe(true);
      expect(approach.every((point) => Number.isFinite(point.y))).toBe(true);
      expect(
        approach.every(
          (point, index) => index === 0 || point.y > approach[index - 1]!.y,
        ),
      ).toBe(true);
      // A full normal approach should span at least the projected landing deck,
      // while remaining many actual note-bar lengths (not a fixed viewport budget).
      expect(approachSpan).toBeGreaterThan(projectedLandingDeckDepth);
      expect(approachSpan).toBeGreaterThan(6 * projectedNoteLength);
    },
  );

  it('fits the normal envelope and complete essential geometry around measured HUD with authored optics', () => {
    const layout = authoredScaleWitnessViewport();
    const profile = createBrightvaleSurfaceProfile(assets.roots);
    const playfield = createBrightvalePlayfieldContract(profile);
    const halfProgress =
      getDifficultyProfile('normal').timing.goodWindowSeconds /
      VISIBLE_NOTE_SECONDS;
    const progress = {
      minimum: -halfProgress,
      maximum: 1 + halfProgress,
    };
    const envelope = measuredEnvelopePoints(playfield, profile, progress);
    expect(envelope.measuredSurfaceSamples).toBeGreaterThan(0);
    expect(envelope.fallbackSamples).toBeGreaterThan(0);

    const projection = createBrightvaleCameraProjection(
      playfield,
      layout,
      progress,
      profile,
    );
    const authoredPosition = new THREE.Vector3().fromArray([
      ...BRIGHTVALE_RUNTIME_LAYOUT.camera.positionGltf,
    ]);
    const authoredQuaternion = new THREE.Quaternion()
      .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.camera.quaternionXyzw])
      .normalize();

    expect(projection.camera.fov).toBe(
      BRIGHTVALE_RUNTIME_LAYOUT.camera.verticalFovDegrees,
    );
    expect(projection.camera.near).toBeGreaterThan(0);
    expect(projection.camera.far).toBeGreaterThan(projection.camera.near);
    expect(
      projection.camera.quaternion.angleTo(authoredQuaternion),
    ).toBeLessThan(1e-7);
    const requiredGeometry = [
      ...envelope.points,
      ...Object.values(profile.essentialGeometryPoints).flat(),
    ];
    const projectedGeometry = requiredGeometry.map((point) => {
      const view = point
        .clone()
        .applyMatrix4(projection.camera.matrixWorld.clone().invert());
      const screen = projection.project(point);
      expect(-view.z).toBeGreaterThanOrEqual(projection.camera.near);
      expect(-view.z).toBeLessThanOrEqual(projection.camera.far);
      expect(Number.isFinite(screen.x) && Number.isFinite(screen.y)).toBe(true);
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(layout.width);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(layout.height);
      expect(
        layout.persistentHudExclusions.some((rect) =>
          rectanglesOverlap(
            { x: screen.x, y: screen.y, width: 0.01, height: 0.01 },
            rect,
          ),
        ),
      ).toBe(false);
      expect(
        Object.values(layout.labels).some((rect) =>
          rectanglesOverlap(
            { x: screen.x, y: screen.y, width: 0.01, height: 0.01 },
            rect,
          ),
        ),
      ).toBe(false);
      return screen;
    });
    expect(projectedGeometry.length).toBeGreaterThan(500);
    const labels = Object.values(layout.labels);
    for (let first = 0; first < labels.length; first += 1) {
      for (let second = first + 1; second < labels.length; second += 1) {
        expect(rectanglesOverlap(labels[first]!, labels[second]!)).toBe(false);
      }
    }
    const authoredUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
      authoredQuaternion,
    );
    const authoredTarget = playfield
      .hitAnchor(1)
      .add(playfield.hitAnchor(2))
      .multiplyScalar(0.5);
    const authoredRay = authoredPosition.clone().sub(authoredTarget);
    const cameraOffset = projection.camera.position
      .clone()
      .sub(authoredPosition);
    const aa = authoredRay.dot(authoredRay);
    const ab = authoredRay.dot(authoredUp);
    const bb = authoredUp.dot(authoredUp);
    const ar = cameraOffset.dot(authoredRay);
    const br = cameraOffset.dot(authoredUp);
    const determinant = aa * bb - ab * ab;
    const rayCoefficient = (ar * bb - br * ab) / determinant;
    const upCoefficient = (br * aa - ar * ab) / determinant;
    const cameraPathError = cameraOffset
      .addScaledVector(authoredRay, -rayCoefficient)
      .addScaledVector(authoredUp, -upCoefficient)
      .length();
    expect(cameraPathError).toBeLessThan(1e-4);
    expect(Number.isFinite(rayCoefficient) && rayCoefficient > -1).toBe(true);

    const approach = [0, 1, 2, 3].map((lane) => ({
      start: projection.project(playfield.point(lane, progress.minimum)),
      hit: projection.project(playfield.hitAnchor(lane)),
    }));
    const deckYs = profile.essentialGeometryPoints.platform.map(
      (point) => projection.project(point).y,
    );
    const deckDepth = Math.max(...deckYs) - Math.min(...deckYs);
    expect(
      approach.every(({ start, hit }) => hit.y - start.y > deckDepth),
    ).toBe(true);
  });

  it.each(['normal', 'easy'] as const)(
    'keeps the projection pose stable while projecting sparse and dense note samples at %s',
    (difficulty) => {
      const layout = controlledPlayfieldViewport();
      const playfield = createBrightvalePlayfieldContract();
      const halfProgress =
        getDifficultyProfile(difficulty).timing.goodWindowSeconds /
        VISIBLE_NOTE_SECONDS;
      const progress = {
        minimum: -halfProgress,
        maximum: 1 + halfProgress,
      };
      const projection = createBrightvaleCameraProjection(
        playfield,
        layout,
        progress,
      );
      if (difficulty === 'easy') {
        const authoredPosition = new THREE.Vector3().fromArray([
          ...BRIGHTVALE_RUNTIME_LAYOUT.camera.positionGltf,
        ]);
        expect(
          projection.camera.position.distanceTo(authoredPosition),
        ).toBeGreaterThan(0);
      }
      const pose = projection.camera.matrixWorld.clone();
      const notePopulations = [
        [],
        [{ lane: 0, progress: progress.minimum }],
        [
          { lane: 0, progress: progress.minimum },
          { lane: 1, progress: 0.35 },
          { lane: 2, progress: 0.7 },
          { lane: 3, progress: progress.maximum },
        ],
      ];
      for (const population of notePopulations) {
        for (const note of population) {
          const screen = projection.project(
            playfield.point(note.lane, note.progress),
          );
          expect(Number.isFinite(screen.x) && Number.isFinite(screen.y)).toBe(
            true,
          );
        }
        expect(projection.camera.matrixWorld.elements).toEqual(pose.elements);
      }
      for (let lane = 0; lane < 4; lane += 1) {
        for (let index = 0; index <= 32; index += 1) {
          const p = THREE.MathUtils.lerp(
            progress.minimum,
            progress.maximum,
            index / 32,
          );
          const center = playfield.point(lane, p);
          for (const xOffset of [-1.375, 0, 1.375]) {
            const point = projection.project(
              center.clone().add(new THREE.Vector3(xOffset, 0, 0)),
            );
            expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(
              true,
            );
            expect(point.x).toBeGreaterThanOrEqual(0);
            expect(point.x).toBeLessThanOrEqual(layout.width);
            expect(point.y).toBeGreaterThanOrEqual(0);
            expect(point.y).toBeLessThanOrEqual(layout.height);
            expect(
              rectanglesOverlap(
                { x: point.x, y: point.y, width: 0.01, height: 0.01 },
                layout.persistentHudExclusions[0]!,
              ),
            ).toBe(false);
          }
        }
      }
      for (const slot of Object.values(layout.labels)) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(layout.width);
        expect(slot.y + slot.height).toBeLessThanOrEqual(layout.height);
      }
      const labels = Object.values(layout.labels);
      for (let first = 0; first < labels.length; first += 1) {
        for (let second = first + 1; second < labels.length; second += 1)
          expect(rectanglesOverlap(labels[first]!, labels[second]!)).toBe(
            false,
          );
      }
    },
  );
});
