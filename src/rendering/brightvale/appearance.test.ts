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
    victory: false,
    cityIntensity: 0.5,
    cityBrightness: 0.61,
    transitionProgress: 0,
    radiantProgress: 0,
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

function importedSurface(material: THREE.Material): THREE.MeshStandardMaterial {
  expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
  if (!(material instanceof THREE.MeshStandardMaterial)) {
    throw new Error('Expected imported city material, not Toon');
  }
  return material;
}

describe('Brightvale imported city appearance', () => {
  it('clones authored standard properties and borrows every surface map unchanged', () => {
    const source = sourceMaterial('city.masonry');
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const roughnessMap = new THREE.Texture();
    const metalnessMap = new THREE.Texture();
    const aoMap = new THREE.Texture();
    const emissiveMap = new THREE.Texture();
    const alphaMap = new THREE.Texture();
    const envMap = new THREE.Texture();
    Object.assign(source, {
      roughness: 0.72,
      metalness: 0.15,
      map,
      normalMap,
      roughnessMap,
      metalnessMap,
      aoMap,
      emissiveMap,
      alphaMap,
      envMap,
      aoMapIntensity: 0.4,
      envMapIntensity: 0.7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      alphaTest: 0.2,
      depthWrite: false,
      flatShading: true,
    });
    source.normalScale.set(0.3, -0.6);
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const material = importedSurface(appearance.materialFor(source));
    expect(material).not.toBe(source);
    expect(material.name).toBe(source.name);
    expect(material.userData.brightvaleRole).toBe('city.masonry');
    expect(source.userData.brightvaleRole).toBeUndefined();
    expect(material.color.toArray()).toEqual(source.color.toArray());
    expect(material.emissive.toArray()).toEqual(source.emissive.toArray());
    expect(material.emissiveIntensity).toBe(source.emissiveIntensity);
    for (const key of [
      'roughness',
      'metalness',
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'emissiveMap',
      'alphaMap',
      'envMap',
      'aoMapIntensity',
      'envMapIntensity',
      'side',
      'transparent',
      'opacity',
      'alphaTest',
      'depthWrite',
      'flatShading',
    ] as const)
      expect(material[key], key).toBe(source[key]);
    expect(material.normalScale.toArray()).toEqual([0.3, -0.6]);
    expect(material.normalScale).not.toBe(source.normalScale);
    material.normalScale.set(1, 1);
    expect(source.normalScale.toArray()).toEqual([0.3, -0.6]);
    appearance.dispose();
  });

  it('retains physical water and metal properties instead of rebuilding a standard approximation', () => {
    const source = new THREE.MeshPhysicalMaterial({
      color: 0x558899,
      roughness: 0.4,
      metalness: 0.1,
      ior: 1.333,
      transmission: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.2,
      reflectivity: 0.4,
      thickness: 0.6,
    });
    source.userData.city_role = 'city.water.surface';
    const clearcoatNormalMap = new THREE.Texture();
    source.clearcoatNormalMap = clearcoatNormalMap;
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const material = appearance.materialFor(source);
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    if (!(material instanceof THREE.MeshPhysicalMaterial))
      throw new Error('Expected physical clone');
    for (const key of [
      'roughness',
      'metalness',
      'ior',
      'transmission',
      'clearcoat',
      'clearcoatRoughness',
      'reflectivity',
      'thickness',
      'clearcoatNormalMap',
    ] as const)
      expect(material[key], key).toBe(source[key]);
    appearance.dispose();
  });

  it('caches by city source identity without collapsing distinct authored properties', () => {
    const first = sourceMaterial('city.roof');
    const second = first.clone();
    second.roughness = 0.25;
    second.normalMap = new THREE.Texture();
    const { scene, root } = makeSourceScene(first);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), second));
    const appearance = createBrightvaleAppearance(scene, [root]);
    const firstMapped = appearance.materialFor(first);
    const secondMapped = importedSurface(appearance.materialFor(second));
    expect(appearance.materialFor(first)).toBe(firstMapped);
    expect(secondMapped).not.toBe(firstMapped);
    expect(secondMapped.roughness).toBe(0.25);
    expect(secondMapped.normalMap).toBe(second.normalMap);
    const other = createBrightvaleAppearance(new THREE.Scene(), [root]);
    expect(other.materialFor(first)).not.toBe(firstMapped);
    other.dispose();
    appearance.dispose();
  });

  it('preserves existing non-city Toon signature sharing and isolates city mapping', () => {
    const first = sourceMaterial('highway');
    const second = first.clone();
    const city = first.clone();
    city.userData.city_role = 'city.masonry';
    const { scene, root } = makeSourceScene(first);
    for (const source of [second, city])
      root.add(new THREE.Mesh(new THREE.BoxGeometry(), source));
    const appearance = createBrightvaleAppearance(scene, [root]);
    const mapped = appearance.materialFor(first);
    expect(mapped).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(appearance.materialFor(second)).toBe(mapped);
    expect(appearance.materialFor(city)).toBeInstanceOf(
      THREE.MeshStandardMaterial,
    );
    appearance.dispose();
  });

  it('scales source window emission across Audience, Twilight and Radiant without mutation or accumulation', () => {
    const source = sourceMaterial('emissive_window', {
      emissiveIntensity: 0.65,
    });
    source.userData.city_role = 'emissive_window';
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    appearance.update(projection({ cityBrightness: 0.22 }));
    const material = importedSurface(appearance.materialFor(source));
    expect(material.emissiveIntensity).toBeCloseTo(0.65 * 0.22);
    for (const state of [
      projection({ cityBrightness: 0.61 }),
      projection({
        phase: 'twilight',
        transitionProgress: 1,
        cityBrightness: 0.61,
      }),
      projection({
        phase: 'twilight',
        victory: true,
        radiantProgress: 1,
        cityBrightness: 1,
      }),
      projection({ cityBrightness: 0 }),
      projection({ cityBrightness: Number.NaN }),
      projection({ cityBrightness: 2 }),
      projection({ cityBrightness: 0.61 }),
    ]) {
      appearance.update(state);
      const brightness = Number.isFinite(state.cityBrightness)
        ? Math.max(0, Math.min(1, state.cityBrightness))
        : 0;
      expect(material.emissiveIntensity).toBeCloseTo(0.65 * brightness);
      expect(appearance.materialFor(source)).toBe(material);
      expect(source.emissiveIntensity).toBe(0.65);
      expect(source.emissive.toArray()).toEqual(material.emissive.toArray());
    }
    appearance.dispose();
  });

  it('disposes city clones once while leaving all borrowed materials/maps/geometry alive', () => {
    const source = sourceMaterial('city.rock');
    const maps = [
      new THREE.Texture(),
      new THREE.Texture(),
      new THREE.Texture(),
    ];
    [source.map, source.normalMap, source.aoMap] = maps;
    const { scene, root, geometry } = makeSourceScene(source);
    const sourceDispose = vi.spyOn(source, 'dispose');
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const mapDisposes = maps.map((map) => vi.spyOn(map, 'dispose'));
    const appearance = createBrightvaleAppearance(scene, [root]);
    const material = appearance.materialFor(source);
    const cloneDispose = vi.spyOn(material, 'dispose');
    appearance.dispose();
    appearance.dispose();
    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    for (const dispose of mapDisposes) expect(dispose).not.toHaveBeenCalled();
    expect(appearance.materialFor.bind(appearance, source)).toThrow('disposed');
    expect(appearance.update.bind(appearance, projection())).toThrow(
      'disposed',
    );
  });
});

