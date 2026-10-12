import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import layout from '../../assets/production/brightvale-structure-layout.json';
import platformInfo from '../../assets/production/brightvale-platform/technical-validation.json';
import highwayInfo from '../../assets/production/brightvale-highway/technical-validation.json';
import endcapsInfo from '../../assets/production/brightvale-platform-endcaps/technical-validation.json';
import difficultyProfiles from '../../data/charts/difficulty-profiles.json';
import { createBrightvalePlayfieldContract } from '../../src/brightvale/playfield.ts';

const canvas = document.querySelector('#view');
const reportNode = document.querySelector('#report');
const params = new URLSearchParams(location.search);
const narrow = params.get('view') === 'narrow';
const width = narrow ? 1120 : 1600;
const height = narrow ? 700 : 900;
const viewport = narrow
  ? { x: 112, y: 66, width: 896, height: 568 }
  : { x: 0, y: 0, width: 1600, height: 900 };
canvas.width = width;
canvas.height = height;
canvas.style.aspectRatio = `${width} / ${height}`;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111a2b');
scene.add(new THREE.HemisphereLight(0xc9dcff, 0x172035, 1.7));
const key = new THREE.DirectionalLight(0xffd19c, 2.4);
key.position.set(-12, 32, 18);
scene.add(key);
const camera = new THREE.PerspectiveCamera(
  39.76070473,
  viewport.width / viewport.height,
  0.1,
  5000,
);
// Keep the accepted view direction/FOV and the measured hit pixels, but move
// farther out on the same center-target ray to keep the easy late endpoint in
// both evidence viewports.
const cameraPullback = 1.5;
const transformedCenterHit = new THREE.Vector3(0, 0.365, -1.45).applyMatrix4(
  new THREE.Matrix4().fromArray(layout.playfield.gltf.matrix_column_major),
);
camera.position
  .set(0, 13.8999996185, 15)
  .sub(transformedCenterHit)
  .multiplyScalar(cameraPullback)
  .add(transformedCenterHit);
camera.rotation.set(-0.1148765842, 0, 0);
camera.updateProjectionMatrix();

