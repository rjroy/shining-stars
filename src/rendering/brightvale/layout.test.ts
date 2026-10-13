import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import authoritativeLayout from '../../../assets/production/brightvale-structure-layout.json';
import { describe, expect, it } from 'vitest';
import { BRIGHTVALE_RUNTIME_LAYOUT, type BrightvaleRuntimeLayout } from './layout';

const reviewMainUrl = new URL(
  '../../../assets/production/brightvale-scene-review/main.js',
  import.meta.url,
);

function runtimeLayoutForAssertion(): BrightvaleRuntimeLayout {
  expect(BRIGHTVALE_RUNTIME_LAYOUT).not.toBeNull();
  if (BRIGHTVALE_RUNTIME_LAYOUT === null) {
    throw new Error('Brightvale runtime layout extraction is not implemented');
  }
  return BRIGHTVALE_RUNTIME_LAYOUT;
}

function reviewFillPlacements(): {
  readonly id: string;
  readonly variant: 'A' | 'B' | 'C';
  readonly pose: 'Calm' | 'Cheering' | 'Reaching';
  readonly matrixColumnMajor: readonly number[];
}[] {
  const extraPoints: [number, number][] = [];
  for (const z of [-5, -8, -11, -14, -17, -20]) {
    for (const ax of [11, 13, 15]) {
      const x = ax + ((Math.abs(Math.round(z)) / 3) % 2 ? 0.45 : 0);
      if (
        x * x + (z + 20) * (z + 20) < 25.2 * 25.2 &&
        x > 7.4 &&
        x < 0.62 * (15 - z)
      ) {
        extraPoints.push([x, z]);
      }
    }
  }

  const poses = ['Calm', 'Cheering', 'Reaching'] as const;
  const variants = ['A', 'B', 'C'] as const;
  return extraPoints.map(([ax, z], index) => {
    const x = index % 2 ? ax : -ax;
    const yaw = Math.atan2(-x, 15 - z);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 8.25, z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        yaw,
      ),
      new THREE.Vector3(1, 1, 1),
    );
    return {
      id: `extra-${String(index + 1).padStart(2, '0')}`,
      variant: variants[(index + 1) % 3],
      pose: poses[(index * 2 + 1) % 3],
      matrixColumnMajor: matrix.toArray(),
    };
  });
}

function expectFiniteMatrix(matrix: readonly number[]): void {
  expect(matrix).toHaveLength(16);
  expect(matrix.every(Number.isFinite)).toBe(true);
}

describe('Brightvale runtime layout correspondence', () => {
  it('declares a compact versioned Y-up layout without shipping source hashes or reports', () => {
    const layout = runtimeLayoutForAssertion();

    expect(layout.schemaVersion).toBe('brightvale-runtime-layout-v1');
    expect(layout.coordinateSystem).toBe('gltf-y-up');
    expect(layout.units).toBe('provisional-authoring-units');
    expect(layout).not.toHaveProperty('sourceHash');
    expect(layout).not.toHaveProperty('report');
  });

  it('preserves authoritative whole-scene playfield and city matrices unchanged', () => {
    const layout = runtimeLayoutForAssertion();

    expect(layout.playfield.matrixColumnMajor).toEqual(
      authoritativeLayout.playfield.gltf.matrix_column_major,
    );
    expect(layout.city.matrixColumnMajor).toEqual(
      authoritativeLayout.city.gltf.matrix_column_major,
    );
    expect(layout.playfield.tiltDegrees).toBe(authoritativeLayout.playfield.tilt_degrees);
    expectFiniteMatrix(layout.playfield.matrixColumnMajor);
    expectFiniteMatrix(layout.city.matrixColumnMajor);
  });

  it('retains all authoritative framing instance and ground geometry data', () => {
    const layout = runtimeLayoutForAssertion();

    expect(layout.framingInstances).toEqual(
      authoritativeLayout.framing_instances.map((entry) => ({
        name: entry.name,
        module: entry.module,
        matrixColumnMajor: entry.gltf.matrix_column_major,
      })),
    );
    expect(layout.framingInstances.filter((entry) => entry.module === 'long')).toHaveLength(26);
    expect(layout.framingInstances.filter((entry) => entry.module === 'post')).toHaveLength(27);
    expect(layout.groundSurfaces).toEqual(
      authoritativeLayout.ground_surfaces.map((surface) => ({
        name: surface.name,
        matrixColumnMajor: surface.gltf.matrix_column_major,
        positionsLocalGltf: surface.positions_local_gltf,
        triangleIndices: surface.triangle_indices,
        material: {
          name: surface.material.name,
          baseColorLinear: surface.material.base_color_linear,
          metallic: surface.material.metallic,
          roughness: surface.material.roughness,
          doubleSided: surface.material.double_sided,
        },
      })),
    );
    for (const entry of layout.framingInstances) expectFiniteMatrix(entry.matrixColumnMajor);
    for (const surface of layout.groundSurfaces) expectFiniteMatrix(surface.matrixColumnMajor);
  });

  it('preserves the accepted study camera basis, clips, FOV, and reference viewport', async () => {
    const layout = runtimeLayoutForAssertion();
    const reviewMain = await readFile(reviewMainUrl, 'utf8');
    const source = authoritativeLayout.camera;

    expect(layout.camera).toEqual({
      verticalFovDegrees: source.vertical_fov_degrees,
      aspect: source.aspect,
      near: source.clip_near,
      far: source.clip_far,
      positionGltf: source.position_gltf,
      quaternionXyzw: source.transform_gltf_camera_basis.quaternion_xyzw,
      referenceResolution: source.resolution,
    });
    expect(reviewMain).toContain('39.76070473');
    expect(reviewMain).toContain('camera.position.set(0, 13.8999996185, 15)');
  });

  it('retains ten saved samples and exactly the fifteen accepted review-fill placements', async () => {
    const layout = runtimeLayoutForAssertion();
    const reviewMain = await readFile(reviewMainUrl, 'utf8');
    const savedSamples = authoritativeLayout.existing_crowd_sample_roots.map((sample) => ({
      id: sample.instance_id,
      variant: sample.variant,
      pose: sample.pose,
      source: 'saved-study' as const,
      matrixColumnMajor: sample.gltf.matrix_column_major,
    }));
    const reviewSamples = reviewFillPlacements().map((placement) => ({
      ...placement,
      source: 'scene-review-fill' as const,
    }));

    expect(reviewMain).toContain('for (const z of [-5, -8, -11, -14, -17, -20])');
    expect(reviewMain).toContain('for (const ax of [11, 13, 15])');
    expect(reviewMain).toContain('const yaw = Math.atan2(-x, 15 - z)');
    expect(reviewSamples).toHaveLength(15);
    expect(layout.crowdPlacements).toHaveLength(25);
    expect(layout.crowdPlacements).toEqual([...savedSamples, ...reviewSamples]);
    for (const placement of layout.crowdPlacements) {
      expectFiniteMatrix(placement.matrixColumnMajor);
    }
  });
});
