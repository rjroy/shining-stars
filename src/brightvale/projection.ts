import * as THREE from 'three';
import type { BrightvaleAssets } from './assets';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './layout';
import type {
  BrightvalePlayfieldContract,
  BrightvaleSurfaceProfile,
} from './playfield';
import type { BrightvaleViewportLayout } from './viewport';

const FIT_EPSILON = 1e-5;
const ENVELOPE_HALF_WIDTH = 2.55 / 2;
const LANE_HALF_WIDTH = 1.375;
const FIT_HALF_WIDTH = Math.max(ENVELOPE_HALF_WIDTH, LANE_HALF_WIDTH);
const ENVELOPE_CLEARANCE = 0.03;
const ENVELOPE_SWEEP_SAMPLES = 128;

interface SurfaceRoot {
  readonly root: THREE.Object3D;
  readonly inverseRoot: THREE.Matrix4;
  readonly bounds: THREE.Box3;
}

function laneCenter(index: number): number {
  return [-4.5, -1.5, 1.5, 4.5][index] ?? 0;
}

const PLAYFIELD_MATRIX = new THREE.Matrix4().fromArray([
  ...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor,
]);
const INVERSE_PLAYFIELD_MATRIX = PLAYFIELD_MATRIX.clone().invert();

function measuredEnvelopePoint(
  playfield: BrightvalePlayfieldContract,
  surface: BrightvaleMeasuredSurfaceProfile | undefined,
  lane: number,
  progress: number,
  lateralOffset: number,
): THREE.Vector3 {
  const local = playfield
    .point(lane, progress)
    .applyMatrix4(INVERSE_PLAYFIELD_MATRIX);
  const x = local.x + lateralOffset;
  let height = surface?.surfaceHeightAt(lane, local.z, x) ?? null;
  if (height === null && surface !== undefined) {
    const direction = local.z < -1.45 ? 1 : -1;
    const nearZ = local.z + direction * 0.025;
    const farZ = local.z + direction * 0.075;
    const near = surface.surfaceHeightAt(lane, nearZ, x);
    const far = surface.surfaceHeightAt(lane, farZ, x);
    if (near !== null && far !== null)
      height = near + ((near - far) / (nearZ - farZ)) * (local.z - nearZ);
    else if (near !== null) height = near;
  }
  local.x = x;
  local.y = height === null ? local.y + 0.025 : height + ENVELOPE_CLEARANCE;
  return local.applyMatrix4(PLAYFIELD_MATRIX);
}

function overlaps(
  left: BrightvaleViewportLayout['labels'][keyof BrightvaleViewportLayout['labels']],
  right: BrightvaleViewportLayout['labels'][keyof BrightvaleViewportLayout['labels']],
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function surfaceRayHeight(
  roots: readonly SurfaceRoot[],
  localX: number,
  localZ: number,
): number | null {
  let highest: number | null = null;
  const localOrigin = new THREE.Vector3(localX, 0, localZ);
  const localDown = new THREE.Vector3(0, -1, 0);

  for (const { root, inverseRoot, bounds } of roots) {
    if (
      localX < bounds.min.x - FIT_EPSILON ||
      localX > bounds.max.x + FIT_EPSILON ||
      localZ < bounds.min.z - FIT_EPSILON ||
      localZ > bounds.max.z + FIT_EPSILON
    )
      continue;

    const origin = localOrigin.clone();
    origin.y = bounds.max.y + 1;
    origin.applyMatrix4(root.matrixWorld);
    const direction = localDown.clone().transformDirection(root.matrixWorld);
    const raycaster = new THREE.Raycaster(origin, direction, 0, 1000);
    const hits = raycaster.intersectObject(root, true);
    for (const hit of hits) {
      const localHit = hit.point.applyMatrix4(inverseRoot);
      if (
        Math.abs(localHit.x - localX) > 1e-4 ||
        Math.abs(localHit.z - localZ) > 1e-4
      )
        continue;
      highest = highest === null ? localHit.y : Math.max(highest, localHit.y);
    }
  }
  return highest;
}

export interface BrightvaleProgressRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface BrightvaleScreenPoint {
  /** Host-relative CSS pixels, not renderer backing-buffer pixels. */
  readonly x: number;
  readonly y: number;
}

/** Surface samples can optionally address the real lateral footprint of notes. */
export interface BrightvaleMeasuredSurfaceProfile extends BrightvaleSurfaceProfile {
  surfaceHeightAt(lane: number, localZ: number, localX?: number): number | null;
  /** Conservative bounds corners for the complete gameplay-critical GLBs. */
  readonly essentialGeometryPoints: Readonly<
    Record<'platform' | 'highway' | 'endcaps', readonly THREE.Vector3[]>
  >;
}

function measuredAssetBoundsCorners(
  root: THREE.Object3D,
  parentMatrix: THREE.Matrix4,
): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    if (positions === undefined) return;
    for (let index = 0; index < positions.count; index += 1) {
      bounds.expandByPoint(
        new THREE.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        )
          .applyMatrix4(object.matrixWorld)
          .applyMatrix4(parentMatrix),
      );
    }
  });
  if (bounds.isEmpty())
    throw new Error('Brightvale essential asset has no mesh bounds');
  const { min, max } = bounds;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

