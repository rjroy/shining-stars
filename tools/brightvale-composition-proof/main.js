import * as THREE from 'three';
import { BRIGHTVALE_RUNTIME_LAYOUT } from '../../src/brightvale/layout.ts';
import { loadBrightvaleRuntimeAssets } from '../../src/brightvale/assets-runtime.ts';
import { createBrightvaleComposition } from '../../src/brightvale/composition.ts';
import { assembledTriangleCount } from '../../src/brightvale/metrics.ts';

const canvas = document.querySelector('#view');
const reportNode = document.querySelector('#report');
const captureNode = document.querySelector('#capture');
const parameters = new URLSearchParams(location.search);
const narrow = parameters.get('view') === 'narrow';
const requestedMode =
  parameters.get('mode') === 'twilight' ? 'twilight' : 'audience';
const width = narrow ? 1120 : 1600;
const height = narrow ? 700 : 900;
const viewport = narrow
  ? { x: 112, y: 66, width: 896, height: 568 }
  : { x: 0, y: 0, width: 1600, height: 900 };
const hudExclusions = { top: narrow ? 66 : 54, bottom: narrow ? 66 : 72 };
const stage = document.querySelector('#stage');
stage.style.width = `${width}px`;
stage.style.height = `${height}px`;
stage.style.aspectRatio = `${width} / ${height}`;
document.querySelector('#resolution').textContent =
  `${width} × ${height} · ${narrow ? 'narrow desktop' : 'reference'}`;
document.querySelector('#mode').textContent =
  requestedMode === 'audience' ? 'Audience' : 'Twilight';
document.body.classList.toggle('twilight', requestedMode === 'twilight');
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
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111a2b);
const layout = BRIGHTVALE_RUNTIME_LAYOUT;
const camera = new THREE.PerspectiveCamera(
  layout.camera.verticalFovDegrees,
  viewport.width / viewport.height,
  layout.camera.near,
  layout.camera.far,
);
camera.position.fromArray([...layout.camera.positionGltf]);
camera.quaternion.fromArray([...layout.camera.quaternionXyzw]);
camera.updateProjectionMatrix();

const modeState = (mode) => ({
  phase: mode,
  cityIntensity: mode === 'audience' ? 0.5 : 1,
  cityBrightness: mode === 'audience' ? 0.61 : 1,
  transitionProgress: mode === 'audience' ? 0 : 1,
  motion: {
    powerLinePulse: false,
    buildingPulse: false,
    windTravel: false,
    cameraPush: 0,
  },
  playerDefiant: false,
  twilightConsumed: mode === 'twilight',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function renderScene() {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  renderer.setClearColor(scene.background, 1);
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
}

function readPixels() {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

function pixelOffset(x, y) {
  return ((height - 1 - y) * width + x) * 4;
}

function geometryMask() {
  const savedMaterials = [];
  scene.traverse((object) => {
    const mesh = object;
    if (!mesh.isMesh) return;
    savedMaterials.push([mesh, mesh.material]);
    mesh.material = maskMaterial;
  });
  const savedBackground = scene.background;
  const savedToneMapping = renderer.toneMapping;
  scene.background = new THREE.Color(0x000000);
  renderer.toneMapping = THREE.NoToneMapping;
  renderScene();
  const pixels = readPixels();
  scene.background = savedBackground;
  renderer.toneMapping = savedToneMapping;
  for (const [mesh, material] of savedMaterials) mesh.material = material;
  return pixels;
}

const maskMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  toneMapped: false,
});

function compareModes(composition) {
  composition.updateAppearance(modeState('audience'));
  renderScene();
  const audiencePixels = readPixels();
  composition.updateAppearance(modeState('twilight'));
  renderScene();
  const twilightPixels = readPixels();
  const mask = geometryMask();
  let visibleGeometryPixels = 0;
  let changedVisibleGeometryPixels = 0;
  let absoluteDifference = 0;
  let changedChannels = 0;
  for (let y = viewport.y; y < viewport.y + viewport.height; y += 1) {
    for (let x = viewport.x; x < viewport.x + viewport.width; x += 1) {
      const offset = pixelOffset(x, y);
      if ((mask[offset] ?? 0) < 128) continue;
      visibleGeometryPixels += 1;
      let pixelChanged = false;
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(
          (audiencePixels[offset + channel] ?? 0) -
            (twilightPixels[offset + channel] ?? 0),
        );
        absoluteDifference += difference;
        changedChannels += 1;
        if (difference !== 0) pixelChanged = true;
      }
      if (pixelChanged) changedVisibleGeometryPixels += 1;
    }
  }
  return {
    sameCamera: true,
    sceneCrop: viewport,
    mask: 'visible geometry pixels only; black/background pixels excluded',
    visibleGeometryPixels,
    changedVisibleGeometryPixels,
    meanAbsoluteRgbDifference: changedChannels
      ? absoluteDifference / changedChannels
      : 0,
    comparison:
      'Audience and Twilight rendered at identical camera/viewport; exact nonzero channel differences',
  };
}

