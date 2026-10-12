import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#view');
const reportElement = document.querySelector('#report');
const evidenceElement = document.querySelector('#evidence');
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'twilight' ? 'twilight' : 'audience';
const runNegativeChecks = params.get('case') === 'negative';
const assetPath = params.get('asset') || '../endcaps.glb';
const errors = [];
const loaderWarnings = [];
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(960, 540, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111a2b);
const hemi = new THREE.HemisphereLight(
  mode === 'audience' ? 0xffd49b : 0xb7a0ff,
  mode === 'audience' ? 0x27334d : 0x21183e,
  mode === 'audience' ? 1.05 : 0.8,
);
const representativeCityIntensity = 0.5;
const representativeCityBrightness = 0.22 + representativeCityIntensity * 0.78;
const point = new THREE.PointLight(
  mode === 'audience' ? 0xffb95e : 0x966dff,
  mode === 'audience' ? 30 : 42,
  30,
  2,
);
point.position.set(mode === 'audience' ? -3.5 : 3.5, 4.4, -2.4);
scene.add(hemi, point);
const camera = new THREE.PerspectiveCamera(36, 960 / 540, 0.1, 1000);

function report(value, state) {
  reportElement.dataset.state = state;
  reportElement.textContent = JSON.stringify(value, null, 2);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function readGlbJson(buffer) {
  const view = new DataView(buffer);
  assert(
    view.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67,
    'GLB magic and header are valid',
  );
  assert(view.getUint32(4, true) === 2, 'GLB version is 2');
  assert(
    view.getUint32(8, true) === view.byteLength,
    'GLB declared length matches response body',
  );
  const jsonLength = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a, 'first GLB chunk is JSON');
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).trim(),
  );
}

function validateGlbContract(document) {
  const primitiveCount = (document.meshes || []).reduce(
    (total, mesh) => total + mesh.primitives.length,
    0,
  );
  const triangleCount = (document.meshes || [])
    .flatMap((mesh) => mesh.primitives)
    .reduce((total, primitive) => {
      assert(
        (primitive.mode ?? 4) === 4,
        'every glTF primitive uses triangle-list mode',
      );
      const count =
        primitive.indices === undefined
          ? document.accessors[primitive.attributes.POSITION].count
          : document.accessors[primitive.indices].count;
      return total + count / 3;
    }, 0);
  assert(
    document.nodes?.length === 2,
    `expected two glTF nodes, received ${document.nodes?.length}`,
  );
  assert(
    document.meshes?.length === 2,
    `expected two glTF meshes, received ${document.meshes?.length}`,
  );
  assert(
    primitiveCount === 4,
    `expected four glTF primitives, received ${primitiveCount}`,
  );
  assert(
    document.materials?.length === 2,
    `expected two glTF materials, received ${document.materials?.length}`,
  );
  assert(
    triangleCount === 2568,
    `expected 2568 glTF primitive triangles, received ${triangleCount}`,
  );
  assert(
    (document.extensionsUsed || []).length === 0,
    'baseline has no required delivery extensions',
  );
  const roles = Object.fromEntries(
    document.materials.map((material) => [
      material.name,
      material.pbrMetallicRoughness,
    ]),
  );
  for (const [name, expected] of [
    [
      'Endcap body | midnight-blue enamel',
      {
        baseColorFactor: [0.015, 0.028, 0.065, 1],
        metallicFactor: 0.45,
        roughnessFactor: 0.32,
      },
    ],
    [
      'Endcap edging | warm brushed gold',
      {
        baseColorFactor: [0.72, 0.36, 0.075, 1],
        metallicFactor: 0.82,
        roughnessFactor: 0.25,
      },
    ],
  ]) {
    const actual = roles[name];
    assert(actual, `material role exists: ${name}`);
    assert(
      actual.baseColorFactor.every(
        (value, index) =>
          Math.abs(value - expected.baseColorFactor[index]) < 1e-5,
      ),
      `${name} base color matches export contract`,
    );
    assert(
      Math.abs(actual.metallicFactor - expected.metallicFactor) < 1e-5,
      `${name} metallic factor matches export contract`,
    );
    assert(
      Math.abs(actual.roughnessFactor - expected.roughnessFactor) < 1e-5,
      `${name} roughness factor matches export contract`,
    );
  }
  return {
    nodeCount: document.nodes.length,
    meshCount: document.meshes.length,
    primitiveCount,
    materialCount: document.materials.length,
    triangleCount,
    materialRoles: Object.keys(roles),
  };
}

