import * as THREE from 'three';
import type { BrightvaleGroundSurface } from './layout';

/**
 * Runtime-only continuation of the horizontal audience disk toward the player.
 * Follow its front rim, rather than overlapping coplanar faces or replacing the
 * authored rear semicircle. Stay within the existing city ground's front limit.
 */
export function createAudienceGroundApron(
  plaza: BrightvaleGroundSurface,
  cityGround: BrightvaleGroundSurface,
): BrightvaleGroundSurface | null {
  const worldPoints = (surface: BrightvaleGroundSurface) => {
    const transform = new THREE.Matrix4().fromArray([
      ...surface.matrixColumnMajor,
    ]);
    return surface.positionsLocalGltf.map(([x, y, z]) =>
      new THREE.Vector3(x, y, z).applyMatrix4(transform),
    );
  };
  const points = worldPoints(plaza);
  const bounds = new THREE.Box3().setFromPoints(points);
  const front = new THREE.Box3().setFromPoints(worldPoints(cityGround)).max.z;
  if (front <= bounds.max.z) return null;

  // Only boundary vertices belong to the rim; exclude the disk's fan center.
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const triangle of plaza.triangleIndices) {
    for (let index = 0; index < 3; index += 1) {
      const a = triangle[index]!;
      const b = triangle[(index + 1) % 3]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const previous = edges.get(key);
      if (previous) previous.count += 1;
      else edges.set(key, { a, b, count: 1 });
    }
  }
  const boundary = new Set<number>();
  for (const edge of edges.values()) {
    if (edge.count === 1) {
      boundary.add(edge.a);
      boundary.add(edge.b);
    }
  }
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  const rim = [...boundary]
    .map((index) => points[index]!)
    .filter((point) => point.z >= centerZ - 1e-6)
    .sort((a, b) => a.x - b.x);
  if (rim.length < 3) return null;
  const contour = [
    ...rim,
    new THREE.Vector3(rim.at(-1)!.x, bounds.max.y, front),
    new THREE.Vector3(rim[0]!.x, bounds.max.y, front),
  ];
  const triangles = THREE.ShapeUtils.triangulateShape(
    contour.map((point) => new THREE.Vector2(point.x, point.z)),
    [],
  ).map(([a, b, c]) => {
    const normal = contour[b!]!.clone()
      .sub(contour[a!]!)
      .cross(contour[c!]!.clone().sub(contour[a!]!));
    return normal.y > 0 ? [a!, b!, c!] : [c!, b!, a!];
  });
  return {
    name: 'Brightvale.Ground.AudienceApron',
    matrixColumnMajor: new THREE.Matrix4().toArray(),
    positionsLocalGltf: contour.map((point) => point.toArray()),
    triangleIndices: triangles,
    material: plaza.material,
  };
}
