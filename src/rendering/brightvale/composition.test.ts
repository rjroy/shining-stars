import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  BRIGHTVALE_PRODUCTION_ASSET_URLS,
  loadBrightvaleRuntimeAssets,
} from './assets-runtime';
import {
  BRIGHTVALE_ASSET_NAMES,
  type BrightvaleAssetName,
  type BrightvaleAssets,
} from './assets';
import { createBrightvaleComposition } from './composition';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './layout';
import type { SceneStateProjection } from '../scene-state';

const productionFiles: Readonly<Record<BrightvaleAssetName, string>> = {
  city: '../../../assets/production/brightvale-distant-city/city.glb',
  highway: '../../../assets/production/brightvale-highway/highway.glb',
  platform: '../../../assets/production/brightvale-platform/platform.glb',
  endcaps: '../../../assets/production/brightvale-platform-endcaps/endcaps.glb',
  crowd: '../../../assets/production/brightvale-crowd/crowd.glb',
  framingLong: '../../../assets/production/brightvale-outer-framing/long.glb',
  framingPost: '../../../assets/production/brightvale-outer-framing/post.glb',
};

let loadedAssets: BrightvaleAssets | undefined;

async function loadProductionAssets(): Promise<BrightvaleAssets> {
  const fetch = vi.fn(async (url: string, _signal: AbortSignal) => {
    const name = BRIGHTVALE_ASSET_NAMES.find(
      (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
    );
    if (name === undefined) throw new Error(`Unexpected asset URL: ${url}`);
    const bytes = await readFile(
      new URL(productionFiles[name], import.meta.url),
    );
    return new Response(new Uint8Array(bytes), { status: 200 });
  });
  return loadBrightvaleRuntimeAssets(new AbortController().signal, { fetch });
}

function requireAssets(): BrightvaleAssets {
  if (!loadedAssets)
    throw new Error('real Brightvale GLB fixture did not load');
  return loadedAssets;
}

function makeState(transitionProgress: number): SceneStateProjection {
  return {
    phase: transitionProgress >= 1 ? 'twilight' : 'audience',
    cityIntensity: 0.5,
    cityBrightness: 0.61,
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

function boundsForPlacedRoot(
  root: THREE.Object3D,
  matrix: readonly number[],
): THREE.Box3 {
  const placed = new THREE.Group();
  placed.matrixAutoUpdate = false;
  placed.matrix.fromArray([...matrix]);
  placed.add(root.clone(true));
  placed.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(placed);
}

function unionBounds(bounds: Iterable<THREE.Box3>): THREE.Box3 {
  const result = new THREE.Box3().makeEmpty();
  for (const item of bounds) result.union(item);
  return result;
}

function poseRoot(
  crowd: THREE.Group,
  variant: string,
  pose: string,
): THREE.Object3D {
  const semanticName = `Crowd.${variant}.${pose}`;
  const sanitizedName = THREE.PropertyBinding.sanitizeNodeName(semanticName);
  const matches: THREE.Object3D[] = [];
  crowd.traverse((object) => {
    if (
      object.userData.variant_id === variant &&
      object.userData.pose === pose &&
      (object.userData.name === semanticName ||
        object.userData.pose_id === semanticName ||
        object.name === sanitizedName)
    )
      matches.push(object);
  });
  expect(matches, `unique actual crowd pose ${semanticName}`).toHaveLength(1);
  return matches[0]!;
}

function expectBoundsClose(actual: THREE.Box3, expected: THREE.Box3): void {
  for (const key of ['min', 'max'] as const) {
    const actualValues = actual[key].toArray();
    const expectedValues = expected[key].toArray();
    actualValues.forEach((value, axis) =>
      expect(value, `${key}[${axis}]`).toBeCloseTo(
        expectedValues[axis] ?? NaN,
        3,
      ),
    );
  }
}

function instancesIn(root: THREE.Object3D): THREE.InstancedMesh[] {
  const result: THREE.InstancedMesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh)
      result.push(object as THREE.InstancedMesh);
  });
  return result;
}

function allMaterials(root: THREE.Object3D): THREE.Material[] {
  const result = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material])
      result.add(material);
  });
  return [...result];
}