function assetInventory(root) {
  const meshes = [];
  const materials = new Set();
  const buffers = new Set();
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push(object);
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    meshMaterials.forEach((material) => materials.add(material));
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    assert(
      position && position.count > 0,
      `${object.name || 'mesh'} has position vertices`,
    );
    const normal = geometry.getAttribute('normal');
    assert(
      normal && [...normal.array].every(Number.isFinite),
      `${object.name || 'mesh'} has finite imported normals`,
    );
    triangles += geometry.index ? geometry.index.count / 3 : position.count / 3;
    for (const attribute of Object.values(geometry.attributes)) {
      if (attribute.array?.buffer) buffers.add(attribute.array.buffer);
    }
    if (geometry.index?.array?.buffer) buffers.add(geometry.index.array.buffer);
  });
  return {
    meshes,
    materials: [...materials],
    triangles,
    decodedGeometryTypedArrayBytes: [...buffers].reduce(
      (sum, buffer) => sum + buffer.byteLength,
      0,
    ),
  };
}

function aimCamera(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  assert(!bounds.isEmpty(), 'asset bounds are non-empty');
  const min = bounds.min.toArray();
  const max = bounds.max.toArray();
  assert([...min, ...max].every(Number.isFinite), 'asset bounds are finite');
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  assert(
    size.x > 0 && size.y > 0 && size.z > 0,
    'asset has finite extent in all glTF axes',
  );
  const direction = new THREE.Vector3(0, 0.26, 0.966).normalize();
  const right = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), direction)
    .normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const verticalHalfAngle = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfAngle = Math.atan(
    Math.tan(verticalHalfAngle) * camera.aspect,
  );
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const delta = new THREE.Vector3(x, y, z).sub(center);
        const depthOffset = delta.dot(direction);
        distance = Math.max(
          distance,
          Math.abs(delta.dot(right)) / (Math.tan(horizontalHalfAngle) * 0.84) +
            depthOffset,
          Math.abs(delta.dot(up)) / (Math.tan(verticalHalfAngle) * 0.84) +
            depthOffset,
        );
      }
    }
  }
  distance += 0.1;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance + Math.hypot(size.x, size.y, size.z) * 4;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return {
    min,
    max,
    center: center.toArray(),
    size: size.toArray(),
    camera: {
      fovDegrees: 36,
      position: camera.position.toArray(),
      target: center.toArray(),
    },
  };
}

