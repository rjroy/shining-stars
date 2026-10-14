import * as THREE from 'three';
import type { SceneStateProjection } from '../scene-state';

/** Shared source-material mapping and mode lighting for one Brightvale scene. */
export interface BrightvaleAppearance {
  /** Return the appearance-owned toon replacement for a borrowed source material. */
  materialFor(source: THREE.Material): THREE.MeshToonMaterial;
  /** Apply the existing projected mode/brightness state without rebuilding resources. */
  update(state: SceneStateProjection): void;
  /** Release only resources created by this appearance; safe to call repeatedly. */
  dispose(): void;
}

type SourceSurfaceMaterial = THREE.Material & {
  readonly color?: THREE.Color;
  readonly emissive?: THREE.Color;
  readonly emissiveIntensity?: number;
  readonly flatShading?: boolean;
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

const PRESETS: Readonly<Record<'audience' | 'twilight' | 'radiant', LightPreset>> = {
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

/** Shared review-matched toon material mapping and state-driven lighting. */
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

  const materialBySource = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const materialBySignature = new Map<string, THREE.MeshToonMaterial>();
  const ownedMaterials = new Set<THREE.MeshToonMaterial>();
  const cityEmissionBaselines = new Map<THREE.MeshToonMaterial, number>();
  const hemisphere = new THREE.HemisphereLight(
    PRESETS.audience.sky,
    PRESETS.audience.ground,
    PRESETS.audience.hemisphereIntensity,
  );
  hemisphere.name = 'Brightvale.Ambience';
  const key = new THREE.DirectionalLight(0xffc982, 2.15);
  key.name = 'Brightvale.Key';
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
  let disposed = false;

  const update = (state: SceneStateProjection): void => {
    if (disposed) throw new Error('Brightvale appearance has been disposed');
    const transitionAmount = Number.isFinite(state.transitionProgress)
      ? THREE.MathUtils.clamp(state.transitionProgress, 0, 1)
      : 0;
    const from = PRESETS.audience;
    const to = state.victory ? PRESETS.radiant : PRESETS.twilight;
    const amount = state.victory ? 1 : transitionAmount;
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

    currentCityBrightness = THREE.MathUtils.clamp(
      Number.isFinite(state.cityBrightness) ? state.cityBrightness : 0,
      0,
      1,
    );
    for (const [material, baseline] of cityEmissionBaselines)
      material.emissiveIntensity = baseline * currentCityBrightness;
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
      const color = properties.color?.clone() ?? new THREE.Color(0xffffff);
      const emissive =
        properties.emissive?.clone() ?? new THREE.Color(0x000000);
      const emissiveIntensity = properties.emissiveIntensity ?? 1;
      const signature = [
        role,
        color.getHexString(),
        emissive.getHexString(),
        emissiveIntensity,
        source.side,
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
      }

      materialBySource.set(source, material);
      if (role === 'emissive_window') {
        cityEmissionBaselines.set(material, emissiveIntensity);
        material.emissiveIntensity = emissiveIntensity * currentCityBrightness;
      }
      return material;
    },
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of [hemisphere, key, fill, rim, point])
        if (light.parent === scene) scene.remove(light);
      for (const material of ownedMaterials) material.dispose();
      ramp.dispose();
    },
  };
}
