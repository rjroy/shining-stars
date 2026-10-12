import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import cityUrl from '../../assets/production/brightvale-distant-city/city.glb?url';
import highwayUrl from '../../assets/production/brightvale-highway/highway.glb?url';
import platformUrl from '../../assets/production/brightvale-platform/platform.glb?url';
import endcapsUrl from '../../assets/production/brightvale-platform-endcaps/endcaps.glb?url';
import crowdUrl from '../../assets/production/brightvale-crowd/crowd.glb?url';
import framingLongUrl from '../../assets/production/brightvale-outer-framing/long.glb?url';
import framingPostUrl from '../../assets/production/brightvale-outer-framing/post.glb?url';
import { BRIGHTVALE_ASSET_NAMES, loadBrightvaleAssets } from './assets';
import type {
  BrightvaleAssetName,
  BrightvaleAssetUrls,
  BrightvaleAssets,
  BrightvaleLoaderDependencies,
} from './assets';
import * as THREE from 'three';

/** Vite rewrites these explicit production assets to deployment-aware URLs. */
export const BRIGHTVALE_PRODUCTION_ASSET_URLS: BrightvaleAssetUrls = {
  city: cityUrl,
  highway: highwayUrl,
  platform: platformUrl,
  endcaps: endcapsUrl,
  crowd: crowdUrl,
  framingLong: framingLongUrl,
  framingPost: framingPostUrl,
};

/** Test seam for browser boundary operations; production URLs remain fixed. */
export type BrightvaleRuntimeOverrides = Partial<
  Pick<BrightvaleLoaderDependencies, 'fetch' | 'decode'>
>;

const requiredNodes: Readonly<Record<BrightvaleAssetName, readonly string[]>> = {
  city: ['CITY.ProvisionalLayout'],
  highway: ['Highway | continuous four-channel profiled chassis'],
  platform: ['Platform | continuous sculpted chassis'],
  endcaps: [
    'Endcap | left | sculpted body and gold edging',
    'Endcap | right | sculpted body and gold edging',
  ],
  crowd: [
    'Crowd.A.Calm',
    'Crowd.A.Cheering',
    'Crowd.A.Reaching',
    'Crowd.B.Calm',
    'Crowd.B.Cheering',
    'Crowd.B.Reaching',
    'Crowd.C.Calm',
    'Crowd.C.Cheering',
    'Crowd.C.Reaching',
  ],
  framingLong: ['Framing | long masonry section'],
  framingPost: [
    'Framing | post inset amber lens',
    'Framing | post stone pier',
    'Framing | post warm metal bezel',
  ],
};

const requiredMaterials: Readonly<Record<BrightvaleAssetName, readonly string[]>> = {
  city: ['Window'],
  highway: ['Highway lanes | quiet midnight enamel.001'],
  platform: ['Hit | cyan pure emitter'],
  endcaps: ['Endcap body | midnight-blue enamel', 'Endcap edging | warm brushed gold'],
  crowd: ['Skin'],
  framingLong: ['Framing | midnight stone'],
  framingPost: ['Framing | amber lens', 'Framing | warm metal'],
};