export interface BrightvaleCameraProjection {
  readonly camera: THREE.PerspectiveCamera;
  readonly usable: boolean;
  /** Refit the authored camera for raw host dimensions and current timing extents. */
  resize(
    layout: BrightvaleViewportLayout,
    progress: BrightvaleProgressRange,
  ): boolean;
  /** Project a world point into host-relative CSS pixels. */
  project(worldPosition: THREE.Vector3): BrightvaleScreenPoint;
}

/** Derive queryable road/target heights from the loaded source GLB meshes. */
export function createBrightvaleSurfaceProfile(
  roots: Pick<BrightvaleAssets['roots'], 'highway' | 'platform' | 'endcaps'>,
): BrightvaleMeasuredSurfaceProfile {
  const cache = new Map<string, number | null>();
  const playfieldMatrix = new THREE.Matrix4().fromArray([
    ...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor,
  ]);
  const essentialGeometryPoints = {
    platform: measuredAssetBoundsCorners(roots.platform, playfieldMatrix),
    highway: measuredAssetBoundsCorners(roots.highway, playfieldMatrix),
    endcaps: measuredAssetBoundsCorners(roots.endcaps, playfieldMatrix),
  };
  const sourceRoots: SurfaceRoot[] = [roots.highway, roots.platform].map(
    (root) => {
      root.updateMatrixWorld(true);
      const inverseRoot = root.matrixWorld.clone().invert();
      const bounds = new THREE.Box3()
        .setFromObject(root)
        .applyMatrix4(inverseRoot);
      return { root, inverseRoot, bounds };
    },
  );
  return {
    essentialGeometryPoints,
    surfaceHeightAt(lane, localZ, localX = laneCenter(lane)) {
      if (
        !Number.isInteger(lane) ||
        lane < 0 ||
        lane > 3 ||
        !Number.isFinite(localZ) ||
        !Number.isFinite(localX)
      )
        return null;
      const quantizedZ = Math.round(localZ * 400) / 400;
      const quantizedX = Math.round(localX * 400) / 400;
      const key = `${lane}:${quantizedX}:${quantizedZ}`;
      if (cache.has(key)) return cache.get(key) ?? null;
      const height = surfaceRayHeight(sourceRoots, quantizedX, quantizedZ);
      cache.set(key, height);
      return height;
    },
  };
}

