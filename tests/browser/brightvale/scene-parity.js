import * as THREE from 'three';
import { MVP_CHART } from '../../../src/mvp-chart.ts';
import { createGame } from '../../../src/game.ts';
import { createGameUI } from '../../../src/ui.ts';
import { projectGameplayFrame } from '../../../src/gameplay-frame.ts';
import { projectSceneState } from '../../../src/scene-state.ts';
import { createBrightvaleScene } from '../../../src/scene.ts';
import { BRIGHTVALE_RUNTIME_LAYOUT } from '../../../src/brightvale/layout.ts';
import { loadBrightvaleRuntimeAssets } from '../../../src/brightvale/assets-runtime.ts';
import { createBrightvaleSurfaceProfile } from '../../../src/brightvale/projection.ts';
import { createBrightvalePlayfieldContract } from '../../../src/brightvale/playfield.ts';

const reportNode = document.querySelector('#proof-report');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const jsonMatrix = (matrix) =>
  matrix.elements.map((value) => Number(value.toFixed(8)));

const snapshotAt = (difficulty, time, chart = MVP_CHART) => {
  const game = createGame(chart, 0, difficulty);
  const state = game.advanceTo(time);
  return {
    audio: {
      status: 'playing',
      position: time,
      duration: chart.duration,
      scheduledWhen: 0,
      hasActiveSource: true,
      loaded: true,
      disposed: false,
      error: null,
    },
    game: state,
    inputOffset: 0,
    visualOffset: 0,
    selectedDifficulty: difficulty,
    feedback: null,
    pendingPlaybackRequests: false,
  };
};

const layoutForEasyGeometry = {
  ...MVP_CHART,
  allowedDifficulties: ['easy'],
  notes: [
    { id: 'easy-audience-geometry', time: 13.795828, lane: 2, type: 'tap' },
    { id: 'easy-twilight-geometry', time: 40.534079, lane: 0, type: 'tap' },
  ],
};
const ui = createGameUI(document.querySelector('#app'), MVP_CHART, {
  start() {},
  pause() {},
  resume() {},
  restart() {},
  selectDifficulty() {},
});
ui.setRendererStatus('rendered');

let renderer;
let worldScene;
let overlayScene;
let camera;
let renderCount = 0;
const rendererFactory = (parameters) => {
  renderer = new THREE.WebGLRenderer({
    ...parameters,
    preserveDrawingBuffer: true,
  });
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, nextCamera) => {
    if (nextCamera.isPerspectiveCamera) {
      worldScene = scene;
      camera = nextCamera;
      renderCount += 1;
    } else if (nextCamera.isOrthographicCamera) overlayScene = scene;
    return render(scene, nextCamera);
  };
  renderer.setPixelRatio(1);
  return renderer;
};

const assets = await loadBrightvaleRuntimeAssets(new AbortController().signal);
const surface = createBrightvaleSurfaceProfile(assets.roots);
const playfield = createBrightvalePlayfieldContract(surface);
const host = document.querySelector('.play-surface');
const scene = createBrightvaleScene(
  host,
  (error) => {
    window.__brightvaleSceneFailure = String(error?.stack || error);
  },
  rendererFactory,
);
assert(scene, 'production scene facade initialized');

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));
const runSnapshot = async (difficulty, time, chart = MVP_CHART) => {
  const snapshot = snapshotAt(difficulty, time, chart);
  ui.render(snapshot, time);
  await nextFrame();
  return {
    snapshot,
    city: projectSceneState(snapshot, chart, true),
    gameplay: projectGameplayFrame(
      snapshot,
      chart,
      ui.getGameplayLayout(),
      true,
      time,
    ),
  };
};

