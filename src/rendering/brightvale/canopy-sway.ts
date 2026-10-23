import * as THREE from 'three';
import type { BrightvaleAmbience } from './ambience';

/** Continuous diffuse relief and bounded normal-only sway of the painted canopy. */
export function attachCanopySway(
  material: THREE.MeshToonMaterial,
): (ambience: BrightvaleAmbience) => void {
  return attachNormalMapSway(
    material,
    'brightvaleCanopyTime',
    'brightvale-canopy-sway-v3',
    1,
    true,
  );
}

/** Plaza uses the same normal-only motion at half time, without canopy lighting changes. */
export function attachPlazaSway(
  material: THREE.MeshToonMaterial,
): (ambience: BrightvaleAmbience) => void {
  return attachNormalMapSway(
    material,
    'brightvalePlazaTime',
    'brightvale-plaza-sway-v1',
    0.5,
    true,
  );
}

function attachNormalMapSway(
  material: THREE.MeshToonMaterial,
  uniformName: string,
  cacheKey: string,
  timeMultiplier: number,
  canopyLighting: boolean,
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
      ${shader.fragmentShader}`
      .replace('#include <normal_fragment_maps>', normalFragment);
    if (canopyLighting) shader.fragmentShader = shader.fragmentShader
      // The shared three-band Toon ramp flattened canopy relief: the overhead
      // lights stayed inside one band even at strong normalScale. Only this
      // ground uses continuous diffuse response; all lights remain unchanged.
      .replace(
        '#include <gradientmap_pars_fragment>',
        `vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection) {
          return vec3(max(dot(normal, lightDirection), 0.0));
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if defined(USE_NORMALMAP_TANGENTSPACE) && NUM_DIR_LIGHTS > 0
          // Brightvale's first directional light is its existing warm key.
          // The opposing fill/rim largely cancel leaf-facing contrast. Recover
          // that contrast in this material, relative to its flat normal, without
          // changing lights, color, emission or the unperturbed ground response.
          float brightvaleCanopyFacing = dot(
            normal - nonPerturbedNormal, directionalLights[0].direction
          );
          float brightvaleCanopyRelief = clamp(
            1.0 + brightvaleCanopyFacing * 4.0, 0.25, 1.8
          );
          reflectedLight.directDiffuse *= brightvaleCanopyRelief;
          reflectedLight.indirectDiffuse *= brightvaleCanopyRelief;
        #endif`,
      );
  };
  return (ambience) => {
    time.value = ambience.time * timeMultiplier;
  };
}
