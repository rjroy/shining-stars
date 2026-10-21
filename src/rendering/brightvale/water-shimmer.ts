import * as THREE from 'three';
import type { BrightvaleAmbience } from './ambience';

const WATER_WEIGHTS: Readonly<Record<string, number>> = {
  'city.water.surface': 1,
  'city.water.highlight': 0.75,
  'city.water.foam': 0.25,
  'city.water.fall': 0.65,
};

/** Existing opaque PBR surfaces; no extra mesh, pass, maps, or moving geometry. */
export function attachWaterShimmer(
  material: THREE.MeshStandardMaterial,
  role: string,
): ((ambience: BrightvaleAmbience) => void) | undefined {
  const weight = WATER_WEIGHTS[role];
  if (weight === undefined) return;
  const time = { value: 0 };
  const strength = { value: 0 };
  // Y-up world: reverse only vertical travel, including falls sharing surface
  // materials. Keep the existing X/Z channel travel and both wave speeds.
  const direction = { value: new THREE.Vector3(1.7, -2.4, 0.9) };
  const speed = { value: 0.85 };
  material.customProgramCacheKey = () => 'brightvale-water-shimmer-v2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.brightvaleWaterTime = time;
    shader.uniforms.brightvaleWaterStrength = strength;
    shader.uniforms.brightvaleWaterDirection = direction;
    shader.uniforms.brightvaleWaterSpeed = speed;
    shader.vertexShader =
      `varying vec3 vBrightvaleWaterPosition;\n${shader.vertexShader}`.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 brightvalePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          brightvalePosition = instanceMatrix * brightvalePosition;
        #endif
        vBrightvaleWaterPosition = (modelMatrix * brightvalePosition).xyz;
      `,
      );
    shader.fragmentShader = `
      uniform float brightvaleWaterTime;
      uniform float brightvaleWaterStrength;
      uniform vec3 brightvaleWaterDirection;
      uniform float brightvaleWaterSpeed;
      varying vec3 vBrightvaleWaterPosition;
      ${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `
        #include <emissivemap_fragment>
        float brightvaleWave = sin(dot(vBrightvaleWaterPosition, brightvaleWaterDirection) - brightvaleWaterTime * brightvaleWaterSpeed);
        float brightvaleCross = sin(dot(vBrightvaleWaterPosition, vec3(-0.8, 0.6, 1.6)) + brightvaleWaterTime * 0.43);
        float brightvaleGlint = smoothstep(0.72, 0.98, brightvaleWave)
          * (0.65 + 0.35 * brightvaleCross) * brightvaleWaterStrength;
        diffuseColor.rgb += vec3(0.12, 0.21, 0.225) * brightvaleGlint;
        totalEmissiveRadiance += vec3(0.045, 0.075, 0.084) * brightvaleGlint;
      `,
    );
  };
  return (ambience) => {
    time.value = ambience.time;
    strength.value = ambience.waterStrength * weight;
  };
}
