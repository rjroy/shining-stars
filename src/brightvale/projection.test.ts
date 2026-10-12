import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDifficultyProfile } from '../game-balance';
import { VISIBLE_NOTE_SECONDS } from '../gameplay-frame';
import type { BrightvaleAssets } from './assets';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './layout';
import { createBrightvalePlayfieldContract } from './playfield';
import { loadBrightvaleProductionAssets } from './test-assets';
import {
  createBrightvaleCameraProjection,
  createBrightvaleSurfaceProfile,
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

function measuredCameraWitness(
  points: readonly THREE.Vector3[],
  layout: BrightvaleViewportLayout,
): { readonly minimumShift: number; readonly maximumShift: number } | null {
  const authored = BRIGHTVALE_RUNTIME_LAYOUT.camera;
  const camera = new THREE.PerspectiveCamera(
    authored.verticalFovDegrees,
    layout.width / layout.height,
    authored.near,
    authored.far,
  );
  camera.position.fromArray([...authored.positionGltf]);
  camera.quaternion.fromArray([...authored.quaternionXyzw]).normalize();
  const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
    camera.quaternion,
  );
  const labels = Object.values(layout.labels);
  const feasibleShifts: number[] = [];
  camera.updateMatrixWorld(true);
  const inverseAuthoredCamera = camera.matrixWorld.clone().invert();
  const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let minimumShift = Number.NEGATIVE_INFINITY;
  let maximumShift = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const view = point.clone().applyMatrix4(inverseAuthoredCamera);
    const depth = -view.z;
    if (depth < camera.near || depth > camera.far) return null;
    minimumShift = Math.max(minimumShift, view.y - verticalTangent * depth);
    maximumShift = Math.min(maximumShift, view.y + verticalTangent * depth);
  }
  if (minimumShift > maximumShift) return null;
  // Derive the scan interval from the authored frustum and measured geometry;
  // the 1/8-unit scan resolves only HUD/label holes within that interval.
  const scanSteps = Math.ceil((maximumShift - minimumShift) * 8);

  for (let step = 0; step <= scanSteps; step += 1) {
    const shift = Math.min(minimumShift + step / 8, maximumShift);
    camera.position
      .fromArray([...authored.positionGltf])
      .addScaledVector(cameraUp, shift);
    camera.updateMatrixWorld(true);
    const inverseCamera = camera.matrixWorld.clone().invert();
    let feasible = true;
    for (const worldPoint of points) {
      const view = worldPoint.clone().applyMatrix4(inverseCamera);
      const projected = worldPoint.clone().project(camera);
      const x = ((projected.x + 1) * layout.width) / 2;
      const y = ((1 - projected.y) * layout.height) / 2;
      if (
        -view.z < camera.near ||
        -view.z > camera.far ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > layout.width ||
        y < 0 ||
        y > layout.height ||
        layout.persistentHudExclusions.some((rect) =>
          rectanglesOverlap({ x, y, width: 0.01, height: 0.01 }, rect),
        ) ||
        labels.some((rect) =>
          rectanglesOverlap({ x, y, width: 0.01, height: 0.01 }, rect),
        )
      ) {
        feasible = false;
        break;
      }
    }
    if (feasible) feasibleShifts.push(shift);
  }

  if (feasibleShifts.length === 0) return null;
  return {
    minimumShift: feasibleShifts[0]!,
    maximumShift: feasibleShifts.at(-1)!,
  };
}

describe('Brightvale source-geometry projection', () => {
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

  it('keeps the normal source-surface envelope inside a controlled HUD and label layout with fixed authored optics', () => {
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
    const witness = measuredCameraWitness(envelope.points, layout);
    expect(witness).not.toBeNull();
    expect(witness!.minimumShift).toBeLessThanOrEqual(witness!.maximumShift);
    expect(witness!.maximumShift).toBeLessThan(0);
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
    const projectedGeometry = envelope.points.map((point) => {
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
    const cameraOffset = projection.camera.position
      .clone()
      .sub(authoredPosition);
    const verticalShift = cameraOffset.dot(authoredUp);
    const nonVerticalMovement = cameraOffset
      .addScaledVector(authoredUp, -verticalShift)
      .length();
    expect(
      nonVerticalMovement,
      `expected authored-scale camera-up witness ${JSON.stringify({ witness, verticalShift, measuredSurfaceSamples: envelope.measuredSurfaceSamples, fallbackSamples: envelope.fallbackSamples })}`,
    ).toBeLessThan(1e-4);
    expect(verticalShift).toBeGreaterThanOrEqual(witness!.minimumShift - 0.125);
    expect(verticalShift).toBeLessThanOrEqual(witness!.maximumShift + 0.125);
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
