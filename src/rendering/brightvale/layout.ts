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
  /** Explicit population seam; absent means the bounded gameplay pilot layout. */
  readonly silhouetteCrowdPlacements?: readonly BrightvaleSilhouetteCrowdPlacement[];
}

export interface BrightvaleSilhouetteCrowdPlacement extends BrightvaleMatrixLayout {
  readonly id: string;
  readonly figure: string;
  readonly motionPhase: number;
  readonly motionRate: number;
  /** Arm swing in radians; zero holds the arm still. Omitted keeps its default. */
  readonly waveAmplitude?: number;
  readonly stickColor?: number;
}

/** Maintained runtime layout, including current gameplay tuning. */
export const BRIGHTVALE_RUNTIME_LAYOUT: BrightvaleRuntimeLayout =
  BRIGHTVALE_RUNTIME_LAYOUT_DATA;
