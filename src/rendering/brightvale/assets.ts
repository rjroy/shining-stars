import * as THREE from 'three';

/** Required production GLBs; the reusable short framing section is optional stock. */
export const BRIGHTVALE_ASSET_NAMES = [
  'city',
  'highway',
  'platform',
  'endcaps',
  'framingLong',
  'framingPost',
] as const;

export type BrightvaleAssetName = (typeof BRIGHTVALE_ASSET_NAMES)[number];
export type BrightvaleAssetUrls = Readonly<Record<BrightvaleAssetName, string>>;

export interface BrightvaleAssets {
  readonly roots: Readonly<Record<BrightvaleAssetName, THREE.Group>>;
  /** Runtime sky overlays loaded by the renderer; generic loader fixtures may omit them. */
  readonly skyTextures?: BrightvaleSkyTextures;
  /** Flat ground maps owned by the runtime bundle. */
  readonly groundTextures?: BrightvaleGroundTextures;
  /** Optional stock for gameplay; borrowed by compositions, owned by this bundle. */
  readonly silhouetteCrowd?: BrightvaleSilhouetteCrowdAssets;
  /** Releases imported resources owned by this bundle; safe to call repeatedly. */
  dispose(): void;
}

export interface BrightvaleSilhouetteCrowdAssets {
  readonly texture: THREE.Texture;
  readonly metadata: BrightvaleSilhouetteAtlas;
}

export interface BrightvaleSilhouetteAtlas {
  readonly schema: string;
  readonly atlas: {
    readonly width: number;
    readonly height: number;
    readonly gutter_px: number;
  };
  readonly coordinates: { readonly source_pixels_per_unit: number };
  readonly parts: readonly {
    readonly id: string;
    readonly card_bounds_local: readonly number[];
    readonly uv_rect_bottom_left: readonly number[];
  }[];
  readonly figures: readonly {
    readonly id: string;
    readonly body_part: string;
    readonly arm_part: string;
    readonly shoulder_body_local: readonly number[];
    readonly grip_arm_local: readonly number[];
    readonly stick_top_arm_local: readonly number[];
    readonly stick_bottom_arm_local: readonly number[];
  }[];
}

export interface BrightvaleGroundTextures {
  readonly city: THREE.Texture;
  readonly plaza: THREE.Texture;
  dispose(): void;
}

export interface BrightvaleSkyTextures {
  readonly warm: THREE.Texture;
  readonly twilight: THREE.Texture;
  /** Releases these textures; safe to call repeatedly. */
  dispose(): void;
}

export interface BrightvaleLoaderDependencies {
  readonly urls: BrightvaleAssetUrls;
  readonly fetch: (url: string, signal: AbortSignal) => Promise<Response>;
  readonly decode: (
    bytes: ArrayBuffer,
    name: BrightvaleAssetName,
  ) => Promise<THREE.Group>;
  readonly validate?: (name: BrightvaleAssetName, root: THREE.Group) => void;
}

type OwnedResource = { dispose?(): void; close?(): void };

function abortError(): DOMException {
  return new DOMException('Brightvale asset loading was aborted', 'AbortError');
}

function collectMaterialTextures(
  value: unknown,
  resources: Set<OwnedResource>,
  visited: Set<object>,
): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  if ('isTexture' in value && value.isTexture === true) {
    const texture = value as THREE.Texture;
    resources.add(texture);
    collectClosableImages(texture.source.data, resources);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value)
      collectMaterialTextures(entry, resources, visited);
    return;
  }
  for (const entry of Object.values(value)) {
    collectMaterialTextures(entry, resources, visited);
  }
}

function collectClosableImages(
  value: unknown,
  resources: Set<OwnedResource>,
): void {
  if (Array.isArray(value)) {
    for (const image of value) collectClosableImages(image, resources);
    return;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'close' in value &&
    typeof value.close === 'function'
  ) {
    resources.add(value as OwnedResource);
  }
}