const drive = async (difficulty, time, chart = MVP_CHART) => {
  const frame = await runSnapshot(difficulty, time, chart);
  let status = 'loading';
  const started = performance.now();
  while (status === 'loading' && performance.now() - started < 45000) {
    status = scene.updateFrame({ city: frame.city, gameplay: frame.gameplay });
    if (status !== 'loading') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(status !== 'unavailable', `scene available at ${difficulty}/${time}`);
  assert(
    worldScene && camera,
    `production scene rendered at ${difficulty}/${time}`,
  );
  return { ...frame, status };
};

const canvasForPixels = () => renderer.domElement;
const pixelOffset = (x, y, width, height) => ((height - 1 - y) * width + x) * 4;
const paletteColor = (index, count) =>
  new THREE.Color().setHSL(index / count, 0.88, 0.56);

function measureCrowdIds(layout) {
  const crowd = worldScene.getObjectByName('Brightvale.Crowd');
  assert(crowd, 'actual production scene contains assembled crowd');
  worldScene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const placements = layout.crowdPlacements.map((placement) => ({
    placement,
    origin: new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray([...placement.matrixColumnMajor]),
    ),
    pixels: 0,
    assigned: 0,
    color: null,
  }));
  const batches = [];
  crowd.traverse((object) => {
    if (object.isInstancedMesh) batches.push(object);
  });
  const savedBatchMaterials = [];
  const savedInstanceColors = [];
  const assignedDistances = placements.map(() => []);
  const idMaterial = new THREE.MeshBasicMaterial({
    // Exclude source GLB vertex tint from the identity channel; the per-instance
    // color alone is the stable placement ID in this diagnostic pass.
    vertexColors: false,
    toneMapped: false,
  });
  const occluderMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    toneMapped: false,
  });
  const otherMaterials = [];
  const color = new THREE.Color();
  for (const batch of batches) {
    savedBatchMaterials.push([batch, batch.material]);
    savedInstanceColors.push([batch, batch.instanceColor]);
    batch.material = idMaterial;
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();
    for (let index = 0; index < batch.count; index += 1) {
      batch.getMatrixAt(index, matrix);
      matrix.premultiply(batch.matrixWorld);
      point.setFromMatrixPosition(matrix);
      const ranked = placements
        .map(({ origin }, placementIndex) => ({
          placementIndex,
          distance: point.distanceTo(origin),
        }))
        .sort((a, b) => a.distance - b.distance);
      const nearest = ranked[0];
      assert(nearest, 'instance maps to a crowd placement');
      const entry = placements[nearest.placementIndex];
      assert(entry, 'crowd placement identity exists');
      entry.color ??= paletteColor(
        nearest.placementIndex + 1,
        placements.length + 1,
      );
      entry.assigned += 1;
      assignedDistances[nearest.placementIndex].push(nearest.distance);
      batch.setColorAt(index, entry.color);
    }
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
  }
  worldScene.traverse((object) => {
    if (!object.isMesh || batches.includes(object)) return;
    otherMaterials.push([object, object.material]);
    object.material = occluderMaterial;
  });
  const rendererState = {
    autoClear: renderer.autoClear,
    toneMapping: renderer.toneMapping,
    outputColorSpace: renderer.outputColorSpace,
    clearColor: renderer.getClearColor(new THREE.Color()).clone(),
    clearAlpha: renderer.getClearAlpha(),
  };
  const width = canvasForPixels().width;
  const height = canvasForPixels().height;
  renderer.autoClear = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissorTest(false);
  renderer.clear(true, true, true);
  renderer.render(worldScene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer
    .getContext()
    .readPixels(
      0,
      0,
      width,
      height,
      renderer.getContext().RGBA,
      renderer.getContext().UNSIGNED_BYTE,
      pixels,
    );
  const encoded = placements.map(({ color: value }) => {
    const srgb = value?.clone().convertLinearToSRGB();
    return srgb ? [srgb.r * 255, srgb.g * 255, srgb.b * 255] : [0, 0, 0];
  });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixelOffset(x, y, width, height);
      const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
      let closest = -1;
      let distance = Infinity;
      encoded.forEach((target, index) => {
        const nextDistance = Math.hypot(
          rgb[0] - target[0],
          rgb[1] - target[1],
          rgb[2] - target[2],
        );
        if (nextDistance < distance) {
          closest = index;
          distance = nextDistance;
        }
      });
      if (closest >= 0 && distance <= 18) placements[closest].pixels += 1;
    }
  }
  for (const [batch, material] of savedBatchMaterials)
    batch.material = material;
  for (const [batch, instanceColor] of savedInstanceColors)
    batch.instanceColor = instanceColor;
  for (const [mesh, material] of otherMaterials) mesh.material = material;
  renderer.autoClear = rendererState.autoClear;
  renderer.toneMapping = rendererState.toneMapping;
  renderer.outputColorSpace = rendererState.outputColorSpace;
  renderer.setClearColor(rendererState.clearColor, rendererState.clearAlpha);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissorTest(false);
  idMaterial.dispose();
  occluderMaterial.dispose();

  return {
    count: placements.length,
    batchCount: batches.length,
    fullyOccluded: placements
      .filter(({ pixels }) => pixels === 0)
      .map(({ placement }) => placement.id),
    placements: placements.map(({ placement, pixels, assigned }, index) => ({
      id: placement.id,
      visiblePixels: pixels,
      assignedInstances: assigned,
      maxInstanceOriginError: Math.max(0, ...assignedDistances[index]),
    })),
  };
}

