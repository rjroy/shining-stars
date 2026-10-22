import * as THREE from 'three';
import type { BrightvaleAssets } from './assets';
import {
  createBrightvaleAppearance,
  type BrightvaleSurfaceMaterial,
} from './appearance';
import { fitDirectionalShadowCamera, setShadowParticipation } from './shadows';
import { hideFrontPlatformCaps } from './platform';
import type { BrightvaleShellComposition } from './scene-shell';
import type { SceneStateProjection } from '../scene-state';
import type { BrightvaleAmbience } from './ambience';
import type { BrightvaleRuntimeLayout } from './layout';
import {
  createSilhouetteCrowd,
  createSilhouettePilotPlacements,
  type SilhouetteCrowd,
} from './silhouette-crowd';

export interface BrightvaleComposition extends BrightvaleShellComposition {
  /** Applies visual state without rebuilding the assembled scene. */
  updateAppearance(
    state: SceneStateProjection,
    ambience?: BrightvaleAmbience,
  ): void;
}

/** Rotated planar mapping keeps grass variation legible at grazing angles. */
export const BRIGHTVALE_GROUND_UV = {
  city: {
    repeatWorldUnits: 200,
    rotationRadians: Math.PI / 5,
    offset: [0.5, 0.5],
  },
  plaza: {
    repeatWorldUnits: 22.5,
    rotationRadians: Math.PI / 10,
    offset: [0, 0],
  },
} as const;

interface BatchSource {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.Material;
  readonly materialIndex: number;
}

function matrix(values: readonly number[]): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray([...values]);
}

function relativeMatrix(
  root: THREE.Object3D,
  object: THREE.Object3D,
): THREE.Matrix4 {
  return new THREE.Matrix4()
    .copy(root.matrixWorld)
    .invert()
    .multiply(object.matrixWorld);
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) result.push(object as THREE.Mesh);
  });
  return result;
}

function sourceParts(mesh: THREE.Mesh): BatchSource[] {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  if (materials.length === 1)
    return [{ mesh, material: materials[0]!, materialIndex: 0 }];
  const groups = mesh.geometry.groups;
  return materials.flatMap((material, materialIndex) =>
    groups.some((group) => group.materialIndex === materialIndex)
      ? [{ mesh, material, materialIndex }]
      : [],
  );
}

function batchGeometry(source: BatchSource): THREE.BufferGeometry {
  const materials = Array.isArray(source.mesh.material)
    ? source.mesh.material
    : [source.mesh.material];
  if (materials.length === 1) return source.mesh.geometry;
  const geometry = source.mesh.geometry.clone();
  const groups = geometry.groups.filter(
    (group) => group.materialIndex === source.materialIndex,
  );
  geometry.clearGroups();
  for (const group of groups) geometry.addGroup(group.start, group.count, 0);
  return geometry;
}

function copyAppearanceMaterials(
  cloneRoot: THREE.Object3D,
  materialFor: (material: THREE.Material) => BrightvaleSurfaceMaterial,
): void {
  for (const mesh of meshes(cloneRoot)) {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(materialFor)
      : materialFor(mesh.material);
  }
}

