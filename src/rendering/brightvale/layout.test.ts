import { readFile } from 'node:fs/promises';
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

});
