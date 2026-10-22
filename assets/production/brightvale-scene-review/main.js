import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PRODUCTION = new URL('/assets/production/', location.origin);
const $ = (selector) => document.querySelector(selector);
const canvas = $('#view');
const reportNode = $('#report');
const evidenceNode = $('#evidence');
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'twilight' ? 'twilight' : 'audience';
const negative = params.get('case') === 'negative';
const errors = [];
const warnings = [];
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
const camera = new THREE.PerspectiveCamera(39.76070473, 1600 / 900, 0.1, 5000);
camera.position.set(0, 13.8999996185, 15);
camera.rotation.set(-0.1148765842, 0, 0);
camera.updateProjectionMatrix();

const palette = {
  audience: {
    sky: 0xffd49b,
    ground: 0x27334d,
    hemi: 1.25,
    point: 0xffb95e,
    pointIntensity: 78,
    pointPosition: [-12, 22, 3],
    fill: 0x6685c4,
  },
  twilight: {
    sky: 0xb7a0ff,
    ground: 0x21183e,
    hemi: 1.0,
    point: 0x966dff,
    pointIntensity: 96,
    pointPosition: [12, 24, -12],
    fill: 0x8267d0,
  },
}[mode];
scene.add(new THREE.HemisphereLight(palette.sky, palette.ground, palette.hemi));
const key = new THREE.DirectionalLight(
  mode === 'audience' ? 0xffc982 : 0x9c83ff,
  2.15,
);
key.position.set(-12, 32, 18);
scene.add(key);
const fill = new THREE.DirectionalLight(palette.fill, 1.15);
fill.position.set(18, 18, 2);
scene.add(fill);
const rim = new THREE.DirectionalLight(
  mode === 'audience' ? 0xff8e4b : 0x855cff,
  2.0,
);
rim.position.set(0, 27, -28);
scene.add(rim);
const point = new THREE.PointLight(
  palette.point,
  palette.pointIntensity,
  55,
  2,
);
point.position.set(...palette.pointPosition);
scene.add(point);

