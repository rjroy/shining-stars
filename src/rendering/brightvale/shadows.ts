import * as THREE from 'three';

export const BRIGHTVALE_SHADOW_MAP_SIZE = 2048;

/**
 * Fit a directional light's one-time shadow map to the assembled scene, not
 * the enormous review ground plane. Receivers can be included for near/far
 * depth, while only caster bounds and their ground-plane projections set the
 * useful XY resolution.
 */
export function fitDirectionalShadowCamera(
  light: THREE.DirectionalLight,
  casters: readonly THREE.Object3D[],
  receiverSurfaces: readonly THREE.Object3D[] = [],
): void {
  if (casters.length === 0)
    throw new TypeError('Directional shadows need at least one caster.');

  const camera = light.shadow.camera as THREE.OrthographicCamera;
  light.updateWorldMatrix(true, true);
  light.target.updateWorldMatrix(true, false);
  camera.position.setFromMatrixPosition(light.matrixWorld);
  camera.lookAt(light.target.getWorldPosition(new THREE.Vector3()));
  camera.updateMatrixWorld(true);

  const casterBounds = casters.map((caster) => {
    caster.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(caster);
    if (bounds.isEmpty())
      throw new TypeError(
        `Directional shadow caster '${caster.name}' is empty.`,
      );
    return bounds;
  });
  const receiverHeights = receiverSurfaces.flatMap((surface) => {
    surface.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(surface);
    return bounds.isEmpty() ? [] : [bounds.min.y, bounds.max.y];
  });
  const shadowDirection = light.target
    .getWorldPosition(new THREE.Vector3())
    .sub(camera.position)
    .normalize();
  const lightSpaceBounds = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();

  for (const bounds of casterBounds) {
    for (const corner of boxCorners(bounds)) {
      point.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      lightSpaceBounds.expandByPoint(point);

      for (const receiverY of receiverHeights) {
        if (Math.abs(shadowDirection.y) < 1e-5) continue;
        const distance = (receiverY - corner.y) / shadowDirection.y;
        if (distance < 0) continue;
        const projected = corner
          .clone()
          .addScaledVector(shadowDirection, distance)
          .applyMatrix4(camera.matrixWorldInverse);
        lightSpaceBounds.expandByPoint(projected);
      }
    }
  }

  const size = lightSpaceBounds.getSize(new THREE.Vector3());
  const xyPadding = Math.max(1.25, Math.max(size.x, size.y) * 0.025);
  const depthPadding = Math.max(2, size.z * 0.025);
  camera.left = lightSpaceBounds.min.x - xyPadding;
  camera.right = lightSpaceBounds.max.x + xyPadding;
  camera.bottom = lightSpaceBounds.min.y - xyPadding;
  camera.top = lightSpaceBounds.max.y + xyPadding;
  camera.near = Math.max(0.1, -lightSpaceBounds.max.z - depthPadding);
  camera.far = Math.max(
    camera.near + 1,
    -lightSpaceBounds.min.z + depthPadding,
  );
  camera.updateProjectionMatrix();
  light.shadow.mapSize.set(
    BRIGHTVALE_SHADOW_MAP_SIZE,
    BRIGHTVALE_SHADOW_MAP_SIZE,
  );
  light.shadow.bias = -0.00015;
  light.shadow.normalBias = 0.025;
  light.shadow.radius = 2;
  light.shadow.intensity = 0.62;
}

/** Set both source and receiver flags without changing imported resources. */
export function setShadowParticipation(
  root: THREE.Object3D,
  options: { readonly cast: boolean; readonly receive: boolean },
): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = options.cast;
    mesh.receiveShadow = options.receive;
  });
}

function boxCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const { min, max } = bounds;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}
