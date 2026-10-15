import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BrightvaleSkyTextures } from './assets';
import { createBrightvaleSky } from './sky';
import type { SceneStateProjection } from '../scene-state';

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
): SceneStateProjection {
  return {
    phase: transitionProgress > 0 ? 'twilight' : 'audience',
    victory,
    cityIntensity: 0.5,
    cityBrightness: 0.7,
    transitionProgress,
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

    sky.update(state(0, true), 1.6);
    expect(gradient.material.uniforms.radiantAmount.value).toBe(1);
    expect(gradient.material.uniforms.twilightAmount.value).toBe(0);
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