describe('Brightvale shared appearance', () => {
  it('maps borrowed source materials through the accepted three-step nearest toon ramp', () => {
    const source = sourceMaterial('stone_trim');
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(source);
    if (!(toon instanceof THREE.MeshToonMaterial))
      throw new Error('Expected non-city Toon');
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

  it('keeps borrowed ground maps and applies green/stone palette tints across modes', () => {
    const cityMap = new THREE.Texture();
    const city = sourceMaterial('ground_city');
    city.map = cityMap;
    city.emissiveMap = cityMap;
    city.userData.brightvaleGround = 'city';
    const { scene, root } = makeSourceScene(city);
    const plazaMap = new THREE.Texture();
    const plaza = sourceMaterial('ground_plaza');
    plaza.map = plazaMap;
    plaza.emissiveMap = plazaMap;
    plaza.userData.brightvaleGround = 'plaza';
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), plaza));
    const appearance = createBrightvaleAppearance(scene, [root]);
    const material = appearance.materialFor(city);
    const plazaMaterial = appearance.materialFor(plaza);
    expect(material.map).toBe(cityMap);
    expect(material.emissiveMap).toBe(cityMap);
    expect(material.color.getHex()).toBe(0x77b78a);
    expect(material.emissive.getHex()).toBe(0x78bf8f);
    expect(plazaMaterial.map).toBe(plazaMap);
    appearance.update(projection({ phase: 'twilight', transitionProgress: 1 }));
    expect(material.emissive.getHex()).toBe(0x82c79b);
    expect(material.color.getHex()).toBe(0x77b78a);
    appearance.update(
      projection({
        phase: 'twilight',
        victory: true,
        transitionProgress: 1,
        radiantProgress: 0.5,
      }),
    );
    expect(material.emissive.toArray()).toEqual(
      new THREE.Color(0x82c79b).lerp(new THREE.Color(0xa5ca8b), 0.5).toArray(),
    );
    appearance.update(
      projection({ phase: 'twilight', victory: true, radiantProgress: 1 }),
    );
    expect(material.emissive.getHex()).toBe(0xa5ca8b);
    expect(material.color.getHex()).toBe(0x77b78a);
    const dispose = vi.spyOn(cityMap, 'dispose');
    const plazaMapDispose = vi.spyOn(plazaMap, 'dispose');
    appearance.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(plazaMapDispose).not.toHaveBeenCalled();
    cityMap.dispose();
    plazaMap.dispose();
    city.dispose();
    plaza.dispose();
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

  it('blends locked victory from violet Twilight to gold-white and resets cleanly', () => {
    const { scene, root } = makeSourceScene(sourceMaterial('body'));
    const appearance = createBrightvaleAppearance(scene, [root]);
    const hemisphere = sceneLight(
      scene,
      'Brightvale.Ambience',
      THREE.HemisphereLight,
    );
    const point = sceneLight(scene, 'Brightvale.Point', THREE.PointLight);

    appearance.update(projection({ transitionProgress: 0.25 }));
    const earlyColor = point.color.clone();
    appearance.update(
      projection({
        transitionProgress: 0.25,
        victory: true,
        radiantProgress: 0,
      }),
    );
    expect(point.color.equals(earlyColor)).toBe(true);
    appearance.update(projection({ phase: 'twilight', transitionProgress: 1 }));
    const twilightPoint = point.intensity;
    expect(point.color.getHex()).toBe(0x966dff);
    const twilightColor = point.color.clone();
    appearance.update(
      projection({
        phase: 'twilight',
        victory: true,
        transitionProgress: 1,
        radiantProgress: 0,
      }),
    );
    expect(point.color.equals(twilightColor)).toBe(true);
    expect(point.intensity).toBe(twilightPoint);
    appearance.update(
      projection({
        phase: 'twilight',
        victory: true,
        transitionProgress: 1,
        radiantProgress: 0.5,
      }),
    );
    expect(point.color.toArray()).toEqual(
      twilightColor.clone().lerp(new THREE.Color(0xffe2a0), 0.5).toArray(),
    );
    expect(point.intensity).toBeCloseTo((96 + 132) / 2);
    appearance.update(
      projection({
        phase: 'twilight',
        victory: true,
        radiantProgress: 1,
        transitionProgress: 1,
      }),
    );

    expect(point.color.getHex()).toBe(0xffe2a0);
    expect(point.intensity).toBeGreaterThan(twilightPoint);
    expect(hemisphere.color.getHex()).toBe(0xffedc4);
    expect(hemisphere.intensity).toBeGreaterThan(1.25);
    appearance.update(projection({ phase: 'twilight', transitionProgress: 1 }));
    expect(point.color.getHex()).toBe(0x966dff);
    expect(point.intensity).toBeCloseTo(twilightPoint);
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
    const source = sourceMaterial('body');
    const { scene, root } = makeSourceScene(source);
    const appearance = createBrightvaleAppearance(scene, [root]);
    const toon = appearance.materialFor(source);
    if (!(toon instanceof THREE.MeshToonMaterial))
      throw new Error('Expected non-city Toon');
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
    if (!(toon instanceof THREE.MeshToonMaterial))
      throw new Error('Expected non-city Toon');
    const generatedMaterialDispose = vi.spyOn(toon, 'dispose');
    const key = sceneLight(scene, 'Brightvale.Key', THREE.DirectionalLight);
    const shadowTarget = new THREE.WebGLRenderTarget(16, 16);
    key.shadow.map = shadowTarget;
    const shadowDispose = vi.spyOn(key.shadow, 'dispose');
    const shadowTargetDispose = vi.spyOn(shadowTarget, 'dispose');
    const ramp = toon.gradientMap;
    expect(ramp).toBeInstanceOf(THREE.DataTexture);
    const rampDispose = vi.spyOn(ramp as THREE.DataTexture, 'dispose');

    appearance.dispose();
    appearance.dispose();

    expect(generatedMaterialDispose).toHaveBeenCalledTimes(1);
    expect(shadowDispose).toHaveBeenCalledTimes(1);
    expect(shadowTargetDispose).toHaveBeenCalledTimes(1);
    expect(rampDispose).toHaveBeenCalledTimes(1);
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(mapDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(source.map).toBe(borrowedMap);
  });
});
