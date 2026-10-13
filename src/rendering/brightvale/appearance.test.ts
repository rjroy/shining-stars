import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SceneStateProjection } from '../scene-state';
import { createBrightvaleAppearance } from './appearance';

function sourceMaterial(
  role: string,
  options: {
    color?: number;
    emissive?: number;
    emissiveIntensity?: number;
  } = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0x8d7351,
    emissive: options.emissive ?? 0x241008,
    emissiveIntensity: options.emissiveIntensity ?? 1.7,
  });
  material.name = `source:${role}`;
  material.userData.role = role;
  return material;
}

function projection(
  overrides: Partial<SceneStateProjection> = {},
): SceneStateProjection {
  return {
    phase: 'audience',
    cityIntensity: 0.5,
    cityBrightness: 0.61,
    transitionProgress: 0,
    motion: {
      powerLinePulse: true,
      buildingPulse: true,
      windTravel: true,
      cameraPush: 0,
    },
    playerDefiant: true,
    twilightConsumed: false,
    ...overrides,
  };
}

function makeSourceScene(material: THREE.Material) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  root.add(new THREE.Mesh(geometry, material));
  scene.add(root);
  return { scene, root, geometry };
}

function sceneLight<T extends THREE.Light>(
  scene: THREE.Scene,
  name: string,
  type: new (...args: never[]) => T,
): T {
  const light = scene.children.find((child) => child.name === name);
  expect(light, `appearance should add ${name}`).toBeInstanceOf(type);
  return light as T;
}

