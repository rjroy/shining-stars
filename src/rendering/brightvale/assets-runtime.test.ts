import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIGHTVALE_PRODUCTION_ASSET_URLS,
  loadBrightvaleRuntimeAssets,
  validateBrightvaleAsset,
  type BrightvaleRuntimeOverrides,
} from './assets-runtime';
import { BRIGHTVALE_ASSET_NAMES, type BrightvaleAssetName } from './assets';

function makeSkyTextures() {
  const makeTexture = (): THREE.DataTexture => {
    const texture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    texture.needsUpdate = true;
    return texture;
  };
  const warm = makeTexture();
  const twilight = makeTexture();
  return {
    warm,
    twilight,
    dispose: vi.fn(() => {
      warm.dispose();
      twilight.dispose();
    }),
  };
}

const sourceFiles: Record<BrightvaleAssetName, string> = {
  city: 'brightvale-city/city-meshopt.glb',
  highway: 'brightvale-highway/highway.glb',
  platform: 'brightvale-platform/platform.glb',
  endcaps: 'brightvale-platform-endcaps/endcaps.glb',
  framingLong: 'brightvale-outer-framing/long.glb',
  framingPost: 'brightvale-outer-framing/post.glb',
};

const requiredNodes: Record<BrightvaleAssetName, readonly string[]> = {
  city: ['CITY.ProvisionalLayout'],
  highway: ['Highway | continuous four-channel profiled chassis'],
  platform: ['Platform | continuous sculpted chassis'],
  endcaps: [
    'Endcap | left | sculpted body and gold edging',
    'Endcap | right | sculpted body and gold edging',
  ],
  framingLong: ['Framing | long masonry section'],
  framingPost: [
    'Framing | post inset amber lens',
    'Framing | post stone pier',
    'Framing | post warm metal bezel',
  ],
};

const requiredMaterials: Record<BrightvaleAssetName, readonly string[]> = {
  city: ['Window'],
  highway: ['Highway lanes | quiet midnight enamel.001'],
  platform: ['Hit | cyan pure emitter'],
  endcaps: [
    'Endcap body | midnight-blue enamel',
    'Endcap edging | warm brushed gold',
  ],
  framingLong: ['Framing | midnight stone'],
  framingPost: ['Framing | amber lens', 'Framing | warm metal'],
};

const productionFiles: Record<BrightvaleAssetName, string> = {
  city: '../../../assets/production/brightvale-city/city-meshopt.glb',
  highway: '../../../assets/production/brightvale-highway/highway.glb',
  platform: '../../../assets/production/brightvale-platform/platform.glb',
  endcaps: '../../../assets/production/brightvale-platform-endcaps/endcaps.glb',
  framingLong: '../../../assets/production/brightvale-outer-framing/long.glb',
  framingPost: '../../../assets/production/brightvale-outer-framing/post.glb',
};

function makeSourceShapedRoot(
  name: BrightvaleAssetName,
  options: {
    omitNode?: string;
    omitMaterial?: string;
    nonFinitePosition?: boolean;
    nonFiniteVertex?: number;
  } = {},
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Scene';
  const materialNames = requiredMaterials[name].filter(
    (material) => material !== options.omitMaterial,
  );
  const materials = new Map(
    materialNames.map((materialName) => {
      const material = new THREE.MeshStandardMaterial();
      material.name = materialName;
      return [materialName, material];
    }),
  );

  const requiredNodeNames = requiredNodes[name];
  const allMaterials = [...materials.values()];
  for (const [index, nodeName] of requiredNodeNames.entries()) {
    if (nodeName === options.omitNode) continue;
    const node = new THREE.Group();
    node.name = nodeName;
    if (options.nonFinitePosition && nodeName === requiredNodes[name][0]) {
      node.position.x = Number.NaN;
    }
    const material = allMaterials[index % allMaterials.length];
    if (material !== undefined) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.name = nodeName;
      if (index === 0 && options.nonFiniteVertex !== undefined) {
        mesh.geometry.attributes.position.setX(0, options.nonFiniteVertex);
      }
      node.add(mesh);
    }
    if (index === 0) {
      for (const additionalMaterial of allMaterials.slice(1)) {
        node.add(
          new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), additionalMaterial),
        );
      }
    }
    root.add(node);
  }
  return root;
}

function makeOverrides(): BrightvaleRuntimeOverrides {
  return {
    fetch: vi.fn(
      async (_url: string, _signal: AbortSignal) =>
        new Response(new ArrayBuffer(0), { status: 200 }),
    ),
    decode: vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) =>
      makeSourceShapedRoot(name),
    ),
    loadSkyTextures: vi.fn(async () => makeSkyTextures()),
    loadGroundTextures: vi.fn(async () => ({
      city: new THREE.Texture(),
      plaza: new THREE.Texture(),
      dispose: vi.fn(),
    })),
  };
}

