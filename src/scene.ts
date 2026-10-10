import * as THREE from 'three';
import {
  isFeedbackWithinVisibleAge,
  LOGICAL_PLAYFIELD_HEIGHT,
  type GameplayFrame,
} from './gameplay-frame';
import { RUNWAY_HIT_LINE_TOP_FRACTION } from './note-projection';
import type { SceneStateProjection } from './scene-state';

export interface BrightvaleScene {
  /** Render city and the complete gameplay surface in the shared context. */
  updateFrame(frame: {
    readonly city: SceneStateProjection;
    readonly gameplay: GameplayFrame;
  }): void;
  destroy(): void;
}

/** Small renderer surface so scene lifecycle can be tested without WebGL. */
export interface SceneRenderer {
  readonly domElement: HTMLCanvasElement;
  autoClear: boolean;
  outputColorSpace: THREE.WebGLRenderer['outputColorSpace'];
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  setScissorTest(enabled: boolean): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  clearDepth(): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export type SceneRendererFactory = (
  parameters: THREE.WebGLRendererParameters,
) => SceneRenderer;

function createPlane(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  role: string,
): THREE.Mesh {
  material.depthTest = false;
  if (material instanceof THREE.MeshBasicMaterial) material.fog = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.layers.mask = parent.layers.mask;
  mesh.userData.gameplayRole = role;
  mesh.userData.pooled = true;
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

function placePlane(
  mesh: THREE.Mesh,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
  screenHeight: number,
): void {
  mesh.position.set(x + width / 2, screenHeight - y - height / 2, z);
  mesh.scale.set(width, height, 1);
  mesh.renderOrder = z;
  mesh.visible = width > 0 && height > 0;
}

function paintText(
  layer: CanvasTextLayer,
  value: string,
  availableWidth: number,
  displayedHeight: number,
  resizeCanvas: (layer: CanvasTextLayer, width: number, height: number) => void,
): number {
  if (
    layer.value === value &&
    layer.renderedHeight === displayedHeight &&
    layer.renderedWidth === availableWidth
  )
    return layer.renderedAspect;
  const context = layer.context;
  if (context === null) return layer.canvas.width / layer.canvas.height;
  const height = layer.canvas.height;
  let textureFontSize =
    (layer.fontSize * height) / Math.max(1, displayedHeight);
  context.font = `500 ${textureFontSize}px Manrope, sans-serif`;
  const sourceWidthLimit = Math.max(
    1,
    (availableWidth * height) / Math.max(1, displayedHeight) - 16,
  );
  let measuredWidth = context.measureText(value).width;
  if (measuredWidth > sourceWidthLimit) {
    textureFontSize *= sourceWidthLimit / measuredWidth;
    context.font = `500 ${textureFontSize}px Manrope, sans-serif`;
    measuredWidth = context.measureText(value).width;
  }
  const width = Math.max(24, Math.ceil(measuredWidth + 16));
  if (layer.canvas.width !== width || layer.canvas.height !== height) {
    resizeCanvas(layer, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }
  const paintContext = layer.context;
  if (paintContext === null) return layer.renderedAspect;
  paintContext.font = `500 ${textureFontSize}px Manrope, sans-serif`;
  paintContext.fillStyle = layer.color;
  paintContext.textAlign = layer.alignment;
  paintContext.textBaseline = 'middle';
  paintContext.fillText(
    value,
    layer.alignment === 'right'
      ? layer.canvas.width - 8
      : layer.alignment === 'center'
        ? layer.canvas.width / 2
        : 8,
    height / 2,
    width - 16,
  );
  if (layer.texture !== null) layer.texture.needsUpdate = true;
  layer.value = value;
  layer.renderedHeight = displayedHeight;
  layer.renderedWidth = availableWidth;
  layer.renderedAspect = width / height;
  return layer.renderedAspect;
}

function createTextTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

interface BuildingInstance {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly phase: number;
}

interface CanvasTextLayer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  texture: THREE.CanvasTexture | null;
  readonly material: THREE.MeshBasicMaterial;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly fontSize: number;
  readonly color: string;
  readonly alignment: 'left' | 'center' | 'right';
  value: string;
  renderedHeight: number;
  renderedWidth: number;
  renderedAspect: number;
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
  const textures = new Set<THREE.Texture>();
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
  let lastFrame: {
    readonly city: SceneStateProjection;
    readonly gameplay: GameplayFrame;
  } | null = null;

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
    for (const texture of textures) texture.dispose();
    textures.clear();
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
    renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene.fog = new THREE.Fog(0x111a2b, 18, 42);
    const cityscape = new THREE.Group();
    scene.add(cityscape);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.layers.set(0);
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

    const stageCamera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 200);
    stageCamera.layers.set(1);
    stageCamera.position.set(0, 0, 100);
    stageCamera.lookAt(0, 0, 0);
    const boardCamera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 200);
    boardCamera.layers.set(2);
    boardCamera.position.set(0, 0, 100);
    boardCamera.lookAt(0, 0, 0);
    const stageLayer = new THREE.Group();
    stageLayer.layers.set(1);
    stageLayer.name = 'gameplay-stage';
    const boardLayer = new THREE.Group();
    boardLayer.layers.set(2);
    boardLayer.name = 'gameplay-board';
    scene.add(stageLayer, boardLayer);

