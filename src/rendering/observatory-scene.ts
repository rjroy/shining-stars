import * as THREE from 'three';
import type { BrightvaleAssets } from './brightvale/assets';
import type { BrightvaleShellComposition } from './brightvale/scene-shell';
import type { SongCollection } from '../catalog/catalog';
import {
  projectObservatoryAmbience,
  windowAmbienceMultiplier,
  type BrightvaleAmbience,
} from './brightvale/ambience';
import { attachWaterShimmer } from './brightvale/water-shimmer';
import {
  fitDirectionalShadowCamera,
  setShadowParticipation,
} from './brightvale/shadows';

export interface ObservatorySceneFrame {
  readonly width: number;
  readonly height: number;
  readonly elapsedSeconds: number;
  readonly reducedMotion: boolean;
}

export interface ObservatoryProjectedAnchor {
  readonly collectionId: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface ObservatoryComposition extends BrightvaleShellComposition {
  readonly camera: THREE.Camera;
  update(frame: ObservatorySceneFrame): void;
  anchors(): readonly ObservatoryProjectedAnchor[];
}

/** Celestial Observatory city and anchors; the shared sky renders behind it. */
export function createObservatoryComposition(
  assets: BrightvaleAssets,
  collections: readonly SongCollection[] = [],
): ObservatoryComposition {
  const root = new THREE.Group();
  root.name = 'Brightvale.Observatory';
  root.add(new THREE.AmbientLight(0x9a83d5, 1.8));
  const city = assets.roots.city.clone(true);
  city.name = 'Observatory.BrightvaleCity';
  city.scale.setScalar(0.18);
  city.position.set(0, -2.85, -7);
  // Own only material clones; imported geometry and textures remain borrowed.
  // Keep Observatory's lights instead of installing gameplay appearance presets.
  const materials = new Map<
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial
  >();
  const ambienceUpdates: ((ambience: BrightvaleAmbience) => void)[] = [];
  const materialFor = (source: THREE.Material): THREE.Material => {
    if (!(source instanceof THREE.MeshStandardMaterial)) return source;
    const existing = materials.get(source);
    if (existing) return existing;
    const material = source.clone();
    materials.set(source, material);
    const role = String(
      source.userData.city_role || source.userData.role || source.name,
    );
    const updateWater = attachWaterShimmer(material, role);
    if (updateWater) ambienceUpdates.push(updateWater);
    if (role === 'emissive_window') {
      const baseline = source.emissiveIntensity;
      const group =
        typeof source.userData.source_material === 'string'
          ? source.userData.source_material
          : source.name;
      ambienceUpdates.push((ambience) => {
        material.emissiveIntensity =
          baseline * windowAmbienceMultiplier(group, ambience);
      });
    }
    return material;
  };
  city.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(materialFor)
      : materialFor(object.material);
  });
  setShadowParticipation(city, { cast: true, receive: true });
  root.add(city);

  const cityKey = new THREE.DirectionalLight(0xffd49b, 0.72);
  cityKey.name = 'Observatory.CityKey';
  cityKey.position.set(-14, 18, 11);
  cityKey.target.position.copy(city.position);
  cityKey.castShadow = true;
  root.add(cityKey, cityKey.target);
  fitDirectionalShadowCamera(cityKey, [city]);

  const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 80);
  camera.position.set(0, 4, 16);
  camera.lookAt(0, 2, 0);
  const collectionTargets = collections.map((collection) => {
    const target = new THREE.Group();
    target.name = `Observatory.CollectionAnchor.${collection.id}`;
    root.add(target);
    return { collection, target };
  });
  let width = 1;
  let height = 1;
  let destroyed = false;
  return {
    root,
    camera,
    update(frame) {
      if (destroyed)
        throw new Error('Observatory composition has been disposed');
      const ambience = projectObservatoryAmbience(
        frame.elapsedSeconds,
        frame.reducedMotion,
      );
      for (const updateAmbience of ambienceUpdates) updateAmbience(ambience);
      width = frame.width;
      height = frame.height;
      const count = Math.max(1, collectionTargets.length);
      const columns = Math.min(count, width < 1100 || width < height ? 2 : 3);
      const horizontalSpan = width < height ? 1 : width < 1100 ? 0.56 : 0.78;
      collectionTargets.forEach(({ target }, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        target.position.set(
          (-8 * width) / height +
            (col + 0.5) *
              ((((16 * width) / height) * horizontalSpan) / columns),
          1.15 - row * (width < height ? 1.5 : 2.1),
          1.1,
        );
      });
      camera.left = (-8 * width) / height;
      camera.right = (8 * width) / height;
      camera.top = 5;
      camera.bottom = -5;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    },
    anchors() {
      root.updateMatrixWorld(true);
      return collectionTargets.map(({ collection, target }) => {
        const anchor = new THREE.Vector3(0, 0, 0);
        target.localToWorld(anchor);
        const projected = anchor.project(camera);
        const x = ((projected.x + 1) / 2) * width;
        const y = ((1 - projected.y) / 2) * height;
        return {
          collectionId: collection.id,
          x,
          y,
          visible:
            width > 0 &&
            height > 0 &&
            x >= 0 &&
            x <= width &&
            y >= 0 &&
            y <= height,
        };
      });
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      cityKey.shadow.dispose();
      for (const material of materials.values()) material.dispose();
      materials.clear();
      ambienceUpdates.length = 0;
    },
  };
}
