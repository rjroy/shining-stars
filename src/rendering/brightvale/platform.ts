import type { Object3D } from 'three';

const FRONT_CAP_NAMES = new Set([
  'Corner forging | -1 -1',
  'Corner forging | 1 -1',
]);

/** Apply the approved cap removal to the runtime clone, not the borrowed asset. */
export function hideFrontPlatformCaps(platform: Object3D): void {
  platform.traverse((object) => {
    // GLTFLoader sanitizes node names and retains the original in userData.name.
    const originalName = object.userData.name;
    const name = typeof originalName === 'string' ? originalName : object.name;
    if (FRONT_CAP_NAMES.has(name)) object.visible = false;
  });
}