/** Fit the authored perspective view around the playfield and persistent HUD. */
export function createBrightvaleCameraProjection(
  playfield: BrightvalePlayfieldContract,
  layout: BrightvaleViewportLayout,
  progress: BrightvaleProgressRange,
  surface?: BrightvaleMeasuredSurfaceProfile,
): BrightvaleCameraProjection {
  const authored = BRIGHTVALE_RUNTIME_LAYOUT.camera;
  const camera = new THREE.PerspectiveCamera(
    authored.verticalFovDegrees,
    layout.width > 0 && layout.height > 0
      ? layout.width / layout.height
      : authored.aspect,
    authored.near,
    authored.far,
  );
  const authoredPosition = new THREE.Vector3().fromArray([
    ...authored.positionGltf,
  ]);
  const authoredQuaternion = new THREE.Quaternion()
    .fromArray([...authored.quaternionXyzw])
    .normalize();
  let currentLayout = layout;
  let usable = false;
  camera.quaternion.copy(authoredQuaternion);
  camera.up.set(0, 1, 0);

  const target = playfield
    .hitAnchor(1)
    .add(playfield.hitAnchor(2))
    .multiplyScalar(0.5);
  const cameraRay = authoredPosition.clone().sub(target);
  const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
    authoredQuaternion,
  );
  const makeFitPoints = (range: BrightvaleProgressRange): THREE.Vector3[] => {
    if (
      !Number.isFinite(range.minimum) ||
      !Number.isFinite(range.maximum) ||
      range.maximum < range.minimum
    )
      throw new RangeError(
        'Brightvale progress range must be finite and ordered',
      );
    const points: THREE.Vector3[] = surface
      ? Object.values(surface.essentialGeometryPoints).flatMap((points) =>
          points.map((point) => point.clone()),
        )
      : [];
    const sampleCount = ENVELOPE_SWEEP_SAMPLES;
    for (let lane = 0; lane < 4; lane += 1) {
      for (let index = 0; index <= sampleCount; index += 1) {
        const amount = index / sampleCount;
        const p = THREE.MathUtils.lerp(range.minimum, range.maximum, amount);
        points.push(
          measuredEnvelopePoint(playfield, surface, lane, p, -FIT_HALF_WIDTH),
          measuredEnvelopePoint(playfield, surface, lane, p, 0),
          measuredEnvelopePoint(playfield, surface, lane, p, FIT_HALF_WIDTH),
        );
      }
    }
    for (let lane = 0; lane < 4; lane += 1)
      points.push(playfield.hitAnchor(lane));
    return points;
  };
  let fitPoints = makeFitPoints(progress);

  const fixedLabelRects = (nextLayout: BrightvaleViewportLayout) =>
    Object.values(nextLayout.labels);

  const layoutLabelsValid = (nextLayout: BrightvaleViewportLayout): boolean => {
    const labels = fixedLabelRects(nextLayout);
    for (const rect of labels) {
      if (
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width < 0 ||
        rect.height < 0 ||
        rect.x < 0 ||
        rect.y < 0 ||
        rect.x + rect.width > nextLayout.width ||
        rect.y + rect.height > nextLayout.height
      )
        return false;
    }
    return true;
  };

  const shiftRangeAtScale = (
    scale: number,
    nextLayout: BrightvaleViewportLayout,
  ): { readonly minimum: number; readonly maximum: number } | null => {
    camera.position.copy(target).addScaledVector(cameraRay, scale);
    camera.updateMatrixWorld(true);
    const inverseCamera = camera.matrixWorld.clone().invert();
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let minimum = Number.NEGATIVE_INFINITY;
    let maximum = Number.POSITIVE_INFINITY;
    const constrainPoint = (
      worldPoint: THREE.Vector3,
      top: number,
      bottom: number,
    ): boolean => {
      const view = worldPoint.clone().applyMatrix4(inverseCamera);
      const depth = -view.z;
      if (depth < camera.near || depth > camera.far) return false;
      const shiftForY = (screenY: number) =>
        view.y +
        depth * verticalTangent * ((2 * screenY) / nextLayout.height - 1);
      minimum = Math.max(minimum, shiftForY(top));
      maximum = Math.min(maximum, shiftForY(bottom));
      return minimum <= maximum;
    };

    for (const worldPoint of fitPoints) {
      if (!constrainPoint(worldPoint, 0, nextLayout.height)) return null;
    }
    const anchors = [0, 1, 2, 3].map((lane) => playfield.hitAnchor(lane));
    for (const anchor of anchors) {
      if (!constrainPoint(anchor, -4, nextLayout.height - 28)) return null;
    }

    const views = anchors.map((anchor) =>
      anchor.clone().applyMatrix4(inverseCamera),
    );
    const meanViewYOverDepth =
      views.reduce((sum, view) => sum + view.y / -view.z, 0) / views.length;
    const meanInverseDepth =
      views.reduce((sum, view) => sum + 1 / -view.z, 0) / views.length;
    const meanScreenYAtZero =
      nextLayout.height / 2 -
      (meanViewYOverDepth * nextLayout.height) / (2 * verticalTangent);
    const meanScreenYSlope =
      (meanInverseDepth * nextLayout.height) / (2 * verticalTangent);
    minimum = Math.max(minimum, (-30 - meanScreenYAtZero) / meanScreenYSlope);
    maximum = Math.min(
      maximum,
      (nextLayout.height - 50 - meanScreenYAtZero) / meanScreenYSlope,
    );
    return minimum <= maximum ? { minimum, maximum } : null;
  };

  const fits = (
    scale: number,
    shift: number,
    nextLayout: BrightvaleViewportLayout,
    nextProgress: BrightvaleProgressRange,
  ): boolean => {
    camera.position
      .copy(target)
      .addScaledVector(cameraRay, scale)
      .addScaledVector(cameraUp, shift);
    camera.quaternion.copy(authoredQuaternion);
    camera.updateMatrixWorld(true);
    const exclusions = [
      ...nextLayout.persistentHudExclusions,
      ...fixedLabelRects(nextLayout),
    ];
    const inverseCamera = camera.matrixWorld.clone().invert();
    const projectRect = (
      worldPoint: THREE.Vector3,
      width = 0,
      height = 0,
      offsetY = 0,
    ) => {
      const projected = worldPoint.clone().project(camera);
      return {
        x: ((projected.x + 1) * nextLayout.width) / 2 - width / 2,
        y: ((1 - projected.y) * nextLayout.height) / 2 + offsetY,
        width,
        height,
      };
    };
    const anchors = [0, 1, 2, 3].map((lane) => playfield.hitAnchor(lane));
    const laneLabels = anchors.map((worldPoint) => {
      const anchor = projectRect(worldPoint);
      return {
        x: anchor.x - 18,
        y: anchor.y + 4,
        width: 36,
        height: 24,
      };
    });
    const anchorMean = laneLabels.reduce(
      (mean, rect) => ({
        x: mean.x + (rect.x + rect.width / 2) / laneLabels.length,
        y: mean.y + (rect.y - 4) / laneLabels.length,
      }),
      { x: 0, y: 0 },
    );
    const hitLabel = {
      x: anchorMean.x - 44,
      y: anchorMean.y + 30,
      width: 88,
      height: 28,
    };
    const labels = [...laneLabels, hitLabel];
    for (const rect of labels) {
      if (
        rect.x < 0 ||
        rect.y < 0 ||
        rect.x + rect.width > nextLayout.width ||
        rect.y + rect.height > nextLayout.height ||
        exclusions.some((obstacle) => overlaps(rect, obstacle))
      ) {
        return false;
      }
    }
    for (let first = 0; first < labels.length; first += 1) {
      for (let second = first + 1; second < labels.length; second += 1) {
        if (overlaps(labels[first]!, labels[second]!)) {
          return false;
        }
      }
    }
    for (const worldPoint of fitPoints) {
      const view = worldPoint.clone().applyMatrix4(inverseCamera);
      if (-view.z < camera.near || -view.z > camera.far) {
        return false;
      }
      const rect = projectRect(worldPoint, 0.01, 0.01);
      if (
        ![rect.x, rect.y].every(Number.isFinite) ||
        rect.x < 0 ||
        rect.x + rect.width > nextLayout.width ||
        rect.y < 0 ||
        rect.y + rect.height > nextLayout.height ||
        exclusions.some((obstacle) => overlaps(rect, obstacle))
      ) {
        return false;
      }
    }

    if (surface !== undefined) {
      const deckY = surface.essentialGeometryPoints.platform.map(
        (point) => projectRect(point).y,
      );
      const landingDeckDepth = Math.max(...deckY) - Math.min(...deckY);
      for (let lane = 0; lane < 4; lane += 1) {
        const approachY = projectRect(
          playfield.point(lane, nextProgress.minimum),
        ).y;
        const hitY = projectRect(playfield.hitAnchor(lane)).y;
        if (hitY <= approachY || hitY - approachY < landingDeckDepth)
          return false;
      }
    }

    return true;
  };

  const resize = (
    nextLayout: BrightvaleViewportLayout,
    nextProgress: BrightvaleProgressRange,
  ): boolean => {
    fitPoints = makeFitPoints(nextProgress);
    currentLayout = nextLayout;
    camera.aspect =
      nextLayout.width > 0 && nextLayout.height > 0
        ? nextLayout.width / nextLayout.height
        : authored.aspect;
    camera.updateProjectionMatrix();
    usable = false;
    if (
      !Number.isFinite(nextLayout.width) ||
      !Number.isFinite(nextLayout.height) ||
      nextLayout.width <= 0 ||
      nextLayout.height <= 0 ||
      !layoutLabelsValid(nextLayout) ||
      nextLayout.persistentHudExclusions.some(
        (rect) =>
          ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
          rect.width < 0 ||
          rect.height < 0,
      )
    )
      return false;

    const previousPosition = camera.position.clone();
    const maximumScale = Math.max(
      1,
      camera.far / Math.max(cameraRay.length(), 1),
    );
    const scales = [1];
    while (scales.length < 4096) {
      const last = scales.at(-1)!;
      if (last >= maximumScale) break;
      scales.push(Math.min(maximumScale, last * 1.005));
    }
    if (scales.at(-1)! < maximumScale) scales.push(maximumScale);

    for (const scale of scales) {
      const shiftRange = shiftRangeAtScale(scale, nextLayout);
      if (shiftRange === null) {
        continue;
      }
      const candidates = new Set<number>([
        shiftRange.minimum,
        shiftRange.maximum,
        THREE.MathUtils.clamp(0, shiftRange.minimum, shiftRange.maximum),
      ]);
      const shiftSteps = Math.min(
        4096,
        Math.ceil((shiftRange.maximum - shiftRange.minimum) * 8),
      );
      for (let index = 1; index < shiftSteps; index += 1) {
        candidates.add(
          THREE.MathUtils.lerp(
            shiftRange.minimum,
            shiftRange.maximum,
            index / shiftSteps,
          ),
        );
      }
      const orderedShifts = [...candidates].sort(
        (left, right) => Math.abs(left) - Math.abs(right),
      );
      for (const shift of orderedShifts) {
        if (!fits(scale, shift, nextLayout, nextProgress)) continue;
        camera.position
          .copy(target)
          .addScaledVector(cameraRay, scale)
          .addScaledVector(cameraUp, shift);
        camera.quaternion.copy(authoredQuaternion);
        camera.updateMatrixWorld(true);
        usable = true;
        return true;
      }
    }
    camera.position.copy(previousPosition);
    camera.quaternion.copy(authoredQuaternion);
    camera.updateMatrixWorld(true);
    return false;
  };

  resize(layout, progress);
  return {
    camera,
    resize,
    get usable() {
      return usable;
    },
    project(worldPosition) {
      camera.updateMatrixWorld(true);
      const projected = worldPosition.clone().project(camera);
      return {
        x: ((projected.x + 1) * currentLayout.width) / 2,
        y: ((1 - projected.y) * currentLayout.height) / 2,
      };
    },
  };
}
