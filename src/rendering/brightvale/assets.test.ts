import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIGHTVALE_ASSET_NAMES,
  loadBrightvaleAssets,
  type BrightvaleAssetName,
  type BrightvaleAssetUrls,
  type BrightvaleLoaderDependencies,
} from './assets';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForDecodeStart(
  started: Promise<void>,
  loading: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    started,
    loading.then(() => {
      throw new Error('Asset loading settled before the deferred decode started');
    }),
  ]);
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function makeFixture(shared?: {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  texture: THREE.DataTexture;
}) {
  const root = new THREE.Group();
  const geometry = shared?.geometry ?? new THREE.BoxGeometry(1, 1, 1);
  const material = shared?.material ?? new THREE.MeshStandardMaterial();
  const texture =
    shared?.texture ?? new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  material.map = texture;
  root.add(new THREE.Mesh(geometry, material));

  return {
    root,
    geometry,
    material,
    texture,
    disposeSpies: [
      vi.spyOn(geometry, 'dispose'),
      vi.spyOn(material, 'dispose'),
      vi.spyOn(texture, 'dispose'),
    ],
  };
}

const urls = Object.fromEntries(
  BRIGHTVALE_ASSET_NAMES.map((name) => [name, `/assets/${name}.glb`]),
) as BrightvaleAssetUrls;

function response(status = 200): Response {
  return new Response(new ArrayBuffer(0), { status });
}

function dependencies(
  overrides: Partial<BrightvaleLoaderDependencies> = {},
): BrightvaleLoaderDependencies {
  return {
    urls,
    fetch: vi.fn(async () => response()),
    decode: vi.fn(async () => makeFixture().root),
    ...overrides,
  };
}

