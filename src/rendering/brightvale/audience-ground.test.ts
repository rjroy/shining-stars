import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createAudienceGroundApron } from './audience-ground';
import type { BrightvaleGroundSurface } from './layout';

// Test-owned geometry and cameras; no production layout or camera tuning.
function fixtures(front = 80) {
  const radius = 20;
  const segments = 32;
  const positions = [[0, 0, 0]];
  const triangles: number[][] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index * Math.PI * 2) / segments;
    positions.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
    triangles.push([0, ((index + 1) % segments) + 1, index + 1]);
  }
  const material = {
    name: 'test-plaza',
    baseColorLinear: [0.1, 0.1, 0.1, 1],
    metallic: 0,
    roughness: 1,
    doubleSided: false,
  };
  const plaza: BrightvaleGroundSurface = {
    name: 'test-disk',
    matrixColumnMajor: new THREE.Matrix4().makeTranslation(0, 5, -10).toArray(),
    positionsLocalGltf: positions,
    triangleIndices: triangles,
    material,
  };
  const city: BrightvaleGroundSurface = {
    name: 'test-ground',
    matrixColumnMajor: new THREE.Matrix4().toArray(),
    positionsLocalGltf: [
      [-100, 0, -100],
      [100, 0, -100],
      [100, 0, front],
      [-100, 0, front],
    ],
    triangleIndices: [
      [0, 2, 1],
      [0, 3, 2],
    ],
    material,
  };
  return { plaza, city };
}

function mesh(surface: BrightvaleGroundSurface): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(surface.positionsLocalGltf.flat(), 3),
  );
  geometry.setIndex(surface.triangleIndices.flat());
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  result.applyMatrix4(
    new THREE.Matrix4().fromArray([...surface.matrixColumnMajor]),
  );
  result.updateMatrixWorld(true);
  return result;
}

function area(surface: BrightvaleGroundSurface): number {
  const positions = surface.positionsLocalGltf.map((p) =>
    new THREE.Vector3().fromArray([...p]),
  );
  return surface.triangleIndices.reduce((sum, [a, b, c]) => {
    const normal = positions[b!]!.clone()
      .sub(positions[a!]!)
      .cross(positions[c!]!.clone().sub(positions[a!]!));
    expect(normal.y).toBeGreaterThan(0);
    return sum + normal.y / 2;
  }, 0);
}

describe('audience foreground apron', () => {
  it('joins the transformed front rim without overlap, a rear extension, or source mutation', () => {
    const { plaza, city } = fixtures();
    const original = structuredClone(plaza);
    const apron = createAudienceGroundApron(plaza, city)!;
    expect(apron.material).toBe(plaza.material);
    expect(plaza).toEqual(original);
    expect(Math.min(...apron.positionsLocalGltf.map((p) => p[2]!))).toBeCloseTo(
      -10,
    );
    expect(Math.max(...apron.positionsLocalGltf.map((p) => p[2]!))).toBe(80);
    expect(
      apron.positionsLocalGltf.every(
        (p) => p[1] === 5 && Math.abs(p[0]!) <= 20,
      ),
    ).toBe(true);
    // Rectangle minus the source polygon's forward half: no overlapping faces.
    expect(area(apron)).toBeCloseTo(40 * 90 - area(plaza) / 2, 5);
    const sourceRim = plaza.positionsLocalGltf
      .slice(1)
      .map(([x, , z]) => [x, 5, z! - 10]);
    for (const point of apron.positionsLocalGltf.slice(0, -2))
      expect(sourceRim).toContainEqual(point);
  });

  it.each([
    {
      name: 'narrow portrait',
      aspect: 390 / 844,
      position: [0, 18, 42],
      exposed: true,
    },
    { name: 'desktop', aspect: 16 / 9, position: [0, 12, 12], exposed: false },
  ])(
    'covers the foreground below the keys for $name, preserving the rear boundary',
    ({ aspect, position, exposed }) => {
      const { plaza, city } = fixtures();
      const disk = mesh(plaza);
      const apron = mesh(createAudienceGroundApron(plaza, city)!);
      const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 500);
      camera.position.fromArray(position);
      camera.rotation.x = -0.12;
      camera.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      try {
        ray.setFromCamera(new THREE.Vector2(0, -1), camera);
        expect(ray.intersectObject(disk).length === 0).toBe(exposed);
        for (const x of [-1, -0.5, 0, 0.5, 1]) {
          for (const y of [-1, -0.8, -0.6]) {
            ray.setFromCamera(new THREE.Vector2(x, y), camera);
            expect(
              ray.intersectObjects([disk, apron]).length,
              `NDC ${x},${y}`,
            ).toBeGreaterThan(0);
          }
        }
        ray.set(new THREE.Vector3(0, 20, -31), new THREE.Vector3(0, -1, 0));
        expect(ray.intersectObjects([disk, apron])).toHaveLength(0);
      } finally {
        for (const object of [disk, apron]) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      }
    },
  );

  it('does not add an apron when the city-ground front limit is already inside the disk', () => {
    const { plaza, city } = fixtures(8);
    expect(createAudienceGroundApron(plaza, city)).toBeNull();
  });
});
