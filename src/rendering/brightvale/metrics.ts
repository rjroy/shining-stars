import * as THREE from 'three';

/** Count geometry triangles in an assembled scene tree, including instance counts. */
export function assembledTriangleCount(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const indexCount = geometry.index?.count;
    const vertexCount = geometry.getAttribute('position')?.count ?? 0;
    const primitiveTriangles = (indexCount ?? vertexCount) / 3;
    const instances = (object as THREE.InstancedMesh).isInstancedMesh
      ? (object as THREE.InstancedMesh).count
      : 1;
    triangles += primitiveTriangles * instances;
  });
  return triangles;
}
