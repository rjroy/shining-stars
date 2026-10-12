import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#view');
const reportElement = document.querySelector('#report');
const evidenceElement = document.querySelector('#evidence');
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'twilight' ? 'twilight' : 'audience';
const negative = params.get('case') === 'negative';
const assetPath = params.get('asset') || '../city-slice.glb';
const loaderWarnings = [];
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(1600, 900, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111a2b);
const hemi = new THREE.HemisphereLight(
  mode === 'audience' ? 0xffd49b : 0xb7a0ff,
  mode === 'audience' ? 0x27334d : 0x21183e,
  mode === 'audience' ? 1.45 : 1.2,
);
const point = new THREE.PointLight(
  mode === 'audience' ? 0xffb95e : 0x966dff,
  mode === 'audience' ? 110 : 145,
  50,
  2,
);
point.position.set(mode === 'audience' ? -14 : -6, 27, -68);
scene.add(hemi, point);
const camera = new THREE.PerspectiveCamera(39.76070473, 1600 / 900, 0.1, 1000);
camera.position.set(0, 13.89999962, 15);
camera.rotation.set(-0.1148765842, 0, 0);
camera.updateProjectionMatrix();

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function report(value, state) {
  reportElement.dataset.state = state;
  reportElement.textContent = JSON.stringify(value, null, 2);
}

function parseGlbJson(buffer) {
  const view = new DataView(buffer);
  assert(
    view.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67,
    'GLB magic/header valid',
  );
  assert(view.getUint32(4, true) === 2, 'GLB version 2');
  assert(
    view.getUint32(8, true) === view.byteLength,
    'GLB declared length matches response',
  );
  const length = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a, 'first GLB chunk is JSON');
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim(),
  );
}

const roleContract = {
  Limestone: {
    role: 'body',
    color: [0.42, 0.31, 0.21],
    emissive: [0, 0, 0],
    strength: 0,
  },
  Recess: {
    role: 'recess',
    color: [0.1, 0.085, 0.12],
    emissive: [0, 0, 0],
    strength: 0,
  },
  Slate: {
    role: 'roof',
    color: [0.035, 0.085, 0.14],
    emissive: [0, 0, 0],
    strength: 0,
  },
  Cornice: {
    role: 'stone_trim',
    color: [0.62, 0.49, 0.3],
    emissive: [0, 0, 0],
    strength: 0,
  },
  Gilt: {
    role: 'gold',
    color: [0.65, 0.38, 0.105],
    emissive: [0, 0, 0],
    strength: 0,
  },
  Window: {
    role: 'emissive_window',
    color: [1, 0.47, 0.12],
    emissive: [1, 0.47, 0.12],
    strength: 1.8,
  },
};

function validateGlb(document) {
  const primitiveCount = document.meshes.reduce(
    (sum, mesh) => sum + mesh.primitives.length,
    0,
  );
  const triangles = document.meshes
    .flatMap((mesh) => mesh.primitives)
    .reduce((sum, primitive) => {
      assert(
        (primitive.mode ?? 4) === 4,
        'all primitives use triangle-list mode',
      );
      const count =
        primitive.indices === undefined
          ? document.accessors[primitive.attributes.POSITION].count
          : document.accessors[primitive.indices].count;
      return sum + count / 3;
    }, 0);
  assert(
    document.nodes.length === 31,
    `expected 31 nodes, received ${document.nodes.length}`,
  );
  assert(
    document.meshes.length === 24,
    `expected 24 unique glTF meshes, received ${document.meshes.length}`,
  );
  assert(
    primitiveCount === 132,
    `expected 132 unique primitives, received ${primitiveCount}`,
  );
  assert(
    document.materials.length === 6,
    `expected six materials, received ${document.materials.length}`,
  );
  assert(
    triangles === 33246,
    `expected 33,246 unique-mesh triangles, received ${triangles}`,
  );
  assert(
    document.extensionsUsed?.includes('KHR_materials_emissive_strength'),
    'emissive strength extension is present',
  );
  return {
    nodeCount: document.nodes.length,
    uniqueMeshCount: document.meshes.length,
    uniquePrimitiveCount: primitiveCount,
    uniqueMeshTriangles: triangles,
  };
}

