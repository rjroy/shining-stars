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
  it('projects the initial collection anchor in CSS-pixel coordinates after viewport changes', () => {
    const composition = createObservatoryComposition(createAssets());
    const projectedCssAnchor = (width: number, height: number) => {
      composition.update({
        width,
        height,
        elapsedSeconds: 0,
        reducedMotion: false,
      });
      const constellation = composition.root.getObjectByName(
        'Observatory.CollectionConstellation',
      )!;
      composition.root.updateMatrixWorld(true);
      const point = new THREE.Vector3(-3.1, 0.35, 1.4)
        .applyMatrix4(constellation.matrixWorld)
        .project(composition.camera);
      return {
        anchor: composition.anchors()[0]!,
        expectedX: ((point.x + 1) / 2) * width,
        expectedY: ((1 - point.y) / 2) * height,
      };
    };
    const desktop = projectedCssAnchor(1200, 800);
    expect(desktop.anchor.collectionId).toBe('all-songs');
    expect(desktop.anchor.visible).toBe(true);
    expect(desktop.anchor.x).toBeCloseTo(desktop.expectedX);
    expect(desktop.anchor.y).toBeCloseTo(desktop.expectedY);

    const portrait = projectedCssAnchor(390, 844);
    expect(portrait.anchor.visible).toBe(true);
    expect(portrait.anchor.x).toBeCloseTo(portrait.expectedX);
    expect(portrait.anchor.y).toBeCloseTo(portrait.expectedY);
    composition.update({
      width: 320,
      height: 844,
      elapsedSeconds: 10,
      reducedMotion: true,
    });
    expect(composition.anchors()[0]).toMatchObject({ visible: true });
    composition.dispose();
    composition.dispose();
  });

  it('builds only procedural Observatory effects and borrows city resources', () => {
    const assets = createAssets();
    const cityGeometry = (assets.roots.city.children[0] as THREE.Mesh).geometry;
    const disposeGeometry = vi.spyOn(cityGeometry, 'dispose');
    const composition = createObservatoryComposition(assets);
    expect(composition.root.name).toBe('Brightvale.Observatory');
    expect(
      composition.root.getObjectByName('Observatory.BrightvaleCity'),
    ).toBeDefined();
    expect(
      composition.root.children.some(
        (object) => object instanceof THREE.Points,
      ),
    ).toBe(true);
    composition.dispose();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(assets.dispose).not.toHaveBeenCalled();
  });
});
