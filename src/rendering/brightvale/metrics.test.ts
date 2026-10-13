import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assembledTriangleCount } from './metrics';

describe('Brightvale assembled scene-tree triangle count', () => {
  it('counts ordinary geometry once and multiplies InstancedMesh geometry by count', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1],
        3,
      ),
    );
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    const instanced = new THREE.InstancedMesh(geometry, material, 4);
    instanced.count = 3;
    root.add(instanced);

    expect(assembledTriangleCount(root)).toBe(8);

    instanced.dispose();
    geometry.dispose();
    material.dispose();
  });
});