function corruptFirstMeshoptView(bytes: Buffer): Buffer {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(
    bytes.toString('utf8', 20, 20 + jsonLength).trim(),
  ) as {
    bufferViews: Array<{
      extensions?: {
        EXT_meshopt_compression?: { byteOffset: number };
      };
    }>;
  };
  const compressedView = json.bufferViews.find(
    (view) => view.extensions?.EXT_meshopt_compression,
  );
  if (!compressedView?.extensions?.EXT_meshopt_compression)
    throw new Error('Compressed city fixture has no Meshopt extension');
  compressedView.extensions.EXT_meshopt_compression.byteOffset =
    Number.MAX_SAFE_INTEGER;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPaddedLength = (jsonBytes.length + 3) & ~3;
  const oldBinHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(oldBinHeader);
  const bin = bytes.subarray(oldBinHeader, oldBinHeader + 8 + binLength);
  const totalLength = 12 + 8 + jsonPaddedLength + bin.length;
  const result = Buffer.alloc(totalLength);
  result.write('glTF', 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(totalLength, 8);
  result.writeUInt32LE(jsonPaddedLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonPaddedLength);
  jsonBytes.copy(result, 20);
  bin.copy(result, 20 + jsonPaddedLength);
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe('Brightvale production runtime asset boundary', () => {
  it('maps each named root to its explicit production GLB URL', () => {
    expect(Object.keys(BRIGHTVALE_PRODUCTION_ASSET_URLS).sort()).toEqual(
      [...BRIGHTVALE_ASSET_NAMES].sort(),
    );
    for (const name of BRIGHTVALE_ASSET_NAMES) {
      const pathname = new URL(
        BRIGHTVALE_PRODUCTION_ASSET_URLS[name],
        import.meta.url,
      ).pathname;
      const expectedPath = sourceFiles[name].replace('.glb', '');
      expect(pathname).toMatch(
        new RegExp(`(?:^|/)${expectedPath}(?:-[a-zA-Z0-9_-]+)?\\.glb$`),
      );
    }
  });

  it('accepts source-shaped roots with documented hierarchy and material roles', () => {
    for (const name of BRIGHTVALE_ASSET_NAMES) {
      expect(() =>
        validateBrightvaleAsset(name, makeSourceShapedRoot(name)),
      ).not.toThrow();
    }
  });

  it('rejects a missing required hierarchy node or semantic material role', () => {
    expect(() =>
      validateBrightvaleAsset(
        'city',
        makeSourceShapedRoot('city', { omitNode: 'CITY.ProvisionalLayout' }),
      ),
    ).toThrow(/CITY\.ProvisionalLayout/);
    expect(() =>
      validateBrightvaleAsset(
        'platform',
        makeSourceShapedRoot('platform', {
          omitMaterial: 'Hit | cyan pure emitter',
        }),
      ),
    ).toThrow(/Hit \| cyan pure emitter/);
  });

  it('rejects non-finite transforms anywhere below a required root', () => {
    expect(() =>
      validateBrightvaleAsset(
        'framingPost',
        makeSourceShapedRoot('framingPost', { nonFinitePosition: true }),
      ),
    ).toThrow(/finite|non-finite/i);
  });

  it('uses injected browser-boundary seams and logs each asset attempt and outcome', async () => {
    const skyTextures = makeSkyTextures();
    const groundTextures = {
      city: new THREE.Texture(),
      plaza: new THREE.Texture(),
      dispose: vi.fn(),
    };
    const overrides: BrightvaleRuntimeOverrides = {
      ...makeOverrides(),
      loadSkyTextures: vi.fn(async () => skyTextures),
      loadGroundTextures: vi.fn(async () => groundTextures),
    };
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const assets = await loadBrightvaleRuntimeAssets(
      new AbortController().signal,
      overrides,
    );

    expect(Object.keys(assets.roots).sort()).toEqual(
      [...BRIGHTVALE_ASSET_NAMES].sort(),
    );
    expect(assets.skyTextures).toBe(skyTextures);
    expect(assets.groundTextures).toBe(groundTextures);
    expect(overrides.fetch).toHaveBeenCalledTimes(
      BRIGHTVALE_ASSET_NAMES.length,
    );
    expect(overrides.decode).toHaveBeenCalledTimes(
      BRIGHTVALE_ASSET_NAMES.length,
    );
    for (const name of BRIGHTVALE_ASSET_NAMES) {
      expect(overrides.fetch).toHaveBeenCalledWith(
        BRIGHTVALE_PRODUCTION_ASSET_URLS[name],
        expect.any(AbortSignal),
      );
      const messages = log.mock.calls.map((args) => args.map(String).join(' '));
      expect(
        messages.some(
          (message) =>
            message.includes(name) && /attempt|loading/i.test(message),
        ),
      ).toBe(true);
      expect(
        messages.some(
          (message) =>
            message.includes(name) && /success|loaded/i.test(message),
        ),
      ).toBe(true);
    }
    assets.dispose();
    assets.dispose();
    expect(skyTextures.dispose).toHaveBeenCalledTimes(1);
    expect(groundTextures.dispose).toHaveBeenCalledTimes(1);
  });

  it('loads and validates all production GLBs through the installed GLTFLoader', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = vi.fn(async (url: string, _signal: AbortSignal) => {
      const name = BRIGHTVALE_ASSET_NAMES.find(
        (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
      );
      if (name === undefined)
        throw new Error(`Unexpected production URL: ${url}`);
      const bytes = await readFile(
        new URL(productionFiles[name], import.meta.url),
      );
      return new Response(new Uint8Array(bytes), { status: 200 });
    });

    const assets = await loadBrightvaleRuntimeAssets(
      new AbortController().signal,
      {
        fetch,
        loadSkyTextures: async () => makeSkyTextures(),
        loadGroundTextures: async () => ({
          city: new THREE.Texture(),
          plaza: new THREE.Texture(),
          dispose() {},
        }),
      },
    );

    try {
      expect(Object.keys(assets.roots).sort()).toEqual(
        [...BRIGHTVALE_ASSET_NAMES].sort(),
      );
      for (const name of BRIGHTVALE_ASSET_NAMES) {
        expect(assets.roots[name].children.length).toBeGreaterThan(0);
      }
      const cityMaterials = new Map<string, THREE.Material>();
      let cityMeshes = 0;
      let cityTriangles = 0;
      assets.roots.city.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        cityMeshes += 1;
        const index = object.geometry.index;
        cityTriangles += (index?.count ?? 0) / 3;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials)
          cityMaterials.set(material.name, material);
      });
      expect(cityMeshes).toBe(2304);
      expect(cityTriangles).toBe(2_589_764);
      expect(cityMaterials.size).toBe(107);
      expect(cityMaterials.get('Window')).toBeDefined();
      expect(
        [...cityMaterials.values()].filter(
          (material) =>
            material.userData.city_role === 'emissive_window' &&
            material instanceof THREE.MeshStandardMaterial &&
            material.emissiveIntensity > 0,
        ),
      ).toHaveLength(9);
      expect(fetch).toHaveBeenCalledTimes(BRIGHTVALE_ASSET_NAMES.length);
    } finally {
      assets.dispose();
    }
  });

  it('rejects corrupt Meshopt payloads and releases acquired textures', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const corruptCity = corruptFirstMeshoptView(
      await readFile(new URL(productionFiles.city, import.meta.url)),
    );
    const skyTextures = makeSkyTextures();
    const groundTextures = {
      city: new THREE.Texture(),
      plaza: new THREE.Texture(),
      dispose: vi.fn(),
    };
    const result = await loadBrightvaleRuntimeAssets(
      new AbortController().signal,
      {
        fetch: async (url, _signal) => {
          const name = BRIGHTVALE_ASSET_NAMES.find(
            (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
          );
          if (!name) throw new Error(`Unexpected production URL: ${url}`);
          const bytes =
            name === 'city'
              ? corruptCity
              : await readFile(new URL(productionFiles[name], import.meta.url));
          return new Response(new Uint8Array(bytes), { status: 200 });
        },
        loadSkyTextures: async () => skyTextures,
        loadGroundTextures: async () => groundTextures,
      },
    ).then(
      (assets) => ({ kind: 'loaded' as const, assets }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    );
    if (result.kind === 'loaded') result.assets.dispose();
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.error).toBeInstanceOf(Error);
    expect(skyTextures.dispose).toHaveBeenCalledTimes(1);
    expect(groundTextures.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ])(
    'rejects a source-shaped asset with a non-finite vertex ($label) and disposes it',
    async ({ value }) => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const invalidRoot = makeSourceShapedRoot('platform', {
        nonFiniteVertex: value,
      });
      let invalidMesh: THREE.Mesh | undefined;
      invalidRoot.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) invalidMesh = object as THREE.Mesh;
      });
      if (invalidMesh === undefined)
        throw new Error('Fixture is missing its platform mesh');
      const geometryDispose = vi.spyOn(invalidMesh.geometry, 'dispose');
      const materials = Array.isArray(invalidMesh.material)
        ? invalidMesh.material
        : [invalidMesh.material];
      const materialDispose = materials.map((material) =>
        vi.spyOn(material, 'dispose'),
      );
      const overrides: BrightvaleRuntimeOverrides = {
        ...makeOverrides(),
        decode: vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) =>
          name === 'platform' ? invalidRoot : makeSourceShapedRoot(name),
        ),
      };

      const result = await loadBrightvaleRuntimeAssets(
        new AbortController().signal,
        overrides,
      ).then(
        (assets) => ({ kind: 'loaded' as const, assets }),
        (error: unknown) => ({ kind: 'failed' as const, error }),
      );
      if (result.kind === 'loaded') result.assets.dispose();

      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toMatch(
          /non-finite.*vertex|vertex.*non-finite/i,
        );
      }
      expect(geometryDispose).toHaveBeenCalledTimes(1);
      expect(materialDispose.map((spy) => spy.mock.calls.length)).toEqual(
        materials.map(() => 1),
      );
    },
  );
});
