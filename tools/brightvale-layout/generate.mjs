import { readFile, writeFile } from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3 } from 'three';

const sourceUrl = new URL(
  '../../assets/production/brightvale-structure-layout.json',
  import.meta.url,
);
const outputUrl = new URL('../../src/brightvale/layout.data.ts', import.meta.url);

const source = JSON.parse(await readFile(sourceUrl, 'utf8'));
if (source.schema !== 'brightvale-structure-layout-v1') {
  throw new Error(`Unsupported source layout schema: ${source.schema}`);
}

function reviewFillPlacements() {
  const extraPoints = [];
  for (const z of [-5, -8, -11, -14, -17, -20]) {
    for (const ax of [11, 13, 15]) {
      const x = ax + ((Math.abs(Math.round(z)) / 3) % 2 ? 0.45 : 0);
      if (
        x * x + (z + 20) * (z + 20) < 25.2 * 25.2 &&
        x > 7.4 &&
        x < 0.62 * (15 - z)
      ) {
        extraPoints.push([x, z]);
      }
    }
  }

  const poses = ['Calm', 'Cheering', 'Reaching'];
  const variants = ['A', 'B', 'C'];
  return extraPoints.map(([ax, z], index) => {
    const side = index % 2 ? 1 : -1;
    const x = side * ax;
    const yaw = Math.atan2(-x, 15 - z);
    const matrix = new Matrix4().compose(
      new Vector3(x, 8.25, z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
      new Vector3(1, 1, 1),
    );
    return {
      id: `extra-${String(index + 1).padStart(2, '0')}`,
      variant: variants[(index + 1) % 3],
      pose: poses[(index * 2 + 1) % 3],
      source: 'scene-review-fill',
      matrixColumnMajor: matrix.toArray(),
    };
  });
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
  crowdPlacements: [
    ...source.existing_crowd_sample_roots.map((sample) => ({
      id: sample.instance_id,
      variant: sample.variant,
      pose: sample.pose,
      source: 'saved-study',
      matrixColumnMajor: sample.gltf.matrix_column_major,
    })),
    ...reviewFillPlacements(),
  ],
};

if (
  layout.framingInstances.length !== 53 ||
  layout.groundSurfaces.length !== 2 ||
  source.existing_crowd_sample_roots.length !== 10 ||
  layout.crowdPlacements.length !== 25
) {
  throw new Error('Unexpected source counts while generating Brightvale runtime layout');
}

const matrixArrays = [
  layout.playfield.matrixColumnMajor,
  layout.city.matrixColumnMajor,
  ...layout.framingInstances.map((entry) => entry.matrixColumnMajor),
  ...layout.groundSurfaces.map((surface) => surface.matrixColumnMajor),
  ...layout.crowdPlacements.map((placement) => placement.matrixColumnMajor),
];
if (matrixArrays.some((matrix) => matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value)))) {
  throw new Error('Generated layout contains an invalid matrix');
}

const generated = `import type { BrightvaleRuntimeLayout } from './layout';\n\nexport const BRIGHTVALE_RUNTIME_LAYOUT_DATA = ${JSON.stringify(layout, null, 2)} satisfies BrightvaleRuntimeLayout;\n`;
await writeFile(outputUrl, generated);