/** Assemble the approved layout while borrowing all imported GLB geometry. */
export function createBrightvaleComposition(
  assets: BrightvaleAssets,
  layout: BrightvaleRuntimeLayout,
  scene: THREE.Scene,
  multisampledFramebuffer = false,
): BrightvaleComposition {
  const root = new THREE.Group();
  root.name = 'Brightvale.Composition';
  const playfield = new THREE.Group();
  playfield.name = 'Brightvale.Playfield';
  playfield.matrixAutoUpdate = false;
  playfield.matrix.copy(matrix(layout.playfield.matrixColumnMajor));
  root.add(playfield);

  const generatedGeometries = new Set<THREE.BufferGeometry>();
  const ownedSourceMaterials = new Set<THREE.Material>();
  let appearance: ReturnType<typeof createBrightvaleAppearance> | undefined;
  let silhouettes: SilhouetteCrowd | undefined;
  let disposed = false;
  const generatedInstances = new Set<THREE.InstancedMesh>();
  const releaseResources = (): void => {
    silhouettes?.dispose();
    for (const batch of generatedInstances) batch.dispose();
    for (const geometry of generatedGeometries) geometry.dispose();
    appearance?.dispose();
    for (const material of ownedSourceMaterials) material.dispose();
  };

  try {
    const groundSources = new THREE.Group();
    const sourceGeometry = new THREE.BufferGeometry();
    generatedGeometries.add(sourceGeometry);
    for (const surface of layout.groundSurfaces) {
      const colorValues = surface.material.baseColorLinear;
      const isCity = surface.name === 'Review.Ground';
      const texture = isCity
        ? assets.groundTextures?.city
        : assets.groundTextures?.plaza;
      const material = new THREE.MeshStandardMaterial({
        name: surface.material.name,
        color: new THREE.Color(
          colorValues[0] ?? 1,
          colorValues[1] ?? 1,
          colorValues[2] ?? 1,
        ),
        metalness: surface.material.metallic,
        roughness: surface.material.roughness,
        side: surface.material.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (texture) {
        material.map = texture;
        if (isCity && assets.groundTextures?.cityNormal) {
          material.normalMap = assets.groundTextures.cityNormal;
          // Deliberately legible relief; keep the canonical normal asset intact.
          material.normalScale.setScalar(5);
        }
        material.color.set(0xffffff);
        if (!isCity) {
          material.emissiveMap = texture;
          material.emissive.set(0xc5c1ec);
          material.emissiveIntensity = 0.42;
        }
        material.userData.brightvaleGround = isCity ? 'city' : 'plaza';
      }
      ownedSourceMaterials.add(material);
      groundSources.add(new THREE.Mesh(sourceGeometry, material));
    }
    const sourceRoots = [...Object.values(assets.roots), groundSources];
    appearance = createBrightvaleAppearance(scene, sourceRoots);

    const addBorrowedAsset = (
      name: 'highway' | 'platform' | 'endcaps',
    ): void => {
      const wrapper = new THREE.Group();
      wrapper.name = `Brightvale.Asset.${name}`;
      const source = assets.roots[name];
      const clone = source.clone(true);
      copyAppearanceMaterials(clone, appearance!.materialFor);
      if (name === 'platform') hideFrontPlatformCaps(clone);
      setShadowParticipation(clone, { cast: true, receive: true });
      wrapper.add(clone);
      playfield.add(wrapper);
    };
    addBorrowedAsset('platform');
    addBorrowedAsset('highway');
    addBorrowedAsset('endcaps');

    const cityGroup = new THREE.Group();
    cityGroup.name = 'Brightvale.City';
    cityGroup.matrixAutoUpdate = false;
    cityGroup.matrix.copy(matrix(layout.city.matrixColumnMajor));
    root.add(cityGroup);

    const framingGroup = new THREE.Group();
    framingGroup.name = 'Brightvale.Framing';
    root.add(framingGroup);
    const crowdGroup = new THREE.Group();
    crowdGroup.name = 'Brightvale.Crowd';
    root.add(crowdGroup);

    const groundGroup = new THREE.Group();
    groundGroup.name = 'Brightvale.Ground';
    root.add(groundGroup);
    for (const surface of layout.groundSurfaces) {
      const geometry = new THREE.BufferGeometry();
      const isCityGround = surface.name === 'Review.Ground';
      const uv = isCityGround
        ? BRIGHTVALE_GROUND_UV.city
        : BRIGHTVALE_GROUND_UV.plaza;
      const surfaceMatrix = matrix(surface.matrixColumnMajor);
      const uvs: number[] = [];
      const cosine = Math.cos(uv.rotationRadians);
      const sine = Math.sin(uv.rotationRadians);
      for (const [x, y, z] of surface.positionsLocalGltf) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(surfaceMatrix);
        uvs.push(
          (point.x * cosine + point.z * sine) / uv.repeatWorldUnits +
            uv.offset[0],
          (-point.x * sine + point.z * cosine) / uv.repeatWorldUnits +
            uv.offset[1],
        );
      }
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(surface.positionsLocalGltf.flat(), 3),
      );
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(surface.triangleIndices.flat());
      geometry.computeVertexNormals();
      generatedGeometries.add(geometry);
      const sourceMaterial = [...ownedSourceMaterials][
        layout.groundSurfaces.indexOf(surface)
      ];
      if (!sourceMaterial)
        throw new Error(`Missing ground material for ${surface.name}`);
      const mesh = new THREE.Mesh(
        geometry,
        appearance.materialFor(sourceMaterial),
      );
      mesh.name = surface.name;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(surfaceMatrix);
      groundGroup.add(mesh);
    }
    setShadowParticipation(groundGroup, { cast: false, receive: true });

    const batchSources = new Map<
      THREE.Object3D,
      Map<THREE.BufferGeometry, Map<BrightvaleSurfaceMaterial, THREE.Matrix4[]>>
    >();
    const splitGeometryCache = new WeakMap<
      THREE.Mesh,
      Map<number, THREE.BufferGeometry>
    >();
    const addPlacement = (
      destination: THREE.Object3D,
      sourceRoot: THREE.Object3D,
      placement: THREE.Matrix4,
    ): void => {
      sourceRoot.updateMatrixWorld(true);
      for (const mesh of meshes(sourceRoot)) {
        for (const part of sourceParts(mesh)) {
          const material = appearance!.materialFor(part.material);
          let byMaterialIndex = splitGeometryCache.get(mesh);
          if (!byMaterialIndex) {
            byMaterialIndex = new Map();
            splitGeometryCache.set(mesh, byMaterialIndex);
          }
          let geometry = byMaterialIndex.get(part.materialIndex);
          if (!geometry) {
            geometry = batchGeometry(part);
            byMaterialIndex.set(part.materialIndex, geometry);
            if (geometry !== mesh.geometry) generatedGeometries.add(geometry);
          }
          let byGeometry = batchSources.get(destination);
          if (!byGeometry)
            batchSources.set(destination, (byGeometry = new Map()));
          let byMaterial = byGeometry.get(geometry);
          if (!byMaterial) byGeometry.set(geometry, (byMaterial = new Map()));
          let sources = byMaterial.get(material);
          if (!sources) byMaterial.set(material, (sources = []));
          // Keep source pose in source-local coordinates for each repeated instance.
          const matrixForMesh = relativeMatrix(sourceRoot, mesh);
          sources.push(placement.clone().multiply(matrixForMesh));
        }
      }
    };

    addPlacement(cityGroup, assets.roots.city, new THREE.Matrix4());
    const framingRoots = {
      long: assets.roots.framingLong,
      post: assets.roots.framingPost,
    };
    for (const placement of layout.framingInstances)
      addPlacement(
        framingGroup,
        framingRoots[placement.module],
        matrix(placement.matrixColumnMajor),
      );

    if (assets.silhouetteCrowd) {
      silhouettes = createSilhouetteCrowd(
        assets.silhouetteCrowd,
        layout.silhouetteCrowdPlacements ?? createSilhouettePilotPlacements(),
        multisampledFramebuffer,
      );
      crowdGroup.add(silhouettes.root);
    }

    for (const [destination, byGeometry] of batchSources) {
      for (const [geometry, byMaterial] of byGeometry) {
        for (const [material, sources] of byMaterial) {
          const batch = new THREE.InstancedMesh(
            geometry,
            material,
            sources.length,
          );
          generatedInstances.add(batch);
          batch.name = `Brightvale.Batch.${material.userData.brightvaleRole ?? material.name}`;
          sources.forEach((placement, index) =>
            batch.setMatrixAt(index, placement),
          );
          batch.instanceMatrix.needsUpdate = true;
          destination.add(batch);
        }
      }
    }

    setShadowParticipation(cityGroup, { cast: true, receive: true });
    setShadowParticipation(framingGroup, { cast: true, receive: true });
    const key = scene.getObjectByName('Brightvale.Key');
    if (!(key instanceof THREE.DirectionalLight))
      throw new Error('Brightvale key light is required for scene shadows');
    fitDirectionalShadowCamera(
      key,
      [cityGroup, playfield, framingGroup],
      groundGroup.children,
    );

    let appearanceState: SceneStateProjection | undefined;
    return {
      root,
      updateAppearance(state, ambience) {
        if (disposed)
          throw new Error('Brightvale composition has been disposed');
        appearanceState = state;
        appearance!.update(appearanceState, ambience);
        silhouettes?.update(ambience?.time ?? 0);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        releaseResources();
      },
    };
  } catch (error) {
    releaseResources();
    throw error;
  }
}
