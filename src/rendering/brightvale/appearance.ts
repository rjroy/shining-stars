import * as THREE from 'three';
import type { SceneStateProjection } from '../scene-state';
import {
  STATIC_AMBIENCE,
  windowAmbienceMultiplier,
  type BrightvaleAmbience,
} from './ambience';
import { attachWaterShimmer } from './water-shimmer';
import { attachCanopySway, attachPlazaSway } from './canopy-sway';

/** Physical materials inherit MeshStandardMaterial; non-city surfaces remain Toon. */
export type BrightvaleSurfaceMaterial =
  THREE.MeshStandardMaterial | THREE.MeshToonMaterial;

/** Shared source-material mapping and mode lighting for one Brightvale scene. */
export interface BrightvaleAppearance {
  /** Return an owned city PBR clone or non-city Toon replacement. */
  materialFor(source: THREE.Material): BrightvaleSurfaceMaterial;
  /** Apply the existing projected mode/brightness state without rebuilding resources. */
  update(state: SceneStateProjection, ambience?: BrightvaleAmbience): void;
  /** Release only resources created by this appearance; safe to call repeatedly. */
  dispose(): void;
}

type SourceSurfaceMaterial = THREE.Material & {
  readonly color?: THREE.Color;
  readonly emissive?: THREE.Color;
  readonly emissiveIntensity?: number;
  readonly flatShading?: boolean;
  readonly map?: THREE.Texture | null;
  readonly normalMap?: THREE.Texture | null;
  readonly normalScale?: THREE.Vector2;
  readonly emissiveMap?: THREE.Texture | null;
};

interface LightPreset {
  readonly sky: THREE.Color;
  readonly ground: THREE.Color;
  readonly hemisphereIntensity: number;
  readonly key: THREE.Color;
  readonly fill: THREE.Color;
  readonly rim: THREE.Color;
  readonly point: THREE.Color;
  readonly pointIntensity: number;
  readonly pointPosition: THREE.Vector3;
}

const GROUND_EMISSIVE = {
  audience: { plaza: 0x09090e },
  twilight: { plaza: 0x0d0b14 },
  radiant: { plaza: 0x14111a },
} as const;

const PRESETS: Readonly<
  Record<'audience' | 'twilight' | 'radiant', LightPreset>
> = {
  audience: {
    sky: new THREE.Color(0xffd49b),
    ground: new THREE.Color(0x27334d),
    hemisphereIntensity: 1.25,
    key: new THREE.Color(0xffc982),
    fill: new THREE.Color(0x6685c4),
    rim: new THREE.Color(0xff8e4b),
    point: new THREE.Color(0xffb95e),
    pointIntensity: 78,
    pointPosition: new THREE.Vector3(-12, 22, 3),
  },
  twilight: {
    sky: new THREE.Color(0xb7a0ff),
    ground: new THREE.Color(0x21183e),
    hemisphereIntensity: 1,
    key: new THREE.Color(0x9c83ff),
    fill: new THREE.Color(0x8267d0),
    rim: new THREE.Color(0x855cff),
    point: new THREE.Color(0x966dff),
    pointIntensity: 96,
    pointPosition: new THREE.Vector3(12, 24, -12),
  },
  radiant: {
    sky: new THREE.Color(0xffedc4),
    ground: new THREE.Color(0x55442f),
    hemisphereIntensity: 1.8,
    key: new THREE.Color(0xffe7ad),
    fill: new THREE.Color(0xffd88b),
    rim: new THREE.Color(0xfff6d8),
    point: new THREE.Color(0xffe2a0),
    pointIntensity: 132,
    pointPosition: new THREE.Vector3(0, 30, -4),
  },
};

function roleOf(material: THREE.Material): string {
  const metadata = material.userData as {
    city_role?: unknown;
    role?: unknown;
  };
  return String(metadata.city_role || metadata.role || material.name);
}

function sourceProperties(material: THREE.Material): SourceSurfaceMaterial {
  return material as SourceSurfaceMaterial;
}

function lerpColor(
  target: THREE.Color,
  from: THREE.Color,
  to: THREE.Color,
  amount: number,
): void {
  target.copy(from).lerp(to, amount);
}