const ROOT = new URL('/assets/production/', location.origin);
const loader = new GLTFLoader();
async function load(name, path, digest) {
  const response = await fetch(new URL(path, ROOT));
  if (!response.ok) throw new Error(`${name} fetch failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actual = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== digest) throw new Error(`${name} hash mismatch ${actual}`);
  const gltf = await loader.parseAsync(bytes, new URL(path, ROOT).href);
  return { root: gltf.scene, path, sha256: actual, bytes: bytes.byteLength };
}
function place(root, name) {
  const parent = new THREE.Group();
  parent.name = `proof:${name}`;
  parent.matrixAutoUpdate = false;
  parent.matrix.fromArray(layout.playfield.gltf.matrix_column_major);
  parent.add(root);
  scene.add(parent);
  return parent;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function finiteVec(v) {
  return v.toArray().every(Number.isFinite);
}

function projected(point, viewport) {
  const ndc = point.clone().project(camera);
  return [
    viewport.x + ((ndc.x + 1) * viewport.width) / 2,
    height - viewport.y - ((ndc.y + 1) * viewport.height) / 2,
  ];
}
function addDot(position, color, radius = 0.11) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.copy(position);
  mesh.renderOrder = 20;
  scene.add(mesh);
}
async function run() {
  const started = performance.now();
  const loaded = await Promise.all([
    load(
      'platform',
      'brightvale-platform/platform.glb',
      platformInfo.glb_sha256,
    ),
    load('highway', 'brightvale-highway/highway.glb', highwayInfo.glb_sha256),
    load(
      'endcaps',
      'brightvale-platform-endcaps/endcaps.glb',
      endcapsInfo.glb_sha256,
    ),
  ]);
  const assembly = loaded.map(({ root, path }) => place(root, path));
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const seedContract = createBrightvalePlayfieldContract();
  const meshes = [];
  for (const root of assembly)
    root.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
  const raycaster = new THREE.Raycaster();
  const matrix = new THREE.Matrix4().fromArray(
    layout.playfield.gltf.matrix_column_major,
  );
  const inverseMatrix = matrix.clone().invert();
  const centers = [-4.5, -1.5, 1.5, 4.5];
  const samplesPerLane = 673;
  const sampledSurface = [];
  const rayHitCounts = new Map();
  const profile = [];
  const laneGeometry = [];
  const targetGeometry = [];
  const highwayMeshes = [];
  assembly[1].traverse((object) => {
    if (object.isMesh) highwayMeshes.push(object);
  });
  const localBounds = (mesh) => {
    const bounds = new THREE.Box3().setFromObject(mesh);
    const points = [];
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          points.push(new THREE.Vector3(x, y, z).applyMatrix4(inverseMatrix));
    return new THREE.Box3().setFromPoints(points);
  };
  for (let lane = 0; lane < 4; lane += 1) {
    const candidates = highwayMeshes
      .map((mesh) => ({ mesh, bounds: localBounds(mesh) }))
      .filter(
        ({ bounds }) =>
          Math.abs((bounds.min.x + bounds.max.x) / 2 - centers[lane]) < 0.25 &&
          bounds.max.x - bounds.min.x > 2.5 &&
          bounds.max.x - bounds.min.x < 3 &&
          bounds.max.z - bounds.min.z > 30,
      );
    assert(
      candidates.length > 0,
      `lane ${lane} authored-width highway geometry exists`,
    );
    const union = new THREE.Box3();
    candidates.forEach(({ bounds }) => union.union(bounds));
    const widthLocal = union.max.x - union.min.x;
    assert(
      widthLocal > 2.5 && widthLocal < 3,
      `lane ${lane} imported mesh width ${widthLocal} is consistent with authored 2.75-unit travel surface`,
    );
    laneGeometry.push({
      lane,
      meshPrimitives: candidates.length,
      measuredBoundsWidth: widthLocal,
      authoredWidth: 2.75,
    });
  }
  const platformMeshes = [];
  assembly[0].traverse((object) => {
    if (object.isMesh) platformMeshes.push(object);
  });
  for (let lane = 0; lane < 4; lane += 1) {
    const anchor = seedContract.hitAnchor(lane);
    const targetMesh = platformMeshes
      .map((mesh) => ({
        mesh,
        center: new THREE.Box3()
          .setFromObject(mesh)
          .getCenter(new THREE.Vector3()),
      }))
      .sort(
        (a, b) => a.center.distanceTo(anchor) - b.center.distanceTo(anchor),
      )[0]?.mesh;
    assert(targetMesh, `lane ${lane} luminous target mesh exists`);
    const center = new THREE.Box3()
      .setFromObject(targetMesh)
      .getCenter(new THREE.Vector3());
    const error = center.distanceTo(anchor);
    assert(
      error < 0.06,
      `lane ${lane} luminous target center alignment error ${error}`,
    );
    targetGeometry.push({
      lane,
      mesh: targetMesh.name,
      worldCenter: center.toArray(),
      anchor: anchor.toArray(),
      centerError: error,
    });
  }
  for (let lane = 0; lane < 4; lane += 1) {
    const laneSamples = [];
    for (let index = 0; index < samplesPerLane; index += 1) {
      const progress = index / (samplesPerLane - 1);
      const localZ = -1.45 - 42 * (1 - progress);
      const origin = new THREE.Vector3(centers[lane], 1.5, localZ).applyMatrix4(
        matrix,
      );
      const localDown = new THREE.Vector3(0, -1, 0).transformDirection(matrix);
      raycaster.set(origin, localDown);
      const hits = raycaster.intersectObjects(meshes, false);
      const surfaceHit = hits.find((hit) => hit.distance > 0);
      assert(
        surfaceHit,
        `lane ${lane} progress ${progress.toFixed(3)} missed imported surface`,
      );
      const localSurfacePoint = surfaceHit.point
        .clone()
        .applyMatrix4(inverseMatrix);
      const footprintHeights = [-1, 0, 1].map((offset) => {
        const edgeOrigin = new THREE.Vector3(
          centers[lane] + offset,
          1.5,
          localZ,
        ).applyMatrix4(matrix);
        raycaster.set(edgeOrigin, localDown);
        const edgeHit = raycaster
          .intersectObjects(meshes, false)
          .find((hit) => hit.distance > 0);
        return edgeHit
          ? edgeHit.point.clone().applyMatrix4(inverseMatrix).y
          : localSurfacePoint.y;
      });
      const pathPoint = seedContract.point(lane, progress);
      const signedPathToSurface = pathPoint.y - surfaceHit.point.y;
      assert(
        Number.isFinite(signedPathToSurface),
        `lane ${lane} progress ${progress} has finite surface delta`,
      );
      laneSamples.push({
        progress,
        localZ: -1.45 - 42 * (1 - progress),
        surfaceHitLocalZ: localSurfacePoint.z,
        surfaceLocalY: localSurfacePoint.y,
        footprintMaxLocalY: Math.max(...footprintHeights),
        surfaceWorld: surfaceHit.point.toArray(),
        surfaceY: surfaceHit.point.y,
        pathY: pathPoint.y,
        signedPathToSurface,
      });
      const hitKey = `${lane}:${surfaceHit.object.name}`;
      rayHitCounts.set(hitKey, (rayHitCounts.get(hitKey) ?? 0) + 1);
    }
    for (let index = 0; index < laneSamples.length; index += 1) {
      const window = laneSamples.slice(index, index + 4);
      const sample = laneSamples[index];
      if (sample)
        sample.footprintMaxLocalY = Math.max(
          ...window.map((item) => item.footprintMaxLocalY),
        );
    }
    sampledSurface.push(laneSamples);
  }

  const measuredContract = createBrightvalePlayfieldContract({
    surfaceHeightAt(lane, localZ) {
      const samples = sampledSurface[lane];
      if (!samples) return null;
      const index = Math.max(
        0,
        Math.min(
          samples.length - 1,
          Math.round(
            ((localZ - samples[0].localZ) / 42) * (samples.length - 1),
          ),
        ),
      );
      const queryZ = Math.max(
        samples[0].localZ,
        Math.min(localZ, samples.at(-1).localZ),
      );
      const measured = [-1, 0, 1]
        .map((offset) => importedSurfaceHeight(centers[lane] + offset, queryZ))
        .filter((height) => height !== null);
      if (measured.length) return Math.max(...measured);
      const neighborhood = samples.slice(Math.max(0, index - 2), index + 3);
      return neighborhood.length
        ? Math.max(...neighborhood.map((sample) => sample.footprintMaxLocalY))
        : null;
    },
  });
  const contract = measuredContract;

  function importedSurfaceHeight(localX, localZ) {
    const origin = new THREE.Vector3(localX, 1.5, localZ).applyMatrix4(matrix);
    const down = new THREE.Vector3(0, -1, 0).transformDirection(matrix);
    raycaster.set(origin, down);
    const hit = raycaster
      .intersectObjects(meshes, false)
      .find((item) => item.distance > 0);
    return hit ? hit.point.clone().applyMatrix4(inverseMatrix).y : null;
  }

  // Compare a nonzero-Z helper query against the independently sampled center
  // ray profile, not against another call to this helper.
  const probeLocalX = centers[1];
  const probeLocalZ = -2.5;
  const probedHeight = importedSurfaceHeight(probeLocalX, probeLocalZ);
  const probeReference = sampledSurface[1]?.reduce((nearest, sample) =>
    Math.abs(sample.localZ - probeLocalZ) <
    Math.abs(nearest.localZ - probeLocalZ)
      ? sample
      : nearest,
  );
  assert(
    probeReference !== undefined &&
      Math.abs(probeReference.localZ - probeLocalZ) < 0.04 &&
      Number.isFinite(probeReference.surfaceLocalY),
    `independent loaded-geometry reference exists near (${probeLocalX}, ${probeLocalZ})`,
  );
  assert(
    probedHeight !== null &&
      Number.isFinite(probedHeight) &&
      Math.abs(probedHeight - probeReference.surfaceLocalY) < 0.02,
    `surface helper samples requested nonzero local point (${probeLocalX}, ${probeLocalZ}): independent mesh Y ${probeReference.surfaceLocalY}, got ${probedHeight}`,
  );

  const hitAnchors = centers.map((_, lane) => contract.hitAnchor(lane));
  for (let lane = 0; lane < 4; lane += 1) {
    const anchor = hitAnchors[lane];
    const note = sampledSurface[lane]?.at(-1);
    assert(anchor && note, `lane ${lane} target proof exists`);
    profile.push({
      lane,
      worldAnchor: anchor.toArray(),
      targetSurfaceY: note.surfaceY,
      pathY: note.pathY,
      measuredSignedPathToSurface: note.signedPathToSurface,
      measuredSamples: sampledSurface[lane]
        ?.filter((sample, index) =>
          [0, 320, 640, 650, 656, 660, 666, 668, 670, 671, 672].includes(index),
        )
        .map(
          ({
            progress,
            localZ,
            surfaceHitLocalZ,
            surfaceLocalY,
            pathY,
            signedPathToSurface,
          }) => ({
            progress,
            localZ,
            surfaceHitLocalZ,
            surfaceLocalY,
            pathY,
            signedPathToSurface,
          }),
        ),
    });
  }

  const clip = { top: narrow ? 66 : 0, bottom: narrow ? 634 : 900 };
  const laneColors = [0x45c5ff, 0xff5c92, 0xffbf5a, 0x62e39a];
  const keyLetters = ['D', 'F', 'J', 'K'];
  for (let lane = 0; lane < 4; lane += 1) {
    const color = laneColors[lane];
    assert(sampledSurface[lane], `lane ${lane} profile exists`);
    const note = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.08, 0.32),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.18,
      }),
    );
    const visibleHit = contract.visualPoint(lane, 1);
    note.position.copy(visibleHit);
    scene.add(note);
    const anchor = hitAnchors[lane];
    addDot(anchor.clone().add(new THREE.Vector3(0, 0.035, 0)), color, 0.16);
    const pixel = projected(anchor, viewport);
    assert(
      pixel[1] >= clip.top && pixel[1] <= clip.bottom,
      `${keyLetters[lane]} hit target outside scene viewport: ${pixel}`,
    );
  }

  const extents = {};
  const visualPathSamples = Array.from({ length: 673 }, (_, index) =>
    contract.visualPoint(1, index / 672),
  );
  const minProjectedStep = Math.min(
    ...visualPathSamples
      .slice(1)
      .map(
        (point, index) => point.z - (visualPathSamples[index]?.z ?? point.z),
      ),
  );
  assert(
    minProjectedStep > 0,
    `measured visual path remains projected-monotonic through ridge/hit (${minProjectedStep})`,
  );
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const profileData = difficultyProfiles.profiles[difficulty];
    const half = profileData.timing.good_ms / 1000 / 2.4;
    const start = contract.visualPoint(1, 1 - half);
    const end = contract.visualPoint(1, 1 + half);
    assert(
      finiteVec(start) && finiteVec(end),
      `${difficulty} unbounded envelope points finite`,
    );
    assert(
      end.z > start.z,
      `${difficulty} envelope points remain ordered along projected path`,
    );
    const pixels = [projected(start, viewport), projected(end, viewport)];
    const cameraDepth = [start, end].map(
      (point) => point.clone().applyMatrix4(camera.matrixWorldInverse).z,
    );
    assert(
      cameraDepth.every((depth) => depth < -camera.near && depth > -camera.far),
      `${difficulty} endpoint depth lies inside camera clips`,
    );
    extents[difficulty] = {
      halfProgress: half,
      progress: [1 - half, 1 + half],
      world: [start.toArray(), end.toArray()],
      pixels,
      cameraDepth,
      endpointsInsidePlayableViewport: pixels.map(
        ([x, y]) =>
          x >= viewport.x &&
          x <= viewport.x + viewport.width &&
          y >= clip.top &&
          y <= clip.bottom,
      ),
      measuredMinimumBodyGap: Infinity,
    };
    let intersampleChecks = 0;
    let minimumGapAt = null;
    for (let index = 0; index <= 168; index += 1) {
      const progress = 1 - half + (2 * half * index) / 168;
      const localCenter = contract
        .visualPoint(1, progress)
        .applyMatrix4(inverseMatrix);
      if (localCenter.z > -1.45) continue; // late envelope extends beyond the physical runway
      for (const offset of [-1, 0, 1]) {
        const surfaceY = importedSurfaceHeight(
          centers[1] + offset,
          localCenter.z,
        );
        if (surfaceY === null) continue;
        const gap = localCenter.y - 0.04 - surfaceY;
        extents[difficulty].measuredMinimumBodyGap = Math.min(
          extents[difficulty].measuredMinimumBodyGap,
          gap,
        );
        if (gap === extents[difficulty].measuredMinimumBodyGap)
          minimumGapAt = {
            progress,
            lateralOffset: offset,
            localZ: localCenter.z,
            noteCenterY: localCenter.y,
            surfaceY,
          };
        intersampleChecks += 1;
      }
    }
    extents[difficulty].interSampleSurfaceChecks = intersampleChecks;
    assert(
      intersampleChecks > 0,
      `${difficulty} envelope made successful measured surface checks`,
    );
    assert(
      Number.isFinite(extents[difficulty].measuredMinimumBodyGap) &&
        extents[difficulty].measuredMinimumBodyGap > 0,
      `${difficulty} envelope has finite positive measured body clearance`,
    );
    assert(
      minimumGapAt !== null &&
        Math.abs(
          minimumGapAt.localZ - (-1.45 - 42 * (1 - minimumGapAt.progress)),
        ) < 1e-8,
      `${difficulty} minimum-clearance evidence is paired with its requested local-Z sample`,
    );
    assert(
      Number.isFinite(extents[difficulty].measuredMinimumBodyGap) &&
        extents[difficulty].measuredMinimumBodyGap > 0,
      `${difficulty} envelope underside clearance ${extents[difficulty].measuredMinimumBodyGap} at ${JSON.stringify(minimumGapAt)} across ${intersampleChecks} measured cross-section rays`,
    );
    const envelopeMaterial = new THREE.MeshStandardMaterial({
      color:
        difficulty === 'hard'
          ? 0xffd05d
          : difficulty === 'normal'
            ? 0xf2f0dc
            : 0x9ba7bf,
      transparent: true,
      opacity: 0.28,
      depthTest: true,
      depthWrite: false,
    });
    const pathPoints = Array.from({ length: 85 }, (_, index) =>
      contract.visualPoint(1, 1 - half + (2 * half * index) / 84),
    );
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const a = pathPoints[index];
      const b = pathPoints[index + 1];
      if (!a || !b) continue;
      const tangent = b.clone().sub(a);
      const segment = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.08, tangent.length() + 0.015),
        envelopeMaterial,
      );
      segment.position.copy(a).add(b).multiplyScalar(0.5);
      segment.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        tangent.normalize(),
      );
      scene.add(segment);
    }
    addDot(start, 0xfff3cb, 0.085);
    addDot(end, 0xfff3cb, 0.085);
  }

  const centersPixels = hitAnchors.map((anchor) => projected(anchor, viewport));
  const targetWidths = centers.map(() => ({
    authoredLaneWidth: 2.75,
    centerSpacing: 3,
  }));
  const geometry = {
    inputFiles: loaded.map(({ path, sha256, bytes }) => ({
      path,
      sha256,
      bytes,
    })),
    sourceTransform: {
      tiltDegrees: layout.playfield.tilt_degrees,
      matrix: layout.playfield.gltf.matrix_column_major,
    },
    loadedMeshCount: meshes.length,
    actualLaneGeometry: laneGeometry,
    actualLuminousTargets: targetGeometry,
    surfaceProbe: {
      localX: probeLocalX,
      requestedLocalZ: probeLocalZ,
      helperLocalY: probedHeight,
      independentRayLocalZ: probeReference.localZ,
      independentRayLocalY: probeReference.surfaceLocalY,
    },
    raySamples: samplesPerLane * 4,
    footprintRaySamples: samplesPerLane * 4 * 3,
    rayHitCounts: Object.fromEntries(rayHitCounts),
    surfaceProfile: profile,
    lanes: centers.map((x, lane) => ({
      lane,
      centerLocalX: x,
      ...targetWidths[lane],
      hitPixels: centersPixels[lane],
      minSignedPathToSurface: Math.min(
        ...(sampledSurface[lane] ?? []).map(
          (sample) => sample.signedPathToSurface,
        ),
      ),
      maxSignedPathToSurface: Math.max(
        ...(sampledSurface[lane] ?? []).map(
          (sample) => sample.signedPathToSurface,
        ),
      ),
    })),
    timing: extents,
    measuredVisualPath: {
      samples: visualPathSamples.length,
      minimumWorldZStep: minProjectedStep,
      logicalHitAnchorDistinct:
        contract.visualPoint(1, 1).distanceTo(contract.hitAnchor(1)) > 0.05,
    },
    viewport: {
      width,
      height,
      scene: viewport,
      persistentHudExclusions: { top: clip.top, bottom: height - clip.bottom },
      camera: {
        position: camera.position.toArray(),
        pullbackAlongCenterTargetRay: cameraPullback,
        verticalFovDegrees: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
      },
    },
    durationMs: Number((performance.now() - started).toFixed(1)),
    limitations: [
      'Chromium/SwiftShader visual/geometry proof only; no device performance claim.',
      'Narrow-window fit uses a centered 896×568 scene viewport with persistent top/bottom HUD reservations; this is an evidence case, not a declared minimum viewport.',
      'Reported note clearance is vertical underside distance at sampled imported-mesh rays; it is not a complete collision or physics guarantee.',
      'Late timing progress continues beyond the loaded road end; no road-surface clearance is claimed outside physical mesh bounds.',
    ],
  };
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  renderer.setClearColor('#0d1422');
  renderer.clear(true, true, true);
  renderer.setViewport(
    viewport.x,
    height - viewport.y - viewport.height,
    viewport.width,
    viewport.height,
  );
  renderer.setScissor(
    viewport.x,
    height - viewport.y - viewport.height,
    viewport.width,
    viewport.height,
  );
  renderer.setScissorTest(true);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  reportNode.textContent = JSON.stringify(geometry, null, 2);
  reportNode.dataset.state = 'passed';
  document.body.dataset.state = 'passed';
  document.querySelector('#capture').textContent = canvas.toDataURL(
    'image/webp',
    0.94,
  );
}

run().catch((error) => {
  reportNode.textContent = error?.stack || String(error);
  reportNode.dataset.state = 'failed';
  document.body.dataset.state = 'failed';
});
