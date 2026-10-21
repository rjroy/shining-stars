import * as THREE from 'three';
import type { BrightvaleAssets } from './brightvale/assets';
import type { BrightvaleShellComposition } from './brightvale/scene-shell';
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

export interface ObservatoryComposition extends BrightvaleShellComposition {
  readonly camera: THREE.Camera;
  update(frame: ObservatorySceneFrame): void;
}

/** Celestial Observatory city; collection navigation lives in the DOM. */
export function createObservatoryComposition(
  assets: BrightvaleAssets,
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
      const { width, height } = frame;
      camera.left = (-8 * width) / height;
      camera.right = (8 * width) / height;
      camera.top = 5;
      camera.bottom = -5;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
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