    const planeGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
    function makeTextLayer(
      parent: THREE.Group,
      role: string,
      color: string,
      fontSize: number,
      alignment: CanvasTextLayer['alignment'],
    ): CanvasTextLayer {
      const canvas =
        typeof document === 'undefined'
          ? ({ width: 512, height: 64 } as HTMLCanvasElement)
          : document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 128;
      const context =
        typeof document === 'undefined' ? null : canvas.getContext('2d');
      let texture: THREE.CanvasTexture | null = null;
      if (context !== null) {
        texture = createTextTexture(canvas);
        textures.add(texture);
      }
      const material = ownMaterial(
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          opacity: texture === null ? 0 : 1,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      material.fog = false;
      const mesh = new THREE.Mesh(planeGeometry, material);
      mesh.layers.mask = parent.layers.mask;
      mesh.userData.gameplayRole = role;
      parent.add(mesh);
      return {
        canvas,
        context,
        texture,
        material,
        mesh,
        fontSize,
        color,
        alignment,
        value: '',
        renderedHeight: 0,
        renderedWidth: 0,
        renderedAspect: canvas.width / canvas.height,
      };
    }
    function resizeTextCanvas(
      layer: CanvasTextLayer,
      width: number,
      height: number,
    ): void {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Unable to create text canvas');

      const texture = createTextTexture(canvas);
      const oldTexture = layer.texture;
      layer.canvas = canvas;
      layer.context = context;
      layer.texture = texture;
      layer.material.map = texture;
      layer.material.opacity = 1;
      textures.add(texture);
      if (oldTexture !== null) {
        textures.delete(oldTexture);
        oldTexture.dispose();
      }
    }
    const stageBackdropMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x09101d,
        transparent: true,
        opacity: 0.64,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const boardBackdropMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x080e1a,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const laneMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x9ab9c5,
        transparent: true,
        opacity: 0.055,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const laneAltMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.025,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    laneAltMaterial.fog = false;
    const separatorMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xd9e8ea,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const goodMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffd475,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const goodEdgeMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffd475,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const perfectMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x9de7d0,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const perfectEdgeMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xc5f5e7,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const hitMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffd475,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const padMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xf4f0df,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const stageBackdrop = createPlane(
      stageLayer,
      planeGeometry,
      stageBackdropMaterial,
      'stage-backdrop',
    );
    const stageBorderMaterial = ownMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xccdee3,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const stageEdges = Array.from({ length: 4 }, () =>
      createPlane(stageLayer, planeGeometry, stageBorderMaterial, 'stage-edge'),
    );
    const boardBackdrop = createPlane(
      boardLayer,
      planeGeometry,
      boardBackdropMaterial,
      'board-backdrop',
    );
    const laneMeshes: THREE.Mesh[] = [];
    const laneDividers: THREE.Mesh[] = [];
    const goodBands: THREE.Mesh[] = [];
    const goodEdges: THREE.Mesh[] = [];
    const perfectBands: THREE.Mesh[] = [];
    const perfectEdges: THREE.Mesh[] = [];
    const hitPads: THREE.Mesh[] = [];
    const laneKeyLabels: CanvasTextLayer[] = [];
    for (let lane = 0; lane < 4; lane += 1) {
      laneMeshes.push(
        createPlane(boardLayer, planeGeometry, laneMaterial, 'lane'),
      );
      laneDividers.push(
        createPlane(
          boardLayer,
          planeGeometry,
          separatorMaterial,
          'lane-divider',
        ),
      );
      goodBands.push(
        createPlane(boardLayer, planeGeometry, goodMaterial, 'good-band'),
      );
      goodEdges.push(
        createPlane(boardLayer, planeGeometry, goodEdgeMaterial, 'good-edge'),
        createPlane(boardLayer, planeGeometry, goodEdgeMaterial, 'good-edge'),
      );
      perfectBands.push(
        createPlane(boardLayer, planeGeometry, perfectMaterial, 'perfect-band'),
      );
      perfectEdges.push(
        createPlane(
          boardLayer,
          planeGeometry,
          perfectEdgeMaterial,
          'perfect-edge',
        ),
        createPlane(
          boardLayer,
          planeGeometry,
          perfectEdgeMaterial,
          'perfect-edge',
        ),
      );
      hitPads.push(
        createPlane(boardLayer, planeGeometry, padMaterial, 'hit-pad'),
      );
      laneKeyLabels.push(
        makeTextLayer(boardLayer, 'lane-key', '#e5e5d9', 12, 'center'),
      );
    }
    const hitLine = createPlane(
      boardLayer,
      planeGeometry,
      hitMaterial,
      'hit-line',
    );
    const hitLabel = makeTextLayer(
      boardLayer,
      'hit-label',
      '#ffd475',
      10,
      'right',
    );
    const feedbackBacker = createPlane(
      stageLayer,
      planeGeometry,
      boardBackdropMaterial,
      'feedback-backdrop',
    );
    const headerChartText = makeTextLayer(
      stageLayer,
      'stage-label',
      '#bbc6d3',
      12,
      'left',
    );
    const headerTimeText = makeTextLayer(
      stageLayer,
      'time-label',
      '#f4f0df',
      14,
      'right',
    );
    const legendText = makeTextLayer(
      stageLayer,
      'timing-legend',
      '#d7e7df',
      13,
      'left',
    );
    const feedbackText = makeTextLayer(
      stageLayer,
      'feedback',
      '#bbc6d3',
      14,
      'right',
    );
    const noteWindowPool: Array<{
      readonly good: THREE.Mesh;
      readonly perfect: THREE.Mesh;
    }> = [];

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
        stageCamera.left = 0;
        stageCamera.right = width;
        stageCamera.top = height;
        stageCamera.bottom = 0;
        stageCamera.updateProjectionMatrix();
        boardCamera.left = 0;
        boardCamera.right = width;
        boardCamera.top = height;
        boardCamera.bottom = 0;
        boardCamera.updateProjectionMatrix();
        cityscape.scale.x = Math.max(0.38, Math.min(1, camera.aspect / 1.25));
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(width, height, false);
        if (lastFrame !== null) renderFrame(lastFrame);
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
    }

