import * as THREE from 'three';
import type { GameplayFrame } from './gameplay-frame';
import type { BrightvaleAssets } from './brightvale/assets';
import { loadBrightvaleRuntimeAssets } from './brightvale/assets-runtime';
import {
  createBrightvaleComposition,
  type BrightvaleComposition,
} from './brightvale/composition';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './brightvale/layout';
import {
  createBrightvaleCameraProjection,
  createBrightvaleSurfaceProfile,
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
  readonly texture: THREE.CanvasTexture | null;
  value: string;
  width: number;
  height: number;
}

interface NoteVisual {
  readonly good: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly perfect: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly bar: THREE.Mesh<THREE.BoxGeometry, THREE.Material>;
}

const LANE_COLORS = [0x65d8ff, 0xe98bc8, 0xffd475, 0x91e6b0] as const;
const LANE_WIDTH = 2.35;
const NOTE_THICKNESS = 0.08;
const NOTE_LENGTH = 0.3;
const WINDOW_WIDTH = 2.55;
const WINDOW_SEGMENTS = 12;
const DEVICE_PIXEL_RATIO_CAP = 1.5;

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
): void {
  const { mesh, canvas, context, texture } = label;
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  mesh.position.set(rect.x + width / 2, rect.y + height / 2, 1);
  mesh.scale.set(width, height, 1);
  mesh.visible = text.length > 0 && width > 0 && height > 0 && context !== null;
  if (context === null || canvas === null || texture === null || !mesh.visible)
    return;
  if (label.value === text && label.width === width && label.height === height)
    return;

  const ratio = Math.max(1, pixelRatio);
  canvas.width = Math.max(1, Math.ceil(width * ratio));
  canvas.height = Math.max(1, Math.ceil(height * ratio));
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
  texture.needsUpdate = true;
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
    layout.labels.feedback,
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
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 10);
  overlayCamera.position.set(0, 0, 5);
  overlayCamera.lookAt(0, 0, 0);
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  const overlayLabels = new Map<string, OverlayLabel>();
  const noteVisuals: NoteVisual[] = [];
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
        if (context !== null) {
          texture = new THREE.CanvasTexture(canvasElement);
          texture.colorSpace = THREE.SRGBColorSpace;
          material.map = texture;
          ownedTextures.add(texture);
        }
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
    'feedback',
    'lane-0',
    'lane-1',
    'lane-2',
    'lane-3',
    'hit',
  ])
    createLabel(name);

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
  };

  let lastFrame: FrameState | null = null;
  let lastProjectionKey = '';
  let disposed = false;
  let failureNotified = false;
  let observer: ResizeObserver | null = null;
  let resizeListener: (() => void) | null = null;
  let shell: ReturnType<typeof createBrightvaleSceneShell> | null = null;
  let rendererWidth = -1;
  let rendererHeight = -1;
  let rendererPixelRatio = -1;

  const setRendererSize = (width: number, height: number): void => {
    if (rendererWidth === width && rendererHeight === height) return;
    renderer.setSize(width, height, false);
    rendererWidth = width;
    rendererHeight = height;
  };

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

  const alignCanvasToContentBox = (): void => {
    if (!('style' in canvas) || typeof getComputedStyle !== 'function') return;
    const style = getComputedStyle(host);
    const pixels = (value: string): number => Number.parseFloat(value) || 0;
    canvas.style.left = `${pixels(style.paddingLeft)}px`;
    canvas.style.right = `${pixels(style.paddingRight)}px`;
    canvas.style.top = `${pixels(style.paddingTop)}px`;
    canvas.style.bottom = `${pixels(style.paddingBottom)}px`;
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
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
      alignCanvasToContentBox();
      setRendererPixelRatio();
      setRendererSize(layout.width, layout.height);
      shell?.updateFrame({ viewportUsable: viewportUsable(layout) });
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

  const renderFrame = (): void => {
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
    setRectLabel(
      label('time'),
      frame.gameplay.timeLabel,
      layout.labels.time,
      {
        color: '#f4f0df',
        align: 'right',
      },
      pixelRatio,
    );
    setRectLabel(
      label('countdown'),
      frame.gameplay.countdownLabel,
      layout.labels.countdown,
      { color: '#f4f0df', align: 'center' },
      pixelRatio,
    );
    setRectLabel(
      label('legend'),
      frame.gameplay.legendLabel,
      layout.labels.legend,
      { color: '#d7e7df', align: 'center' },
      pixelRatio,
    );
    setRectLabel(
      label('feedback'),
      frame.gameplay.feedbackLabel,
      layout.labels.feedback,
      {
        color:
          frame.gameplay.feedback?.quality === 'perfect'
            ? '#ffd475'
            : frame.gameplay.feedback?.quality === 'good'
              ? '#9de7d0'
              : '#bbc6d3',
        align: 'center',
      },
      pixelRatio,
    );

    const anchors = [0, 1, 2, 3].map((lane) =>
      composition.projection!.project(playfield.hitAnchor(lane)),
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
      );
    });
    const targetMean = anchors.reduce(
      (sum, anchor) => ({ x: sum.x + anchor.x / 4, y: sum.y + anchor.y / 4 }),
      { x: 0, y: 0 },
    );
    setRectLabel(
      label('hit'),
      'HIT',
      {
        x: targetMean.x - 44,
        y: targetMean.y + 30,
        width: 88,
        height: 28,
      },
      {
        color: '#fff7dd',
        align: 'center',
        fontScale: 0.78,
        fontWeight: 700,
        outlineColor: '#39251b',
        outlineWidth: 2,
        backgroundColor: 'rgba(42, 30, 26, 0.94)',
      },
      pixelRatio,
    );

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
  ): BrightvaleShellComposition => {
    const frame = lastFrame;
    if (frame === null)
      throw new Error('cannot compose without a viewport frame');
    if (dependencies === undefined) {
      composition.profile = createBrightvaleSurfaceProfile(assets.roots);
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
    alignCanvasToContentBox();
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
      loadAssets:
        dependencies?.loadAssets ??
        ((signal) => loadBrightvaleRuntimeAssets(signal)),
      createComposition: createShellComposition,
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
        alignCanvasToContentBox();
        const size = readHostContentSize();
        width = size.width;
        height = size.height;
        setRendererPixelRatio();
        setRendererSize(width, height);
        if (
          lastFrame !== null &&
          lastFrame.gameplay.layout.width === width &&
          lastFrame.gameplay.layout.height === height
        )
          shell?.updateFrame({ viewportUsable: width > 0 && height > 0 });
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
      });
      if (composition.projection !== null && !composition.projection.usable)
        return 'suspended';
      return status;
    },
    destroy(): void {
      cleanup();
    },
  };
}