describe('Brightvale shared appearance', () => {
  it('maps borrowed source materials through the accepted three-step nearest toon ramp', () => {
    const source = sourceMaterial('stone_trim');
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(source);
    const ramp = toon.gradientMap as THREE.DataTexture | null;

    expect(toon).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(ramp).toBeInstanceOf(THREE.DataTexture);
    expect(ramp?.image).toMatchObject({ width: 3, height: 1 });
    expect(
      Array.from((ramp?.image as { readonly data: Uint8Array }).data),
    ).toEqual([76, 76, 158, 158, 242, 242]);
    expect(ramp?.format).toBe(THREE.RGFormat);
    expect(ramp?.minFilter).toBe(THREE.NearestFilter);
    expect(ramp?.magFilter).toBe(THREE.NearestFilter);
    expect(ramp?.generateMipmaps).toBe(false);
    expect(ramp?.colorSpace).toBe(THREE.NoColorSpace);
    appearance.dispose();
    source.dispose();
  });

  it('preserves semantic roles, linear base colors, and source emission values', () => {
    const trim = sourceMaterial('stone_trim', {
      color: 0x72865e,
      emissive: 0x140a05,
      emissiveIntensity: 0.8,
    });
    const roof = sourceMaterial('roof', {
      color: 0x72865e,
      emissive: 0x140a05,
      emissiveIntensity: 0.8,
    });
    const { scene, root } = makeSourceScene(trim);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), roof));
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toonTrim = appearance.materialFor(trim);
    const toonRoof = appearance.materialFor(roof);

    expect(toonTrim).not.toBe(toonRoof);
    expect(toonTrim.name).toContain('stone_trim');
    expect(toonRoof.name).toContain('roof');
    expect(toonTrim.color.toArray()).toEqual(trim.color.toArray());
    expect(toonTrim.emissive.toArray()).toEqual(trim.emissive.toArray());
    expect(toonTrim.emissiveIntensity).toBe(trim.emissiveIntensity);
    expect(toonTrim.side).toBe(trim.side);
    expect(trim.userData.role).toBe('stone_trim');
    appearance.dispose();
    trim.dispose();
    roof.dispose();
  });

  it('keeps pure-emission surfaces black-based while retaining their emission', () => {
    const emitter = sourceMaterial('hit_emitter', {
      color: 0x000000,
      emissive: 0x54d8ff,
      emissiveIntensity: 3.2,
    });
    const { scene, root } = makeSourceScene(emitter);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(emitter);

    expect(toon.color.r + toon.color.g + toon.color.b).toBe(0);
    expect(toon.emissive.toArray()).toEqual(emitter.emissive.toArray());
    expect(toon.emissiveIntensity).toBe(3.2);
    appearance.dispose();
    emitter.dispose();
  });

  it('matches the accepted Audience and Twilight light presets', () => {
    const { scene, root } = makeSourceScene(sourceMaterial('body'));
    const appearance = createBrightvaleAppearance(scene, [root]);
    appearance.update(projection({ transitionProgress: 0 }));

    const hemisphere = sceneLight(
      scene,
      'Brightvale.Ambience',
      THREE.HemisphereLight,
    );
    const key = sceneLight(scene, 'Brightvale.Key', THREE.DirectionalLight);
    const fill = sceneLight(scene, 'Brightvale.Fill', THREE.DirectionalLight);
    const rim = sceneLight(scene, 'Brightvale.Rim', THREE.DirectionalLight);
    const point = sceneLight(scene, 'Brightvale.Point', THREE.PointLight);
    expect(hemisphere.color.getHex()).toBe(0xffd49b);
    expect(hemisphere.groundColor.getHex()).toBe(0x27334d);
    expect(hemisphere.intensity).toBeCloseTo(1.25);
    expect(key.color.getHex()).toBe(0xffc982);
    expect(key.intensity).toBeCloseTo(2.15);
    expect(fill.color.getHex()).toBe(0x6685c4);
    expect(fill.intensity).toBeCloseTo(1.15);
    expect(rim.color.getHex()).toBe(0xff8e4b);
    expect(rim.intensity).toBeCloseTo(2);
    expect(point.color.getHex()).toBe(0xffb95e);
    expect(point.intensity).toBeCloseTo(78);
    expect(point.position.toArray()).toEqual([-12, 22, 3]);
    expect(point.distance).toBeCloseTo(55);
    expect(point.decay).toBeCloseTo(2);

    appearance.update(projection({ phase: 'twilight', transitionProgress: 1 }));
    expect(hemisphere.color.getHex()).toBe(0xb7a0ff);
    expect(hemisphere.groundColor.getHex()).toBe(0x21183e);
    expect(hemisphere.intensity).toBeCloseTo(1);
    expect(key.color.getHex()).toBe(0x9c83ff);
    expect(fill.color.getHex()).toBe(0x8267d0);
    expect(rim.color.getHex()).toBe(0x855cff);
    expect(point.color.getHex()).toBe(0x966dff);
    expect(point.intensity).toBeCloseTo(96);
    expect(point.position.toArray()).toEqual([12, 24, -12]);
    appearance.dispose();
  });

  it('interpolates the same lights and city brightness from projected mode state', () => {
    const cityWindow = sourceMaterial('emissive_window', {
      color: 0x000000,
      emissive: 0xffb95e,
      emissiveIntensity: 2.4,
    });
    cityWindow.userData.city_role = 'emissive_window';
    const { scene, root } = makeSourceScene(cityWindow);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(cityWindow);
    appearance.update(projection({ transitionProgress: 0 }));
    const hemisphere = sceneLight(
      scene,
      'Brightvale.Ambience',
      THREE.HemisphereLight,
    );
    const point = sceneLight(scene, 'Brightvale.Point', THREE.PointLight);

    appearance.update(
      projection({
        phase: 'twilight',
        transitionProgress: 0.5,
        cityIntensity: 0,
        cityBrightness: 0.22,
      }),
    );
    const expectedSky = new THREE.Color(0xffd49b).lerp(
      new THREE.Color(0xb7a0ff),
      0.5,
    );
    expect(hemisphere.color.equals(expectedSky)).toBe(true);
    expect(hemisphere.intensity).toBeCloseTo(1.125);
    expect(point.intensity).toBeCloseTo(87);
    expect(point.position.toArray()).toEqual([0, 23, -4.5]);
    expect(toon.emissiveIntensity).toBeCloseTo(2.4 * 0.22);
    appearance.dispose();
    cityWindow.dispose();
  });

  it('reuses mapped materials, ramp, and lights across mode updates', () => {
    const source = sourceMaterial('emissive_window');
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(source);
    const ramp = toon.gradientMap;
    const lights = [...scene.children];

    appearance.update(projection({ transitionProgress: 0 }));
    appearance.update(projection({ transitionProgress: 0.4 }));
    appearance.update(projection({ phase: 'twilight', transitionProgress: 1 }));

    expect(appearance.materialFor(source)).toBe(toon);
    expect(toon.gradientMap).toBe(ramp);
    expect(scene.children).toEqual(lights);
    appearance.dispose();
    source.dispose();
  });

  it('disposes generated appearance resources once without disposing borrowed roots', () => {
    const source = sourceMaterial('body');
    const borrowedMap = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
    );
    source.map = borrowedMap;
    const sourceDispose = vi.spyOn(source, 'dispose');
    const mapDispose = vi.spyOn(borrowedMap, 'dispose');
    const { scene, root, geometry } = makeSourceScene(source);
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(source);
    const generatedMaterialDispose = vi.spyOn(toon, 'dispose');
    const ramp = toon.gradientMap;
    expect(ramp).toBeInstanceOf(THREE.DataTexture);
    const rampDispose = vi.spyOn(ramp as THREE.DataTexture, 'dispose');

    appearance.dispose();
    appearance.dispose();

    expect(generatedMaterialDispose).toHaveBeenCalledTimes(1);
    expect(rampDispose).toHaveBeenCalledTimes(1);
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(mapDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(source.map).toBe(borrowedMap);
  });
});