describe('Brightvale production composition', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadedAssets = await loadProductionAssets();
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(() => {
    loadedAssets?.dispose();
    loadedAssets = undefined;
  });

  it('applies the canonical whole-playfield and city matrices exactly once', () => {
    const assets = requireAssets();
    const scene = new THREE.Scene();
    const composition = createBrightvaleComposition(
      assets,
      BRIGHTVALE_RUNTIME_LAYOUT,
      scene,
    );
    const playfield = composition.root.getObjectByName('Brightvale.Playfield');
    const city = composition.root.getObjectByName('Brightvale.City');
    if (!playfield || !city)
      throw new Error('playfield and city roots are required');

    expect(playfield.matrixAutoUpdate).toBe(false);
    expect(playfield.matrix.toArray()).toEqual(
      new THREE.Matrix4()
        .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor])
        .toArray(),
    );
    expect(city.matrixAutoUpdate).toBe(false);
    expect(city.matrix.toArray()).toEqual(
      new THREE.Matrix4()
        .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.city.matrixColumnMajor])
        .toArray(),
    );
    for (const assetName of ['platform', 'highway', 'endcaps']) {
      const wrapper = composition.root.getObjectByName(
        `Brightvale.Asset.${assetName}`,
      );
      expect(wrapper, `${assetName} wrapper`).toBeDefined();
      expect(wrapper?.matrix.toArray()).toEqual(new THREE.Matrix4().toArray());
    }
    expect(BRIGHTVALE_RUNTIME_LAYOUT.playfield.tiltDegrees).toBe(14);
    expect(composition.root.parent).toBeNull();
    composition.dispose();
  });

  it('retains exact layout ground, framing, and crowd placements with bounded role batches', () => {
    const assets = requireAssets();
    const scene = new THREE.Scene();
    const layout = BRIGHTVALE_RUNTIME_LAYOUT;
    const composition = createBrightvaleComposition(assets, layout, scene);
    const root = composition.root;
    root.updateMatrixWorld(true);
    const cityGroup = root.getObjectByName('Brightvale.City');
    const framingGroup = root.getObjectByName('Brightvale.Framing');
    const crowdGroup = root.getObjectByName('Brightvale.Crowd');
    const groundGroup = root.getObjectByName('Brightvale.Ground');
    if (!cityGroup || !framingGroup || !crowdGroup || !groundGroup)
      throw new Error('all runtime composition groups are required');

    expectBoundsClose(
      new THREE.Box3().setFromObject(cityGroup),
      boundsForPlacedRoot(assets.roots.city, layout.city.matrixColumnMajor),
    );
    const expectedFraming = unionBounds(
      layout.framingInstances.map((placement) =>
        boundsForPlacedRoot(
          assets.roots[
            placement.module === 'long' ? 'framingLong' : 'framingPost'
          ],
          placement.matrixColumnMajor,
        ),
      ),
    );
    expectBoundsClose(
      new THREE.Box3().setFromObject(framingGroup),
      expectedFraming,
    );
    expect(layout.framingInstances).toHaveLength(53);

    const expectedCrowd = unionBounds(
      layout.crowdPlacements.map((placement) =>
        boundsForPlacedRoot(
          poseRoot(assets.roots.crowd, placement.variant, placement.pose),
          placement.matrixColumnMajor,
        ),
      ),
    );
    expectBoundsClose(
      new THREE.Box3().setFromObject(crowdGroup),
      expectedCrowd,
    );
    expect(layout.crowdPlacements).toHaveLength(25);

    const groundMeshes: THREE.Mesh[] = [];
    groundGroup.traverse((object) => {
      if ((object as THREE.Mesh).isMesh)
        groundMeshes.push(object as THREE.Mesh);
    });
    expect(groundMeshes).toHaveLength(layout.groundSurfaces.length);
    for (const surface of layout.groundSurfaces) {
      const mesh = groundMeshes.find(
        (candidate) => candidate.name === surface.name,
      );
      expect(mesh, `${surface.name} mesh`).toBeDefined();
      const positions = mesh?.geometry.getAttribute('position');
      const expectedPositions = surface.positionsLocalGltf.flat();
      expect(Array.from(positions?.array ?? [])).toEqual(
        Array.from(new Float32Array(expectedPositions)),
      );
      expect(Array.from(mesh?.geometry.index?.array ?? [])).toEqual(
        surface.triangleIndices.flat(),
      );
      expect(mesh?.matrix.toArray()).toEqual(
        new THREE.Matrix4().fromArray([...surface.matrixColumnMajor]).toArray(),
      );

      const normals = mesh?.geometry.getAttribute('normal');
      expect(normals, `${surface.name} normals`).toBeDefined();
      if (!mesh || !positions || !normals || !mesh.geometry.index) {
        throw new Error(`${surface.name} ground geometry is incomplete`);
      }
      expect(normals.count).toBe(positions.count);
      for (let vertex = 0; vertex < normals.count; vertex += 1) {
        const normal = new THREE.Vector3().fromBufferAttribute(normals, vertex);
        expect(normal.toArray().every(Number.isFinite)).toBe(true);
        expect(normal.length()).toBeGreaterThan(0);
        expect(normal.length()).toBeCloseTo(1, 5);
      }

      const index = mesh.geometry.index;
      for (let triangle = 0; triangle < index.count; triangle += 3) {
        const vertexIndices = [
          index.getX(triangle),
          index.getX(triangle + 1),
          index.getX(triangle + 2),
        ];
        const [first, second, third] = vertexIndices.map((vertex) =>
          new THREE.Vector3().fromBufferAttribute(positions, vertex),
        );
        const faceNormal = new THREE.Vector3()
          .subVectors(second!, first!)
          .cross(new THREE.Vector3().subVectors(third!, first!));
        expect(faceNormal.length()).toBeGreaterThan(0);
        faceNormal.normalize();
        for (const vertex of vertexIndices) {
          const normal = new THREE.Vector3().fromBufferAttribute(normals, vertex);
          expect(normal.dot(faceNormal)).toBeGreaterThan(0.999);
        }
      }
    }

    const cityBatches = instancesIn(cityGroup);
    const framingBatches = instancesIn(framingGroup);
    const crowdBatches = instancesIn(crowdGroup);
    expect(cityBatches).toHaveLength(288);
    expect(framingBatches).toHaveLength(10);
    expect(crowdBatches).toHaveLength(98);
    expect(cityBatches.reduce((sum, batch) => sum + batch.count, 0)).toBe(1080);
    expect(framingBatches.reduce((sum, batch) => sum + batch.count, 0)).toBe(
      266,
    );
    expect(crowdBatches.reduce((sum, batch) => sum + batch.count, 0)).toBe(350);

    const allBatches = [...cityBatches, ...framingBatches, ...crowdBatches];
    const geometryMaterialPairs = new Set<string>();
    for (const batch of allBatches) {
      expect(Array.isArray(batch.material)).toBe(false);
      const material = batch.material as THREE.Material;
      expect(material).toBeInstanceOf(THREE.MeshToonMaterial);
      expect(material.userData.brightvaleRole).toBeTruthy();
      const pair = `${batch.geometry.uuid}:${material.uuid}`;
      expect(geometryMaterialPairs.has(pair)).toBe(false);
      geometryMaterialPairs.add(pair);
    }
    composition.dispose();
  });

  it('forwards projected appearance state without replacing the assembled root', () => {
    const scene = new THREE.Scene();
    const composition = createBrightvaleComposition(
      requireAssets(),
      BRIGHTVALE_RUNTIME_LAYOUT,
      scene,
    );
    const root = composition.root;
    const batchIdentity = instancesIn(root);
    composition.updateAppearance(makeState(1));
    const pointLight = scene.getObjectByName('Brightvale.Point') as
      THREE.PointLight | undefined;

    expect(pointLight).toBeInstanceOf(THREE.PointLight);
    expect(pointLight?.color.getHex()).toBe(0x966dff);
    expect(composition.root).toBe(root);
    expect(instancesIn(root)).toEqual(batchIdentity);
    composition.dispose();
  });

  it('disposes only composition-owned resources, once, leaving imported assets borrowed', () => {
    const assets = requireAssets();
    let borrowedMesh: THREE.Mesh | undefined;
    assets.roots.city.traverse((object) => {
      if (!borrowedMesh && (object as THREE.Mesh).isMesh)
        borrowedMesh = object as THREE.Mesh;
    });
    if (!borrowedMesh) throw new Error('city GLB fixture must contain a mesh');
    const borrowedGeometry = borrowedMesh.geometry;
    const borrowedMaterial = Array.isArray(borrowedMesh.material)
      ? borrowedMesh.material[0]
      : borrowedMesh.material;
    const borrowedGeometryDispose = vi.spyOn(borrowedGeometry, 'dispose');
    const borrowedMaterialDispose = vi.spyOn(borrowedMaterial, 'dispose');
    const scene = new THREE.Scene();
    const composition = createBrightvaleComposition(
      assets,
      BRIGHTVALE_RUNTIME_LAYOUT,
      scene,
    );
    const batches = instancesIn(composition.root);
    const generatedInstances = batches.map((batch) =>
      vi.spyOn(batch, 'dispose'),
    );
    const generatedGround = composition.root.getObjectByName('Review.Ground');
    const groundGeometry = (generatedGround as THREE.Mesh | undefined)
      ?.geometry;
    if (!groundGeometry)
      throw new Error('generated ground geometry is required');
    const groundDispose = vi.spyOn(groundGeometry, 'dispose');
    const generatedMaterials = allMaterials(composition.root).filter(
      (material) => material instanceof THREE.MeshToonMaterial,
    );
    const toonDisposals = generatedMaterials.map((material) =>
      vi.spyOn(material, 'dispose'),
    );
    const ramp = (generatedMaterials[0] as THREE.MeshToonMaterial | undefined)
      ?.gradientMap;
    if (!ramp) throw new Error('generated shared toon ramp is required');
    const rampDispose = vi.spyOn(ramp, 'dispose');

    composition.dispose();
    composition.dispose();

    for (const dispose of generatedInstances)
      expect(dispose).toHaveBeenCalledTimes(1);
    expect(groundDispose).toHaveBeenCalledTimes(1);
    for (const dispose of toonDisposals)
      expect(dispose).toHaveBeenCalledTimes(1);
    expect(rampDispose).toHaveBeenCalledTimes(1);
    expect(borrowedGeometryDispose).not.toHaveBeenCalled();
    expect(borrowedMaterialDispose).not.toHaveBeenCalled();
    expect(borrowedMesh.geometry).toBe(borrowedGeometry);
    expect(scene.children).toHaveLength(0);
  });

  it('disposes owned allocations and leaves imported resources untouched after assembly fails', () => {
    const assets = requireAssets();
    const scene = new THREE.Scene();
    const originalChildren = [...scene.children];
    let allocatedBatch: THREE.InstancedMesh | undefined;
    let allocatedBatchDispose: ReturnType<typeof vi.spyOn> | undefined;
    const originalAdd = THREE.Group.prototype.add;
    vi.spyOn(THREE.Group.prototype, 'add').mockImplementation(function (
      this: THREE.Group,
      ...objects: THREE.Object3D[]
    ) {
      originalAdd.apply(this, objects);
      const batch = objects.find(
        (object) => (object as THREE.InstancedMesh).isInstancedMesh,
      ) as THREE.InstancedMesh | undefined;
      if (batch) {
        allocatedBatch = batch;
        allocatedBatchDispose = vi.spyOn(batch, 'dispose');
        throw new Error('injected failure after owned batch allocation');
      }
      return this;
    });
    const borrowedMaterials = new Set<THREE.Material>();
    for (const root of Object.values(assets.roots))
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          borrowedMaterials.add(material);
      });
    const borrowedDispose = [...borrowedMaterials].map((material) =>
      vi.spyOn(material, 'dispose'),
    );
    expect(() =>
      createBrightvaleComposition(assets, BRIGHTVALE_RUNTIME_LAYOUT, scene),
    ).toThrow('injected failure after owned batch allocation');
    expect(allocatedBatch).toBeInstanceOf(THREE.InstancedMesh);
    expect(allocatedBatchDispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toEqual(originalChildren);
    for (const dispose of borrowedDispose)
      expect(dispose).not.toHaveBeenCalled();
  });
});
