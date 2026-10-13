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

const sourceFiles: Record<BrightvaleAssetName, string> = {
  city: 'brightvale-distant-city/city.glb',
  highway: 'brightvale-highway/highway.glb',
  platform: 'brightvale-platform/platform.glb',
  endcaps: 'brightvale-platform-endcaps/endcaps.glb',
  crowd: 'brightvale-crowd/crowd.glb',
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
  crowd: [
    'Crowd.A.Calm', 'Crowd.A.Cheering', 'Crowd.A.Reaching',
    'Crowd.B.Calm', 'Crowd.B.Cheering', 'Crowd.B.Reaching',
    'Crowd.C.Calm', 'Crowd.C.Cheering', 'Crowd.C.Reaching',
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
  endcaps: ['Endcap body | midnight-blue enamel', 'Endcap edging | warm brushed gold'],
  crowd: ['Skin'],
  framingLong: ['Framing | midnight stone'],
  framingPost: ['Framing | amber lens', 'Framing | warm metal'],
};

const productionFiles: Record<BrightvaleAssetName, string> = {
  city: '../../assets/production/brightvale-distant-city/city.glb',
  highway: '../../assets/production/brightvale-highway/highway.glb',
  platform: '../../assets/production/brightvale-platform/platform.glb',
  endcaps: '../../assets/production/brightvale-platform-endcaps/endcaps.glb',
  crowd: '../../assets/production/brightvale-crowd/crowd.glb',
  framingLong: '../../assets/production/brightvale-outer-framing/long.glb',
  framingPost: '../../assets/production/brightvale-outer-framing/post.glb',
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
      mesh.name = name === 'crowd' ? `${nodeName}.Surface` : nodeName;
      if (index === 0 && options.nonFiniteVertex !== undefined) {
        mesh.geometry.attributes.position.setX(0, options.nonFiniteVertex);
      }
      node.add(mesh);
    }
    if (index === 0) {
      for (const additionalMaterial of allMaterials.slice(1)) {
        node.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), additionalMaterial));
      }
    }
    root.add(node);
  }
  return root;
}

function makeOverrides(): BrightvaleRuntimeOverrides {
  return {
    fetch: vi.fn(async (_url: string, _signal: AbortSignal) =>
      new Response(new ArrayBuffer(0), { status: 200 }),
    ),
    decode: vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) =>
      makeSourceShapedRoot(name),
    ),
  };
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
      expect(() => validateBrightvaleAsset(name, makeSourceShapedRoot(name))).not.toThrow();
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
        makeSourceShapedRoot('platform', { omitMaterial: 'Hit | cyan pure emitter' }),
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
    const overrides = makeOverrides();
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const assets = await loadBrightvaleRuntimeAssets(
      new AbortController().signal,
      overrides,
    );

    expect(Object.keys(assets.roots).sort()).toEqual([...BRIGHTVALE_ASSET_NAMES].sort());
    expect(overrides.fetch).toHaveBeenCalledTimes(BRIGHTVALE_ASSET_NAMES.length);
    expect(overrides.decode).toHaveBeenCalledTimes(BRIGHTVALE_ASSET_NAMES.length);
    for (const name of BRIGHTVALE_ASSET_NAMES) {
      expect(overrides.fetch).toHaveBeenCalledWith(
        BRIGHTVALE_PRODUCTION_ASSET_URLS[name],
        expect.any(AbortSignal),
      );
      const messages = log.mock.calls.map((args) => args.map(String).join(' '));
      expect(messages.some((message) => message.includes(name) && /attempt|loading/i.test(message))).toBe(true);
      expect(messages.some((message) => message.includes(name) && /success|loaded/i.test(message))).toBe(true);
    }
    assets.dispose();
  });

  it('loads and validates all seven real production GLBs through the installed GLTFLoader', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = vi.fn(async (url: string, _signal: AbortSignal) => {
      const name = BRIGHTVALE_ASSET_NAMES.find(
        (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
      );
      if (name === undefined) throw new Error(`Unexpected production URL: ${url}`);
      const bytes = await readFile(new URL(productionFiles[name], import.meta.url));
      return new Response(new Uint8Array(bytes), { status: 200 });
    });

    const assets = await loadBrightvaleRuntimeAssets(
      new AbortController().signal,
      { fetch },
    );

    try {
      expect(Object.keys(assets.roots).sort()).toEqual([...BRIGHTVALE_ASSET_NAMES].sort());
      for (const name of BRIGHTVALE_ASSET_NAMES) {
        expect(assets.roots[name].children.length).toBeGreaterThan(0);
      }
      expect(fetch).toHaveBeenCalledTimes(BRIGHTVALE_ASSET_NAMES.length);
    } finally {
      assets.dispose();
    }
  });

  it.each([
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ])('rejects a source-shaped asset with a non-finite vertex ($label) and disposes it', async ({ value }) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const invalidRoot = makeSourceShapedRoot('platform', { nonFiniteVertex: value });
    let invalidMesh: THREE.Mesh | undefined;
    invalidRoot.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) invalidMesh = object as THREE.Mesh;
    });
    if (invalidMesh === undefined) throw new Error('Fixture is missing its platform mesh');
    const geometryDispose = vi.spyOn(invalidMesh.geometry, 'dispose');
    const materials = Array.isArray(invalidMesh.material)
      ? invalidMesh.material
      : [invalidMesh.material];
    const materialDispose = materials.map((material) => vi.spyOn(material, 'dispose'));
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
      expect((result.error as Error).message).toMatch(/non-finite.*vertex|vertex.*non-finite/i);
    }
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose.map((spy) => spy.mock.calls.length)).toEqual(
      materials.map(() => 1),
    );
  });
});