/** Checks stable names exported in the production GLBs without assuming root shape. */
export function validateBrightvaleAsset(
  name: BrightvaleAssetName,
  root: THREE.Group,
): void {
  if (!(root instanceof THREE.Group)) {
    throw new Error(`Brightvale asset "${name}" did not decode to a scene group`);
  }

  const nodes = new Map<string, THREE.Object3D[]>();
  const crowdPoseNodes = new Map<string, THREE.Object3D[]>();
  const materials = new Set<string>();
  let hasMesh = false;
  let transformError: string | undefined;
  let vertexError: string | undefined;
  root.traverse((object) => {
    if (object.name.length > 0) {
      const normalizedName = THREE.PropertyBinding.sanitizeNodeName(object.name);
      const namedObjects = nodes.get(normalizedName) ?? [];
      namedObjects.push(object);
      nodes.set(normalizedName, namedObjects);
    }
    const poseId = object.userData.pose_id;
    if (typeof poseId === 'string') {
      const poseObjects = crowdPoseNodes.get(poseId) ?? [];
      poseObjects.push(object);
      crowdPoseNodes.set(poseId, poseObjects);
    }
    const transformValues = [
      object.position.x,
      object.position.y,
      object.position.z,
      object.quaternion.x,
      object.quaternion.y,
      object.quaternion.z,
      object.quaternion.w,
      object.scale.x,
      object.scale.y,
      object.scale.z,
      ...object.matrix.elements,
    ];
    if (transformValues.some((value) => !Number.isFinite(value))) {
      transformError = `Brightvale asset "${name}" contains a non-finite transform at "${object.name || '(unnamed)'}"`;
    }

    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    hasMesh = true;
    const positions = mesh.geometry.getAttribute('position');
    if (positions === undefined || positions.itemSize < 3) {
      vertexError ??= `Brightvale asset "${name}" has invalid position data at "${object.name || '(unnamed)'}"`;
    } else {
      for (let index = 0; index < positions.count; index += 1) {
        if (
          !Number.isFinite(positions.getX(index)) ||
          !Number.isFinite(positions.getY(index)) ||
          !Number.isFinite(positions.getZ(index))
        ) {
          vertexError ??= `Brightvale asset "${name}" contains a non-finite vertex ${index} at "${object.name || '(unnamed)'}"`;
          break;
        }
      }
    }

    const bounds = mesh.geometry.boundingBox;
    if (
      bounds !== null &&
      [
        bounds.min.x,
        bounds.min.y,
        bounds.min.z,
        bounds.max.x,
        bounds.max.y,
        bounds.max.z,
      ].some((value) => !Number.isFinite(value))
    ) {
      vertexError ??= `Brightvale asset "${name}" contains non-finite geometry bounds at "${object.name || '(unnamed)'}"`;
    }

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (material?.name) materials.add(material.name);
    }
  });

  if (transformError) throw new Error(transformError);
  if (vertexError) throw new Error(vertexError);
  for (const nodeName of requiredNodes[name]) {
    const normalizedName = THREE.PropertyBinding.sanitizeNodeName(nodeName);
    const namedObjects = nodes.get(normalizedName) ?? [];
    const poseObjects =
      name === 'crowd'
        ? crowdPoseNodes
            .get(nodeName)
            ?.filter(
              (object) =>
                THREE.PropertyBinding.sanitizeNodeName(object.name) === normalizedName,
            )
        : undefined;
    const candidates =
      name === 'crowd' && crowdPoseNodes.size > 0
        ? (poseObjects ?? [])
        : namedObjects;

    // GLTFLoader may represent a named Group with a direct, same-named Mesh child.
    // Treat that wrapper pair as one source node, but reject sibling/nested collisions.
    const groups = candidates.filter((object) => object instanceof THREE.Group);
    const selected = groups.length === 1 ? groups[0] : undefined;
    const ambiguous =
      groups.length > 1 ||
      (selected !== undefined &&
        candidates.some(
          (object) =>
            object !== selected &&
            !(object instanceof THREE.Mesh && object.parent === selected),
        )) ||
      (selected === undefined && candidates.length > 1);
    if (candidates.length === 0) {
      throw new Error(`Brightvale asset "${name}" is missing required node "${nodeName}"`);
    }
    if (ambiguous) {
      throw new Error(
        `Brightvale asset "${name}" has ambiguous objects for required node "${nodeName}"`,
      );
    }
  }
  for (const materialName of requiredMaterials[name]) {
    if (!materials.has(materialName)) {
      throw new Error(
        `Brightvale asset "${name}" is missing required material role "${materialName}"`,
      );
    }
  }
  if (!hasMesh) throw new Error(`Brightvale asset "${name}" has no mesh content`);
}