/** Approved city PBR/non-city Toon mapping and unchanged state-driven lighting. */
export function createBrightvaleAppearance(
  scene: THREE.Scene,
  sourceRoots: readonly THREE.Object3D[],
): BrightvaleAppearance {
  const sources = new Set<THREE.Material>();
  for (const root of sourceRoots) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        sources.add(material);
    });
  }

  const ramp = new THREE.DataTexture(
    new Uint8Array([76, 76, 158, 158, 242, 242]),
    3,
    1,
    THREE.RGFormat,
  );
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.colorSpace = THREE.NoColorSpace;
  ramp.needsUpdate = true;

  const materialBySource = new Map<THREE.Material, BrightvaleSurfaceMaterial>();
  const materialBySignature = new Map<string, THREE.MeshToonMaterial>();
  const ownedMaterials = new Set<BrightvaleSurfaceMaterial>();
  const cityEmissionBaselines = new Map<BrightvaleSurfaceMaterial, number>();
  const windowGroups = new Map<BrightvaleSurfaceMaterial, string>();
  const waterUpdates: ((ambience: BrightvaleAmbience) => void)[] = [];
  const canopyUpdates: ((ambience: BrightvaleAmbience) => void)[] = [];
  const plazaUpdates: ((ambience: BrightvaleAmbience) => void)[] = [];
  const groundMaterials = new Map<THREE.MeshToonMaterial, 'city' | 'plaza'>();
  const hemisphere = new THREE.HemisphereLight(
    PRESETS.audience.sky,
    PRESETS.audience.ground,
    PRESETS.audience.hemisphereIntensity,
  );
  hemisphere.name = 'Brightvale.Ambience';
  const key = new THREE.DirectionalLight(0xffc982, 2.15);
  key.name = 'Brightvale.Key';
  key.castShadow = true;
  key.position.set(-12, 32, 18);
  const fill = new THREE.DirectionalLight(0x6685c4, 1.15);
  fill.name = 'Brightvale.Fill';
  fill.position.set(18, 18, 2);
  const rim = new THREE.DirectionalLight(0xff8e4b, 2);
  rim.name = 'Brightvale.Rim';
  rim.position.set(0, 27, -28);
  const point = new THREE.PointLight(0xffb95e, 78, 55, 2);
  point.name = 'Brightvale.Point';
  point.position.set(-12, 22, 3);
  scene.add(hemisphere, key, fill, rim, point);

  let currentCityBrightness = 1;
  let currentAmbience = STATIC_AMBIENCE;
  let disposed = false;
  const groundTargetColor = new THREE.Color();

  const update = (
    state: SceneStateProjection,
    ambience = STATIC_AMBIENCE,
  ): void => {
    if (disposed) throw new Error('Brightvale appearance has been disposed');
    const transitionAmount = Number.isFinite(state.transitionProgress)
      ? THREE.MathUtils.clamp(state.transitionProgress, 0, 1)
      : 0;
    const from = PRESETS.audience;
    const to = PRESETS.twilight;
    const amount = transitionAmount;
    const radiantAmount = state.victory
      ? THREE.MathUtils.clamp(state.radiantProgress, 0, 1)
      : 0;
    lerpColor(hemisphere.color, from.sky, to.sky, amount);
    lerpColor(hemisphere.groundColor, from.ground, to.ground, amount);
    hemisphere.intensity = THREE.MathUtils.lerp(
      from.hemisphereIntensity,
      to.hemisphereIntensity,
      amount,
    );
    lerpColor(key.color, from.key, to.key, amount);
    lerpColor(fill.color, from.fill, to.fill, amount);
    lerpColor(rim.color, from.rim, to.rim, amount);
    lerpColor(point.color, from.point, to.point, amount);
    point.intensity = THREE.MathUtils.lerp(
      from.pointIntensity,
      to.pointIntensity,
      amount,
    );
    point.position.lerpVectors(from.pointPosition, to.pointPosition, amount);
    // Layer the victory handoff over the existing blend, including early wins.
    const radiant = PRESETS.radiant;
    hemisphere.color.lerp(radiant.sky, radiantAmount);
    hemisphere.groundColor.lerp(radiant.ground, radiantAmount);
    hemisphere.intensity = THREE.MathUtils.lerp(
      hemisphere.intensity,
      radiant.hemisphereIntensity,
      radiantAmount,
    );
    key.color.lerp(radiant.key, radiantAmount);
    fill.color.lerp(radiant.fill, radiantAmount);
    rim.color.lerp(radiant.rim, radiantAmount);
    point.color.lerp(radiant.point, radiantAmount);
    point.intensity = THREE.MathUtils.lerp(
      point.intensity,
      radiant.pointIntensity,
      radiantAmount,
    );
    point.position.lerp(radiant.pointPosition, radiantAmount);

    currentCityBrightness = THREE.MathUtils.clamp(
      Number.isFinite(state.cityBrightness) ? state.cityBrightness : 0,
      0,
      1,
    );
    currentAmbience = ambience;
    for (const updateWater of waterUpdates) updateWater(ambience);
    for (const updateCanopy of canopyUpdates) updateCanopy(ambience);
    for (const updatePlaza of plazaUpdates) updatePlaza(ambience);
    for (const [material, baseline] of cityEmissionBaselines)
      material.emissiveIntensity =
        baseline *
        currentCityBrightness *
        windowAmbienceMultiplier(windowGroups.get(material) ?? '', ambience);
    const fromGround = GROUND_EMISSIVE.audience;
    const toGround = GROUND_EMISSIVE.twilight;
    for (const [material, surface] of groundMaterials) {
      if (surface === 'city') {
        material.emissive.set(0x000000);
        continue;
      }
      material.emissive.set(fromGround[surface]);
      groundTargetColor.set(toGround[surface]);
      material.emissive.lerp(groundTargetColor, amount);
      groundTargetColor.set(GROUND_EMISSIVE.radiant[surface]);
      material.emissive.lerp(groundTargetColor, radiantAmount);
    }
  };

  return {
    materialFor(source) {
      if (disposed) throw new Error('Brightvale appearance has been disposed');
      if (!sources.has(source))
        throw new Error(
          'Brightvale source material does not belong to this scene',
        );
      const existing = materialBySource.get(source);
      if (existing) return existing;

      const properties = sourceProperties(source);
      const role = roleOf(source);
      // City surfaces preserve the approved imported PBR response.
      if (
        (role.startsWith('city.') || role === 'emissive_window') &&
        source instanceof THREE.MeshStandardMaterial
      ) {
        // Keep authored properties/maps and isolate mode updates from borrowed
        // materials shared with Observatory. Cache by source, not Toon signature:
        // equal colors do not imply equal roughness, metalness or normal maps.
        const material = source.clone();
        material.userData.brightvaleRole = role;
        materialBySource.set(source, material);
        ownedMaterials.add(material);
        const updateWater = attachWaterShimmer(material, role);
        if (updateWater) {
          waterUpdates.push(updateWater);
          updateWater(currentAmbience);
        }
        if (role === 'emissive_window') {
          cityEmissionBaselines.set(material, source.emissiveIntensity);
          const group =
            typeof source.userData.source_material === 'string'
              ? source.userData.source_material
              : source.name;
          windowGroups.set(material, group);
          material.emissiveIntensity =
            source.emissiveIntensity *
            currentCityBrightness *
            windowAmbienceMultiplier(group, currentAmbience);
        }
        return material;
      }
      // Non-city surfaces keep the existing Toon mapping.
      const color = properties.color?.clone() ?? new THREE.Color(0xffffff);
      const emissive =
        properties.emissive?.clone() ?? new THREE.Color(0x000000);
      const groundSurface = source.userData.brightvaleGround as
        'city' | 'plaza' | undefined;
      const map = properties.map ?? null;
      const normalMap = properties.normalMap ?? null;
      const normalScale =
        properties.normalScale?.clone() ?? new THREE.Vector2(1, 1);
      let emissiveMap = properties.emissiveMap ?? null;
      if (groundSurface === 'city') emissive.set(0x000000);
      if (groundSurface === 'city') emissiveMap = null;
      const emissiveIntensity =
        groundSurface === 'city' ? 0 : (properties.emissiveIntensity ?? 1);
      const signature = [
        role,
        color.getHexString(),
        emissive.getHexString(),
        emissiveIntensity,
        source.side,
        map?.uuid ?? '',
        normalMap?.uuid ?? '',
        normalScale.x,
        normalScale.y,
        emissiveMap?.uuid ?? '',
        groundSurface ?? '',
      ].join('|');

      let material = materialBySignature.get(signature);
      if (!material) {
        material = new THREE.MeshToonMaterial({
          name: `${source.name} | ${role} | Brightvale toon`,
          color,
          gradientMap: ramp,
          side: source.side,
          emissive,
          emissiveIntensity,
          map,
          normalMap,
          normalScale,
          emissiveMap,
        });
        // Preserve black-based pure emitters; their glow remains in emissive.
        if (
          properties.color &&
          properties.color.r + properties.color.g + properties.color.b <
            0.0001 &&
          properties.emissive &&
          properties.emissive.r +
            properties.emissive.g +
            properties.emissive.b >
            0
        )
          material.color.setRGB(0, 0, 0);
        material.userData.brightvaleRole = role;
        materialBySignature.set(signature, material);
        ownedMaterials.add(material);
        if (groundSurface) groundMaterials.set(material, groundSurface);
        if (groundSurface === 'city' && normalMap) {
          const updateCanopy = attachCanopySway(material);
          canopyUpdates.push(updateCanopy);
          updateCanopy(currentAmbience);
        } else if (groundSurface === 'plaza' && normalMap) {
          const updatePlaza = attachPlazaSway(material);
          plazaUpdates.push(updatePlaza);
          updatePlaza(currentAmbience);
        }
      }

      materialBySource.set(source, material);
      if (role === 'emissive_window') {
        cityEmissionBaselines.set(material, emissiveIntensity);
        material.emissiveIntensity = emissiveIntensity * currentCityBrightness;
      }
      if (groundSurface) {
        material.color.set(groundSurface === 'city' ? 0x77b78a : 0x303060);
        material.emissive.set(0x000000);
      }
      return material;
    },
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of [hemisphere, key, fill, rim, point])
        if (light.parent === scene) scene.remove(light);
      key.shadow.dispose();
      for (const material of ownedMaterials) material.dispose();
      ramp.dispose();
    },
  };
}