describe('Brightvale runtime asset bundle loader', () => {
  it('returns all named roots and disposes shared imported resources once, idempotently', async () => {
    const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
    const sharedMaterial = new THREE.MeshStandardMaterial();
    const geometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const materialDispose = vi.spyOn(sharedMaterial, 'dispose');
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const textureDispose = vi.spyOn(texture, 'dispose');
    const decode = vi.fn(async () => makeFixture({
      geometry: sharedGeometry,
      material: sharedMaterial,
      texture,
    }).root);

    const assets = await loadBrightvaleAssets(
      new AbortController().signal,
      dependencies({ decode }),
    );

    expect(Object.keys(assets.roots).sort()).toEqual([...BRIGHTVALE_ASSET_NAMES].sort());
    expect(assets.roots.city).toBeInstanceOf(THREE.Group);
    expect(decode).toHaveBeenCalledTimes(BRIGHTVALE_ASSET_NAMES.length);

    assets.dispose();
    assets.dispose();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it('aborts fetches and disposes a result that finishes decoding after caller cancellation', async () => {
    const decodeStarted = deferred<void>();
    const decodeResult = deferred<THREE.Group>();
    const lateFixture = makeFixture();
    const controller = new AbortController();
    const decode = vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) => {
      if (name === 'city') {
        decodeStarted.resolve();
        return decodeResult.promise;
      }
      return makeFixture().root;
    });
    const fetch = vi.fn(async (_url: string, _signal: AbortSignal) => response());

    const loading = loadBrightvaleAssets(
      controller.signal,
      dependencies({ fetch, decode }),
    );
    await waitForDecodeStart(decodeStarted.promise, loading);
    controller.abort();
    decodeResult.resolve(lateFixture.root);

    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls.every(([, signal]) => signal?.aborted)).toBe(true);
    expect(lateFixture.disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('aborts sibling fetches on required-asset failure and cleans up partial and late successes', async () => {
    const failedAsset: BrightvaleAssetName = 'platform';
    const lateAsset: BrightvaleAssetName = 'city';
    const decodeStarted = deferred<void>();
    const lateDecode = deferred<THREE.Group>();
    const partialFixture = makeFixture();
    const lateFixture = makeFixture();
    const fetch = vi.fn(async (_url: string, signal: AbortSignal) => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return response();
    });
    const decode = vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) => {
      if (name === failedAsset) throw new Error('decode failed');
      if (name === lateAsset) {
        decodeStarted.resolve();
        return lateDecode.promise;
      }
      return partialFixture.root;
    });

    const loading = loadBrightvaleAssets(
      new AbortController().signal,
      dependencies({ fetch, decode }),
    );
    await waitForDecodeStart(decodeStarted.promise, loading);
    await expect(loading).rejects.toThrow('decode failed');
    lateDecode.resolve(lateFixture.root);

    await vi.waitFor(() => {
      expect(lateFixture.disposeSpies[0]).toHaveBeenCalledTimes(1);
    });
    expect(fetch.mock.calls.some(([, signal]) => signal.aborted)).toBe(true);
    expect(partialFixture.disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
    expect(lateFixture.disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('rejects a genuinely pending fetch when the caller aborts', async () => {
    const allFetchesStarted = deferred<void>();
    const controller = new AbortController();
    let started = 0;
    const fetch = vi.fn((_url: string, signal: AbortSignal) => {
      started += 1;
      if (started === BRIGHTVALE_ASSET_NAMES.length) allFetchesStarted.resolve();
      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener('abort', rejectOnAbort, { once: true });
      });
    });

    const loading = loadBrightvaleAssets(
      controller.signal,
      dependencies({ fetch }),
    );
    await waitForDecodeStart(allFetchesStarted.promise, loading);
    controller.abort();

    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(BRIGHTVALE_ASSET_NAMES.length);
  });

  it('rejects an HTTP error response and cancels sibling requests', async () => {
    const fetch = vi.fn(async (url: string, _signal: AbortSignal) =>
      response(url.endsWith('/city.glb') ? 503 : 200),
    );
    const decode = vi.fn(async () => makeFixture().root);

    await expect(
      loadBrightvaleAssets(
        new AbortController().signal,
        dependencies({ fetch, decode }),
      ),
    ).rejects.toThrow('HTTP 503');

    expect(fetch.mock.calls.some(([, signal]) => signal.aborted)).toBe(true);
  });

  it('disposes resources already decoded when a later decoder rejects', async () => {
    const partialDecoded = deferred<void>();
    const failureMayProceed = deferred<void>();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    material.map = texture;
    const disposeSpies = [
      vi.spyOn(geometry, 'dispose'),
      vi.spyOn(material, 'dispose'),
      vi.spyOn(texture, 'dispose'),
    ];
    const decode = vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) => {
      if (name === 'city') {
        await failureMayProceed.promise;
        throw new Error('city decode failed');
      }
      const root = new THREE.Group();
      root.add(new THREE.Mesh(geometry, material));
      partialDecoded.resolve();
      return root;
    });
    const loading = loadBrightvaleAssets(
      new AbortController().signal,
      dependencies({ decode }),
    );

    await waitForDecodeStart(partialDecoded.promise, loading);
    failureMayProceed.resolve();
    await expect(loading).rejects.toThrow('city decode failed');

    expect(disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('disposes imported resources captured at decode even after the root graph is changed', async () => {
    const imported = makeFixture();
    const retainedImportedGeometry = new THREE.SphereGeometry(1);
    const retainedGeometryDispose = vi.spyOn(retainedImportedGeometry, 'dispose');
    const detachedMesh = imported.root.children[0] as THREE.Mesh;
    imported.root.add(new THREE.Mesh(retainedImportedGeometry, imported.material));
    const replacementGeometry = new THREE.PlaneGeometry(1, 1);
    const replacementMaterial = new THREE.MeshBasicMaterial();
    const replacementGeometryDispose = vi.spyOn(replacementGeometry, 'dispose');
    const replacementMaterialDispose = vi.spyOn(replacementMaterial, 'dispose');
    const decode = vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) =>
      name === 'city' ? imported.root : makeFixture().root,
    );

    const assets = await loadBrightvaleAssets(
      new AbortController().signal,
      dependencies({ decode }),
    );
    const cityRoot = assets.roots.city;
    cityRoot.remove(detachedMesh);
    const importedRemainder = cityRoot.children[0] as THREE.Mesh;
    importedRemainder.material = replacementMaterial;
    importedRemainder.geometry = replacementGeometry;

    assets.dispose();

    expect(imported.disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
    expect(retainedGeometryDispose).toHaveBeenCalledTimes(1);
    expect(replacementGeometryDispose).not.toHaveBeenCalled();
    expect(replacementMaterialDispose).not.toHaveBeenCalled();
  });

  it('rejects caller abort promptly, disposes completed roots immediately, and cleans up late decode', async () => {
    const pendingStarted = deferred<void>();
    const completedReturned = deferred<void>();
    const pendingDecode = deferred<THREE.Group>();
    const completed = makeFixture();
    const late = makeFixture();
    const controller = new AbortController();
    const decode = vi.fn(async (_bytes: ArrayBuffer, name: BrightvaleAssetName) => {
      if (name === 'city') {
        pendingStarted.resolve();
        return pendingDecode.promise;
      }
      if (name === 'highway') {
        completedReturned.resolve();
        return completed.root;
      }
      return makeFixture().root;
    });
    const loading = loadBrightvaleAssets(
      controller.signal,
      dependencies({ decode }),
    );
    let settlement: 'fulfilled' | 'rejected' | undefined;
    const observedSettlement = loading.then(
      () => {
        settlement = 'fulfilled';
      },
      () => {
        settlement = 'rejected';
      },
    );

    await Promise.all([pendingStarted.promise, completedReturned.promise]);
    await flushMicrotasks();
    controller.abort();
    await flushMicrotasks();

    let promptAbortFailure: unknown;
    try {
      expect(settlement).toBe('rejected');
      expect(completed.disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
    } catch (error) {
      promptAbortFailure = error;
    } finally {
      pendingDecode.resolve(late.root);
      await observedSettlement;
    }

    expect(settlement).toBe('rejected');
    await vi.waitFor(
      () =>
        expect(late.disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([
          1,
          1,
          1,
        ]),
      { timeout: 1000 },
    );
    if (promptAbortFailure !== undefined) throw promptAbortFailure;
  });
});
