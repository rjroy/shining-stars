import * as THREE from 'three';
import type { GameplayFrame } from './gameplay-frame';
import { FEEDBACK_VISIBLE_SECONDS } from './gameplay-frame';
import type { BrightvaleAssets } from './brightvale/assets';
import {
  createObservatoryComposition,
  type ObservatoryComposition,
  type ObservatoryProjectedAnchor,
} from './observatory-scene';
import { loadBrightvaleRuntimeAssets } from './brightvale/assets-runtime';
import {
  createBrightvaleComposition,
  type BrightvaleComposition,
} from './brightvale/composition';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './brightvale/layout';
import {
  createBrightvaleCameraProjection,
  createBrightvaleSurfaceProfile,
  getFrontPlatformProgress,
  type BrightvaleCameraProjection,
  type BrightvaleMeasuredSurfaceProfile,
  type BrightvaleProgressRange,
} from './brightvale/projection';
import {
  createBrightvalePlayfieldContract,
  type BrightvalePlayfieldContract,
} from './brightvale/playfield';
import {
  createBrightvaleSceneShell,
  type BrightvaleFrameStatus,
  type BrightvaleShellComposition,
} from './brightvale/scene-shell';
import type { SceneStateProjection } from './scene-state';
import type {
  BrightvaleRendererStatus,
  BrightvaleViewportLayout,
  BrightvaleViewportRect,
} from './brightvale/viewport';

export interface BrightvaleScene {
  /** Render the latest app-owned state and report whether the viewport is ready. */
  updateFrame(frame: {
    readonly city: SceneStateProjection;
    readonly gameplay: GameplayFrame;
  }): BrightvaleRendererStatus;
  updateObservatoryFrame(frame: {
    readonly width: number;
    readonly height: number;
    readonly elapsedSeconds: number;
    readonly reducedMotion: boolean;
  }): BrightvaleRendererStatus;
  getObservatoryAnchors(): readonly ObservatoryProjectedAnchor[];
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

/** Narrow seam for deterministic facade lifecycle tests. */
export interface BrightvaleSceneDependencies {
  readonly loadAssets: (signal: AbortSignal) => Promise<BrightvaleAssets>;
  readonly createComposition: (
    assets: BrightvaleAssets,
    world: THREE.Scene,
  ) => BrightvaleShellComposition;
}

interface FrameState {
  readonly city: SceneStateProjection;
  readonly gameplay: GameplayFrame;
}

interface OverlayLabel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly canvas: HTMLCanvasElement | null;
  readonly context: CanvasRenderingContext2D | null;
  texture: THREE.CanvasTexture | null;
  value: string;
  width: number;
  height: number;
}

interface NoteVisual {
  readonly good: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly perfect: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly bar: THREE.Mesh<THREE.BoxGeometry, THREE.Material>;
}

