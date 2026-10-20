import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BrightvaleSkyTextures } from './assets';
import { createBrightvaleSky } from './sky';
import type { SceneStateProjection } from '../scene-state';
import { projectBrightvaleAmbience } from './ambience';

function makeTextures(): BrightvaleSkyTextures {
  const texture = (): THREE.DataTexture => {
    const result = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    result.needsUpdate = true;
    return result;
  };
  const warm = texture();
  const twilight = texture();
  return { warm, twilight, dispose: vi.fn() };
}

function state(
  transitionProgress: number,
  victory = false,
  radiantProgress = victory ? 1 : 0,
): SceneStateProjection {
  return {
    phase: transitionProgress > 0 ? 'twilight' : 'audience',
    victory,
    cityIntensity: 0.5,
    cityBrightness: 0.7,
    transitionProgress,
    radiantProgress,
    motion: {
      powerLinePulse: false,
      buildingPulse: false,
      windTravel: false,
      cameraPush: 0,
    },
    playerDefiant: true,
    twilightConsumed: false,
  };
}

describe('Brightvale shared sky composition', () => {
  it('tints existing cloud materials without accumulating tint or changing Observatory', () => {
    const textures = makeTextures();
    const sky = createBrightvaleSky(textures);
    const cloud = sky.scene.getObjectByName(
      'Brightvale.Sky.Clouds.Warm',
    ) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const material = cloud.material;
    // The shader hook only consumes these fields; it does not use the renderer.
    const shader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: {},
    } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain(
      'brightvaleCloudLight * brightvaleCloudGrade',
    );
    expect(shader.fragmentShader).toContain(
      'max(dot(brightvaleCloudGrade, brightvaleLumaWeights)',
    );
    const initialChildren = [...sky.scene.children];
    const ambience = projectBrightvaleAmbience(state(0), 11, false);
    for (const phase of [state(0), state(1), state(1, true)]) {
      const ambience = projectBrightvaleAmbience(phase, 11, false);
      sky.update(phase, 1.6, { ambience });
      expect(material.color.toArray()).toEqual(ambience.cloudTint);
      expect(shader.uniforms.brightvaleCloudGrade?.value.toArray()).toEqual(
        ambience.cloudGradeColor,
      );
      expect(shader.uniforms.brightvaleCloudGradeAmount?.value).toBe(
        ambience.cloudGradeAmount,
      );
      expect(cloud.material).toBe(material);
      expect(sky.scene.children).toEqual(initialChildren);
    }
    sky.update(state(0), 1.6, { observatory: true, ambience });
    expect(material.color.toArray()).toEqual([1, 1, 1]);
    expect(shader.uniforms.brightvaleCloudGradeAmount?.value).toBe(0);
    sky.update(state(0), 1.6);
    expect(material.color.toArray()).toEqual([1, 1, 1]);
    sky.dispose();
  });
  it('crossfades the approved clouds and perpetual-twilight palettes across modes', () => {
    const textures = makeTextures();
    const sky = createBrightvaleSky(textures);
    const gradient = sky.scene.getObjectByName('Brightvale.Sky.Gradient') as
      THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
    const warm = sky.scene.getObjectByName('Brightvale.Sky.Clouds.Warm') as
      THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
    const twilight = sky.scene.getObjectByName(
      'Brightvale.Sky.Clouds.Twilight',
    ) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
    const stars = sky.scene.getObjectByName('Brightvale.Sky.Stars') as
      THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined;
    if (!gradient || !warm || !twilight || !stars)
      throw new Error('Brightvale sky is missing a render layer');

    sky.update(state(0), 16 / 9);
    expect(gradient.material.uniforms.radiantAmount.value).toBe(0);
    expect(gradient.material.uniforms.twilightAmount.value).toBe(0);
    expect(warm.material.opacity).toBeCloseTo(0.86);
    expect(twilight.visible).toBe(false);
    expect(stars.geometry.getAttribute('position').count).toBe(156);

    sky.update(state(0.6), 390 / 844);
    expect(gradient.material.uniforms.twilightAmount.value).toBe(0.6);
    expect(warm.material.opacity).toBeCloseTo(0.344);
    expect(twilight.material.opacity).toBeCloseTo(0.492);
    expect(twilight.visible).toBe(true);
    expect(sky.camera.left).toBeCloseTo(-390 / 844);
    expect(sky.camera.right).toBeCloseTo(390 / 844);
    expect(warm.scale.x).toBeCloseTo(2 * (1535 / 864));
    expect(warm.scale.y).toBe(2);
    expect(warm.position.x).toBeCloseTo(-warm.scale.x * 0.22);
    expect(warm.position.y).toBeCloseTo(0.72);

    sky.update(state(1, true, 0), 1.6);
    expect(gradient.material.uniforms.radiantAmount.value).toBe(0);
    expect(warm.material.opacity).toBe(0);
    expect(twilight.material.opacity).toBeCloseTo(0.82);
    sky.update(state(1, true, 0.5), 1.6);
    expect(gradient.material.uniforms.radiantAmount.value).toBe(0.5);
    expect(warm.material.opacity).toBeCloseTo(0.48);
    expect(twilight.material.opacity).toBeCloseTo(0.41);
    sky.update(state(1, true, 1), 1.6);
    expect(gradient.material.uniforms.radiantAmount.value).toBe(1);
    expect(gradient.material.uniforms.twilightAmount.value).toBe(1);
    expect(warm.material.opacity).toBeCloseTo(0.96);
    expect(twilight.visible).toBe(false);

    sky.update(state(0), 1.6, { observatory: true });
    expect(gradient.material.uniforms.observatoryAmount.value).toBe(1);
    expect(warm.material.opacity).toBeCloseTo(0.86 * 0.34);
    expect((stars.material as THREE.PointsMaterial).opacity).toBe(0.36);
    sky.dispose();
  });

  it('disposes only its generated render resources and can be torn down twice', () => {
    const textures = makeTextures();
    const warmTextureDispose = vi.spyOn(textures.warm, 'dispose');
    const twilightTextureDispose = vi.spyOn(textures.twilight, 'dispose');
    const sky = createBrightvaleSky(textures);
    const resources: Array<THREE.BufferGeometry | THREE.Material> = [];
    sky.scene.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      resources.push(renderable.geometry);
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      resources.push(...materials);
    });
    const disposal = resources.map((resource) => vi.spyOn(resource, 'dispose'));

    sky.dispose();
    sky.dispose();

    expect(disposal.map((spy) => spy.mock.calls.length)).toEqual(
      resources.map(() => 1),
    );
    expect(warmTextureDispose).not.toHaveBeenCalled();
    expect(twilightTextureDispose).not.toHaveBeenCalled();
    expect(textures.dispose).not.toHaveBeenCalled();
    expect(sky.scene.children).toHaveLength(0);
    expect(() => sky.update(state(0), 1)).toThrow(/disposed/);
  });
});
