import * as THREE from 'three';
import type { BrightvaleAmbience } from './ambience';

/** Bounded color and normal sway of the painted canopy under standard lighting. */
export function attachCanopySway(
  material: THREE.MeshStandardMaterial,
): (ambience: BrightvaleAmbience) => void {
  return attachNormalMapSway(
    material,
    'brightvaleCanopyTime',
    'brightvale-canopy-sway-v4',
    1,
    true,
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
    false,
  );
}

function attachNormalMapSway(
  material: THREE.MeshStandardMaterial,
  uniformName: string,
  cacheKey: string,
  timeMultiplier: number,
  swayColor: boolean,
): (ambience: BrightvaleAmbience) => void {
  const time = { value: 0 };
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${previousCacheKey}|${cacheKey}`;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms[uniformName] = time;
    // Reuse Three's normal decoding/TBN path, including double-sided handling.
    // Both lookups use their already-transformed UVs; texture transforms stay intact.
    const normalFragment = THREE.ShaderChunk.normal_fragment_maps.replaceAll(
      'texture2D( normalMap, vNormalMapUv )',
      'texture2D( normalMap, brightvaleCanopyUv( vNormalMapUv ) )',
    );
    let fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      normalFragment,
    );
    if (swayColor) {
      const mapFragment = THREE.ShaderChunk.map_fragment.replace(
        'texture2D( map, vMapUv )',
        'texture2D( map, brightvaleCanopyUv( vMapUv ) )',
      );
      fragmentShader = fragmentShader.replace(
        '#include <map_fragment>',
        mapFragment,
      );
    }
    shader.fragmentShader = `
      uniform float ${uniformName};
      vec2 brightvaleCanopyUv(vec2 uv) {
        vec2 phase = vec2(
          dot(uv, vec2(19.0, 13.0)) + sin(uv.y * 23.0),
          dot(uv, vec2(-11.0, 21.0)) + sin(uv.x * 17.0)
        );
        // Different local phases and unequal periods bend patches in place.
        // Subtract the resting phase so time zero uses the original UVs.
        vec2 sway = sin(phase + ${uniformName} * vec2(0.73, 0.51))
          - sin(phase);
        return uv + sway * vec2(0.0045, 0.0035);
      }
      ${fragmentShader}`;
  };
  return (ambience) => {
    time.value = ambience.time * timeMultiplier;
  };
}
