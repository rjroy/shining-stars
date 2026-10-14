import * as THREE from 'three';
import layout from '../../../assets/production/brightvale-structure-layout.json';

const LANE_CENTERS = [-4.5, -1.5, 1.5, 4.5] as const;
const HIT_LOCAL = { y: 0.365, z: -1.45 } as const;
const APPROACH_LENGTH = 42;
const NOTE_HALF_THICKNESS = 0.04;
const SURFACE_GAP = 0.055;
const MATRIX = new THREE.Matrix4().fromArray(
  layout.playfield.gltf.matrix_column_major,
);

export interface BrightvalePlayfieldContract {
  /** Logical judging coordinate; progress is intentionally unbounded. */
  point(lane: number, progress: number): THREE.Vector3;
  /** Center of the authored luminous platform target for this lane. */
  hitAnchor(lane: number): THREE.Vector3;
  /** Safe visible note center above the measured surface. */
  visualPoint(lane: number, progress: number): THREE.Vector3;
  /** Vertical gap between the visible note underside and the measured surface. */
  clearanceAt(lane: number, progress: number): number;
}

export interface BrightvaleSurfaceProfile {
  /** Surface height in the unparented GLB-local frame, measured from loaded meshes. */
  surfaceHeightAt(lane: number, localZ: number): number | null;
}

function laneCenter(lane: number): number {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_CENTERS.length)
    throw new RangeError(
      `lane must be an integer from 0 through 3 (got ${lane})`,
    );
  return LANE_CENTERS[lane] as number;
}

function finiteProgress(progress: number): number {
  if (!Number.isFinite(progress))
    throw new RangeError(`progress must be finite (got ${progress})`);
  return progress;
}

function localPoint(lane: number, progress: number): THREE.Vector3 {
  const p = finiteProgress(progress);
  const noseStart = 1 - (-1.45 - -2.535) / APPROACH_LENGTH;
  const nosePeak = noseStart + 0.006;
  let y = 0.44;
  if (p > noseStart && p < nosePeak)
    y = 0.44 + ((0.505 - 0.44) * (p - noseStart)) / (nosePeak - noseStart);
  else if (p >= nosePeak && p < 1)
    y = 0.505 + ((0.365 - 0.505) * (p - nosePeak)) / (1 - nosePeak);
  else if (p >= 1) y = 0.365;
  return new THREE.Vector3(
    laneCenter(lane),
    y,
    HIT_LOCAL.z - APPROACH_LENGTH * (1 - p),
  );
}

/** Coordinates are transformed once by the production shared parent matrix. */
export function createBrightvalePlayfieldContract(
  surface?: BrightvaleSurfaceProfile,
): BrightvalePlayfieldContract {
  const transform = (point: THREE.Vector3) => point.applyMatrix4(MATRIX);

  function measuredHeight(lane: number, z: number): number | null {
    if (!surface) return null;
    const height = surface.surfaceHeightAt(lane, z);
    if (height !== null && !Number.isFinite(height))
      throw new RangeError('measured surface height must be finite');
    return height;
  }

  function visualSurfaceHeight(
    lane: number,
    progress: number,
    z: number,
  ): number | null {
    if (!surface)
      throw new Error(
        'visualPoint requires a measured Brightvale surface profile',
      );
    let height = measuredHeight(lane, z);
    // Beyond the authored geometry, keep late notes moving at the measured hit
    // surface height. This simple continuation prevents missing-surface errors;
    // the visual path need not follow nonexistent geometry past the platform.
    if (height === null && progress >= 1)
      height = measuredHeight(lane, HIT_LOCAL.z);
    return height;
  }

  function visibleLocal(lane: number, progress: number): THREE.Vector3 {
    const point = localPoint(lane, progress);
    const height = visualSurfaceHeight(lane, progress, point.z);
    if (height === null)
      throw new RangeError(
        `measured surface profile has no sample at local Z ${point.z}`,
      );
    point.y = height + NOTE_HALF_THICKNESS + SURFACE_GAP;
    return point;
  }

  return {
    point(lane, progress) {
      const p = finiteProgress(progress);
      laneCenter(lane);
      return transform(localPoint(lane, p));
    },
    hitAnchor(lane) {
      return transform(
        new THREE.Vector3(laneCenter(lane), HIT_LOCAL.y, HIT_LOCAL.z),
      );
    },
    visualPoint(lane, progress) {
      return transform(visibleLocal(lane, finiteProgress(progress)));
    },
    clearanceAt(lane, progress) {
      const p = finiteProgress(progress);
      const point = visibleLocal(lane, p);
      const surfaceHeight = visualSurfaceHeight(lane, p, point.z);
      if (surfaceHeight === null)
        throw new RangeError(
          `measured surface profile has no sample at local Z ${point.z}`,
        );
      return point.y - NOTE_HALF_THICKNESS - surfaceHeight;
    },
  };
}