function inspectSubmittedNotes(frame) {
  worldScene.updateMatrixWorld(true);
  const bars = [];
  const envelopes = [];
  worldScene.traverse((object) => {
    if (object.userData.gameplayRole === 'note-bar' && object.visible)
      bars.push(object);
    if (
      object.userData.gameplayRole === 'note-good-envelope' ||
      object.userData.gameplayRole === 'note-perfect-envelope'
    )
      envelopes.push(object);
  });
  const expected = frame.gameplay.notes;
  assert(
    bars.length === expected.length,
    `note bar count ${bars.length} matches projected notes ${expected.length}`,
  );
  const inverse = new THREE.Matrix4()
    .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.playfield.matrixColumnMajor])
    .invert();
  const barRecords = bars.map((bar) => {
    const center = new THREE.Vector3().setFromMatrixPosition(bar.matrixWorld);
    const localCenter = center.clone().applyMatrix4(inverse);
    const note = expected.reduce((best, candidate) => {
      const target = playfield.visualPoint(candidate.lane, candidate.progress);
      const error = target.distanceTo(center);
      return !best || error < best.error ? { candidate, error } : best;
    }, null);
    assert(
      note && note.error < 1e-3,
      `submitted bar aligns with canonical visual point (${note?.error})`,
    );
    const vertices = bar.geometry.getAttribute('position');
    const gaps = [];
    for (let index = 0; index < vertices.count; index += 1) {
      const worldVertex = new THREE.Vector3(
        vertices.getX(index),
        vertices.getY(index),
        vertices.getZ(index),
      ).applyMatrix4(bar.matrixWorld);
      const localVertex = worldVertex.clone().applyMatrix4(inverse);
      const surfaceHeight = surface.surfaceHeightAt(
        note.candidate.lane,
        localVertex.z,
        localVertex.x,
      );
      if (surfaceHeight !== null) gaps.push(localVertex.y - surfaceHeight);
    }
    return {
      lane: note.candidate.lane,
      progress: note.candidate.progress,
      centerErrorWorld: note.error,
      localCenter: localCenter.toArray(),
      surfaceCornerSamples: gaps.length,
      minSurfaceGap: gaps.length ? Math.min(...gaps) : null,
    };
  });
  let envelopeVertices = 0;
  let envelopeSurfaceSamples = 0;
  let minEnvelopeGap = Infinity;
  for (const envelope of envelopes) {
    const attr = envelope.geometry.getAttribute('position');
    if (!envelope.visible) continue;
    for (let index = 0; index < attr.count; index += 1) {
      const local = new THREE.Vector3(
        attr.getX(index),
        attr.getY(index),
        attr.getZ(index),
      ).applyMatrix4(inverse);
      const lane = expected[Math.floor(envelopes.indexOf(envelope) / 2)]?.lane;
      if (lane === undefined) continue;
      envelopeVertices += 1;
      const height = surface.surfaceHeightAt(lane, local.z, local.x);
      if (height === null) continue;
      envelopeSurfaceSamples += 1;
      minEnvelopeGap = Math.min(minEnvelopeGap, local.y - height);
    }
  }
  return {
    projectedNotes: expected.map(({ id, lane, progress }) => ({
      id,
      lane,
      progress,
    })),
    submittedBars: barRecords,
    noteBarCount: bars.length,
    envelopeMeshCount: envelopes.filter((mesh) => mesh.visible).length,
    envelopeVertices,
    envelopeSurfaceSamples,
    minimumEnvelopeSurfaceGap: Number.isFinite(minEnvelopeGap)
      ? minEnvelopeGap
      : null,
  };
}