interface JudgmentVisual {
  readonly group: THREE.Group;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly rays: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

const LANE_COLORS = [0x65d8ff, 0xe98bc8, 0xffd475, 0x91e6b0] as const;
const LANE_WIDTH = 2.35;
const NOTE_THICKNESS = 0.08;
const NOTE_LENGTH = 0.3;
const WINDOW_WIDTH = 2.55;
const WINDOW_SEGMENTS = 12;
const DEVICE_PIXEL_RATIO_CAP = 1.5;
const JUDGMENT_COLORS = {
  perfect: 0xffe596,
  good: 0xa8eedb,
  miss: 0xd8bfd8,
} as const;

function timingProgress(frame: GameplayFrame): BrightvaleProgressRange {
  const half = frame.timingWindows.goodHalfProgress;
  return {
    minimum: -half,
    maximum: 1 + half,
  };
}

function viewportUsable(layout: BrightvaleViewportLayout): boolean {
  return layout.width > 0 && layout.height > 0;
}

function makeEnvelopeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array((WINDOW_SEGMENTS + 1) * 2 * 3);
  const indices: number[] = [];
  for (let index = 0; index < WINDOW_SEGMENTS; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry;
}

function makeJudgmentRayGeometry(): THREE.BufferGeometry {
  const points: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const inner = index % 2 === 0 ? 0.2 : 0.29;
    const outer = index % 2 === 0 ? 1.15 : 0.88;
    const halfWidth = index % 2 === 0 ? 0.12 : 0.075;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    const px = -y * halfWidth;
    const py = x * halfWidth;
    points.push(
      x * inner + px,
      y * inner + py,
      0,
      x * outer,
      y * outer,
      0,
      x * inner - px,
      y * inner - py,
      0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function setRectLabel(
  label: OverlayLabel,
  text: string,
  rect: BrightvaleViewportRect,
  options: {
    readonly color: string;
    readonly align: CanvasTextAlign;
    readonly fontScale?: number;
    readonly fontWeight?: number;
    readonly outlineColor?: string;
    readonly outlineWidth?: number;
    readonly backgroundColor?: string;
  },
  pixelRatio: number,
  ownedTextures: Set<THREE.Texture>,
): void {
  const { mesh, canvas, context } = label;
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  mesh.position.set(rect.x + width / 2, rect.y + height / 2, 1);
  mesh.scale.set(width, height, 1);
  mesh.visible = text.length > 0 && width > 0 && height > 0 && context !== null;
  if (context === null || canvas === null || !mesh.visible) return;
  if (label.value === text && label.width === width && label.height === height)
    return;

  const ratio = Math.max(1, pixelRatio);
  const canvasWidth = Math.max(1, Math.ceil(width * ratio));
  const canvasHeight = Math.max(1, Math.ceil(height * ratio));
  const canvasResized =
    canvas.width !== canvasWidth || canvas.height !== canvasHeight;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (options.backgroundColor !== undefined) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = options.color;
  if (options.outlineColor !== undefined && (options.outlineWidth ?? 0) > 0) {
    context.strokeStyle = options.outlineColor;
    context.lineWidth = options.outlineWidth ?? 0;
    context.lineJoin = 'round';
  }
  context.textAlign = options.align;
  context.textBaseline = 'middle';
  context.font = `${options.fontWeight ?? 400} ${Math.max(10, Math.round(height * (options.fontScale ?? 0.58) * ratio))}px Manrope, sans-serif`;
  const x =
    options.align === 'left'
      ? 0
      : options.align === 'right'
        ? canvas.width
        : canvas.width / 2;
  if (options.outlineColor !== undefined && (options.outlineWidth ?? 0) > 0)
    context.strokeText(text, x, canvas.height / 2, canvas.width);
  context.fillText(text, x, canvas.height / 2, canvas.width);
  const texture = label.texture;
  if (texture === null) {
    const initialTexture = new THREE.CanvasTexture(canvas);
    initialTexture.colorSpace = THREE.SRGBColorSpace;
    label.mesh.material.map = initialTexture;
    label.texture = initialTexture;
    ownedTextures.add(initialTexture);
  } else if (canvasResized) {
    const resizedTexture = new THREE.CanvasTexture(canvas);
    try {
      resizedTexture.copy(texture);
      label.mesh.material.map = resizedTexture;
      label.texture = resizedTexture;
      ownedTextures.add(resizedTexture);
      ownedTextures.delete(texture);
      texture.dispose();
    } catch (error) {
      resizedTexture.dispose();
      throw error;
    }
  } else {
    texture.needsUpdate = true;
  }
  label.value = text;
  label.width = width;
  label.height = height;
}

function normalizedLayoutKey(
  layout: BrightvaleViewportLayout,
  range: BrightvaleProgressRange,
): string {
  return JSON.stringify([
    layout.width,
    layout.height,
    layout.persistentHudExclusions,
    layout.labels.time,
    layout.labels.countdown,
    layout.labels.legend,
    range.minimum,
    range.maximum,
  ]);
}

/** Create the scene facade around one renderer and one asynchronous asset shell. */
export function createBrightvaleScene(
  host: HTMLElement,
  onUnavailable: () => void,
  rendererFactory: SceneRendererFactory = (parameters) =>
    new THREE.WebGLRenderer(parameters),
  dependencies?: BrightvaleSceneDependencies,
): BrightvaleScene | null {
  let renderer: SceneRenderer;
  try {
    renderer = rendererFactory({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch (error) {
    console.error('[Brightvale] renderer initialization failed', { error });
    onUnavailable();
    return null;
  }

  const canvas = renderer.domElement;
  const worldScene = new THREE.Scene();
  const observatoryScene = new THREE.Scene();
  observatoryScene.background = new THREE.Color('#100d2a');
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 10);
  overlayCamera.position.set(0, 0, 5);
  overlayCamera.lookAt(0, 0, 0);
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  const overlayLabels = new Map<string, OverlayLabel>();
  const noteVisuals: NoteVisual[] = [];
  const judgmentVisuals: JudgmentVisual[] = [];
  const barGeometry = new THREE.BoxGeometry(
    LANE_WIDTH,
    NOTE_THICKNESS,
    NOTE_LENGTH,
  );
  const goodMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd475,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const perfectMaterial = new THREE.MeshBasicMaterial({
    color: 0x9de7d0,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const barMaterials = LANE_COLORS.map(
    (color) =>
      new THREE.MeshToonMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.12,
        transparent: true,
        opacity: 0.96,
        side: THREE.DoubleSide,
      }),
  );
  ownedGeometries.add(barGeometry);
  ownedMaterials.add(goodMaterial);
  ownedMaterials.add(perfectMaterial);
  barMaterials.forEach((material) => ownedMaterials.add(material));

  const createLabel = (name: string): OverlayLabel => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    ownedGeometries.add(geometry);
    ownedMaterials.add(material);
    let canvasElement: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D | null = null;
    let texture: THREE.CanvasTexture | null = null;
    try {
      if (typeof document !== 'undefined') {
        canvasElement = document.createElement('canvas');
        canvasElement.width = 1;
        canvasElement.height = 1;
        context = canvasElement.getContext('2d');
      }
    } catch {
      context = null;
      texture = null;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Brightvale.Label.${name}`;
    mesh.userData.gameplayRole = 'screen-label';
    mesh.rotation.x = Math.PI;
    mesh.visible = false;
    overlayScene.add(mesh);
    const result: OverlayLabel = {
      mesh,
      canvas: canvasElement,
      context,
      texture,
      value: '',
      width: 0,
      height: 0,
    };
    overlayLabels.set(name, result);
    return result;
  };

  for (const name of [
    'time',
    'countdown',
    'legend',
    'lane-0',
    'lane-1',
    'lane-2',
    'lane-3',
  ])
    createLabel(name);

  for (let lane = 0; lane < 4; lane += 1) {
    const group = new THREE.Group();
    group.name = `Brightvale.Judgment.${lane}`;
    group.userData.gameplayRole = 'lane-judgment-effect';
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: JUDGMENT_COLORS.perfect,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const rayMaterial = new THREE.MeshBasicMaterial({
      color: JUDGMENT_COLORS.perfect,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.43, 32),
      ringMaterial,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.012;
    ring.userData.gameplayRole = 'lane-judgment-ring';
    ring.renderOrder = 20;
    const rays = new THREE.Mesh(makeJudgmentRayGeometry(), rayMaterial);
    rays.rotation.x = Math.PI / 2;
    rays.position.y = 0.018;
    rays.userData.gameplayRole = 'lane-judgment-rays';
    rays.renderOrder = 21;
    group.add(ring, rays);
    group.visible = false;
    worldScene.add(group);
    ownedGeometries.add(ring.geometry);
    ownedGeometries.add(rays.geometry);
    ownedMaterials.add(ringMaterial);
    ownedMaterials.add(rayMaterial);
    judgmentVisuals.push({ group, ring, rays });
    createLabel(`judgment-${lane}`);
  }

  const playfieldMatrix = new THREE.Matrix4().fromArray([
    ...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor,
  ]);
  const playfieldRotation = new THREE.Quaternion().setFromRotationMatrix(
    playfieldMatrix,
  );
  const composition = {
    current: null as BrightvaleComposition | null,
    profile: null as BrightvaleMeasuredSurfaceProfile | null,
    playfield: createBrightvalePlayfieldContract(),
    projection: null as BrightvaleCameraProjection | null,
    frontProgress: 1,
  };

  let lastFrame: FrameState | null = null;
  let observatoryFrame = { elapsedSeconds: 0, reducedMotion: false };
  let observatoryViewport = { width: 0, height: 0 };
  let activeMode: 'gameplay' | 'observatory' = 'gameplay';
  let observatoryComposition: ObservatoryComposition | null = null;
  let lastProjectionKey = '';
  let disposed = false;
  let failureNotified = false;
  let observer: ResizeObserver | null = null;
  let resizeListener: (() => void) | null = null;
  let shell: ReturnType<typeof createBrightvaleSceneShell> | null = null;
  let rendererWidth = -1;
  let rendererHeight = -1;
  let rendererPixelRatio = -1;

  const setRendererPixelRatio = (): void => {
    const pixelRatio = Math.min(
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      DEVICE_PIXEL_RATIO_CAP,
    );
    if (rendererPixelRatio === pixelRatio) return;
    renderer.setPixelRatio(pixelRatio);
    rendererPixelRatio = pixelRatio;
  };

  const notifyUnavailable = (): void => {
    if (failureNotified) return;
    failureNotified = true;
    try {
      onUnavailable();
    } catch (error) {
      console.error('[Brightvale] unavailable callback failed', { error });
    }
  };

  const alignCanvasToContentBox = (width: number, height: number): void => {
    if (!('style' in canvas) || typeof getComputedStyle !== 'function') return;
    const style = getComputedStyle(host);
    const pixels = (value: string): number => Number.parseFloat(value) || 0;
    const css = {
      left: `${pixels(style.paddingLeft)}px`,
      top: `${pixels(style.paddingTop)}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
    if (canvas.style.left !== css.left) canvas.style.left = css.left;
    if (canvas.style.top !== css.top) canvas.style.top = css.top;
    if (canvas.style.right !== 'auto') canvas.style.right = 'auto';
    if (canvas.style.bottom !== 'auto') canvas.style.bottom = 'auto';
    if (canvas.style.width !== css.width) canvas.style.width = css.width;
    if (canvas.style.height !== css.height) canvas.style.height = css.height;
  };

  const setRendererSize = (width: number, height: number): void => {
    // Three.js sizes the drawing buffer in DPR-scaled pixels. Keep the CSS box
    // in measured host-content CSS pixels, even when those logical dimensions
    // have not changed since a DPR-only resize.
    alignCanvasToContentBox(width, height);
    if (rendererWidth === width && rendererHeight === height) return;
    renderer.setSize(width, height, false);
    rendererWidth = width;
    rendererHeight = height;
  };

  const readHostContentSize = (): { width: number; height: number } => {
    if (typeof getComputedStyle !== 'function')
      return { width: host.clientWidth, height: host.clientHeight };
    const style = getComputedStyle(host);
    const pixels = (value: string): number => Number.parseFloat(value) || 0;
    const rect = host.getBoundingClientRect();
    return {
      width: Math.max(
        0,
        rect.width -
          pixels(style.borderLeftWidth) -
          pixels(style.borderRightWidth) -
          pixels(style.paddingLeft) -
          pixels(style.paddingRight),
      ),
      height: Math.max(
        0,
        rect.height -
          pixels(style.borderTopWidth) -
          pixels(style.borderBottomWidth) -
          pixels(style.paddingTop) -
          pixels(style.paddingBottom),
      ),
    };
  };

  const onLayoutMeasured = (event: Event): void => {
    if (disposed || lastFrame === null) return;
    const layout = (event as CustomEvent<BrightvaleViewportLayout>).detail;
    if (layout === undefined) return;
    lastFrame = {
      city: lastFrame.city,
      gameplay: { ...lastFrame.gameplay, layout },
    };
    try {
      setRendererPixelRatio();
      setRendererSize(layout.width, layout.height);
      if (activeMode === 'observatory') {
        observatoryViewport = { width: layout.width, height: layout.height };
      }
      shell?.updateFrame({
        viewportUsable: viewportUsable(layout),
        mode: activeMode,
      });
    } catch (error) {
      console.error('[Brightvale] measured viewport update failed', {
        width: layout.width,
        height: layout.height,
        error,
      });
      shell?.destroy();
      releaseRenderer();
      notifyUnavailable();
    }
  };

  const releaseRenderer = (): void => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    observer = null;
    if (resizeListener !== null && typeof window !== 'undefined')
      window.removeEventListener('resize', resizeListener);
    host.removeEventListener?.('brightvale-layout-measured', onLayoutMeasured);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.remove();
    overlayScene.clear();
    worldScene.clear();
    for (const texture of ownedTextures) texture.dispose();
    ownedTextures.clear();
    for (const geometry of ownedGeometries) geometry.dispose();
    ownedGeometries.clear();
    for (const material of ownedMaterials) material.dispose();
    ownedMaterials.clear();
    renderer.dispose();
    console.info('[Brightvale] scene renderer disposed');
  };

  const resizeOverlay = (layout: BrightvaleViewportLayout): void => {
    overlayCamera.left = 0;
    overlayCamera.right = layout.width;
    overlayCamera.top = 0;
    overlayCamera.bottom = layout.height;
    overlayCamera.updateProjectionMatrix();
    overlayCamera.updateMatrixWorld(true);
  };

  const updateEnvelope = (
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    lane: number,
    start: number,
    end: number,
    playfield: BrightvalePlayfieldContract,
  ): void => {
    const positions = mesh.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const width = WINDOW_WIDTH / 2;
    const inversePlayfield = playfieldMatrix.clone().invert();
    const measuredSurface = composition.profile?.surfaceHeightAt;
    const clearanceHeight = (
      sampleLane: number,
      x: number,
      z: number,
      fallback: number,
    ): number => {
      let height = measuredSurface?.(sampleLane, z, x) ?? null;
      if (height === null && measuredSurface !== undefined) {
        const direction = z < -1.45 ? 1 : -1;
        const nearZ = z + direction * 0.025;
        const farZ = z + direction * 0.075;
        const near = measuredSurface(sampleLane, nearZ, x);
        const far = measuredSurface(sampleLane, farZ, x);
        if (near !== null && far !== null)
          height = near + ((near - far) / (nearZ - farZ)) * (z - nearZ);
        else if (near !== null) height = near;
      }
      return height === null ? fallback + 0.025 : height + 0.03;
    };
    for (let index = 0; index <= WINDOW_SEGMENTS; index += 1) {
      const amount = index / WINDOW_SEGMENTS;
      const progress = THREE.MathUtils.lerp(start, end, amount);
      const center = playfield
        .point(lane, progress)
        .applyMatrix4(inversePlayfield);
      const edge = (x: number): THREE.Vector3 => {
        const local = center.clone();
        local.x = x;
        local.y = clearanceHeight(lane, x, local.z, local.y);
        return local.applyMatrix4(playfieldMatrix);
      };
      const left = edge(center.x - width);
      const right = edge(center.x + width);
      positions.setXYZ(index * 2, left.x, left.y, left.z);
      positions.setXYZ(index * 2 + 1, right.x, right.y, right.z);
    }
    positions.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  };

  const ensureNoteVisuals = (count: number): void => {
    while (noteVisuals.length < count) {
      const goodGeometry = makeEnvelopeGeometry();
      const perfectGeometry = makeEnvelopeGeometry();
      ownedGeometries.add(goodGeometry);
      ownedGeometries.add(perfectGeometry);
      const good = new THREE.Mesh(goodGeometry, goodMaterial);
      const perfect = new THREE.Mesh(perfectGeometry, perfectMaterial);
      good.userData.gameplayRole = 'note-good-envelope';
      perfect.userData.gameplayRole = 'note-perfect-envelope';
      good.frustumCulled = false;
      perfect.frustumCulled = false;
      const bar = new THREE.Mesh(barGeometry, barMaterials[0]!);
      bar.userData.gameplayRole = 'note-bar';
      worldScene.add(good, perfect, bar);
      noteVisuals.push({ good, perfect, bar });
    }
  };

  const renderFrame = (mode: 'gameplay' | 'observatory' = 'gameplay'): void => {
    if (mode === 'observatory') {
      if (observatoryComposition === null)
        throw new Error('Observatory composition is not ready');
      const layout = observatoryViewport;
      observatoryComposition.update({
        width: layout.width,
        height: layout.height,
        elapsedSeconds: observatoryFrame.elapsedSeconds,
        reducedMotion: observatoryFrame.reducedMotion,
      });
      renderer.autoClear = true;
      renderer.setViewport(0, 0, layout.width, layout.height);
      renderer.setScissorTest(false);
      renderer.render(observatoryScene, observatoryComposition.camera);
      return;
    }
    if (lastFrame === null) throw new Error('Brightvale has no gameplay frame');
    const frame = lastFrame;
    const layout = frame.gameplay.layout;
    const range = timingProgress(frame.gameplay);
    if (composition.current === null || composition.projection === null)
      throw new Error('Brightvale composition is not ready');

    const key = normalizedLayoutKey(layout, range);
    if (key !== lastProjectionKey) {
      const usable = composition.projection.resize(layout, range);
      lastProjectionKey = key;
      if (!usable) return;
      resizeOverlay(layout);
    }
    if (!composition.projection.usable) return;
    composition.current.updateAppearance?.(frame.city);

    const playfield = composition.playfield;
    ensureNoteVisuals(frame.gameplay.notes.length);
    for (let index = 0; index < noteVisuals.length; index += 1) {
      const visual = noteVisuals[index];
      const note = frame.gameplay.notes[index];
      if (visual === undefined) continue;
      if (note === undefined || !frame.gameplay.playing) {
        visual.good.visible = false;
        visual.perfect.visible = false;
        visual.bar.visible = false;
        continue;
      }
      const goodHalf = frame.gameplay.timingWindows.goodHalfProgress;
      const perfectHalf = frame.gameplay.timingWindows.perfectHalfProgress;
      updateEnvelope(
        visual.good,
        note.lane,
        note.progress - goodHalf,
        note.progress + goodHalf,
        playfield,
      );
      updateEnvelope(
        visual.perfect,
        note.lane,
        note.progress - perfectHalf,
        note.progress + perfectHalf,
        playfield,
      );
      const noteCenter = playfield.visualPoint(note.lane, note.progress);
      visual.bar.position.copy(noteCenter);
      visual.bar.quaternion.copy(playfieldRotation);
      visual.bar.material = barMaterials[note.lane] ?? barMaterials[0]!;
      visual.bar.visible = true;
      visual.good.visible = true;
      visual.perfect.visible = true;
    }

    const pixelRatio = Math.min(
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      DEVICE_PIXEL_RATIO_CAP,
    );
    const label = (name: string) => overlayLabels.get(name)!;
    const judgmentLabelWidth = Math.min(112, Math.max(72, layout.width / 10));
    for (let lane = 0; lane < 4; lane += 1) {
      const judgmentLabel = label(`judgment-${lane}`);
      setRectLabel(
        judgmentLabel,
        'PERFECT',
        { x: 0, y: 0, width: judgmentLabelWidth, height: 30 },
        {
          color: '#fff4cf',
          align: 'center',
          fontScale: 0.66,
          fontWeight: 800,
          outlineColor: '#17131f',
          outlineWidth: 3 * pixelRatio,
        },
        pixelRatio,
        ownedTextures,
      );
      judgmentLabel.mesh.visible = false;
    }
    setRectLabel(
      label('time'),
      frame.gameplay.timeLabel,
      layout.labels.time,
      {
        color: '#f4f0df',
        align: 'right',
      },
      pixelRatio,
      ownedTextures,
    );
    setRectLabel(
      label('countdown'),
      frame.gameplay.countdownLabel,
      layout.labels.countdown,
      { color: '#f4f0df', align: 'center' },
      pixelRatio,
      ownedTextures,
    );
    setRectLabel(
      label('legend'),
      frame.gameplay.legendLabel,
      layout.labels.legend,
      { color: '#d7e7df', align: 'center' },
      pixelRatio,
      ownedTextures,
    );

    for (const [lane, visual] of judgmentVisuals.entries()) {
      const event = frame.gameplay.feedback.find((item) => item.lane === lane);
      const labelName = `judgment-${lane}`;
      const judgmentLabel = label(labelName);
      if (event === undefined) {
        visual.group.visible = false;
        judgmentLabel.mesh.visible = false;
        continue;
      }

      const progress = Math.min(1, event.age / FEEDBACK_VISIBLE_SECONDS);
      const materialColor = JUDGMENT_COLORS[event.quality];
      const reduced = frame.gameplay.reducedMotion;
      const startScale =
        event.quality === 'perfect'
          ? 0.68
          : event.quality === 'good'
            ? 0.58
            : 0.48;
      const endScale =
        event.quality === 'perfect'
          ? 1.62
          : event.quality === 'good'
            ? 1.14
            : 0.86;
      const scale = reduced
        ? startScale
        : THREE.MathUtils.lerp(startScale, endScale, progress);
      const fade = Math.pow(
        1 - progress,
        event.quality === 'miss' ? 1.15 : 0.68,
      );
      visual.group.visible = true;
      visual.group.position.copy(
        composition.profile === null
          ? playfield.point(lane, 1)
          : playfield.visualPoint(lane, 1),
      );
      visual.group.quaternion.copy(playfieldRotation);
      visual.group.scale.setScalar(scale);
      visual.ring.material.color.setHex(materialColor);
      visual.rays.material.color.setHex(materialColor);
      visual.ring.scale.setScalar(
        event.quality === 'perfect'
          ? 1
          : event.quality === 'good'
            ? 0.88
            : 0.68,
      );
      visual.ring.material.opacity =
        fade *
        (event.quality === 'miss'
          ? 0.78
          : event.quality === 'good'
            ? 0.62
            : 0.95);
      const shimmer = reduced ? 1 : 0.78 + 0.22 * Math.sin(event.age * 30);
      const rayFade =
        event.quality === 'perfect' ? Math.pow(1 - progress, 0.25) : fade;
      visual.rays.material.opacity =
        rayFade *
        shimmer *
        (event.quality === 'perfect' ? 1 : event.quality === 'miss' ? 0.3 : 0);
      visual.rays.scale.setScalar(event.quality === 'miss' ? 0.45 : 1);
      visual.rays.visible = event.quality !== 'good';

      const labelWidth = judgmentLabelWidth;
      const projected = composition.projection.project(
        composition.profile === null
          ? playfield.point(lane, 1)
          : playfield.visualPoint(lane, 1),
      );
      const text =
        event.quality === 'perfect'
          ? 'PERFECT'
          : event.quality === 'good'
            ? 'GOOD'
            : 'MISS';
      const textColor =
        event.quality === 'perfect'
          ? '#fff4cf'
          : event.quality === 'good'
            ? '#e5fff5'
            : '#d1bfd0';
      setRectLabel(
        judgmentLabel,
        text,
        {
          x: projected.x - labelWidth / 2,
          y: projected.y - 41,
          width: labelWidth,
          height: 30,
        },
        {
          color: textColor,
          align: 'center',
          fontScale: 0.66,
          fontWeight: 800,
          outlineColor: '#17131f',
          outlineWidth: 3 * pixelRatio,
        },
        pixelRatio,
        ownedTextures,
      );
      judgmentLabel.mesh.material.opacity = fade;
    }

    // Keycaps sit on each lane's projected front lip, so perspective and
    // viewport changes move them with the loaded platform geometry.
    const anchors = [0, 1, 2, 3].map((lane) =>
      composition.projection!.project(
        playfield.point(lane, composition.frontProgress),
      ),
    );
    anchors.forEach((anchor, lane) => {
      const slot = {
        x: anchor.x - 18,
        y: anchor.y + 4,
        width: 36,
        height: 24,
      };
      setRectLabel(
        label(`lane-${lane}`),
        ['D', 'F', 'J', 'K'][lane] ?? '',
        slot,
        { color: '#f4f0df', align: 'center' },
        pixelRatio,
        ownedTextures,
      );
    });
    const width = layout.width;
    const height = layout.height;
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      renderer.render(worldScene, composition.projection.camera);
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCamera);
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
    }
  };

  const createShellComposition = (
    assets: BrightvaleAssets,
    mode: 'gameplay' | 'observatory' = 'gameplay',
  ): BrightvaleShellComposition => {
    if (mode === 'observatory') {
      observatoryComposition = createObservatoryComposition(assets);
      return observatoryComposition;
    }
    const frame = lastFrame;
    if (frame === null)
      throw new Error('cannot compose without a viewport frame');
    if (dependencies === undefined) {
      composition.profile = createBrightvaleSurfaceProfile(assets.roots);
      composition.frontProgress = getFrontPlatformProgress(
        composition.playfield,
        composition.profile,
      );
      composition.playfield = createBrightvalePlayfieldContract(
        composition.profile,
      );
      composition.projection = createBrightvaleCameraProjection(
        composition.playfield,
        frame.gameplay.layout,
        timingProgress(frame.gameplay),
        composition.profile,
      );
      composition.current = createBrightvaleComposition(
        assets,
        BRIGHTVALE_RUNTIME_LAYOUT,
        worldScene,
      );
    } else {
      composition.playfield = createBrightvalePlayfieldContract();
      composition.projection = createBrightvaleCameraProjection(
        composition.playfield,
        frame.gameplay.layout,
        timingProgress(frame.gameplay),
      );
      composition.current = dependencies.createComposition(
        assets,
        worldScene,
      ) as BrightvaleComposition;
    }
    resizeOverlay(frame.gameplay.layout);
    lastProjectionKey = normalizedLayoutKey(
      frame.gameplay.layout,
      timingProgress(frame.gameplay),
    );
    return composition.current;
  };

  const cleanup = (): void => {
    if (disposed) return;
    shell?.destroy();
    releaseRenderer();
  };

  function onContextLost(event: Event): void {
    event.preventDefault();
    if (disposed) return;
    console.error('[Brightvale] WebGL context lost');
    shell?.destroy();
    releaseRenderer();
    notifyUnavailable();
  }

  try {
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.insertBefore(canvas, host.firstChild);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    setRendererPixelRatio();
    const initialSize = readHostContentSize();
    setRendererSize(initialSize.width, initialSize.height);
    canvas.addEventListener('webglcontextlost', onContextLost);

    shell = createBrightvaleSceneShell({
      scene: worldScene,
      sceneForMode: (mode) =>
        mode === 'observatory' ? observatoryScene : worldScene,
      loadAssets:
        dependencies?.loadAssets ??
        ((signal) => loadBrightvaleRuntimeAssets(signal)),
      createComposition: (assets, mode) => createShellComposition(assets, mode),
      render: renderFrame,
      onFailure: () => {
        releaseRenderer();
        notifyUnavailable();
      },
    });

    const onResize = (): void => {
      if (disposed) return;
      let width = 0;
      let height = 0;
      try {
        const size = readHostContentSize();
        width = size.width;
        height = size.height;
        setRendererPixelRatio();
        setRendererSize(width, height);
        if (activeMode === 'observatory') {
          observatoryViewport = { width, height };
          shell?.updateFrame({
            viewportUsable: width > 0 && height > 0,
            mode: activeMode,
          });
        } else if (
          lastFrame !== null &&
          lastFrame.gameplay.layout.width === width &&
          lastFrame.gameplay.layout.height === height
        )
          shell?.updateFrame({
            viewportUsable: width > 0 && height > 0,
            mode: activeMode,
          });
      } catch (error) {
        console.error('[Brightvale] scene resize failed', {
          width,
          height,
          error,
        });
        shell?.destroy();
        releaseRenderer();
        notifyUnavailable();
      }
    };
    observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(onResize)
        : null;
    if (observer !== null) observer.observe(host);
    else if (typeof window !== 'undefined') {
      resizeListener = onResize;
      window.addEventListener('resize', onResize);
    }
    host.addEventListener?.('brightvale-layout-measured', onLayoutMeasured);
    console.info('[Brightvale] scene renderer initialized');
  } catch (error) {
    console.error('[Brightvale] scene initialization failed', { error });
    shell?.destroy();
    releaseRenderer();
    notifyUnavailable();
    return null;
  }

  return {
    updateFrame(frame): BrightvaleFrameStatus {
      if (disposed || shell === null) return 'unavailable';
      lastFrame = frame;
      if (viewportUsable(frame.gameplay.layout)) {
        try {
          setRendererPixelRatio();
          setRendererSize(
            frame.gameplay.layout.width,
            frame.gameplay.layout.height,
          );
        } catch (error) {
          console.error('[Brightvale] renderer sizing failed', { error });
          shell.destroy();
          releaseRenderer();
          notifyUnavailable();
          return 'unavailable';
        }
      }
      const status = shell.updateFrame({
        viewportUsable: viewportUsable(frame.gameplay.layout),
        mode: 'gameplay',
      });
      activeMode = 'gameplay';
      if (composition.projection !== null && !composition.projection.usable)
        return 'suspended';
      return status;
    },
    updateObservatoryFrame(frame): BrightvaleFrameStatus {
      if (disposed || shell === null) return 'unavailable';
      activeMode = 'observatory';
      observatoryFrame = {
        elapsedSeconds: frame.elapsedSeconds,
        reducedMotion: frame.reducedMotion,
      };
      observatoryViewport = { width: frame.width, height: frame.height };
      if (frame.width > 0 && frame.height > 0) {
        try {
          setRendererPixelRatio();
          setRendererSize(frame.width, frame.height);
        } catch (error) {
          console.error('[Brightvale] Observatory renderer sizing failed', {
            error,
          });
          shell.destroy();
          releaseRenderer();
          notifyUnavailable();
          return 'unavailable';
        }
      }
      return shell.updateFrame({
        viewportUsable: frame.width > 0 && frame.height > 0,
        mode: 'observatory',
      });
    },
    getObservatoryAnchors() {
      return observatoryComposition?.anchors() ?? [];
    },
    destroy(): void {
      cleanup();
    },
  };
}