function hash(array) {
  let value = 2166136261;
  for (const item of array) {
    const text = String(item);
    for (let index = 0; index < text.length; index += 1)
      value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

async function run() {
  const started = performance.now();
  if (negative) {
    let rejected = false;
    try {
      await new Promise((resolve, reject) =>
        new GLTFLoader().parse(new ArrayBuffer(8), '', resolve, reject),
      );
    } catch {
      rejected = true;
    }
    assert(rejected, 'GLTFLoader rejects invalid binary input');
  }
  const response = await fetch(assetPath, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(
      `Asset request failed: ${response.status} ${response.statusText} (${assetPath})`,
    );
  const buffer = await response.arrayBuffer();
  if (
    buffer.byteLength < 12 ||
    new DataView(buffer).getUint32(0, true) !== 0x46546c67
  ) {
    throw new Error(
      `Invalid GLB payload: missing glTF magic header (HTTP ${response.status}, ${response.headers.get('content-type') || 'unknown content type'})`,
    );
  }
  const structural = validateGlb(parseGlbJson(buffer));
  const loader = new GLTFLoader();
  const originalWarn = console.warn;
  console.warn = (...args) => {
    loaderWarnings.push(args.map(String).join(' '));
    originalWarn.apply(console, args);
  };
  let gltf;
  try {
    gltf = await new Promise((resolve, reject) =>
      loader.parse(
        buffer,
        new URL('.', new URL(assetPath, location.href)).href,
        resolve,
        reject,
      ),
    );
  } finally {
    console.warn = originalWarn;
  }

  gltf.scene.updateMatrixWorld(true);
  const gltfBounds = new THREE.Box3().setFromObject(gltf.scene);
  const city = new THREE.Group();
  city.name = 'Browser study placement (not baked)';
  city.scale.setScalar(0.35);
  city.position.set(0, 3.9, -55);
  city.add(gltf.scene);
  scene.add(city);
  city.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(city);
  const boundsArray = [...bounds.min.toArray(), ...bounds.max.toArray()];
  assert(boundsArray.every(Number.isFinite), 'placed bounds are finite');
  const nativeBounds = {
    min: [-117.45, -7, -60.36],
    max: [-41.43, 118, 4.015],
  };
  for (let axis = 0; axis < 3; axis += 1) {
    assert(
      Math.abs(gltfBounds.min.toArray()[axis] - nativeBounds.min[axis]) < 0.002,
      `GLB minimum bound axis ${axis} matches contract: ${gltfBounds.min.toArray()[axis]}`,
    );
    assert(
      Math.abs(gltfBounds.max.toArray()[axis] - nativeBounds.max[axis]) < 0.002,
      `GLB maximum bound axis ${axis} matches contract: ${gltfBounds.max.toArray()[axis]}`,
    );
  }

  const meshes = [];
  const originalMaterials = new Set();
  const geometryRefs = new Map();
  let placedTriangles = 0;
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push(object);
    const geometry = object.geometry;
    geometryRefs.set(geometry, (geometryRefs.get(geometry) || 0) + 1);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    assert(position?.count > 0, `${object.name} has position vertices`);
    assert(
      normal && [...normal.array].every(Number.isFinite),
      `${object.name} has finite flat normals`,
    );
    placedTriangles += geometry.index
      ? geometry.index.count / 3
      : position.count / 3;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      originalMaterials.add(material);
  });
  assert(
    meshes.length === 150,
    `expected 150 placed primitive meshes, received ${meshes.length}`,
  );
  assert(
    placedTriangles === 36489,
    `expected 36,489 placed triangles, received ${placedTriangles}`,
  );
  assert(
    originalMaterials.size === 6,
    `expected six imported PBR material objects, received ${originalMaterials.size}`,
  );
  const sharedGeometryReuse = [...geometryRefs.values()].filter(
    (count) => count > 1,
  ).length;
  assert(
    sharedGeometryReuse > 0,
    'GLTFLoader retains shared mesh geometry across placements',
  );

  const baseline = [...originalMaterials].map((material) => {
    const expected = roleContract[material.name];
    assert(expected, `known imported material ${material.name}`);
    assert(
      material.userData.city_role === expected.role,
      `${material.name} city_role extra transfers`,
    );
    const color = [material.color.r, material.color.g, material.color.b];
    const emissive = [
      material.emissive.r,
      material.emissive.g,
      material.emissive.b,
    ];
    assert(
      [
        ...color,
        ...emissive,
        material.metalness,
        material.roughness,
        material.emissiveIntensity,
      ].every(Number.isFinite),
      `${material.name} imported factors are finite`,
    );
    assert(
      color.every((value, i) => Math.abs(value - expected.color[i]) < 1e-5),
      `${material.name} imported base color matches`,
    );
    assert(
      emissive.every(
        (value, i) => Math.abs(value - expected.emissive[i]) < 1e-5,
      ),
      `${material.name} emissive color matches`,
    );
    if (expected.strength > 0) {
      assert(
        Math.abs(material.emissiveIntensity - expected.strength) < 0.002,
        `${material.name} emissive strength matches: ${material.emissiveIntensity}`,
      );
    }
    assert(
      material.side === THREE.DoubleSide,
      `${material.name} remains double sided`,
    );
    return {
      name: material.name,
      cityRole: material.userData.city_role,
      type: material.type,
      color,
      metalness: material.metalness,
      roughness: material.roughness,
      emissive,
      emissiveIntensity: material.emissiveIntensity,
      sourceMaterial: material.userData.source_material,
      textures: [
        'map',
        'normalMap',
        'emissiveMap',
        'metalnessMap',
        'roughnessMap',
      ].filter((key) => Boolean(material[key])),
    };
  });
  assert(
    new Set(baseline.map((material) => material.cityRole)).size === 6,
    'all six city roles are represented',
  );
  const roleColor = {
    body: 0,
    recess: 1,
    roof: 2,
    stone_trim: 3,
    gold: 4,
    emissive_window: 5,
  };
  const ramp = new THREE.DataTexture(
    new Uint8Array([76, 76, 158, 158, 242, 242]),
    3,
    1,
    THREE.RGFormat,
  );
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.colorSpace = THREE.NoColorSpace;
  ramp.needsUpdate = true;
  const toonByOriginal = new Map(
    baseline.map((entry) => {
      const original = [...originalMaterials].find(
        (material) => material.name === entry.name,
      );
      const role = entry.cityRole;
      const toon = new THREE.MeshToonMaterial({
        name: `${entry.name} | ${role} | validation toon`,
        color: original.color,
        gradientMap: ramp,
        side: THREE.DoubleSide,
        flatShading: true,
        emissive: original.emissive,
        emissiveIntensity: original.emissiveIntensity,
      });
      assert(
        Number.isFinite(
          toon.color.r + toon.color.g + toon.color.b + toon.emissiveIntensity,
        ),
        `${entry.name} derived toon material finite`,
      );
      return [original, { material: toon, roleIndex: roleColor[role] }];
    }),
  );
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => toonByOriginal.get(material).material)
      : toonByOriginal.get(mesh.material).material;
  }

  const geometrySignature = meshes.map((mesh) => ({
    name: mesh.name,
    sourceGeometryId:
      mesh.userData.shared_geometry_id || mesh.userData.source_object || null,
    positionCount: mesh.geometry.getAttribute('position').count,
    positionHash: hash(mesh.geometry.getAttribute('position').array),
    normalHash: hash(mesh.geometry.getAttribute('normal').array),
    indexHash: mesh.geometry.index ? hash(mesh.geometry.index.array) : null,
  }));
  const compactGeometrySignature = {
    meshCount: geometrySignature.length,
    attributeIndexHash: hash(
      geometrySignature.map(
        (item) =>
          `${item.name}:${item.positionHash}:${item.normalHash}:${item.indexHash}`,
      ),
    ),
  };
  const cameraContract = {
    fovDegrees: camera.fov,
    aspect: camera.aspect,
    position: camera.position.toArray(),
    rotation: camera.rotation.toArray(),
    scale: city.scale.toArray(),
    cityPosition: city.position.toArray(),
    topSpireCropIntentional: true,
  };
  renderer.info.reset();
  renderer.render(scene, camera);
  const resource = performance
    .getEntriesByName(response.url, 'resource')
    .at(-1);
  const result = {
    state: 'passed-browser-structural-checks-not-visual-approval',
    mode,
    method:
      'Imported PBR baseline recorded, then all six existing roles mapped to shared MeshToonMaterial equivalents. Original base colors, flat shading, double-sidedness and window emission preserved. Study transform/camera held fixed.',
    assetPath,
    glbResponseBodyBytes: buffer.byteLength,
    browserResourceTransferBytes: resource?.transferSize || null,
    localFetchParseAndFirstRenderMs: Number(
      (performance.now() - started).toFixed(2),
    ),
    structural,
    placedPrimitiveMeshCount: meshes.length,
    placedTriangleCount: placedTriangles,
    uniqueLoadedGeometryCount: geometryRefs.size,
    geometryIdentityReuseCount: sharedGeometryReuse,
    decodedGeometryTypedArrayBytes: [
      ...new Set(
        meshes.flatMap((mesh) =>
          Object.values(mesh.geometry.attributes).map(
            (attribute) => attribute.array.buffer,
          ),
        ),
      ),
    ].reduce((sum, item) => sum + item.byteLength, 0),
    decodedTextureBytes: 0,
    textureNote:
      'No source textures; validation ramp is a 3-texel one-dimensional DataTexture and is not GLB payload.',
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    },
    browserGpuBackend: (() => {
      const gl = renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        webglVersion: gl.getParameter(gl.VERSION),
        vendor: debug
          ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR),
        renderer: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      };
    })(),
    bounds: {
      gltf: { min: gltfBounds.min.toArray(), max: gltfBounds.max.toArray() },
      placed: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    },
    camera: cameraContract,
    lighting: {
      hemisphere: {
        sky: hemi.color.getHexString(),
        ground: hemi.groundColor.getHexString(),
        intensity: hemi.intensity,
      },
      point: {
        color: point.color.getHexString(),
        position: point.position.toArray(),
        intensity: point.intensity,
        distance: point.distance,
        decay: point.decay,
      },
      outputColorSpace: 'SRGBColorSpace',
      toneMapping: 'ACESFilmicToneMapping',
      exposure: 1.05,
    },
    baselinePbrMaterials: baseline,
    derivedToonMapping: [...new Set(toonByOriginal.values())].map(
      ({ material, roleIndex }) => ({
        name: material.name,
        role: material.name.split(' | ').slice(1, -1).join(' | '),
        color: material.color.toArray(),
        emissive: material.emissive.toArray(),
        emissiveIntensity: material.emissiveIntensity,
        gradientSteps: 3,
        rampIndex: roleIndex,
      }),
    ),
    loaderWarnings,
    modeInvariant: {
      camera: cameraContract,
      geometry: compactGeometrySignature,
    },
    limitations: [
      'Harness-only toon consumer materials; not exported GLB toon portability or runtime parity.',
      'Mesh reuse is not GPU instancing; renderer calls are actual browser calls for this view only.',
      'Triangle and decoded typed-array figures are not GPU-memory or target-device measurements.',
      'Study camera intentionally crops the spire top; full-silhouette view is in production comparison.webp.',
      'Toon mapping intentionally loses metallic/roughness BRDF behavior and PBR reflection response; emissive windows retain color and strength.',
    ],
  };
  ramp.dispose();
  report(result, 'passed');
  const dataUrl = canvas.toDataURL('image/webp', 0.92);
  assert(
    dataUrl.startsWith('data:image/webp;'),
    'browser produced WebP evidence',
  );
  evidenceElement.textContent = JSON.stringify({
    filename: `${mode}.webp`,
    mimeType: 'image/webp',
    dataUrl,
  });
  evidenceElement.dataset.ready = 'true';
}

run().catch((error) =>
  report(
    {
      state: 'failed',
      mode,
      assetPath,
      errors: [error.message || String(error)],
    },
    'failed',
  ),
);