function assertSelfContainedGlb(bytes: ArrayBuffer, name: BrightvaleAssetName): void {
  if (bytes.byteLength < 20) {
    throw new Error(`Brightvale asset "${name}" is not a complete GLB file`);
  }
  const view = new DataView(bytes);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  const jsonChunkLength = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  if (
    magic !== 0x46546c67 ||
    version !== 2 ||
    declaredLength !== bytes.byteLength ||
    jsonChunkType !== 0x4e4f534a ||
    jsonChunkLength > bytes.byteLength - 20
  ) {
    throw new Error(`Brightvale asset "${name}" has an invalid GLB header`);
  }

  let document: {
    buffers?: readonly { uri?: unknown }[];
    images?: readonly { uri?: unknown }[];
  };
  try {
    const json = new TextDecoder().decode(new Uint8Array(bytes, 20, jsonChunkLength));
    document = JSON.parse(json.replace(/[\u0000\u0020]+$/g, '')) as typeof document;
  } catch (error) {
    throw new Error(`Brightvale asset "${name}" has invalid GLB JSON`, { cause: error });
  }

  const hasExternalUri = [
    ...(document.buffers ?? []),
    ...(document.images ?? []),
  ].some((resource) => resource.uri !== undefined);
  if (hasExternalUri) {
    throw new Error(
      `Brightvale asset "${name}" references an external resource; only self-contained GLBs are supported`,
    );
  }
}

async function parseBrightvaleGlb(
  bytes: ArrayBuffer,
  name: BrightvaleAssetName,
  url: string,
  loader: GLTFLoader,
): Promise<THREE.Group> {
  assertSelfContainedGlb(bytes, name);
  const basePath = new URL('.', new URL(url, 'https://brightvale.invalid/')).href;
  const parsed = await loader.parseAsync(bytes, basePath);
  if (!(parsed.scene instanceof THREE.Group)) {
    throw new Error(`Brightvale asset "${name}" did not contain a default scene`);
  }
  return parsed.scene;
}

/** Loads and validates the production bundle using per-call GLTFLoader state. */
export async function loadBrightvaleRuntimeAssets(
  signal: AbortSignal,
  overrides: BrightvaleRuntimeOverrides = {},
): Promise<BrightvaleAssets> {
  const loader = new GLTFLoader();
  const fetchAsset =
    overrides.fetch ??
    (async (url: string, assetSignal: AbortSignal) =>
      fetch(url, { signal: assetSignal }));
  const decodeAsset =
    overrides.decode ??
    ((bytes: ArrayBuffer, name: BrightvaleAssetName) =>
      parseBrightvaleGlb(bytes, name, BRIGHTVALE_PRODUCTION_ASSET_URLS[name], loader));

  const dependencies: BrightvaleLoaderDependencies = {
    urls: BRIGHTVALE_PRODUCTION_ASSET_URLS,
    fetch: async (url, assetSignal) => {
      const name = BRIGHTVALE_ASSET_NAMES.find(
        (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
      );
      if (name === undefined) throw new Error(`Unknown Brightvale asset URL: ${url}`);
      console.info(`[Brightvale] ${name} asset load attempt`, { url });
      try {
        const response = await fetchAsset(url, assetSignal);
        if (!response.ok) {
          console.error(`[Brightvale] ${name} asset load failed`, {
            status: response.status,
            url,
          });
        }
        return response;
      } catch (error) {
        console.error(`[Brightvale] ${name} asset load failed`, { error, url });
        throw error;
      }
    },
    decode: async (bytes, name) => {
      try {
        return await decodeAsset(bytes, name);
      } catch (error) {
        console.error(`[Brightvale] ${name} asset load failed`, { error });
        throw error;
      }
    },
    validate: (name, root) => {
      try {
        validateBrightvaleAsset(name, root);
        console.info(`[Brightvale] ${name} asset loaded successfully`);
      } catch (error) {
        console.error(`[Brightvale] ${name} asset load failed`, { error });
        throw error;
      }
    },
  };

  return loadBrightvaleAssets(signal, dependencies);
}
