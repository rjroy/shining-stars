import * as THREE from 'three';
import { createSilhouetteCrowd } from '../../../src/rendering/brightvale/silhouette-crowd';
import type { BrightvaleSilhouetteCrowdAssets } from '../../../src/rendering/brightvale/assets';

declare global {
  interface Window {
    __crowdBlendResult?: { pixel: number[] } | { error: string };
  }
}

function solidAtlas(
  color: readonly [number, number, number],
  alpha: number,
): THREE.DataTexture {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let pixel = 0; pixel < 16; pixel += 1) {
    rgba.set([...color, alpha], pixel * 4);
  }
  const texture = new THREE.DataTexture(rgba, 4, 4, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function atlas(
  texture: THREE.Texture,
  bodyBounds: readonly number[],
): BrightvaleSilhouetteCrowdAssets {
  return {
    texture,
    metadata: {
      schema: 'brightvale-silhouette-crowd-v1',
      atlas: { width: 4, height: 4, gutter_px: 0 },
      coordinates: { source_pixels_per_unit: 1 },
      parts: [
        {
          id: 'A.body',
          card_bounds_local: bodyBounds,
          uv_rect_bottom_left: [0, 0, 1, 1],
        },
        {
          id: 'A.arm',
          card_bounds_local: [5, 5, 6, 6],
          uv_rect_bottom_left: [0, 0, 1, 1],
        },
      ],
      figures: [
        {
          id: 'A',
          body_part: 'A.body',
          arm_part: 'A.arm',
          shoulder_body_local: [0, 0],
          grip_arm_local: [0, 0],
          stick_top_arm_local: [0, 1],
          stick_bottom_arm_local: [0, 0],
        },
      ],
    },
  };
}

async function renderSample(): Promise<number[]> {
  const originalTexture = solidAtlas([255, 0, 0], 204);
  const twilightTexture = solidAtlas([0, 0, 255], 255);
  const crowd = createSilhouetteCrowd(
    atlas(originalTexture, [-1.5, -1.5, 1.5, 1.5]),
    atlas(twilightTexture, [-0.5, -1.5, 1.5, 1.5]),
    [
      {
        id: 'alpha-edge',
        figure: 'A',
        matrixColumnMajor: new THREE.Matrix4().toArray(),
        motionPhase: 0,
        motionRate: 1,
      },
    ],
  );
  const material = crowd.root.getObjectByName('Brightvale.Crowd.Body.A')
    ?.material as THREE.MeshBasicMaterial;
  // Read the actual blended shader output, before either production coverage
  // mode converts alpha into hash discards or multisample coverage.
  material.alphaHash = false;
  material.alphaToCoverage = false;
  material.transparent = true;
  material.blending = THREE.NoBlending;
  crowd.setAtlasBlend(0.5);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setSize(64, 64, false);
  const target = new THREE.WebGLRenderTarget(64, 64, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(crowd.root);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  const pixel = new Uint8Array(4);
  renderer.readRenderTargetPixels(target, 15, 32, 1, 1, pixel);

  crowd.dispose();
  target.dispose();
  renderer.dispose();
  originalTexture.dispose();
  twilightTexture.dispose();
  return [...pixel];
}

void renderSample()
  .then((pixel) => {
    window.__crowdBlendResult = { pixel };
    document.body.dataset.result = 'complete';
  })
  .catch((error: unknown) => {
    window.__crowdBlendResult = {
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
    document.body.dataset.result = 'error';
  });
