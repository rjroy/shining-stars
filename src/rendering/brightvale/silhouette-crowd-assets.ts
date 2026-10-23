import * as THREE from 'three';
import atlasUrl from '../../../assets/production/brightvale-silhouette-crowd/crowd-atlas-waist-up.png?url';
import metadata from '../../../assets/production/brightvale-silhouette-crowd/crowd-atlas-waist-up.json';
import twilightAtlasUrl from '../../../assets/production/brightvale-silhouette-crowd/crowd-atlas-waist-up-sinister.png?url';
import twilightMetadata from '../../../assets/production/brightvale-silhouette-crowd/crowd-atlas-waist-up-sinister.json';
import { loadBrightvaleRuntimeAssets } from './assets-runtime';
import type {
  BrightvaleAssets,
  BrightvaleSilhouetteCrowdAssets,
} from './assets';

function abortError(): DOMException {
  return new DOMException(
    'Brightvale gameplay assets were aborted',
    'AbortError',
  );
}

async function loadAtlas(
  signal: AbortSignal,
  url: string,
  metadata: typeof import('../../../assets/production/brightvale-silhouette-crowd/crowd-atlas-waist-up.json'),
): Promise<BrightvaleSilhouetteCrowdAssets & { dispose(): void }> {
  if (signal.aborted) throw abortError();
  console.info('[Brightvale] silhouette atlas load attempt', { url });
  let texture: THREE.Texture | undefined;
  let onAbort: (() => void) | undefined;
  const pending = new THREE.TextureLoader()
    .loadAsync(url)
    .then((loaded) => {
      // TextureLoader cannot cancel its image request; release late completion.
      if (signal.aborted) {
        loaded.dispose();
        throw abortError();
      }
      texture = loaded;
      return loaded;
    });
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const loaded = await Promise.race([pending, aborted]);
    if (signal.aborted) throw abortError();
    const image = loaded.image as { width?: number; height?: number };
    if (
      image.width !== metadata.atlas.width ||
      image.height !== metadata.atlas.height
    )
      throw new Error(
        'Silhouette atlas dimensions do not match its attachment metadata',
      );
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.flipY = true;
    loaded.premultiplyAlpha = false;
    loaded.wrapS = loaded.wrapT = THREE.ClampToEdgeWrapping;
    loaded.minFilter = loaded.magFilter = THREE.LinearFilter;
    loaded.generateMipmaps = false;
    loaded.needsUpdate = true;
    let disposed = false;
    console.info('[Brightvale] silhouette atlas loaded successfully', {
      width: image.width,
      height: image.height,
    });
    return {
      texture: loaded,
      metadata,
      dispose() {
        if (disposed) return;
        disposed = true;
        loaded.dispose();
      },
    };
  } catch (error) {
    texture?.dispose();
    console.error('[Brightvale] silhouette atlas load failed', { error });
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** App-owned gameplay stock; generic GLB/scene consumers need no DOM image loader. */
export async function loadBrightvaleGameplayAssets(
  signal: AbortSignal,
): Promise<BrightvaleAssets> {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  let failure: unknown;
  const onAbort = (): void => {
    failure = abortError();
    controller.abort();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const fail = (error: unknown): never => {
    failure ??= error;
    controller.abort();
    throw error;
  };
  try {
    const results = await Promise.allSettled([
      loadBrightvaleRuntimeAssets(controller.signal).catch(fail),
      loadAtlas(controller.signal, atlasUrl, metadata).catch(fail),
      loadAtlas(controller.signal, twilightAtlasUrl, twilightMetadata).catch(fail),
    ] as const);
    const [base, atlas, twilightAtlas] = results;
    if (
      base.status === 'rejected' ||
      atlas.status === 'rejected' ||
      twilightAtlas.status === 'rejected' ||
      signal.aborted
    ) {
      for (const result of results)
        if (result.status === 'fulfilled') result.value.dispose();
      throw failure ?? abortError();
    }
    let disposed = false;
    return {
      ...base.value,
      silhouetteCrowd: atlas.value,
      silhouetteCrowdTwilight: twilightAtlas.value,
      dispose() {
        if (disposed) return;
        disposed = true;
        base.value.dispose();
        atlas.value.dispose();
        twilightAtlas.value.dispose();
      },
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