    function placeText(
      layer: CanvasTextLayer,
      rect: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      },
      value: string,
      z: number,
      screenHeight: number,
    ): void {
      const aspect = paintText(
        layer,
        value,
        rect.width,
        rect.height,
        resizeTextCanvas,
      );
      const width = Math.min(rect.width, rect.height * aspect);
      const textHeight = width / aspect;
      const x =
        layer.alignment === 'right'
          ? rect.x + rect.width - width
          : layer.alignment === 'center'
            ? rect.x + (rect.width - width) / 2
            : rect.x;
      placePlane(
        layer.mesh,
        x,
        rect.y + (rect.height - textHeight) / 2,
        width,
        textHeight,
        z,
        screenHeight,
      );
    }

    function ensureNoteWindowPool(capacity: number): void {
      while (noteWindowPool.length < capacity) {
        const good = createPlane(
          boardLayer,
          planeGeometry,
          goodMaterial,
          'note-good-envelope',
        );
        const perfect = createPlane(
          boardLayer,
          planeGeometry,
          perfectMaterial,
          'note-perfect-envelope',
        );
        noteWindowPool.push({ good, perfect });
      }
    }

    function renderGameplay(frame: GameplayFrame): void {
      const { layout } = frame;
      const activeFeedback =
        frame.feedback !== null &&
        frame.playing &&
        isFeedbackWithinVisibleAge(
          frame.transportTime,
          frame.feedback.onsetTransportTime,
        )
          ? frame.feedback
          : null;
      const width = layout.width;
      const height = layout.height;
      const stage = layout.stage;
      const board = layout.board;
      const boardScale = board.height / LOGICAL_PLAYFIELD_HEIGHT;
      const hitY = board.y + board.height * RUNWAY_HIT_LINE_TOP_FRACTION;

      placePlane(
        stageBackdrop,
        stage.x,
        stage.y,
        stage.width,
        stage.height,
        0,
        height,
      );
      placePlane(stageEdges[0]!, stage.x, stage.y, stage.width, 1, 1, height);
      placePlane(
        stageEdges[1]!,
        stage.x,
        stage.y + stage.height - 1,
        stage.width,
        1,
        1,
        height,
      );
      placePlane(stageEdges[2]!, stage.x, stage.y, 1, stage.height, 1, height);
      placePlane(
        stageEdges[3]!,
        stage.x + stage.width - 1,
        stage.y,
        1,
        stage.height,
        1,
        height,
      );
      placePlane(
        boardBackdrop,
        board.x,
        board.y,
        board.width,
        board.height,
        0,
        height,
      );
      placePlane(
        feedbackBacker,
        layout.feedback.x,
        layout.feedback.y,
        layout.feedback.width,
        layout.feedback.height,
        1,
        height,
      );
      feedbackBacker.visible = activeFeedback !== null;

      placeText(
        headerChartText,
        {
          x: layout.header.x,
          y: layout.header.y,
          width: layout.header.width * 0.76,
          height: layout.header.height,
        },
        'Onset-derived chart · play-test timing',
        3,
        height,
      );
      placeText(
        headerTimeText,
        {
          x: layout.header.x + layout.header.width * 0.78,
          y: layout.header.y,
          width: layout.header.width * 0.22,
          height: layout.header.height,
        },
        frame.timeLabel,
        3,
        height,
      );
      placeText(legendText, layout.legend, frame.legendLabel, 3, height);
      legendText.mesh.visible = frame.playing;
      const countdownVisible = frame.countdownLabel.length > 0;
      placeText(
        feedbackText,
        layout.feedback,
        countdownVisible ? frame.countdownLabel : frame.feedbackLabel,
        3,
        height,
      );
      feedbackText.mesh.material.color.set(
        activeFeedback?.quality === 'perfect'
          ? 0xffd475
          : activeFeedback?.quality === 'good'
            ? 0x9de7d0
            : 0xbbc6d3,
      );
      feedbackText.mesh.userData.activeJudgement = activeFeedback !== null;
      feedbackText.mesh.userData.eventId = activeFeedback?.eventId ?? null;
      feedbackText.mesh.userData.runId = activeFeedback?.runId ?? null;

      for (let index = 0; index < 4; index += 1) {
        const lane = frame.lanes[index];
        if (lane === undefined) continue;
        placePlane(
          laneMeshes[index]!,
          lane.x,
          board.y,
          lane.width,
          board.height,
          1,
          height,
        );
        laneMeshes[index]!.material =
          index % 2 === 0 ? laneMaterial : laneAltMaterial;
        laneMeshes[index]!.renderOrder = 1;
        if (index < 3) {
          placePlane(
            laneDividers[index]!,
            lane.x + lane.width - 0.5 * boardScale,
            board.y,
            boardScale,
            board.height,
            2,
            height,
          );
        } else {
          laneDividers[index]!.visible = false;
        }
        const goodHeight = frame.timingWindows.goodEnvelopeHeightPx;
        const goodY = hitY - frame.timingWindows.goodHalfHeightPx;
        const goodX = lane.x + lane.width * 0.08;
        const goodWidth = lane.width * 0.84;
        placePlane(
          goodBands[index]!,
          goodX,
          goodY,
          goodWidth,
          goodHeight,
          3,
          height,
        );
        placePlane(
          goodEdges[index * 2]!,
          goodX,
          goodY,
          goodWidth,
          boardScale,
          4,
          height,
        );
        placePlane(
          goodEdges[index * 2 + 1]!,
          goodX,
          goodY + goodHeight - boardScale,
          goodWidth,
          boardScale,
          4,
          height,
        );
        const perfectHeight = frame.timingWindows.perfectEnvelopeHeightPx;
        const perfectY = hitY - frame.timingWindows.perfectHalfHeightPx;
        const perfectX = lane.x + lane.width * 0.16;
        const perfectWidth = lane.width * 0.68;
        placePlane(
          perfectBands[index]!,
          perfectX,
          perfectY,
          perfectWidth,
          perfectHeight,
          5,
          height,
        );
        placePlane(
          perfectEdges[index * 2]!,
          perfectX,
          perfectY,
          perfectWidth,
          boardScale,
          6,
          height,
        );
        placePlane(
          perfectEdges[index * 2 + 1]!,
          perfectX,
          perfectY + perfectHeight - boardScale,
          perfectWidth,
          boardScale,
          6,
          height,
        );
        placePlane(
          hitPads[index]!,
          lane.x + lane.width * 0.13,
          hitY - 9 * boardScale,
          lane.width * 0.74,
          18 * boardScale,
          7,
          height,
        );
        const keyText = ['D', 'F', 'J', 'K'][index] ?? '';
        placeText(
          laneKeyLabels[index]!,
          {
            x: lane.x + lane.width * 0.3,
            y: board.y + 8 * boardScale,
            width: lane.width * 0.4,
            height: 22 * boardScale,
          },
          keyText,
          8,
          height,
        );
      }
      placePlane(
        hitLine,
        board.x,
        hitY - boardScale,
        board.width,
        2 * boardScale,
        8,
        height,
      );
      placeText(
        hitLabel,
        {
          x: board.x + board.width - 45 * boardScale,
          y: hitY - 19 * boardScale,
          width: 38 * boardScale,
          height: 14 * boardScale,
        },
        'HIT',
        9,
        height,
      );

      ensureNoteWindowPool(frame.noteCapacity);
      for (let index = 0; index < noteWindowPool.length; index += 1) {
        const pool = noteWindowPool[index];
        const projected = frame.notes[index];
        if (pool === undefined || projected === undefined) {
          if (pool !== undefined) {
            pool.good.visible = false;
            pool.perfect.visible = false;
          }
          continue;
        }
        const lane = frame.lanes[projected.lane];
        if (lane === undefined) continue;
        const centerX = lane.x + lane.width / 2;
        const centerY =
          board.y + board.height * (1 - projected.bottomPercent / 100);
        const windows = frame.timingWindows;
        const envelopeWidth = Math.min(lane.width * 0.78, 80 * boardScale);
        placePlane(
          pool.good,
          centerX - envelopeWidth / 2,
          centerY - windows.goodHalfHeightPx,
          envelopeWidth,
          windows.goodEnvelopeHeightPx,
          9,
          height,
        );
        placePlane(
          pool.perfect,
          centerX - envelopeWidth / 2,
          centerY - windows.perfectHalfHeightPx,
          envelopeWidth,
          windows.perfectEnvelopeHeightPx,
          10,
          height,
        );
        pool.good.visible = frame.playing;
        pool.perfect.visible = frame.playing;
      }

      if (countdownVisible) {
        feedbackBacker.visible = true;
      }

      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(
        stage.x,
        height - stage.y - stage.height,
        stage.width,
        stage.height,
      );
      renderer.setScissorTest(true);
      renderer.clearDepth();
      renderer.render(scene, stageCamera);

      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(
        board.x,
        height - board.y - board.height,
        board.width,
        board.height,
      );
      renderer.clearDepth();
      renderer.render(scene, boardCamera);

      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
    }

    function renderFrame(frame: {
      readonly city: SceneStateProjection;
      readonly gameplay: GameplayFrame;
    }): void {
      render(frame.city, frame.gameplay.transportTime);
      renderGameplay(frame.gameplay);
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
      updateFrame(frame) {
        if (cleaned) return;
        lastFrame = frame;
        try {
          renderFrame(frame);
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
