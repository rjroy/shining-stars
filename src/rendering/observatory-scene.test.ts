import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIGHTVALE_ASSET_NAMES,
  type BrightvaleAssets,
} from './brightvale/assets';
import { createObservatoryComposition } from './observatory-scene';

function createAssets(): BrightvaleAssets {
  const roots = Object.fromEntries(
    BRIGHTVALE_ASSET_NAMES.map((name) => [name, new THREE.Group()]),
  ) as Record<(typeof BRIGHTVALE_ASSET_NAMES)[number], THREE.Group>;
  roots.city.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
  );
  return { roots, dispose: vi.fn() };
}

describe('Observatory scene composition', () => {
  const collections = [
    {
      id: 'lyra-of-brightvale',
      title: 'Lyra of Brightvale',
      sortOrder: 10,
      songIds: ['a'],
    },
    {
      id: 'christmas-star',
      title: 'Christmas Star',
      sortOrder: 20,
      songIds: ['b'],
    },
    {
      id: 'outside-worlds',
      title: 'Outside Worlds',
      sortOrder: 30,
      songIds: ['c'],
    },
  ];

  it('projects every collection anchor to responsive CSS-pixel coordinates', () => {
    const composition = createObservatoryComposition(
      createAssets(),
      collections,
    );
    const projectedCssAnchors = (width: number, height: number) => {
      composition.update({
        width,
        height,
        elapsedSeconds: 0,
        reducedMotion: false,
      });
      const collectionAnchor = composition.root.getObjectByName(
        'Observatory.CollectionAnchor.lyra-of-brightvale',
      )!;
      composition.root.updateMatrixWorld(true);
      const point = new THREE.Vector3(0, 0, 0)
        .applyMatrix4(collectionAnchor.matrixWorld)
        .project(composition.camera);
      return {
        anchors: composition.anchors(),
        expectedX: ((point.x + 1) / 2) * width,
        expectedY: ((1 - point.y) / 2) * height,
      };
    };
    const desktop = projectedCssAnchors(1200, 800);
    expect(desktop.anchors.map(({ collectionId }) => collectionId)).toEqual(
      collections.map(({ id }) => id),
    );
    expect(desktop.anchors.every(({ visible }) => visible)).toBe(true);
    expect(desktop.anchors[0]!.x).toBeCloseTo(desktop.expectedX);
    expect(desktop.anchors[0]!.y).toBeCloseTo(desktop.expectedY);

    const portrait = projectedCssAnchors(390, 844);
    expect(portrait.anchors.every(({ visible }) => visible)).toBe(true);
    expect(
      new Set(
        portrait.anchors.map(({ x, y }) => `${Math.round(x)}:${Math.round(y)}`),
      ).size,
    ).toBe(3);
    expect(portrait.anchors[0]!.x).toBeCloseTo(portrait.expectedX);
    expect(portrait.anchors[0]!.y).toBeCloseTo(portrait.expectedY);
    composition.update({
      width: 320,
      height: 844,
      elapsedSeconds: 10,
      reducedMotion: true,
    });
    expect(composition.anchors()).toHaveLength(3);
    expect(composition.anchors().every(({ visible }) => visible)).toBe(true);
    composition.dispose();
    composition.dispose();
  });

  it('supports the existing single-collection view and an empty catalog', () => {
    const single = createObservatoryComposition(
      createAssets(),
      collections.slice(0, 1),
    );
    single.update({
      width: 1200,
      height: 800,
      elapsedSeconds: 0,
      reducedMotion: true,
    });
    expect(single.anchors()).toMatchObject([
      { collectionId: 'lyra-of-brightvale', visible: true },
    ]);
    single.dispose();
    const empty = createObservatoryComposition(createAssets(), [
      { id: 'empty-sky', title: 'Empty Sky', sortOrder: 10, songIds: [] },
    ]);
    empty.update({
      width: 390,
      height: 844,
      elapsedSeconds: 0,
      reducedMotion: true,
    });
    expect(empty.anchors()).toMatchObject([
      { collectionId: 'empty-sky', visible: true },
    ]);
    empty.dispose();
  });

  it('owns cached animated material clones while borrowing city geometry and maps', () => {
    const assets = createAssets();
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const water = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.37,
      clearcoat: 0.28,
    });
    water.userData.city_role = 'city.water.surface';
    const window = new THREE.MeshStandardMaterial({
      emissive: 0xffbb88,
      emissiveIntensity: 1.3,
      emissiveMap: texture,
    });
    window.userData.city_role = 'emissive_window';
    window.userData.source_material = 'District detail | Left lit glazing';
    const surface = new THREE.Mesh(geometry, [water, window]);
    surface.name = 'Test.SharedCitySurface';
    const repeated = new THREE.Mesh(geometry, water);
    repeated.name = 'Test.RepeatedWater';
    assets.roots.city.add(surface, repeated);
    const borrowedDisposals = [geometry, texture, water, window].map(
      (resource) => vi.spyOn(resource, 'dispose'),
    );
    const composition = createObservatoryComposition(assets);
    try {
      const cloned = composition.root.getObjectByName(surface.name);
      const clonedRepeated = composition.root.getObjectByName(repeated.name);
      if (
        !(cloned instanceof THREE.Mesh) ||
        !Array.isArray(cloned.material) ||
        !(clonedRepeated instanceof THREE.Mesh)
      ) {
        throw new Error(
          'Expected cloned city meshes with their material slots',
        );
      }
      const [ownedWater, ownedWindow] = cloned.material;
      if (
        !(ownedWater instanceof THREE.MeshPhysicalMaterial) ||
        !(ownedWindow instanceof THREE.MeshStandardMaterial)
      ) {
        throw new Error('Expected authored PBR material types to be retained');
      }
      expect(ownedWater).not.toBe(water);
      expect(ownedWindow).not.toBe(window);
      expect(clonedRepeated.material).toBe(ownedWater);
      expect(cloned.geometry).toBe(geometry);
      expect(ownedWater.map).toBe(texture);
      expect(ownedWindow.emissiveMap).toBe(texture);
      expect(ownedWater.roughness).toBe(water.roughness);
      expect(ownedWater.clearcoat).toBe(water.clearcoat);
      const ownedDisposals = [ownedWater, ownedWindow].map((material) =>
        vi.spyOn(material, 'dispose'),
      );
      for (const elapsedSeconds of [0, 6, 18, 6]) {
        composition.update({
          width: 1200,
          height: 800,
          elapsedSeconds,
          reducedMotion: false,
        });
      }
      expect(window.emissiveIntensity).toBe(1.3);
      composition.dispose();
      composition.dispose();
      for (const dispose of ownedDisposals)
        expect(dispose).toHaveBeenCalledTimes(1);
      for (const dispose of borrowedDisposals)
        expect(dispose).not.toHaveBeenCalled();
      expect(assets.dispose).not.toHaveBeenCalled();
    } finally {
      composition.dispose();
      geometry.dispose();
      texture.dispose();
      water.dispose();
      window.dispose();
    }
  });

  it('builds the Observatory city without duplicating shared sky effects or owning city resources', () => {
    const assets = createAssets();
    const cityGeometry = (assets.roots.city.children[0] as THREE.Mesh).geometry;
    const disposeGeometry = vi.spyOn(cityGeometry, 'dispose');
    const composition = createObservatoryComposition(assets);
    expect(composition.root.name).toBe('Brightvale.Observatory');
    expect(
      composition.root.getObjectByName('Observatory.BrightvaleCity'),
    ).toBeDefined();
    const cityKey = composition.root.getObjectByName('Observatory.CityKey') as
      THREE.DirectionalLight | undefined;
    if (!cityKey) throw new Error('Observatory city key light is missing');
    const shadowTarget = new THREE.WebGLRenderTarget(16, 16);
    cityKey.shadow.map = shadowTarget;
    const shadowDispose = vi.spyOn(cityKey.shadow, 'dispose');
    const shadowTargetDispose = vi.spyOn(shadowTarget, 'dispose');
    expect(cityKey?.castShadow).toBe(true);
    expect(cityKey?.shadow.mapSize.toArray()).toEqual([2048, 2048]);
    const cityMesh = composition.root.getObjectByName(
      'Observatory.BrightvaleCity',
    )?.children[0] as THREE.Mesh | undefined;
    expect(cityMesh?.castShadow).toBe(true);
    expect(cityMesh?.receiveShadow).toBe(true);
    expect(
      composition.root.children.some(
        (object) => object instanceof THREE.Points,
      ),
    ).toBe(false);
    const collectionAnchor = createObservatoryComposition(assets, collections);
    expect(
      collectionAnchor.root.getObjectByName(
        'Observatory.CollectionAnchor.lyra-of-brightvale',
      )?.children,
    ).toHaveLength(0);
    expect(
      collectionAnchor.root.children.some(
        (object) => object instanceof THREE.Line,
      ),
    ).toBe(false);
    collectionAnchor.dispose();
    composition.dispose();
    composition.dispose();
    expect(shadowDispose).toHaveBeenCalledTimes(1);
    expect(shadowTargetDispose).toHaveBeenCalledTimes(1);
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(assets.dispose).not.toHaveBeenCalled();
  });
});
