import * as THREE from 'three';
import type { BrightvaleAmbience } from './ambience';

/** Bounded normal-only sway of the painted canopy under standard lighting. */
export function attachCanopySway(
  material: THREE.MeshStandardMaterial,
): (ambience: BrightvaleAmbience) => void {
  return attachNormalMapSway(
    material,
    'brightvaleCanopyTime',
    'brightvale-canopy-sway-v3',
    1,
  );
}

/** Plaza uses the same normal-only motion with its own time scaling. */
export function attachPlazaSway(
  material: THREE.MeshStandardMaterial,
): (ambience: BrightvaleAmbience) => void {
  return attachNormalMapSway(
    material,
    'brightvalePlazaTime',
    'brightvale-plaza-sway-v1',
    2,
  );
}

function attachNormalMapSway(
  material: THREE.MeshStandardMaterial,
  uniformName: string,
  cacheKey: string,
  timeMultiplier: number,
): (ambience: BrightvaleAmbience) => void {
  const time = { value: 0 };
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    shader.uniforms[uniformName] = time;
    // Reuse Three's normal decoding/TBN path, including double-sided handling.
    // Only the normal lookup changes: never the color UVs or texture transforms.
    const normalFragment = THREE.ShaderChunk.normal_fragment_maps.replaceAll(
      'texture2D( normalMap, vNormalMapUv )',
      'texture2D( normalMap, brightvaleCanopyUv( vNormalMapUv ) )',
    );
    shader.fragmentShader = `
      uniform float ${uniformName};
      vec2 brightvaleCanopyUv(vec2 uv) {
        vec2 phase = vec2(
          dot(uv, vec2(19.0, 13.0)) + sin(uv.y * 23.0),
          dot(uv, vec2(-11.0, 21.0)) + sin(uv.x * 17.0)
        );
        // Different local phases and unequal periods bend patches in place.
        // Subtract the resting phase so time zero is the original normal map.
        vec2 sway = sin(phase + ${uniformName} * vec2(0.73, 0.51))
          - sin(phase);
        return uv + sway * vec2(0.0045, 0.0035);
      }
      ${shader.fragmentShader}`.replace(
      '#include <normal_fragment_maps>',
      normalFragment,
    );
  };
  return (ambience) => {
    time.value = ambience.time * timeMultiplier;
  };
}