async function run() {
  const loadStarted = performance.now();
  if (runNegativeChecks) {
    const loader = new GLTFLoader();
    let invalidRejected = false;
    await new Promise((resolve) => {
      try {
        loader.parse(
          new ArrayBuffer(8),
          '',
          () => resolve(),
          () => {
            invalidRejected = true;
            resolve();
          },
        );
      } catch {
        invalidRejected = true;
        resolve();
      }
    });
    assert(invalidRejected, 'GLTFLoader rejects invalid binary input');
  }

  const response = await fetch(assetPath, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(
      `Asset request failed: ${response.status} ${response.statusText} (${assetPath})`,
    );
  const buffer = await response.arrayBuffer();
  assert(buffer.byteLength > 0, 'GLB response is non-empty');
  if (
    buffer.byteLength < 12 ||
    new DataView(buffer).getUint32(0, true) !== 0x46546c67
  ) {
    throw new Error(
      `Invalid GLB payload: missing glTF magic header (HTTP ${response.status}, ${response.headers.get('content-type') || 'unknown content type'})`,
    );
  }
  const glbContract = validateGlbContract(readGlbJson(buffer));
  const loader = new GLTFLoader();
  const originalWarn = console.warn;
  console.warn = (...args) => {
    loaderWarnings.push(args.map(String).join(' '));
    originalWarn.apply(console, args);
  };
  let gltf;
  try {
    gltf = await new Promise((resolve, reject) => {
      loader.parse(
        buffer,
        new URL('.', new URL(assetPath, location.href)).href,
        resolve,
        reject,
      );
    });
  } finally {
    console.warn = originalWarn;
  }
  const root = gltf.scene;
  assert(root, 'glTF has a default scene');
  scene.add(root);
  const inventory = assetInventory(root);
  assert(
    inventory.meshes.length === glbContract.primitiveCount,
    `expected one Three.js mesh per glTF primitive (${glbContract.primitiveCount}), received ${inventory.meshes.length}`,
  );
  assert(
    inventory.materials.length === glbContract.materialCount,
    `expected ${glbContract.materialCount} imported PBR materials, received ${inventory.materials.length}`,
  );
  assert(
    inventory.triangles === glbContract.triangleCount,
    `imported triangle count ${inventory.triangles} matches glTF primitive count ${glbContract.triangleCount}`,
  );
  const framing = aimCamera(root);
  const geometrySignature = inventory.meshes.map((mesh) => {
    const hash = (array) => {
      let value = 2166136261;
      for (const item of array) {
        const text = String(item);
        for (let index = 0; index < text.length; index += 1)
          value = Math.imul(value ^ text.charCodeAt(index), 16777619);
      }
      return (value >>> 0).toString(16).padStart(8, '0');
    };
    return {
      name: mesh.name,
      attributes: Object.fromEntries(
        Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [
          name,
          {
            count: attribute.count,
            itemSize: attribute.itemSize,
            hash: hash(attribute.array),
          },
        ]),
      ),
      index: mesh.geometry.index
        ? {
            count: mesh.geometry.index.count,
            hash: hash(mesh.geometry.index.array),
          }
        : null,
      material: (Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      ).map((material) => material.name),
    };
  });
  const sourceMaterialAssignments = inventory.meshes.map((mesh) => ({
    name: mesh.name,
    materialNames: (Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    ).map((material) => material.name),
  }));
  const cameraSignature = {
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    projection: camera.projectionMatrix.toArray(),
    target: framing.camera.target,
  };
  const materialSignature = inventory.materials.map((material) => ({
    name: material.name,
    color: material.color.toArray(),
    metalness: material.metalness,
    roughness: material.roughness,
    emissive: material.emissive.toArray(),
    map: Boolean(material.map),
    envMap: Boolean(material.envMap),
  }));
  assert(
    materialSignature.every((material) =>
      [
        ...material.color,
        ...material.emissive,
        material.metalness,
        material.roughness,
      ].every(Number.isFinite),
    ),
    'all imported baseline material values are finite',
  );
  // Deliberate harness-only consumer mapping: preserve the imported PBR objects
  // as baseline evidence, then assign a shared two-role toon palette to meshes.
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
  const toonMaterials = new Map(
    inventory.materials.map((original) => {
      const body = original.name.includes('midnight-blue');
      const material = new THREE.MeshToonMaterial({
        name: `${original.name} | validation toon`,
        color: body ? 0x244b8e : 0xe6a647,
        gradientMap: ramp,
        side: THREE.DoubleSide,
      });
      return [original, material];
    }),
  );
  assert(
    [...toonMaterials.values()].every((material) =>
      [material.color.r, material.color.g, material.color.b].every(
        Number.isFinite,
      ),
    ),
    'all derived toon material values are finite',
  );
  for (const mesh of inventory.meshes) {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => toonMaterials.get(material))
      : toonMaterials.get(mesh.material);
  }
  renderer.info.reset();
  renderer.render(scene, camera);
  const resourceEntry = performance
    .getEntriesByName(response.url, 'resource')
    .at(-1);

  const materials = inventory.materials.map((material) => ({
    name: material.name,
    type: material.type,
    color: material.color?.getHexString(),
    baseColorLinear: material.color
      ? [material.color.r, material.color.g, material.color.b]
      : null,
    roughness: material.roughness,
    metalness: material.metalness,
    emissive: material.emissive?.getHexString(),
    maps: [
      'map',
      'normalMap',
      'aoMap',
      'emissiveMap',
      'metalnessMap',
      'roughnessMap',
    ]
      .filter((key) => Boolean(material[key]))
      .map((key) => key),
  }));
  const elapsedMs = performance.now() - loadStarted;
  const result = {
    state: 'passed-structural-checks-not-visual-approval',
    mode,
    materialTreatment:
      'Harness-only MeshToonMaterial mapping with a 3-step nearest-filtered gradient ramp; imported MeshStandardMaterial objects remain recorded as baseline and are not rendered.',
    assetPath,
    environment: 'local validation browser; not a target-device benchmark',
    localFetchParseAndFirstRenderMs: Number(elapsedMs.toFixed(2)),
    glbResponseBodyBytes: buffer.byteLength,
    browserResourceTransferBytes: resourceEntry?.transferSize || null,
    responseContentType: response.headers.get('content-type'),
    gltfStructure: glbContract,
    threeMeshObjectCount: inventory.meshes.length,
    decodedGeometryTypedArrayBytes: inventory.decodedGeometryTypedArrayBytes,
    decodedTextureRGBAEstimateBytes:
      'not measured (texture pixel buffers are not read back)',
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    },
    coordinateContract:
      'glTF Y-up; bounds reported in imported Three.js coordinates',
    meshes: sourceMaterialAssignments,
    materialCount: inventory.materials.length,
    materials,
    toonMaterialMapping: [...new Set(toonMaterials.values())].map(
      (material) => ({
        name: material.name,
        color: `#${material.color.getHexString()}`,
        type: material.type,
        gradientSteps: 3,
      }),
    ),
    renderInvariants: {
      camera: cameraSignature,
      material: materialSignature,
      geometry: geometrySignature,
    },
    geometryTriangles: inventory.triangles,
    sourceInheritedNearZeroAreaTriangles: 14,
    framing,
    renderContract: {
      outputColorSpace: 'SRGBColorSpace',
      toneMapping: 'ACESFilmicToneMapping',
      toneMappingExposure: 1.05,
      cameraFovDegrees: 36,
      representativeCityIntensity,
      representativeCityBrightness,
      hemisphere: {
        sky: hemi.color.getHexString(),
        ground: hemi.groundColor.getHexString(),
        intensity: hemi.intensity,
      },
      point: {
        color: mode === 'audience' ? '#ffb95e' : '#966dff',
        position: point.position.toArray(),
        intensity: point.intensity,
        distance: 23,
        decay: 2,
      },
    },
    loaderWarnings,
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
  };
  ramp.dispose();
  report(result, 'passed');
  const evidenceDataUrl = canvas.toDataURL('image/webp', 0.92);
  assert(
    evidenceDataUrl.startsWith('data:image/webp;'),
    'browser produced WebP evidence',
  );
  evidenceElement.textContent = JSON.stringify({
    filename: `${mode}.webp`,
    mimeType: 'image/webp',
    dataUrl: evidenceDataUrl,
  });
  evidenceElement.dataset.ready = 'true';
}

run().catch((error) => {
  errors.push(error.message || String(error));
  report({ state: 'failed', mode, assetPath, errors }, 'failed');
});

window.addEventListener('error', (event) => {
  errors.push(event.message || 'window error');
});
window.addEventListener('unhandledrejection', (event) => {
  errors.push(String(event.reason));
});