function paletteColor(index, count) {
  return new THREE.Color().setHSL(index / count, 0.88, 0.56);
}

function visibleCrowdEvidence(composition) {
  const crowdGroup = composition.root.getObjectByName('Brightvale.Crowd');
  assert(crowdGroup, 'assembled crowd group exists');
  const placements = layout.crowdPlacements.map((placement) => ({
    placement,
    origin: new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray([...placement.matrixColumnMajor]),
    ),
    color: undefined,
    pixels: 0,
    nearestInstanceDistance: Infinity,
    nearestAssignmentMargin: Infinity,
  }));
  const batches = [];
  crowdGroup.traverse((object) => {
    if (object.isInstancedMesh) batches.push(object);
  });
  const originalMaterials = [];
  const originalInstanceColors = [];
  const assignmentDistances = placements.map(() => []);
  for (const batch of batches) {
    originalMaterials.push([batch, batch.material]);
    originalInstanceColors.push([batch, batch.instanceColor]);
    batch.material = idMaterial;
    const world = new THREE.Matrix4();
    const point = new THREE.Vector3();
    for (let instance = 0; instance < batch.count; instance += 1) {
      batch.getMatrixAt(instance, world);
      world.premultiply(batch.matrixWorld);
      point.setFromMatrixPosition(world);
      const distances = placements.map(({ origin }) =>
        point.distanceTo(origin),
      );
      const ranked = distances
        .map((distance, placementIndex) => ({ distance, placementIndex }))
        .sort((a, b) => a.distance - b.distance);
      const nearest = ranked[0];
      const second = ranked[1];
      assert(nearest, 'each crowd instance maps to a layout placement');
      const target = placements[nearest.placementIndex];
      assert(target, 'crowd placement identity exists');
      const color = paletteColor(
        nearest.placementIndex + 1,
        placements.length + 1,
      );
      target.color = color;
      target.nearestInstanceDistance = Math.min(
        target.nearestInstanceDistance,
        nearest.distance,
      );
      target.nearestAssignmentMargin = Math.min(
        target.nearestAssignmentMargin,
        (second?.distance ?? Infinity) - nearest.distance,
      );
      assignmentDistances[nearest.placementIndex]?.push(nearest.distance);
      batch.setColorAt(instance, color);
    }
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
  }

  const savedOtherMaterials = [];
  scene.traverse((object) => {
    if (!object.isMesh || batches.includes(object)) return;
    savedOtherMaterials.push([object, object.material]);
    object.material = occluderMaterial;
  });
  const savedBackground = scene.background;
  const savedToneMapping = renderer.toneMapping;
  const savedOutputColorSpace = renderer.outputColorSpace;
  scene.background = new THREE.Color(0x000000);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderScene();
  const pixels = readPixels();

  const encoded = placements.map(({ color }) => {
    const srgb = color?.clone().convertLinearToSRGB();
    return srgb ? [srgb.r * 255, srgb.g * 255, srgb.b * 255] : [0, 0, 0];
  });
  for (let y = viewport.y; y < viewport.y + viewport.height; y += 1) {
    for (let x = viewport.x; x < viewport.x + viewport.width; x += 1) {
      const offset = pixelOffset(x, y);
      const rgb = [
        pixels[offset] ?? 0,
        pixels[offset + 1] ?? 0,
        pixels[offset + 2] ?? 0,
      ];
      let closestIndex = -1;
      let closestDistance = Infinity;
      encoded.forEach((color, index) => {
        const distance = Math.hypot(
          rgb[0] - color[0],
          rgb[1] - color[1],
          rgb[2] - color[2],
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      if (closestIndex >= 0 && closestDistance <= 18) {
        const person = placements[closestIndex];
        if (person) person.pixels += 1;
      }
    }
  }

  for (const [batch, material] of originalMaterials) batch.material = material;
  for (const [batch, color] of originalInstanceColors)
    batch.instanceColor = color;
  for (const [mesh, material] of savedOtherMaterials) mesh.material = material;
  scene.background = savedBackground;
  renderer.toneMapping = savedToneMapping;
  renderer.outputColorSpace = savedOutputColorSpace;

  return placements.map(
    (
      {
        placement,
        pixels: visiblePixels,
        nearestInstanceDistance,
        nearestAssignmentMargin,
      },
      index,
    ) => ({
      id: placement.id,
      variant: placement.variant,
      pose: placement.pose,
      source: placement.source,
      visiblePixels,
      fullyOccluded: visiblePixels === 0,
      nearestInstanceDistance,
      nearestAssignmentMargin,
      instancesAssigned: assignmentDistances[index]?.length ?? 0,
    }),
  );
}

function captureComposite(mode) {
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  assert(context, '2D evidence compositor is available');
  context.drawImage(canvas, 0, 0);
  const top = narrow ? 0 : 0;
  const bottom = narrow ? height - 66 : height - 72;
  context.fillStyle = 'rgba(7, 12, 22, 0.94)';
  context.fillRect(0, top, width, narrow ? 56 : 54);
  context.fillRect(0, bottom, width, narrow ? 66 : 72);
  context.strokeStyle = 'rgba(152, 179, 218, 0.24)';
  context.beginPath();
  context.moveTo(0, (narrow ? 56 : 54) + 0.5);
  context.lineTo(width, (narrow ? 56 : 54) + 0.5);
  context.moveTo(0, bottom + 0.5);
  context.lineTo(width, bottom + 0.5);
  context.stroke();
  context.textBaseline = 'middle';
  context.fillStyle = '#f0dfc5';
  context.font = '700 13px system-ui, sans-serif';
  context.fillText('✦  BRIGHTVALE', 28, 27);
  context.fillStyle = mode === 'twilight' ? '#b9a3ff' : '#f4bb70';
  context.textAlign = 'right';
  context.font = '700 11px system-ui, sans-serif';
  context.fillText(mode.toUpperCase(), width - 28, 27);
  context.textAlign = 'left';
  context.fillStyle = '#98a7c1';
  context.font = '600 10px system-ui, sans-serif';
  context.fillText('FOUR-LANE RHYTHM WORLD', 28, bottom + (narrow ? 33 : 36));
  context.textAlign = 'right';
  context.fillText(
    `${width} × ${height}  ·  ${narrow ? 'NARROW DESKTOP' : 'REFERENCE'}`,
    width - 28,
    bottom + (narrow ? 33 : 36),
  );
  return output.toDataURL('image/webp', 0.94);
}

async function run() {
  const started = performance.now();
  const assets = await loadBrightvaleRuntimeAssets(
    new AbortController().signal,
  );
  let composition;
  try {
    composition = createBrightvaleComposition(assets, layout, scene);
    scene.add(composition.root);
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const sourceMeshCounts = Object.fromEntries(
      Object.entries(assets.roots).map(([name, root]) => {
        let meshes = 0;
        root.traverse((object) => {
          if (object.isMesh) meshes += 1;
        });
        return [name, meshes];
      }),
    );
    const instanceCounts = {};
    const groupBounds = {};
    for (const name of [
      'Brightvale.City',
      'Brightvale.Framing',
      'Brightvale.Crowd',
      'Brightvale.Ground',
    ]) {
      const group = composition.root.getObjectByName(name);
      assert(group, `${name} exists in assembled composition`);
      const bounds = new THREE.Box3().setFromObject(group);
      groupBounds[name] = {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
      };
      let batchCount = 0;
      let instances = 0;
      group.traverse((object) => {
        if (!object.isInstancedMesh) return;
        batchCount += 1;
        instances += object.count;
      });
      instanceCounts[name] = { batches: batchCount, instances };
    }
    const sceneTriangles = assembledTriangleCount(composition.root);
    const groundGroup = composition.root.getObjectByName('Brightvale.Ground');
    const groundMeshes = [];
    groundGroup?.traverse((object) => {
      if (object.isMesh) groundMeshes.push(object);
    });
    const groundNormalEvidence = {
      meshCount: groundMeshes.length,
      meshesWithNormals: groundMeshes.filter(
        (mesh) =>
          mesh.geometry.getAttribute('normal')?.count ===
          mesh.geometry.getAttribute('position')?.count,
      ).length,
      allHaveNormals:
        groundMeshes.length === layout.groundSurfaces.length &&
        groundMeshes.every(
          (mesh) =>
            mesh.geometry.getAttribute('normal')?.count ===
            mesh.geometry.getAttribute('position')?.count,
        ),
    };
    assert(
      groundNormalEvidence.allHaveNormals,
      'all generated ground surfaces have computed vertex normals',
    );
    const modePixelComparison = compareModes(composition);
    const crowdVisibility = visibleCrowdEvidence(composition);
    const fullyOccludedPeople = crowdVisibility.filter(
      (person) => person.fullyOccluded,
    );

    composition.updateAppearance(modeState(requestedMode));
    renderScene();
    const actualRenderer = {
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      points: renderer.info.render.points,
      lines: renderer.info.render.lines,
    };
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      camera.quaternion,
    );
    const proof = {
      status:
        fullyOccludedPeople.length === 0 && groundNormalEvidence.allHaveNormals
          ? 'passed'
          : 'visual-failure',
      requestedMode,
      viewport: {
        size: [width, height],
        scene: viewport,
        persistentHudExclusions: hudExclusions,
        camera: {
          position: camera.position.toArray(),
          quaternionXyzw: camera.quaternion.toArray(),
          verticalFovDegrees: camera.fov,
          aspect: camera.aspect,
          near: camera.near,
          far: camera.far,
          forward: forward.toArray(),
          source:
            'BRIGHTVALE_RUNTIME_LAYOUT.camera; unchanged camera position/orientation for both viewport cases',
        },
      },
      sourceAssets: sourceMeshCounts,
      layout: {
        playfieldTiltDegrees: layout.playfield.tiltDegrees,
        framingPlacements: layout.framingInstances.length,
        crowdPlacements: layout.crowdPlacements.length,
        groundSurfaces: layout.groundSurfaces.length,
      },
      instanceCounts,
      groupBounds,
      groundNormalEvidence,
      assembledSceneTreeTriangles: sceneTriangles,
      actualRendererInfo: actualRenderer,
      audienceTwilightDifference: modePixelComparison,
      occlusionAwareCrowdEvidence: {
        method:
          'Per-placement instance-ID raster pass through all assembled opaque geometry with depth testing enabled; each actor ID is counted only where it wins depth.',
        fullyOccludedCount: fullyOccludedPeople.length,
        fullyOccludedIds: fullyOccludedPeople.map((person) => person.id),
        people: crowdVisibility,
      },
      evidence: {
        screenshot: `${requestedMode}-${narrow ? 'narrow' : 'reference'}.webp`,
        sameCameraPairedModes: true,
        noGameplayCutover: true,
      },
      limitations: [
        'Headless Chromium with SwiftShader; this is a geometry and visual composition proof, not a device-performance or hardware-budget claim.',
        'The narrow viewport is one sampled aspect/size, not a declared minimum supported viewport.',
        'Crowd ID raster identifies visible pixels and full occlusion, not a semantic quality score; partial visibility is allowed.',
        'Renderer triangles/calls are the actual submitted frame counters; assembled scene-tree triangle count is a separate geometry inventory.',
      ],
      durationMs: Number((performance.now() - started).toFixed(1)),
    };
    renderScene();
    reportNode.textContent = JSON.stringify(proof, null, 2);
    reportNode.dataset.state = proof.status;
    document.body.dataset.state = proof.status;
    captureNode.textContent = captureComposite(requestedMode);
  } finally {
    composition?.dispose();
    assets.dispose();
    maskMaterial.dispose();
    idMaterial.dispose();
    occluderMaterial.dispose();
    renderer.dispose();
  }
}

const idMaterial = new THREE.MeshBasicMaterial({
  toneMapped: false,
});
const occluderMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  toneMapped: false,
});

run().catch((error) => {
  reportNode.textContent = error?.stack || String(error);
  reportNode.dataset.state = 'failed';
  document.body.dataset.state = 'failed';
});