function inspectEssentialAssetProjection(layout) {
  worldScene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const viewport = { width: layout.width, height: layout.height };
  const projectedAssets = {};
  for (const name of ['platform', 'endcaps', 'highway']) {
    const root = worldScene.getObjectByName(`Brightvale.Asset.${name}`);
    assert(root, `production scene contains ${name} asset wrapper`);
    root.updateMatrixWorld(true);
    let vertices = 0;
    let outside = 0;
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    root.traverse((object) => {
      if (!object.isMesh) return;
      const positions = object.geometry.getAttribute('position');
      if (!positions) return;
      for (let index = 0; index < positions.count; index += 1) {
        const projected = new THREE.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        )
          .applyMatrix4(object.matrixWorld)
          .project(camera);
        const x = ((projected.x + 1) * viewport.width) / 2;
        const y = ((1 - projected.y) * viewport.height) / 2;
        vertices += 1;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > viewport.width ||
          y < 0 ||
          y > viewport.height ||
          projected.z < -1 ||
          projected.z > 1
        )
          outside += 1;
      }
    });
    projectedAssets[name] = { vertices, outside, bounds };
  }
  const canvasRect = renderer.domElement.getBoundingClientRect();
  const approachStart = playfield.point(1, -0.11).project(camera);
  const approachHit = playfield.point(1, 1).project(camera);
  const approachTravelCss = Math.abs(
    ((1 - approachHit.y) * viewport.height) / 2 -
      ((1 - approachStart.y) * viewport.height) / 2,
  );
  return {
    rendererStatus: document.querySelector('[data-renderer-status]')?.hidden
      ? 'rendered'
      : 'not-rendered',
    browser: {
      innerWidth,
      innerHeight,
      devicePixelRatio,
      visualViewport: visualViewport
        ? {
            width: visualViewport.width,
            height: visualViewport.height,
            scale: visualViewport.scale,
          }
        : null,
      document: {
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
    },
    viewport,
    hud: {
      persistent: layout.persistentHudExclusions,
      labels: layout.labels,
    },
    canvas: {
      x: canvasRect.x,
      y: canvasRect.y,
      width: canvasRect.width,
      height: canvasRect.height,
      bufferWidth: renderer.domElement.width,
      bufferHeight: renderer.domElement.height,
    },
    camera: {
      position: camera.position.toArray(),
      aspect: camera.aspect,
      fov: camera.fov,
    },
    approach: {
      normalStartProgress: -0.11,
      hitProgress: 1,
      travelCssPixels: approachTravelCss,
      projectedPlatformDepthCssPixels:
        projectedAssets.platform.bounds.maxY -
        projectedAssets.platform.bounds.minY,
    },
    assets: projectedAssets,
  };
}

function matrixDelta(first, second) {
  return Math.max(
    ...first.map((value, index) => Math.abs(value - second[index])),
  );
}

function inspectOverlayTextures() {
  const names = [
    'time',
    'countdown',
    'legend',
    'feedback',
    'lane-0',
    'lane-1',
    'lane-2',
    'lane-3',
    'hit',
  ];
  return names.map((name) => {
    const mesh = overlayScene?.getObjectByName(`Brightvale.Label.${name}`);
    const material = mesh?.material;
    const image =
      material instanceof THREE.Material && 'map' in material
        ? material.map?.image
        : null;
    const context =
      image instanceof HTMLCanvasElement ? image.getContext('2d') : null;
    const pixels =
      context && image
        ? context.getImageData(0, 0, image.width, image.height).data
        : null;
    let alphaPixels = 0;
    if (pixels)
      for (let index = 3; index < pixels.length; index += 4)
        if (pixels[index] > 0) alphaPixels += 1;
    return {
      name,
      meshVisible: mesh?.visible ?? false,
      alphaPixels,
      textureSize:
        image instanceof HTMLCanvasElement ? [image.width, image.height] : null,
      side: material instanceof THREE.Material ? material.side : null,
      rotationX: mesh?.rotation.x ?? null,
      screenCenter: mesh ? { x: mesh.position.x, y: mesh.position.y } : null,
      screenSize: mesh ? { width: mesh.scale.x, height: mesh.scale.y } : null,
    };
  });
}