function collectRootResources(root: THREE.Group): Set<OwnedResource> {
  const resources = new Set<OwnedResource>();
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (renderable.geometry?.isBufferGeometry)
      resources.add(renderable.geometry);

    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material === undefined
        ? []
        : [renderable.material];
    for (const material of materials) {
      if (!material?.isMaterial) continue;
      resources.add(material);
      collectMaterialTextures(material, resources, new Set());
    }
  });
  return resources;
}

function disposeResources(
  resources: Iterable<OwnedResource>,
  disposed: Set<OwnedResource>,
): void {
  for (const resource of resources) {
    if (disposed.has(resource)) continue;
    disposed.add(resource);
    try {
      if (typeof resource.dispose === 'function') resource.dispose();
      else resource.close?.();
    } catch {
      // Continue releasing the remaining imported resources if one release hook throws.
    }
  }
}

/** Loads the required bundle with per-call cancellation and imported-resource ownership. */
export async function loadBrightvaleAssets(
  signal: AbortSignal,
  dependencies: BrightvaleLoaderDependencies,
): Promise<BrightvaleAssets> {
  if (signal.aborted) throw abortError();

  const controller = new AbortController();
  const roots = new Map<BrightvaleAssetName, THREE.Group>();
  const ownedResources = new Set<OwnedResource>();
  const disposedResources = new Set<OwnedResource>();
  let failure: unknown;
  let isTerminal = false;

  const disposeOwnedResources = (): void => {
    disposeResources(ownedResources, disposedResources);
  };

  let rejectExternalAbort!: (reason: unknown) => void;
  const externalAbort = new Promise<never>((_resolve, reject) => {
    rejectExternalAbort = reject;
  });
  const onAbort = (): void => {
    if (isTerminal) return;
    failure = abortError();
    controller.abort();
    disposeOwnedResources();
    rejectExternalAbort(failure);
  };
  signal.addEventListener('abort', onAbort, { once: true });

  const throwIfAborted = (): void => {
    if (signal.aborted) throw abortError();
    if (controller.signal.aborted) throw failure ?? abortError();
  };

  const loadOne = async (name: BrightvaleAssetName): Promise<void> => {
    try {
      throwIfAborted();
      const response = await dependencies.fetch(
        dependencies.urls[name],
        controller.signal,
      );
      throwIfAborted();
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Brightvale asset "${name}": HTTP ${response.status}`,
        );
      }

      const bytes = await response.arrayBuffer();
      throwIfAborted();
      const root = await dependencies.decode(bytes, name);
      const resources = collectRootResources(root);
      for (const resource of resources) ownedResources.add(resource);
      if (signal.aborted || controller.signal.aborted) {
        disposeResources(resources, disposedResources);
        throwIfAborted();
      }
      dependencies.validate?.(name, root);
      roots.set(name, root);
    } catch (error) {
      if (!isTerminal && !signal.aborted && !controller.signal.aborted) {
        failure = error;
        controller.abort();
        disposeOwnedResources();
      }
      throw signal.aborted ? abortError() : (failure ?? error);
    }
  };

  try {
    await Promise.race([
      Promise.all(BRIGHTVALE_ASSET_NAMES.map((name) => loadOne(name))),
      externalAbort,
    ]);
    throwIfAborted();

    const namedRoots = Object.fromEntries(
      BRIGHTVALE_ASSET_NAMES.map((name) => [name, roots.get(name)!]),
    ) as Record<BrightvaleAssetName, THREE.Group>;
    let bundleDisposed = false;
    isTerminal = true;
    return {
      roots: namedRoots,
      dispose(): void {
        if (bundleDisposed) return;
        bundleDisposed = true;
        disposeOwnedResources();
      },
    };
  } catch (error) {
    isTerminal = true;
    controller.abort();
    disposeOwnedResources();
    throw signal.aborted ? abortError() : (failure ?? error);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
