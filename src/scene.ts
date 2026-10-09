import * as THREE from 'three';
import type { SceneStateProjection } from './scene-state';

export interface BrightvaleScene {
  /** Render from the authoritative game clock; this scene owns no animation loop. */
  update(state: SceneStateProjection, transportTime: number): void;
  destroy(): void;
}

/** Small renderer surface so scene lifecycle can be tested without WebGL. */
export interface SceneRenderer {
  readonly domElement: HTMLCanvasElement;
  outputColorSpace: THREE.WebGLRenderer['outputColorSpace'];
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export type SceneRendererFactory = (
  parameters: THREE.WebGLRendererParameters,
) => SceneRenderer;

interface BuildingInstance {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly phase: number;
}

const BUILDINGS: readonly BuildingInstance[] = [
  { x: -7.2, z: -1.5, width: 1.15, height: 3.1, depth: 1.2, phase: 0.3 },
  { x: -5.7, z: -2.0, width: 1.05, height: 4.4, depth: 1.1, phase: 1.1 },
  { x: -4.2, z: -1.3, width: 1.2, height: 2.7, depth: 1.3, phase: 2.2 },
  { x: -2.7, z: -2.2, width: 1.2, height: 3.8, depth: 1.25, phase: 0.8 },
  { x: 2.7, z: -2.0, width: 1.1, height: 3.3, depth: 1.2, phase: 1.9 },
  { x: 4.2, z: -1.5, width: 1.25, height: 4.2, depth: 1.3, phase: 0.1 },
  { x: 5.8, z: -2.1, width: 1.1, height: 2.8, depth: 1.1, phase: 2.7 },
  { x: 7.2, z: -1.4, width: 1.15, height: 3.6, depth: 1.3, phase: 1.4 },
];

const WIND_BEAD_COUNT = 4;

/** Create one low-cost twilight city illustration behind the rhythm interface. */
export function createBrightvaleScene(
  host: HTMLElement,
  onUnavailable: () => void,
  rendererFactory: SceneRendererFactory = (parameters) =>
    new THREE.WebGLRenderer(parameters),
): BrightvaleScene | null {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instancedMeshes = new Set<THREE.InstancedMesh>();
  let renderer: SceneRenderer;
  let canvas: HTMLCanvasElement;

  try {
    renderer = rendererFactory({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    canvas = renderer.domElement;
  } catch {
    onUnavailable();
    return null;
  }

  const scene = new THREE.Scene();
  let observer: ResizeObserver | null = null;
  let cleaned = false;
  let fallbackShown = false;
  let onContextLost: ((event: Event) => void) | null = null;
  let resizeListener: (() => void) | null = null;
  let lastState: SceneStateProjection | null = null;
  let lastTransportTime = 0;

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    observer?.disconnect();
    observer = null;
    if (resizeListener !== null) {
      window.removeEventListener('resize', resizeListener);
    }
    if (onContextLost !== null) {
      canvas.removeEventListener('webglcontextlost', onContextLost);
    }
    canvas.remove();
    for (const mesh of instancedMeshes) mesh.dispose();
    instancedMeshes.clear();
    for (const geometry of geometries) geometry.dispose();
    geometries.clear();
    for (const material of materials) material.dispose();
    materials.clear();
    scene.clear();
    renderer.dispose();
  }

  function showFallback(): void {
    if (fallbackShown) return;
    fallbackShown = true;
    onUnavailable();
  }

  function failScene(): void {
    cleanup();
    showFallback();
  }

  try {
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.insertBefore(canvas, host.firstChild);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene.fog = new THREE.Fog(0x111a2b, 18, 42);
    const cityscape = new THREE.Group();
    scene.add(cityscape);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    const baseCameraPosition = new THREE.Vector3(0, 6.7, 19);
    const cameraLookAt = new THREE.Vector3(0, 1.5, 0);
    camera.position.copy(baseCameraPosition);
    camera.lookAt(cameraLookAt);

    const ambient = new THREE.HemisphereLight(0xc5e0e1, 0x101626, 1.15);
    scene.add(ambient);
    const stageLight = new THREE.PointLight(0xffd37b, 54, 17, 1.8);
    stageLight.position.set(0, 4.2, 5.7);
    scene.add(stageLight);
    const cityLight = new THREE.PointLight(0x6bd9c0, 22, 23, 2);
    cityLight.position.set(-1, 4.4, -2.4);
    scene.add(cityLight);

    function ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
      geometries.add(geometry);
      return geometry;
    }
    function ownMaterial<T extends THREE.Material>(material: T): T {
      materials.add(material);
      return material;
    }

    const groundMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x101b2a,
        roughness: 0.94,
        metalness: 0.04,
      }),
    );
    const ground = new THREE.Mesh(
      ownGeometry(new THREE.PlaneGeometry(34, 34)),
      groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.45, 0);
    scene.add(ground);

    const platformMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x354354,
        emissive: 0x382916,
        emissiveIntensity: 0.36,
        roughness: 0.55,
        metalness: 0.18,
      }),
    );
    const platform = new THREE.Mesh(
      ownGeometry(new THREE.BoxGeometry(4.5, 0.28, 2.6)),
      platformMaterial,
    );
    platform.position.set(0, 5.87, 3.7);
    platform.scale.setScalar(0.14);
    scene.add(platform);

    const trimMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffd475,
        emissive: 0xffb94f,
        emissiveIntensity: 1.25,
        roughness: 0.35,
      }),
    );
    const platformTrim = new THREE.Mesh(
      ownGeometry(new THREE.BoxGeometry(4.35, 0.035, 2.42)),
      trimMaterial,
    );
    platformTrim.position.set(0, 6.02, 3.7);
    platformTrim.scale.setScalar(0.14);
    scene.add(platformTrim);

    const buildingMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x26394d,
        emissive: 0x143042,
        emissiveIntensity: 0.18,
        roughness: 0.9,
        metalness: 0.02,
      }),
    );
    const buildingGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    const buildings = new THREE.InstancedMesh(
      buildingGeometry,
      buildingMaterial,
      BUILDINGS.length,
    );
    instancedMeshes.add(buildings);
    buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const buildingTransform = new THREE.Object3D();
    BUILDINGS.forEach((building, index) => {
      buildingTransform.position.set(
        building.x,
        building.height / 2 - 0.44,
        building.z,
      );
      buildingTransform.scale.set(
        building.width,
        building.height,
        building.depth,
      );
      buildingTransform.updateMatrix();
      buildings.setMatrixAt(index, buildingTransform.matrix);
    });
    cityscape.add(buildings);

    const windowMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x9de7d0,
        emissive: 0x72cbb0,
        emissiveIntensity: 0.75,
        roughness: 0.4,
      }),
    );
    const windowGeometry = ownGeometry(new THREE.BoxGeometry(0.1, 0.14, 0.035));
    const windowPlacements: Array<{ x: number; y: number; z: number }> = [];
    for (const building of BUILDINGS) {
      const rows = Math.max(2, Math.floor(building.height / 0.72));
      for (let row = 0; row < rows; row += 1) {
        for (const side of [-1, 1]) {
          windowPlacements.push({
            x: building.x + side * building.width * 0.2,
            y: -0.22 + row * 0.55,
            z: building.z + building.depth / 2 + 0.022,
          });
        }
      }
    }
    const windows = new THREE.InstancedMesh(
      windowGeometry,
      windowMaterial,
      windowPlacements.length,
    );
    instancedMeshes.add(windows);
    windowPlacements.forEach((placement, index) => {
      buildingTransform.position.set(placement.x, placement.y, placement.z);
      buildingTransform.scale.setScalar(1);
      buildingTransform.updateMatrix();
      windows.setMatrixAt(index, buildingTransform.matrix);
    });
    cityscape.add(windows);

    const pressureMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x25233c,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const pressureVeil = new THREE.Mesh(
      ownGeometry(new THREE.PlaneGeometry(18, 5.8)),
      pressureMaterial,
    );
    pressureVeil.position.set(0, 2.5, -3.6);
    cityscape.add(pressureVeil);

    const wireMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xd2c99d,
        emissive: 0xffd475,
        emissiveIntensity: 0.32,
        roughness: 0.3,
        metalness: 0.15,
      }),
    );
    const wireCurves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-9, 8.55, -1.6),
        new THREE.Vector3(-5, 8.85, -1.9),
        new THREE.Vector3(0, 8.3, -1.8),
        new THREE.Vector3(5, 8.7, -1.7),
        new THREE.Vector3(9, 8.35, -1.6),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-8, 7.75, -1.8),
        new THREE.Vector3(-4, 8.05, -2.0),
        new THREE.Vector3(1, 7.6, -1.9),
        new THREE.Vector3(6, 7.95, -1.7),
        new THREE.Vector3(9, 7.65, -1.6),
      ]),
    ];
    for (const curve of wireCurves) {
      const wire = new THREE.Mesh(
        ownGeometry(new THREE.TubeGeometry(curve, 48, 0.018, 5, false)),
        wireMaterial,
      );
      cityscape.add(wire);
    }

    const windMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x75cdb9,
        emissive: 0x58c4ad,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.32,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    const windCurves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-9, 0.9, -1.2),
        new THREE.Vector3(-5, 1.4, -1.45),
        new THREE.Vector3(-1, 1.0, -1.55),
        new THREE.Vector3(4, 1.5, -1.3),
        new THREE.Vector3(9, 1.05, -1.1),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-8, 1.8, -2.2),
        new THREE.Vector3(-4, 2.0, -2.1),
        new THREE.Vector3(0, 1.75, -2.3),
        new THREE.Vector3(5, 2.2, -2.0),
        new THREE.Vector3(9, 1.9, -1.8),
      ]),
    ];
    for (const curve of windCurves) {
      const ribbon = new THREE.Mesh(
        ownGeometry(new THREE.TubeGeometry(curve, 48, 0.035, 6, false)),
        windMaterial,
      );
      cityscape.add(ribbon);
    }

    const beadMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({ color: 0xb4f4dc, transparent: true }),
    );
    const beadGeometry = ownGeometry(new THREE.SphereGeometry(0.07, 8, 6));
    const windBeads: THREE.Mesh[] = [];
    for (let index = 0; index < WIND_BEAD_COUNT; index += 1) {
      const bead = new THREE.Mesh(beadGeometry, beadMaterial);
      bead.position.z = -1.35 - (index % 2) * 0.8;
      bead.visible = false;
      scene.add(bead);
      windBeads.push(bead);
    }

    const haloMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffd475,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    const performerHalo = new THREE.Mesh(
      ownGeometry(new THREE.TorusGeometry(0.82, 0.025, 8, 64)),
      haloMaterial,
    );
    performerHalo.position.set(0, 6.37, 3.92);
    performerHalo.scale.setScalar(0.14);
    scene.add(performerHalo);

    const performerMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({ color: 0xffd475, toneMapped: false }),
    );
    const performerSkin = ownMaterial(
      new THREE.MeshBasicMaterial({ color: 0xffe6c3, toneMapped: false }),
    );
    const performer = new THREE.Group();
    performer.position.y = 6;
    performer.scale.setScalar(0.14);
    const body = new THREE.Mesh(
      ownGeometry(new THREE.CapsuleGeometry(0.27, 0.7, 4, 8)),
      performerMaterial,
    );
    body.position.set(0, 0.88, 3.7);
    performer.add(body);
    const head = new THREE.Mesh(
      ownGeometry(new THREE.SphereGeometry(0.25, 14, 10)),
      performerSkin,
    );
    head.position.set(0, 1.66, 3.7);
    performer.add(head);
    const armGeometry = ownGeometry(
      new THREE.CapsuleGeometry(0.09, 0.62, 3, 6),
    );
    const leftArm = new THREE.Mesh(armGeometry, performerSkin);
    leftArm.position.set(-0.53, 1.15, 3.72);
    leftArm.rotation.z = -1.12;
    performer.add(leftArm);
    const rightArm = new THREE.Mesh(armGeometry, performerSkin);
    rightArm.position.set(0.53, 1.15, 3.72);
    rightArm.rotation.z = 1.12;
    performer.add(rightArm);
    const legGeometry = ownGeometry(
      new THREE.CapsuleGeometry(0.105, 0.48, 3, 6),
    );
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeometry, performerMaterial);
      leg.position.set(side * 0.17, 0.18, 3.72);
      performer.add(leg);
    }
    const hair = new THREE.Mesh(
      ownGeometry(new THREE.SphereGeometry(0.25, 12, 8)),
      ownMaterial(new THREE.MeshBasicMaterial({ color: 0x26304a })),
    );
    hair.scale.set(1.04, 0.57, 1.02);
    hair.position.set(0, 1.82, 3.68);
    performer.add(hair);
    scene.add(performer);

    const crowdMaterial = ownMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x172338,
        emissive: 0x111d2e,
        emissiveIntensity: 0.32,
        roughness: 0.9,
      }),
    );
    const crowdHeadGeometry = ownGeometry(new THREE.SphereGeometry(0.22, 8, 6));
    const crowdBodyGeometry = ownGeometry(
      new THREE.CapsuleGeometry(0.22, 0.58, 3, 5),
    );
    for (let index = 0; index < 8; index += 1) {
      const side = index < 4 ? -1 : 1;
      const localIndex = index % 4;
      const x = side * (2.5 + localIndex * 0.72);
      const z = 5.7 + (localIndex % 2) * 0.45;
      const torso = new THREE.Mesh(crowdBodyGeometry, crowdMaterial);
      torso.position.set(x, -0.03, z);
      torso.scale.setScalar(0.78 + (localIndex % 3) * 0.06);
      scene.add(torso);
      const crowdHead = new THREE.Mesh(crowdHeadGeometry, crowdMaterial);
      crowdHead.position.set(x, 0.52, z);
      crowdHead.scale.setScalar(0.78 + (localIndex % 3) * 0.06);
      scene.add(crowdHead);
    }

    observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    resizeListener = resize;

    function resize(): void {
      if (cleaned) return;
      try {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        cityscape.scale.x = Math.max(0.38, Math.min(1, camera.aspect / 1.25));
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(width, height, false);
        if (lastState !== null) render(lastState, lastTransportTime);
      } catch {
        failScene();
      }
    }

    function render(state: SceneStateProjection, transportTime: number): void {
      const intensity = state.cityIntensity;
      const beat = state.motion.powerLinePulse
        ? 0.5 + 0.5 * Math.sin(transportTime * 2.4)
        : 0.5;
      wireMaterial.color.setHex(
        state.phase === 'twilight' ? 0x9de7d0 : 0xd2c99d,
      );
      wireMaterial.emissive.setHex(
        state.phase === 'twilight' ? 0x58c7ad : 0xffd475,
      );
      wireMaterial.emissiveIntensity =
        0.14 + state.cityBrightness * 0.35 + intensity * beat * 0.38;
      buildingMaterial.emissiveIntensity =
        0.08 + state.cityBrightness * 0.27 + intensity * beat * 0.2;
      windowMaterial.emissiveIntensity =
        0.3 + state.cityBrightness * 0.7 + intensity * beat * 0.65;
      windMaterial.color.setHex(
        state.phase === 'twilight' ? 0x70e2c7 : 0x77cfc0,
      );
      windMaterial.opacity = 0.1 + state.cityBrightness * 0.22;
      beadMaterial.opacity = 0.2 + intensity * 0.8;
      pressureVeil.visible = state.phase === 'twilight';
      pressureMaterial.opacity = 0.14 + (1 - intensity) * 0.17;
      haloMaterial.color.setHex(
        state.phase === 'twilight' ? 0xa6f0d7 : 0xffd475,
      );
      haloMaterial.opacity = 0.3 + state.cityBrightness * 0.4;
      cityLight.intensity = 10 + state.cityBrightness * 24;
      stageLight.intensity = 52;

      for (let index = 0; index < BUILDINGS.length; index += 1) {
        const building = BUILDINGS[index];
        if (building === undefined) continue;
        const pulse = state.motion.buildingPulse
          ? Math.sin(transportTime * 1.8 + building.phase) * 0.035 * intensity
          : 0;
        buildingTransform.position.set(
          building.x,
          building.height / 2 - 0.44 + pulse / 2,
          building.z,
        );
        buildingTransform.scale.set(
          building.width,
          building.height * (1 + pulse),
          building.depth,
        );
        buildingTransform.updateMatrix();
        buildings.setMatrixAt(index, buildingTransform.matrix);
      }
      buildings.instanceMatrix.needsUpdate = true;

      for (let index = 0; index < windBeads.length; index += 1) {
        const bead = windBeads[index];
        if (bead === undefined) continue;
        bead.visible = state.motion.windTravel && intensity > 0.02;
        const progress = (transportTime * 0.24 + index * 0.27) % 1;
        bead.position.set(
          -8.5 + progress * 17,
          1.1 + Math.sin(progress * Math.PI * 2 + index) * 0.18,
          -1.35 - (index % 2) * 0.8,
        );
        bead.scale.setScalar(0.55 + intensity * 0.75);
      }

      const push = state.motion.cameraPush * 0.34;
      camera.position.set(
        0,
        baseCameraPosition.y - push * 0.12,
        baseCameraPosition.z - push,
      );
      camera.lookAt(cameraLookAt);
      renderer.render(scene, camera);
    }

    onContextLost = (event: Event): void => {
      event.preventDefault();
      failScene();
    };

    canvas.addEventListener('webglcontextlost', onContextLost);
    if (observer !== null) observer.observe(host);
    else window.addEventListener('resize', resize);
    resize();
    if (cleaned) return null;

    return {
      update(state, transportTime) {
        if (cleaned) return;
        lastState = state;
        lastTransportTime = transportTime;
        try {
          render(state, transportTime);
        } catch {
          failScene();
        }
      },
      destroy() {
        cleanup();
      },
    };
  } catch {
    failScene();
    return null;
  }
}