const waitLayout = async (requestedWidth, requestedHeight) => {
  const started = performance.now();
  const expectedMaxWidth = Math.min(requestedWidth, requestedHeight * (16 / 9));
  while (performance.now() - started < 20000) {
    const layout = ui.getGameplayLayout();
    if (
      window.innerWidth === requestedWidth &&
      window.innerHeight === requestedHeight &&
      layout.width >= expectedMaxWidth * 0.8 &&
      layout.width <= expectedMaxWidth &&
      layout.height >= requestedHeight * 0.8 &&
      layout.height <= requestedHeight
    )
      return layout;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('UI did not measure a positive content layout');
};

async function runViewport(requestedWidth, requestedHeight) {
  const layout = await waitLayout(requestedWidth, requestedHeight);
  const normal = await drive('normal', 10.2);
  const essentialProjection = inspectEssentialAssetProjection(layout);
  const firstFrameOverlayPixels = {
    viewport: [requestedWidth, requestedHeight],
    labels: inspectOverlayTextures(),
    webpDataUrl: renderer.domElement.toDataURL('image/webp', 0.95),
  };
  const matrixAtAudience = jsonMatrix(camera.matrixWorld);
  const projectionAtAudience = jsonMatrix(camera.projectionMatrix);
  const normalNotesA = inspectSubmittedNotes(normal);
  const normalLater = await drive('normal', 18.6);
  const matrixAtDifferentNotes = jsonMatrix(camera.matrixWorld);
  const normalNotesB = inspectSubmittedNotes(normalLater);
  const twilight = await drive('normal', 42);
  const matrixAtTwilight = jsonMatrix(camera.matrixWorld);
  const twilightNotes = inspectSubmittedNotes(twilight);
  const crowd = measureCrowdIds(BRIGHTVALE_RUNTIME_LAYOUT);
  const labels = [0, 1, 2, 3].map((lane) => {
    const target = playfield.hitAnchor(lane).project(camera);
    const mesh = overlayScene?.getObjectByName(`Brightvale.Label.lane-${lane}`);
    const projected = {
      x: ((target.x + 1) * layout.width) / 2,
      y: ((1 - target.y) * layout.height) / 2,
    };
    return {
      lane,
      projectedHitAnchor: projected,
      renderedLabelCenter: mesh
        ? { x: mesh.position.x, y: mesh.position.y }
        : null,
      labelOffsetError: mesh
        ? Math.max(
            Math.abs(mesh.position.x - projected.x),
            Math.abs(mesh.position.y - (projected.y + 16)),
          )
        : null,
      labelVisible: mesh?.visible ?? false,
    };
  });
  const hard = await drive('hard', 18.6);
  const hardCamera = {
    matrixWorld: jsonMatrix(camera.matrixWorld),
    fov: camera.fov,
    aspect: camera.aspect,
  };
  const hardGeometry = inspectSubmittedNotes(hard);
  const easyTime = 13.795828 - 0.5;
  const easy = await drive('easy', easyTime, layoutForEasyGeometry);
  const easyGeometry = inspectSubmittedNotes(easy);
  assert(
    hardGeometry.noteBarCount > 0 && hardGeometry.envelopeSurfaceSamples > 0,
    'Hard geometry fixture submits note bars and timing-envelope vertices',
  );
  assert(
    easyGeometry.noteBarCount > 0 && easyGeometry.envelopeSurfaceSamples > 0,
    'Easy geometry-only fixture submits note bars and timing-envelope vertices',
  );
  return {
    viewport: {
      cssContentWidth: layout.width,
      cssContentHeight: layout.height,
      requestedViewport: [window.innerWidth, window.innerHeight],
    },
    measuredHudExclusions: layout.persistentHudExclusions,
    measuredLabelSlots: layout.labels,
    difficulty: 'normal',
    notesAtFrames: [normalNotesA, normalNotesB, twilightNotes],
    camera: {
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      audienceMatrixWorld: matrixAtAudience,
      audienceProjectionMatrix: projectionAtAudience,
      notePopulationMaxMatrixDelta: matrixDelta(
        matrixAtAudience,
        matrixAtDifferentNotes,
      ),
      modeChangeMatrixDelta: matrixDelta(matrixAtAudience, matrixAtTwilight),
    },
    projectedHitAnchors: labels,
    essentialProjection,
    crowdIdPass: crowd,
    hardGeometryOnly: {
      difficulty:
        'Hard is chart-allowed but this parity fixture is not audio gameplay',
      camera: hardCamera,
      geometry: hardGeometry,
    },
    easyGeometryOnly: {
      difficulty:
        'Easy is not allowed for MVP_CHART; fixture chart widened only for geometry projection',
      time: easyTime,
      geometry: easyGeometry,
    },
    actualSceneFrameRenderCount: renderCount,
    firstFrameOverlayPixels,
  };
}

window.__brightvaleParityReady = true;
window.__brightvaleRunViewport = async (requestedWidth, requestedHeight) => {
  try {
    const result = await runViewport(requestedWidth, requestedHeight);
    window.__brightvaleParityViewports ??= [];
    window.__brightvaleParityViewports.push(result);
    reportNode.textContent = JSON.stringify(
      window.__brightvaleParityViewports,
      null,
      2,
    );
    return result;
  } catch (error) {
    reportNode.textContent = error?.stack || String(error);
    window.__brightvaleParityError = String(error?.stack || error);
    throw error;
  }
};
window.__brightvaleInspectViewport = async (
  requestedWidth,
  requestedHeight,
) => {
  try {
    const layout = await waitLayout(requestedWidth, requestedHeight);
    await drive('normal', 10.2);
    return inspectEssentialAssetProjection(layout);
  } catch (error) {
    window.__brightvaleParityError = String(error?.stack || error);
    throw error;
  }
};
window.__brightvaleParityDispose = () => {
  scene.destroy();
  ui.destroy();
  assets.dispose();
};
