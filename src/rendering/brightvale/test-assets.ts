import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import {
  BRIGHTVALE_ASSET_NAMES,
  type BrightvaleAssetName,
  type BrightvaleAssets,
} from './assets';
import {
  BRIGHTVALE_PRODUCTION_ASSET_URLS,
  loadBrightvaleRuntimeAssets,
} from './assets-runtime';

const PRODUCTION_FILES: Readonly<Record<BrightvaleAssetName, string>> = {
  city: '../../../assets/production/brightvale-city/city-meshopt.glb',
  highway: '../../../assets/production/brightvale-highway/highway.glb',
  platform: '../../../assets/production/brightvale-platform/platform.glb',
  endcaps: '../../../assets/production/brightvale-platform-endcaps/endcaps.glb',
  framingLong: '../../../assets/production/brightvale-outer-framing/long.glb',
  framingPost: '../../../assets/production/brightvale-outer-framing/post.glb',
};

/** Load the actual production bundle through the runtime GLTFLoader boundary. */
export async function loadBrightvaleProductionAssets(): Promise<BrightvaleAssets> {
  return loadBrightvaleRuntimeAssets(new AbortController().signal, {
    fetch: async (url) => {
      const name = BRIGHTVALE_ASSET_NAMES.find(
        (candidate) => BRIGHTVALE_PRODUCTION_ASSET_URLS[candidate] === url,
      );
      if (name === undefined)
        throw new Error(`Unexpected production asset URL: ${url}`);
      const bytes = await readFile(
        new URL(PRODUCTION_FILES[name], import.meta.url),
      );
      return new Response(new Uint8Array(bytes), { status: 200 });
    },
    loadSkyTextures: async () => {
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
        dispose() {
          warm.dispose();
          twilight.dispose();
        },
      };
    },
    loadGroundTextures: async () => ({
      city: new THREE.DataTexture(
        new Uint8Array([80, 120, 50, 255]),
        1,
        1,
        THREE.RGBAFormat,
      ),
      cityNormal: new THREE.DataTexture(
        new Uint8Array([128, 128, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
      ),
      plaza: new THREE.DataTexture(
        new Uint8Array([100, 100, 150, 255]),
        1,
        1,
        THREE.RGBAFormat,
      ),
      plazaNormal: new THREE.DataTexture(
        new Uint8Array([128, 128, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
      ),
      dispose() {},
    }),
  });
}