function assert(ok, message) {
  if (!ok) throw new Error(`Assertion failed: ${message}`);
}
function report(value, state) {
  reportNode.dataset.state = state;
  reportNode.textContent = JSON.stringify(value, null, 2);
}
async function hashBytes(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function parseGlb(buffer) {
  const v = new DataView(buffer);
  assert(
    v.byteLength >= 20 && v.getUint32(0, true) === 0x46546c67,
    'GLB magic/header',
  );
  assert(
    v.getUint32(4, true) === 2 && v.getUint32(8, true) === v.byteLength,
    'GLB version/length',
  );
  const n = v.getUint32(12, true);
  assert(v.getUint32(16, true) === 0x4e4f534a, 'GLB JSON first chunk');
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, n)).trim(),
  );
}
async function loadJson(path) {
  const url = new URL(path, PRODUCTION);
  const r = await fetch(url, { cache: 'no-store' });
  assert(r.ok, `layout request ${r.status}: ${path}`);
  const text = await r.text();
  assert(
    r.headers.get('content-type')?.includes('json'),
    `layout is not JSON (${url.href}): ${text.slice(0, 40)}`,
  );
  return JSON.parse(text);
}
async function loadGlb(path) {
  const url = new URL(path, PRODUCTION);
  const response = await fetch(url, { cache: 'no-store' });
  assert(response.ok, `asset request ${response.status}: ${path}`);
  const buffer = await response.arrayBuffer();
  const document = parseGlb(buffer);
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(buffer, url.href, resolve, reject),
  );
  assert(gltf.scene, `default scene present: ${path}`);
  return {
    root: gltf.scene,
    document,
    bytes: buffer.byteLength,
    hash: await hashBytes(buffer),
    url: path,
  };
}
function matrixFrom(entry) {
  assert(
    entry?.gltf?.matrix_column_major?.length === 16,
    `layout matrix exists for ${entry?.name}`,
  );
  return new THREE.Matrix4().fromArray(entry.gltf.matrix_column_major);
}
function roleOf(material) {
  return (
    material.userData?.city_role || material.userData?.role || material.name
  );
}
const toonCache = new Map();
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
function toonFor(source) {
  const role = roleOf(source);
  const signature = [
    role,
    source.color?.getHexString(),
    source.emissive?.getHexString(),
    source.emissiveIntensity,
    source.side,
  ].join('|');
  if (toonCache.has(signature)) return toonCache.get(signature);
  const material = new THREE.MeshToonMaterial({
    name: `${source.name} | ${role} | review toon`,
    color: source.color?.clone() ?? new THREE.Color(0xffffff),
    gradientMap: ramp,
    side: source.side ?? THREE.FrontSide,
    flatShading: source.flatShading ?? false,
    emissive: source.emissive?.clone() ?? new THREE.Color(0x000000),
    emissiveIntensity: source.emissiveIntensity ?? 1,
  });
  // Keep pure-emission hit regions black-based; emission stays a separate channel.
  if (
    source.color &&
    source.color.r + source.color.g + source.color.b < 0.0001 &&
    source.emissive &&
    source.emissive.r + source.emissive.g + source.emissive.b > 0
  )
    material.color.setRGB(0, 0, 0);
  toonCache.set(signature, material);
  return material;
}
function applyToon(root) {
  const materials = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.material = Array.isArray(obj.material)
      ? obj.material.map((m) => {
          materials.add(m);
          return toonFor(m);
        })
      : (materials.add(obj.material), toonFor(obj.material));
  });
  return materials;
}
function addPlaced(root, matrix, name, parent = scene) {
  const placed = new THREE.Group();
  placed.name = name;
  placed.matrixAutoUpdate = false;
  placed.matrix.copy(matrix);
  placed.add(root);
  parent.add(placed);
  return placed;
}
function makeGround(surface) {
  const geometry = new THREE.BufferGeometry();
  const points = surface.positions_local_gltf.flat();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3),
  );
  geometry.setIndex(surface.triangle_indices.flat());
  geometry.computeVertexNormals();
  const base = surface.material.base_color_linear;
  const material = new THREE.MeshToonMaterial({
    name: `${surface.material.name} | review`,
    color: new THREE.Color().setRGB(base[0], base[1], base[2]),
    gradientMap: ramp,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = surface.name;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrixFrom(surface));
  scene.add(mesh);
  return mesh;
}
function triangles(root) {
  let count = 0,
    meshes = 0;
  root.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      const meshTriangles = o.geometry.index
        ? o.geometry.index.count / 3
        : o.geometry.getAttribute('position').count / 3;
      count += meshTriangles * (o.isInstancedMesh ? o.count : 1);
    }
  });
  return { meshes, triangles: count };
}
function assertTriangleAccounting() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(18), 3),
  );
  const root = new THREE.Group();
  const normalMaterial = new THREE.MeshBasicMaterial();
  const instancedMaterial = new THREE.MeshBasicMaterial();
  root.add(new THREE.Mesh(geometry, normalMaterial));
  const instanced = new THREE.InstancedMesh(geometry, instancedMaterial, 3);
  instanced.count = 3;
  root.add(instanced);
  const measured = triangles(root);
  geometry.dispose();
  normalMaterial.dispose();
  instancedMaterial.dispose();
  assert(
    measured.meshes === 2 && measured.triangles === 8,
    `triangle accounting includes normal mesh and three instances (${JSON.stringify(measured)})`,
  );
}
function instanceStaticGroup(container, label) {
  container.updateMatrixWorld(true);
  const inverse = container.matrixWorld.clone().invert();
  const batches = new Map();
  let sourceMeshes = 0;
  container.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    sourceMeshes++;
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    assert(
      !Array.isArray(o.material),
      `${label} source mesh has one material per primitive`,
    );
    let byMaterial = batches.get(o.geometry);
    if (!byMaterial) batches.set(o.geometry, (byMaterial = new Map()));
    let list = byMaterial.get(material);
    if (!list) byMaterial.set(material, (list = []));
    list.push({ matrix: inverse.clone().multiply(o.matrixWorld), source: o });
  });
  const sourceBounds = new THREE.Box3().setFromObject(container);
  const drawables = [];
  for (const [geometry, byMaterial] of batches)
    for (const [material, entries] of byMaterial) {
      const instanced = new THREE.InstancedMesh(
        geometry,
        material,
        entries.length,
      );
      instanced.name = `${label}.batch.${drawables.length}`;
      instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      entries.forEach((entry, i) => instanced.setMatrixAt(i, entry.matrix));
      instanced.count = entries.length;
      instanced.computeBoundingBox();
      instanced.computeBoundingSphere();
      instanced.userData.reviewSourceMatrices = entries.map((entry) =>
        entry.matrix.toArray(),
      );
      drawables.push(instanced);
    }
  for (const child of [...container.children]) container.remove(child);
  for (const batch of drawables) container.add(batch);
  container.updateMatrixWorld(true);
  const resultBounds = new THREE.Box3().setFromObject(container);
  const maxBoundsError = Math.max(
    ...sourceBounds.min
      .toArray()
      .map((v, i) => Math.abs(v - resultBounds.min.toArray()[i])),
    ...sourceBounds.max
      .toArray()
      .map((v, i) => Math.abs(v - resultBounds.max.toArray()[i])),
  );
  assert(
    maxBoundsError < 1e-4,
    `${label} instanced bounds match source (${maxBoundsError})`,
  );
  return {
    sourceMeshes,
    instancedDrawables: drawables.length,
    sourceInstances: drawables.reduce((n, x) => n + x.count, 0),
    boundsError: maxBoundsError,
  };
}
async function run() {
  const started = performance.now();
  assertTriangleAccounting();
  const layoutPath = params.get('layout') || 'brightvale-structure-layout.json';
  const layout = await loadJson(layoutPath);
  assert(
    layout.schema === 'brightvale-structure-layout-v1',
    'authoritative layout schema',
  );
  if (negative) {
    let rejected = false;
    try {
      await new Promise((resolve, reject) =>
        new GLTFLoader().parse(new ArrayBuffer(8), '', resolve, reject),
      );
    } catch {
      rejected = true;
    }
    assert(rejected, 'GLTFLoader rejects invalid GLB');
  }
  const paths = {
    platform: 'brightvale-platform/platform.glb',
    highway: 'brightvale-highway/highway.glb',
    endcaps: 'brightvale-platform-endcaps/endcaps.glb',
    long: 'brightvale-outer-framing/long.glb',
    post: 'brightvale-outer-framing/post.glb',
    city: 'brightvale-distant-city/city.glb',
  };
  const loaded = {};
  for (const [key, path] of Object.entries(paths))
    loaded[key] = await loadGlb(params.get(key) || path);
  const fileHashes = Object.fromEntries(
    Object.entries(loaded).map(([k, v]) => [
      k,
      { bytes: v.bytes, sha256: v.hash, path: v.url },
    ]),
  );
  const expectedHashes = {
    platform:
      '1ad2308e0a73dd245feb18e6e5567e0664ac9d45ff09aeefc1c0a2647709e9f1',
    highway: 'e650f6d7b65b2710e5605ba8231741a1d893effd96e5d53116e31d39d30da751',
    endcaps: '76301ee2ab5915a299c4fd54949dceee26a5db4023e767bfa8ceba893390c2b5',
    long: '8cb0f33f672b366a7725158f21524a42bc55afe2d21153575030a991a9b4d012',
    post: '54b718163e06fb27b357bd3ac3255319b345a747e84159c5b618a233fec1a6fb',
    city: '47bfaf2f18ed154cc86e5495102e0b4b888dca8cded12c1c8f47ec67fe040579',
  };
  for (const [key, digest] of Object.entries(expectedHashes))
    assert(loaded[key].hash === digest, `${key} source GLB SHA-256 unchanged`);
  const importStats = Object.fromEntries(
    Object.entries(loaded).map(([k, v]) => [k, triangles(v.root)]),
  );
  const expectedAssetTriangles = {
    platform: 24426,
    highway: 11336,
    endcaps: 2568,
    long: 2668,
    post: 968,
    city: 216633,
  };
  for (const [key, count] of Object.entries(expectedAssetTriangles))
    assert(
      importStats[key].triangles === count,
      `${key} placed/imported triangles match production report`,
    );
  const imported = Object.values(loaded).flatMap((v) => {
    const arr = [];
    v.root.traverse((o) => {
      if (o.isMesh) arr.push(o);
    });
    return arr;
  });
  const materialBaseline = new Map();
  for (const { root } of Object.values(loaded))
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (!materialBaseline.has(m))
          materialBaseline.set(m, {
            name: m.name,
            type: m.type,
            color: m.color?.toArray(),
            metalness: m.metalness,
            roughness: m.roughness,
            emissive: m.emissive?.toArray(),
            emissiveIntensity: m.emissiveIntensity,
            role: roleOf(m),
          });
    });
  for (const { root } of Object.values(loaded)) applyToon(root);
  const cityRoles = new Set([...materialBaseline.values()].map((m) => m.role));
  for (const role of [
    'body',
    'recess',
    'roof',
    'stone_trim',
    'gold',
    'emissive_window',
  ])
    assert(cityRoles.has(role), `city material role retained: ${role}`);
  const windowMaterial = [...materialBaseline.values()].find(
    (m) => m.role === 'emissive_window',
  );
  assert(
    windowMaterial?.emissive?.some((v) => v > 0) &&
      windowMaterial.emissiveIntensity > 1,
    'city window emission color and strength retained',
  );
  const luminousHitMaterials = [...materialBaseline.values()].filter(
    (m) =>
      m.name.toLowerCase().includes('hit') && m.emissive?.some((v) => v > 0),
  );
  assert(
    luminousHitMaterials.length > 0,
    'platform luminous hit material emission imported',
  );

  const playfieldMatrix = matrixFrom(layout.playfield);
  for (const key of ['platform', 'highway', 'endcaps'])
    addPlaced(loaded[key].root, playfieldMatrix, `placed:${key}`);
  const cityMatrix = matrixFrom(layout.city);
  const cityPlaced = addPlaced(
    loaded.city.root,
    cityMatrix,
    'placed:full-city',
  );
  const cityBatch = instanceStaticGroup(cityPlaced, 'city');
  // Place the exact saved 26 section + 27 complete-post enclosure, no short modules.
  const framing = layout.framing_instances;
  assert(
    framing.filter((x) => x.module === 'long').length === 26 &&
      framing.filter((x) => x.module === 'post').length === 27,
    'layout has 26 long sections and 27 whole posts',
  );
  const framingGroup = new THREE.Group();
  framingGroup.name = 'framing-assembly';
  scene.add(framingGroup);
  for (const inst of framing) {
    const key = inst.module;
    assert(
      key === 'long' || key === 'post',
      `no optional short module in assembly: ${key}`,
    );
    const clone = loaded[key].root.clone(true);
    addPlaced(clone, matrixFrom(inst), inst.name, framingGroup);
  }
  const framingBatch = instanceStaticGroup(framingGroup, 'framing');
  for (const surface of layout.ground_surfaces) makeGround(surface);

  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const cityBounds = new THREE.Box3().setFromObject(cityPlaced);
  const playfieldBounds = new THREE.Box3();
  for (const key of ['platform', 'highway', 'endcaps'])
    playfieldBounds.union(
      new THREE.Box3().setFromObject(scene.getObjectByName(`placed:${key}`)),
    );
  assert(
    cityBounds.min.toArray().every(Number.isFinite) &&
      playfieldBounds.min.toArray().every(Number.isFinite),
    'scene bounds finite',
  );
  assert(
    Math.abs(cityBounds.min.x + 46.55) < 0.01 &&
      Math.abs(cityBounds.max.x - 46.55) < 0.01,
    'full city lateral bounds match transformed GLB contract',
  );
  assert(
    Math.abs(cityBounds.min.y + 0.65) < 0.01 &&
      Math.abs(cityBounds.max.y - 45.2) < 0.02,
    'full city vertical bounds match transformed GLB contract',
  );
  assert(
    Math.abs(cityBounds.min.z + 89.65) < 0.02 &&
      Math.abs(cityBounds.max.z + 50.8) < 0.02,
    'full city depth bounds match transformed GLB contract',
  );
  assert(
    Math.abs(layout.ground_surfaces[0].positions_local_gltf[0][1] - -0.65) <
      0.001,
    'lower ground retains Z-up/Three Y=-0.65 datum',
  );
  assert(
    Math.abs(layout.ground_surfaces[1].gltf.translation[1] - 8.25) < 0.001,
    'plaza retains raised Y=8.25 level',
  );
  assert(
    loaded.city.document.meshes.reduce((n, m) => n + m.primitives.length, 0) ===
      288,
    'city has 288 unique primitives',
  );
  assert(loaded.city.root.children.length > 0, 'city loaded');

  renderer.info.reset();
  renderer.render(scene, camera);
  const frame = renderer.info.render;
  const sceneCounts = triangles(scene);
  const decodedBuffers = new Set();
  for (const o of imported)
    for (const a of Object.values(o.geometry.attributes))
      decodedBuffers.add(a.array.buffer);
  for (const o of imported)
    if (o.geometry.index) decodedBuffers.add(o.geometry.index.array.buffer);
  const reportData = {
    state: 'passed-structural-checks-not-final-runtime-approval',
    mode,
    environment:
      'local Chromium/SwiftShader browser review; timings and draw counts are not target-device claims',
    layout: {
      schema: layout.schema,
      sourceSha256: layout.source_sha256,
      units: layout.units,
      playfieldTiltDegrees: layout.playfield.tilt_degrees,
      playfieldMatrix: layout.playfield.gltf.matrix_column_major,
      cityMatrix: layout.city.gltf.matrix_column_major,
    },
    inputs: fileHashes,
    importedAssetCounts: importStats,
    assembly: {
      framingLongSections: 26,
      wholePosts: 27,
      batching: {
        city: cityBatch,
        framing: framingBatch,
      },
      cityWorldBounds: {
        min: cityBounds.min.toArray(),
        max: cityBounds.max.toArray(),
      },
      playfieldWorldBounds: {
        min: playfieldBounds.min.toArray(),
        max: playfieldBounds.max.toArray(),
      },
    },
    materialTreatment:
      'All source GLBs remain unchanged. Browser-only shared MeshToonMaterial instances use a nearest-filtered three-step ramp; original base-color and emissive channels/strengths are retained separately. PBR roughness/metallic/environment response is not reproduced. Procedural mineral fine noise remains unbaked; source constant base colors and roughness are used.',
    baselineMaterials: [...materialBaseline.values()],
    toonMaterials: [...toonCache.values()].map((m) => ({
      name: m.name,
      color: m.color.getHexString(),
      emissive: m.emissive.getHexString(),
      emissiveIntensity: m.emissiveIntensity,
      gradientSteps: 3,
      side: m.side,
    })),
    geometry: {
      loadedMeshObjects: imported.length,
      decodedGeometryArrayBytes: [...decodedBuffers].reduce(
        (n, b) => n + b.byteLength,
        0,
      ),
      sceneMeshObjects: sceneCounts.meshes,
      sceneTriangles: sceneCounts.triangles,
    },
    renderer: {
      calls: frame.calls,
      triangles: frame.triangles,
      points: frame.points,
      lines: frame.lines,
      webgl: (() => {
        const gl = renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          version: gl.getParameter(gl.VERSION),
          vendor: debug
            ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
            : gl.getParameter(gl.VENDOR),
          renderer: debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
        };
      })(),
    },
    localFetchParseAssemblyAndFirstRenderMs: Number(
      (performance.now() - started).toFixed(2),
    ),
    lighting: {
      preset: mode,
      hemisphere: {
        sky: palette.sky,
        ground: palette.ground,
        intensity: palette.hemi,
      },
      point: {
        color: palette.point,
        intensity: palette.pointIntensity,
        position: palette.pointPosition,
      },
      toneMapping: 'ACESFilmicToneMapping',
      outputColorSpace: 'SRGBColorSpace',
      exposure: 1.05,
    },
    camera: {
      fov: camera.fov,
      aspect: camera.aspect,
      position: camera.position.toArray(),
      rotation: camera.rotation.toArray(),
      matrix: camera.matrix.toArray(),
      projection: camera.projectionMatrix.toArray(),
    },
    loaderWarnings: warnings,
    limitations: [
      'Crowd is intentionally excluded; this shared-source scene review covers city and playfield assets only.',
      'Background is fixed; verify mode difference on scene surfaces.',
      'Software renderer metrics are local structural evidence only, not mobile/device budgets.',
      'No mineral noise bake, texture synthesis, game integration, collision/support claims, or changes to source geometry/assets.',
      'Study composition intentionally retains inherited skyline crop and exact camera framing.',
    ],
  };
  assert(
    frame.calls > 0 && frame.triangles > 0,
    'browser rendered scene geometry',
  );
  report(reportData, 'passed');
  const dataUrl = canvas.toDataURL('image/webp', 0.94);
  assert(dataUrl.startsWith('data:image/webp;'), 'browser WebP capture');
  evidenceNode.textContent = JSON.stringify({
    filename: `${mode}.webp`,
    mimeType: 'image/webp',
    dataUrl,
  });
  evidenceNode.dataset.ready = 'true';
  ramp.dispose();
}

run().catch((error) => {
  errors.push(error?.stack || String(error));
  report({ state: 'failed', mode, errors, warnings }, 'failed');
});
window.addEventListener('error', (event) =>
  errors.push(event.message || 'window error'),
);
window.addEventListener('unhandledrejection', (event) =>
  errors.push(String(event.reason)),
);
