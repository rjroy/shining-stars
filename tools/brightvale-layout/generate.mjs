import { readFile, writeFile } from 'node:fs/promises';

const sourceUrl = new URL(
  '../../assets/production/brightvale-structure-layout.json',
  import.meta.url,
);
const outputUrl = new URL(
  '../../src/rendering/brightvale/layout.data.ts',
  import.meta.url,
);

const source = JSON.parse(await readFile(sourceUrl, 'utf8'));
if (source.schema !== 'brightvale-structure-layout-v1') {
  throw new Error(`Unsupported source layout schema: ${source.schema}`);
}

const layout = {
  schemaVersion: 'brightvale-runtime-layout-v1',
  coordinateSystem: 'gltf-y-up',
  units: 'provisional-authoring-units',
  playfield: {
    matrixColumnMajor: source.playfield.gltf.matrix_column_major,
    tiltDegrees: source.playfield.tilt_degrees,
  },
  city: {
    matrixColumnMajor: source.city.gltf.matrix_column_major,
  },
  framingInstances: source.framing_instances.map((entry) => ({
    name: entry.name,
    module: entry.module,
    matrixColumnMajor: entry.gltf.matrix_column_major,
  })),
  groundSurfaces: source.ground_surfaces.map((surface) => ({
    name: surface.name,
    matrixColumnMajor: surface.gltf.matrix_column_major,
    positionsLocalGltf: surface.positions_local_gltf,
    triangleIndices: surface.triangle_indices,
    material: {
      name: surface.material.name,
      baseColorLinear: surface.material.base_color_linear,
      metallic: surface.material.metallic,
      roughness: surface.material.roughness,
      doubleSided: surface.material.double_sided,
    },
  })),
  camera: {
    verticalFovDegrees: source.camera.vertical_fov_degrees,
    aspect: source.camera.aspect,
    near: source.camera.clip_near,
    far: source.camera.clip_far,
    positionGltf: source.camera.position_gltf,
    quaternionXyzw: source.camera.transform_gltf_camera_basis.quaternion_xyzw,
    referenceResolution: source.camera.resolution,
  },
};

if (
  layout.framingInstances.length !== 53 ||
  layout.groundSurfaces.length !== 2
) {
  throw new Error('Unexpected source counts while generating Brightvale runtime layout');
}

const matrixArrays = [
  layout.playfield.matrixColumnMajor,
  layout.city.matrixColumnMajor,
  ...layout.framingInstances.map((entry) => entry.matrixColumnMajor),
  ...layout.groundSurfaces.map((surface) => surface.matrixColumnMajor),
];
if (matrixArrays.some((matrix) => matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value)))) {
  throw new Error('Generated layout contains an invalid matrix');
}

const generated = `import type { BrightvaleRuntimeLayout } from './layout';\n\nexport const BRIGHTVALE_RUNTIME_LAYOUT_DATA = ${JSON.stringify(layout, null, 2)} satisfies BrightvaleRuntimeLayout;\n`;
await writeFile(outputUrl, generated);
