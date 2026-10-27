import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import highwayValidation from '../../../assets/production/brightvale-highway/technical-validation.json';
import platformValidation from '../../../assets/production/brightvale-platform/technical-validation.json';
import { getDifficultyProfile } from '../../game/game-balance';
import { createBrightvaleSurfaceProfile } from './projection';
import { createBrightvalePlayfieldContract } from './playfield';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './layout';
import { loadBrightvaleProductionAssets } from './test-assets';
import type { BrightvaleAssets } from './assets';

const playfield = BRIGHTVALE_RUNTIME_LAYOUT.playfield;
const highway = highwayValidation.glb;
const sourceLaneCenters = [-4.5, -1.5, 1.5, 4.5] as const;
const laneWidth = 2.75;
const visibleApproachLength = 42;
let assets: BrightvaleAssets;
let surfaceProfile: ReturnType<typeof createBrightvaleSurfaceProfile>;

beforeAll(async () => {
  assets = await loadBrightvaleProductionAssets();
  surfaceProfile = createBrightvaleSurfaceProfile(assets.roots);
});

afterAll(() => assets?.dispose());

describe('Brightvale geometry-driven playfield contract', () => {
  it('maps each of four authored lane hit anchors to the measured platform target', () => {
    const contract = createBrightvalePlayfieldContract();
    const matrix = new THREE.Matrix4().fromArray(playfield.matrixColumnMajor);
    const localHitZ = -1.45;

    sourceLaneCenters.forEach((laneX, lane) => {
      const measuredTarget = new THREE.Vector3(
        laneX,
        0.365,
        localHitZ,
      ).applyMatrix4(matrix);
      const actual = contract.hitAnchor(lane);
      expect(
        actual.distanceTo(measuredTarget),
        `lane ${lane} hit point`,
      ).toBeLessThan(0.06);
      expect(contract.point(lane, 1).distanceTo(actual)).toBeLessThan(1e-8);
    });
  });

  it('applies the shared parent transform once over the 42-unit approach', () => {
    expect(highway.bounds_gltf.dimensions[2]).toBeCloseTo(42.165, 3);
    const matrix = new THREE.Matrix4().fromArray(playfield.matrixColumnMajor);
    const contract = createBrightvalePlayfieldContract();
    for (let lane = 0; lane < 4; lane += 1) {
      const approach = contract.point(lane, 0);
      const hit = contract.point(lane, 1);
      const expectedHit = new THREE.Vector3(
        sourceLaneCenters[lane],
        0.365,
        -1.45,
      ).applyMatrix4(matrix);
      expect(hit.distanceTo(expectedHit)).toBeLessThan(1e-8);
      expect(approach.distanceTo(hit)).toBeCloseTo(visibleApproachLength, 3);
      expect(approach.x).toBeCloseTo(hit.x, 8);
    }
  });

  it('keeps lane travel within authored 2.75-unit surfaces and the raised nose clearance', () => {
    const contract = createBrightvalePlayfieldContract({
      surfaceHeightAt() {
        return 0.41;
      },
    });
    const halfWidth = laneWidth / 2;
    for (let lane = 0; lane < 4; lane += 1) {
      const point = contract.point(lane, 1);
      expect(Math.abs(point.x - sourceLaneCenters[lane])).toBeLessThan(0.06);
      expect(halfWidth).toBeLessThan(1.5); // authored center spacing
      const noseClearance = contract.clearanceAt(lane, 1);
      expect(noseClearance).toBeCloseTo(0.055, 6);
    }
    expect(highway.bounds_gltf.max[1]).toBeCloseTo(0.505, 3);
  });

  it('keeps the real-GLB visual path continuous through progress 1 while preserving the judged anchor', () => {
    const contract = createBrightvalePlayfieldContract(surfaceProfile);
    const justBefore = contract.visualPoint(0, 1 - 1e-4);
    const judgedPoint = contract.visualPoint(0, 1);

    expect(contract.point(0, 1).distanceTo(contract.hitAnchor(0))).toBeLessThan(
      1e-8,
    );
    expect(
      judgedPoint.z,
      'the visual path must not step backward in world depth at the hit transition',
    ).toBeGreaterThan(justBefore.z);
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    'keeps loaded-geometry note positions finite and continuous through the %s late cutoff',
    (difficulty) => {
      const contract = createBrightvalePlayfieldContract(surfaceProfile);
      const lateCutoff =
        1 + getDifficultyProfile(difficulty).timing.goodWindowSeconds / 2.4;
      const samples = [
        1,
        1 + (lateCutoff - 1) * 0.25,
        1 + (lateCutoff - 1) * 0.5,
        1 + (lateCutoff - 1) * 0.75,
        lateCutoff,
      ];
      if (difficulty === 'easy') {
        samples.push(1.125);
        samples.sort((left, right) => left - right);
      }
      const points = samples.map((progress) =>
        contract.visualPoint(0, progress),
      );

      for (const point of points)
        expect(point.toArray().every(Number.isFinite)).toBe(true);
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (previous === undefined || current === undefined)
          throw new Error('missing loaded-geometry sample');
        expect(current.z).toBeGreaterThan(previous.z);
        expect(current.distanceTo(previous)).toBeLessThan(3);
      }
    },
  );

  it('reports actual GLB target-surface separation rather than highway seam clearance', () => {
    const targetMesh =
      platformValidation.glb.meshes['Hit bar 1 | recessed luminous center'];
    const measuredTargetTop = surfaceProfile.surfaceHeightAt(0, -1.45);
    if (measuredTargetTop === null || !targetMesh)
      throw new Error('measured target mesh fixture is required');
    const actualTargetTopToCenter =
      measuredTargetTop - targetMesh.origin_gltf[1];
    expect(actualTargetTopToCenter).toBeGreaterThan(0.04);

    const contract = createBrightvalePlayfieldContract(surfaceProfile);
    const actual = contract.clearanceAt(0, 1);
    expect(
      actual,
      'visual clearance must be the note underside gap above the recessed-target surface',
    ).toBeGreaterThan(0);
    expect(actual).toBeGreaterThan(actualTargetTopToCenter);
    expect(actual).toBeCloseTo(0.055, 6);
  });

  it('refuses to claim a verified visual pose without loaded surface measurements', () => {
    expect(() => createBrightvalePlayfieldContract().visualPoint(0, 1)).toThrow(
      'requires a measured Brightvale surface profile',
    );
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    'projects finite, ordered unclamped timing endpoints for %s difficulty',
    (difficulty) => {
      const contract = createBrightvalePlayfieldContract();
      const profile = getDifficultyProfile(difficulty);
      const half = profile.timing.goodWindowSeconds / 2.4;
      const samples = [-half, 0, 1, 1 + half];
      const points = samples.map((progress) => contract.point(1, progress));

      for (const point of points)
        expect(point.toArray().every(Number.isFinite)).toBe(true);
      expect(points[0]?.distanceTo(points[1] as THREE.Vector3)).toBeGreaterThan(
        0,
      );
      for (let index = 1; index < points.length; index += 1) {
        const before = points[index - 1];
        const after = points[index];
        if (before === undefined || after === undefined)
          throw new Error('missing sample');
        expect(after.z).toBeGreaterThan(before.z);
      }
    },
  );
});
