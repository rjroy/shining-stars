import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import highwayValidation from '../../assets/production/brightvale-highway/technical-validation.json';
import platformValidation from '../../assets/production/brightvale-platform/technical-validation.json';
import structureLayout from '../../assets/production/brightvale-structure-layout.json';
import measuredProof from '../../tools/brightvale-playfield-proof/reference.json';
import { getDifficultyProfile } from '../game-balance';
import { createBrightvalePlayfieldContract } from './playfield';

const playfield = structureLayout.playfield;
const highway = highwayValidation.glb;
const sourceLaneCenters = [-4.5, -1.5, 1.5, 4.5] as const;
const laneWidth = 2.75;
const visibleApproachLength = 42;

describe('Brightvale geometry-driven playfield contract', () => {
  it('maps each of four authored lane hit anchors to the measured platform target', () => {
    const contract = createBrightvalePlayfieldContract();
    const matrix = new THREE.Matrix4().fromArray(
      playfield.gltf.matrix_column_major,
    );
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

  it('applies the authored 14 degree, 42-unit shared parent transform once', () => {
    expect(playfield.tilt_degrees).toBe(14);
    expect(highway.bounds_gltf.dimensions[2]).toBeCloseTo(42.165, 3);
    const matrix = new THREE.Matrix4().fromArray(
      playfield.gltf.matrix_column_major,
    );
    const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
    const roadNearOrigin = new THREE.Vector3(0, 0, -2.7).applyMatrix4(matrix);
    expect(origin.toArray()).toEqual(playfield.gltf.translation);
    expect(roadNearOrigin.z).toBeCloseTo(-2.38, 2);

    const contract = createBrightvalePlayfieldContract();
    for (let lane = 0; lane < 4; lane += 1) {
      const approach = contract.point(lane, 0);
      const hit = contract.point(lane, 1);
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

  it('keeps the measured visual path continuous through progress 1 while preserving the judged anchor', () => {
    const measuredTarget = measuredProof.surfaceProfile[0]?.measuredSamples;
    if (!measuredTarget || measuredTarget.length < 2)
      throw new Error(
        'the real-GLB proof must retain adjacent target-surface measurements',
      );
    const beforeTarget = measuredTarget.at(-2);
    const targetTop = measuredTarget.at(-1);
    if (!beforeTarget || !targetTop)
      throw new Error('target profile endpoints are required');

    const contract = createBrightvalePlayfieldContract({
      surfaceHeightAt(_lane, localZ) {
        if (localZ < beforeTarget.localZ || localZ > targetTop.localZ)
          return null;
        const t =
          (localZ - beforeTarget.localZ) /
          (targetTop.localZ - beforeTarget.localZ);
        return (
          beforeTarget.surfaceLocalY +
          (targetTop.surfaceLocalY - beforeTarget.surfaceLocalY) * t
        );
      },
    });
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

  it('reports target-surface separation rather than the unrelated highway seam clearance', () => {
    const measuredTarget =
      measuredProof.surfaceProfile[0]?.measuredSamples.at(-1);
    const targetMesh =
      platformValidation.glb.meshes['Hit bar 1 | recessed luminous center'];
    if (!measuredTarget || !targetMesh)
      throw new Error('measured target mesh fixture is required');
    const actualTargetTopToCenter =
      measuredTarget.surfaceLocalY - targetMesh.origin_gltf[1];
    expect(actualTargetTopToCenter).toBeGreaterThan(0.04);

    const contract = createBrightvalePlayfieldContract({
      surfaceHeightAt(_lane, localZ) {
        return Math.abs(localZ + 1.45) < 0.001
          ? measuredTarget.surfaceLocalY
          : null;
      },
    });
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

  it('records raised-nose ray hits at their local-vertical sample Z', () => {
    const recorded = measuredProof.surfaceProfile[0]?.measuredSamples.find(
      ({ progress }) => progress > 0.97 && progress < 0.98,
    ) as
      | {
          readonly localZ: number;
          readonly pathY: number;
          readonly signedPathToSurface: number;
          readonly surfaceHitLocalZ?: number;
        }
      | undefined;
    if (!recorded)
      throw new Error('real-GLB raised-nose measurement is required');

    expect(
      recorded.surfaceHitLocalZ,
      'local-vertical rays must preserve their local-Z sample coordinate',
    ).toBeCloseTo(recorded.localZ, 5);
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
