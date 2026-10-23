import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STATIC_AMBIENCE } from './ambience';
import { attachCanopySway } from './canopy-sway';

function compile(material: THREE.MeshToonMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.toon.vertexShader,
    fragmentShader: THREE.ShaderLib.toon.fragmentShader,
    uniforms: {},
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('canopy normal sampling', () => {
  it('distorts only normal sampling, leaving painted color, vertices and borrowed textures untouched', () => {
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const material = new THREE.MeshToonMaterial({ map, normalMap });
    const originalMapTransform = map.matrix.toArray();
    const originalNormalTransform = normalMap.matrix.toArray();
    const update = attachCanopySway(material);
    update({ ...STATIC_AMBIENCE, time: 7.25 });
    const shader = compile(material);
    expect(shader.vertexShader).toBe(THREE.ShaderLib.toon.vertexShader);
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
    expect(shader.fragmentShader).not.toContain(
      '#include <normal_fragment_maps>',
    );
    expect(shader.fragmentShader).toContain(
      'texture2D( normalMap, brightvaleCanopyUv( vNormalMapUv ) )',
    );
    expect(shader.fragmentShader).toContain('normal = normalize( tbn * mapN )');
    expect(shader.fragmentShader).toContain('dot(uv,');
    expect(shader.fragmentShader).toContain('- sin(phase)');
    // A stepped Toon ramp hid the normal response under the overhead lights.
    expect(shader.fragmentShader).not.toContain(
      '#include <gradientmap_pars_fragment>',
    );
    expect(shader.fragmentShader).toContain(
      'max(dot(normal, lightDirection), 0.0)',
    );
    expect(shader.fragmentShader).toContain('normal - nonPerturbedNormal');
    expect(shader.fragmentShader).toContain('directionalLights[0].direction');
    expect(shader.fragmentShader).toContain(
      'reflectedLight.directDiffuse *= brightvaleCanopyRelief',
    );
    expect(shader.fragmentShader).not.toContain('diffuseColor.rgb +=');
    expect(shader.fragmentShader).not.toContain('totalEmissiveRadiance +=');
    expect(shader.uniforms.brightvaleCanopyTime?.value).toBe(7.25);
    expect(map.matrix.toArray()).toEqual(originalMapTransform);
    expect(normalMap.matrix.toArray()).toEqual(originalNormalTransform);
    expect(material.map).toBe(map);
    expect(material.normalMap).toBe(normalMap);
    material.dispose();
    map.dispose();
    normalMap.dispose();
  });

  it('uses absolute caller time and reuses uniforms across pauses, seeks and recompiles', () => {
    const material = new THREE.MeshToonMaterial();
    const update = attachCanopySway(material);
    const shader = compile(material);
    const time = shader.uniforms.brightvaleCanopyTime;
    for (const sample of [0, 3.5, 3.5, 8, 1.25, 0]) {
      update({ ...STATIC_AMBIENCE, time: sample });
      expect(time?.value).toBe(sample);
    }
    expect(compile(material).uniforms.brightvaleCanopyTime).toBe(time);
    expect(shader.uniforms.brightvaleCanopyTime).toBe(time);
    material.dispose();
  });
});
