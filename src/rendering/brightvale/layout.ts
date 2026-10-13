import { BRIGHTVALE_RUNTIME_LAYOUT_DATA } from './layout.data';

/** Matrix values are glTF/Three column-major; imported scenes are already Y-up. */
export interface BrightvaleMatrixLayout {
  readonly matrixColumnMajor: readonly number[];
}

export interface BrightvaleFramingPlacement extends BrightvaleMatrixLayout {
  readonly name: string;
  readonly module: 'long' | 'post';
}

export interface BrightvaleGroundSurface extends BrightvaleMatrixLayout {
  readonly name: string;
  readonly positionsLocalGltf: readonly (readonly number[])[];
  readonly triangleIndices: readonly (readonly number[])[];
  readonly material: {
    readonly name: string;
    readonly baseColorLinear: readonly number[];
    readonly metallic: number;
    readonly roughness: number;
    readonly doubleSided: boolean;
  };
}

export interface BrightvaleCrowdPlacement extends BrightvaleMatrixLayout {
  readonly id: string;
  readonly variant: 'A' | 'B' | 'C';
  readonly pose: 'Calm' | 'Cheering' | 'Reaching';
  readonly source: 'saved-study' | 'scene-review-fill';
}

export interface BrightvaleRuntimeLayout {
  readonly schemaVersion: 'brightvale-runtime-layout-v1';
  readonly coordinateSystem: 'gltf-y-up';
  readonly units: 'provisional-authoring-units';
  readonly playfield: BrightvaleMatrixLayout & { readonly tiltDegrees: number };
  readonly city: BrightvaleMatrixLayout;
  readonly framingInstances: readonly BrightvaleFramingPlacement[];
  readonly groundSurfaces: readonly BrightvaleGroundSurface[];
  readonly camera: {
    readonly verticalFovDegrees: number;
    readonly aspect: number;
    readonly near: number;
    readonly far: number;
    readonly positionGltf: readonly number[];
    readonly quaternionXyzw: readonly number[];
    readonly referenceResolution: readonly number[];
  };
  readonly crowdPlacements: readonly BrightvaleCrowdPlacement[];
}

/** Versioned projection of the authoritative layout and approved review fill. */
export const BRIGHTVALE_RUNTIME_LAYOUT: BrightvaleRuntimeLayout =
  BRIGHTVALE_RUNTIME_LAYOUT_DATA;
