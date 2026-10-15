import * as THREE from 'three';
import type { BrightvaleAssets } from './brightvale/assets';
import type { BrightvaleShellComposition } from './brightvale/scene-shell';
import type { SongCollection } from '../catalog/catalog';
import {
  fitDirectionalShadowCamera,
  setShadowParticipation,
} from './brightvale/shadows';

export interface ObservatorySceneFrame {
  readonly width: number;
  readonly height: number;
  readonly elapsedSeconds: number;
  readonly reducedMotion: boolean;
}

export interface ObservatoryProjectedAnchor {
  readonly collectionId: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface ObservatoryComposition extends BrightvaleShellComposition {
  readonly camera: THREE.Camera;
  update(frame: ObservatorySceneFrame): void;
  anchors(): readonly ObservatoryProjectedAnchor[];
}

/** Procedural twilight observatory sharing the app's existing WebGL renderer. */
export function createObservatoryComposition(
  assets: BrightvaleAssets,
  collections: readonly SongCollection[] = [],
): ObservatoryComposition {
  const root = new THREE.Group();
  root.name = 'Brightvale.Observatory';
  root.add(new THREE.AmbientLight(0x9a83d5, 1.8));
  const city = assets.roots.city.clone(true);
  city.name = 'Observatory.BrightvaleCity';
  city.scale.setScalar(0.18);
  city.position.set(0, -2.85, -7);
  setShadowParticipation(city, { cast: true, receive: true });
  root.add(city);

  const cityKey = new THREE.DirectionalLight(0xffd49b, 0.72);
  cityKey.name = 'Observatory.CityKey';
  cityKey.position.set(-14, 18, 11);
  cityKey.target.position.copy(city.position);
  cityKey.castShadow = true;
  root.add(cityKey, cityKey.target);
  fitDirectionalShadowCamera(cityKey, [city]);

  const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 80);
  camera.position.set(0, 0, 16);
  camera.lookAt(0, 0, 0);
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();

  const backdropGeometry = new THREE.PlaneGeometry(32, 20);
  const backdropMaterial = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { time: { value: 0 }, motion: { value: 1 } },
    vertexShader:
      'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float motion;
      void main(){ vec2 p=vUv-vec2(.5,.42); float neb=exp(-dot(p*vec2(1.5,2.1),p*vec2(1.5,2.1))*5.0);
      float drift=sin(vUv.x*8.0+time*.12*motion)*.025; vec3 a=vec3(.025,.035,.11); vec3 b=vec3(.15,.075,.30);
      gl_FragColor=vec4(mix(a,b,clamp(neb*.8+drift,0.0,.8)),1.0); }`,
  });
  const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
  backdrop.position.z = -10;
  root.add(backdrop);
  ownedGeometries.add(backdropGeometry);
  ownedMaterials.add(backdropMaterial);

  let seed = 0x5a17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const starPositions = new Float32Array(480 * 3);
  for (let index = 0; index < 480; index += 1) {
    starPositions[index * 3] = (random() - 0.5) * 24;
    starPositions[index * 3 + 1] = (random() - 0.5) * 14;
    starPositions[index * 3 + 2] = -3 + random() * 5;
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(starPositions, 3),
  );
  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffe3a0,
    size: 0.035,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  root.add(stars);
  ownedGeometries.add(starsGeometry);
  ownedMaterials.add(starsMaterial);

  const collectionTargets = collections.map((collection) => {
    const target = new THREE.Group();
    target.name = `Observatory.CollectionAnchor.${collection.id}`;
    root.add(target);
    return { collection, target };
  });
  let width = 1;
  let height = 1;
  let destroyed = false;
  return {
    root,
    camera,
    update(frame) {
      width = frame.width;
      height = frame.height;
      const reducedMotion = frame.reducedMotion;
      const count = Math.max(1, collectionTargets.length);
      const columns = Math.min(count, width < 1100 || width < height ? 2 : 3);
      const horizontalSpan = width < height ? 1 : width < 1100 ? 0.56 : 0.78;
      collectionTargets.forEach(({ target }, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        target.position.set(
          (-8 * width) / height +
            (col + 0.5) *
              ((((16 * width) / height) * horizontalSpan) / columns),
          1.15 - row * (width < height ? 1.5 : 2.1),
          1.1,
        );
      });
      camera.left = (-8 * width) / height;
      camera.right = (8 * width) / height;
      camera.top = 5;
      camera.bottom = -5;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      backdropMaterial.uniforms.time.value = frame.elapsedSeconds;
      backdropMaterial.uniforms.motion.value = reducedMotion ? 0 : 1;
      stars.rotation.z = reducedMotion
        ? 0
        : Math.sin(frame.elapsedSeconds * 0.025) * 0.012;
    },
    anchors() {
      root.updateMatrixWorld(true);
      return collectionTargets.map(({ collection, target }) => {
        const anchor = new THREE.Vector3(0, 0, 0);
        target.localToWorld(anchor);
        const projected = anchor.project(camera);
        const x = ((projected.x + 1) / 2) * width;
        const y = ((1 - projected.y) / 2) * height;
        return {
          collectionId: collection.id,
          x,
          y,
          visible:
            width > 0 &&
            height > 0 &&
            x >= 0 &&
            x <= width &&
            y >= 0 &&
            y <= height,
        };
      });
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      cityKey.shadow.dispose();
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
    },
  };
}
