import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIGHTVALE_ASSET_NAMES, type BrightvaleAssets } from './assets';
import {
  createBrightvaleComposition,
  type BrightvaleComposition,
} from './composition';
import { projectBrightvaleAmbience } from './ambience';
import type {
  BrightvaleRuntimeLayout,
  BrightvaleSilhouetteCrowdPlacement,
} from './layout';
import type { SceneStateProjection } from '../scene-state';

// Composition-boundary tests: no new production-module import, production GLB,
// atlas JSON, population tuning, DOM, decoder or WebGL setup is needed for RED.
// Proposed data seam: assets.silhouetteCrowd supplies an already-loaded atlas;
// layout.silhouetteCrowdPlacements supplies explicit bounded pilot placements.
// The crowd module can own its batches/update/dispose behind this existing seam.
const state: SceneStateProjection = {
  phase: 'audience',
  victory: false,
  cityIntensity: 0.4,
  cityBrightness: 0.6,
  transitionProgress: 0,
  radiantProgress: 0,
  motion: {
    powerLinePulse: false,
    buildingPulse: false,
    windTravel: false,
    cameraPush: 0,
  },
  playerDefiant: true,
  twilightConsumed: false,
};

function atlasMetadata(
  verticalStick = false,
  width = 64,
  height = 32,
  offset = 0,
) {
  const twilightAtlas = width !== 64;
  // Fixture-owned atlas dimensions and offsets expose accidental assumptions
  // about shared UV coordinates or production atlas sizing.
  return {
    schema: 'brightvale-silhouette-crowd-v1',
    atlas: { width, height, gutter_px: 2 },
    coordinates: { source_pixels_per_unit: 10 },
    parts: [
      {
        id: 'A.body',
        source_rect_px: [0, 0, 8, 12],
        tile_rect_px: [2, 2, 8, 12],
        padded_rect_px: [0, 0, 12, 16],
        origin_px: [4, 12],
        shoulder_px: [7, 6],
        uv_rect_bottom_left: [
          (2 + offset) / width,
          (height - 14) / height,
          8 / width,
          12 / height,
        ],
        card_bounds_local: twilightAtlas
          ? [-0.15, -0.1, 0.5, 1.1]
          : [-0.4, 0, 0.4, 1.2],
        source_pixels_per_atlas_pixel: 1,
      },
      {
        id: 'A.arm',
        source_rect_px: [12, 0, 6, 10],
        tile_rect_px: [18, 2, 6, 10],
        padded_rect_px: [16, 0, 10, 14],
        origin_px: [2, 8],
        shoulder_px: [2, 8],
        grip_px: [3, 1],
        uv_rect_bottom_left: [
          (18 + offset) / width,
          (height - 12) / height,
          6 / width,
          10 / height,
        ],
        card_bounds_local: twilightAtlas
          ? [-0.35, -0.1, 0.3, 0.9]
          : [-0.2, -0.2, 0.4, 0.8],
        source_pixels_per_atlas_pixel: 1,
      },
    ],
    figures: [
      {
        id: 'A',
        body_part: 'A.body',
        arm_part: 'A.arm',
        shoulder_body_local: [0.3, 0.6],
        grip_arm_local: [0.1, 0.7],
        stick_top_arm_local: verticalStick
          ? ([0.1, 0.95] as const)
          : ([0.15, 0.95] as const),
        stick_bottom_arm_local: verticalStick
          ? ([0.1, 0.45] as const)
          : ([0.05, 0.45] as const),
        inspection_body_height_px: 12,
        inspection_color: '#66ddff',
      },
    ],
  } as const;
}

function transform(x: number, z: number, yaw = 0, scale = 1): number[] {
  return new THREE.Matrix4()
    .compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(scale, scale, scale),
    )
    .toArray();
}

// Cleanup needs only this nonrecursive ownership contract. Inferring the whole
// factory return type here would feed fixtures.push(result) back into itself.
const fixtures: {
  assets: BrightvaleAssets;
  composition: BrightvaleComposition;
}[] = [];

// Use the public optional-field contract while retaining test-owned phase edits
// for the neutral-pose check below.
type FixturePlacement = {
  -readonly [
    Key in keyof BrightvaleSilhouetteCrowdPlacement
  ]: BrightvaleSilhouetteCrowdPlacement[Key];
};

function fixture(verticalStick = false, waveAmplitude?: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x28344a });
  const texture = new THREE.DataTexture(
    new Uint8Array(64 * 32 * 4).fill(255),
    64,
    32,
  );
  const twilightTexture = new THREE.DataTexture(
    new Uint8Array(80 * 40 * 4).fill(180),
    80,
    40,
  );
  const roots = Object.fromEntries(
    BRIGHTVALE_ASSET_NAMES.map((name) => {
      const root = new THREE.Group();
      const mesh = new THREE.Mesh(geometry, material);
      root.add(mesh);
      return [name, root];
    }),
  ) as BrightvaleAssets['roots'];
  const silhouetteCrowd = { texture, metadata: atlasMetadata(verticalStick) };
  const silhouetteCrowdTwilight = {
    texture: twilightTexture,
    metadata: atlasMetadata(verticalStick, 80, 40, 30),
  };
  const assets: BrightvaleAssets & {
    silhouetteCrowd: typeof silhouetteCrowd;
    silhouetteCrowdTwilight: typeof silhouetteCrowdTwilight;
  } = {
    roots,
    silhouetteCrowd,
    // Proposed runtime seam: keep both phase atlases loaded as one owned bundle;
    // the composition selects the matching texture and geometry/UV metadata.
    silhouetteCrowdTwilight,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      twilightTexture.dispose();
    },
  };
  const placements: FixturePlacement[] = [
    {
      id: 'lit-left',
      figure: 'A',
      matrixColumnMajor: transform(-8, -2, 0.3, 1.5),
      motionPhase: 0.2,
      motionRate: 0.8,
      stickColor: 0x66ddff,
      ...(waveAmplitude === undefined ? {} : { waveAmplitude }),
    },
    {
      id: 'unlit-right',
      figure: 'A',
      matrixColumnMajor: transform(9, -5, -0.4, 0.8),
      motionPhase: 1.6,
      motionRate: 1.1,
    },
    {
      id: 'lit-far',
      figure: 'A',
      matrixColumnMajor: transform(-11, -8, 0.1, 1.2),
      motionPhase: 2.7,
      motionRate: 0.7,
      stickColor: 0xff66bb,
    },
  ];
  // Legacy entries deliberately remain valid, so today's composition assembles
  // successfully and fails on absent motion/atlas behavior, not a fixture error.
  const layout: BrightvaleRuntimeLayout & {
    silhouetteCrowdPlacements: typeof placements;
  } = {
    schemaVersion: 'brightvale-runtime-layout-v1',
    coordinateSystem: 'gltf-y-up',
    units: 'provisional-authoring-units',
    playfield: { matrixColumnMajor: transform(0, 0), tiltDegrees: 0 },
    city: { matrixColumnMajor: transform(2, -15) },
    framingInstances: [
      {
        name: 'fixture-framing',
        module: 'long',
        matrixColumnMajor: transform(4, -9),
      },
    ],
    groundSurfaces: [
      {
        name: 'Review.Ground',
        matrixColumnMajor: transform(0, 0),
        positionsLocalGltf: [
          [-30, 0, -30],
          [30, 0, -30],
          [0, 0, 30],
        ],
        triangleIndices: [[0, 2, 1]],
        material: {
          name: 'fixture ground',
          baseColorLinear: [0.2, 0.3, 0.4],
          metallic: 0,
          roughness: 1,
          doubleSided: false,
        },
      },
    ],
    camera: {
      verticalFovDegrees: 45,
      aspect: 1,
      near: 0.1,
      far: 100,
      positionGltf: [0, 4, 12],
      quaternionXyzw: [0, 0, 0, 1],
      referenceResolution: [600, 600],
    },
    silhouetteCrowdPlacements: placements,
  };
  const scene = new THREE.Scene();
  const composition = createBrightvaleComposition(assets, layout, scene);
  const result = {
    assets,
    geometry,
    material,
    texture,
    twilightTexture,
    placements,
    scene,
    composition,
  };
  fixtures.push(result);
  return result;
}

function batches(root: THREE.Object3D): THREE.InstancedMesh[] {
  const result: THREE.InstancedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) result.push(object);
  });
  return result;
}

function crowd(f: ReturnType<typeof fixture>): THREE.Object3D {
  const result = f.composition.root.getObjectByName('Brightvale.Crowd');
  expect(result, 'composition must expose its crowd subtree').toBeDefined();
  return result!;
}

function batch(
  f: ReturnType<typeof fixture>,
  name: string,
): THREE.InstancedMesh {
  const result = crowd(f).getObjectByName(`Brightvale.Crowd.${name}`);
  expect(result, `pilot must expose rendered ${name} instances`).toBeInstanceOf(
    THREE.InstancedMesh,
  );
  return result as THREE.InstancedMesh;
}

function worldMatrix(mesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const instance = new THREE.Matrix4();
  mesh.getMatrixAt(index, instance);
  return mesh.matrixWorld.clone().multiply(instance);
}

function snapshot(root: THREE.Object3D): number[][][] {
  root.updateWorldMatrix(true, true);
  return batches(root).map((mesh) =>
    Array.from({ length: mesh.count }, (_, index) => {
      const instance = new THREE.Matrix4();
      mesh.getMatrixAt(index, instance);
      return mesh.matrixWorld.clone().multiply(instance).toArray();
    }),
  );
}

function update(
  f: ReturnType<typeof fixture>,
  time: number,
  reducedMotion = false,
  overrides: Partial<SceneStateProjection> = {},
): void {
  const phaseState = { ...state, ...overrides };
  f.composition.updateAppearance(
    phaseState,
    projectBrightvaleAmbience(phaseState, time, reducedMotion),
  );
  f.composition.root.updateWorldMatrix(true, true);
}

function expectXY(actual: THREE.Vector3, expected: readonly number[]): void {
  expect(actual.x).toBeCloseTo(expected[0]!, 5);
  expect(actual.y).toBeCloseTo(expected[1]!, 5);
}

/** Endpoint center from UVs, independent of quad width or vertex winding. */
function shaftPoint(
  mesh: THREE.InstancedMesh,
  index: number,
  end: 0 | 1,
  relativeTo: THREE.Matrix4,
): THREE.Vector3 {
  const positions = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const point = new THREE.Vector3();
  let count = 0;
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    if (uv.getY(vertex) !== end) continue;
    point.add(new THREE.Vector3().fromBufferAttribute(positions, vertex));
    count += 1;
  }
  expect(
    count,
    'shaft UV endpoints must expose measurable geometry',
  ).toBeGreaterThan(0);
  return point
    .divideScalar(count)
    .applyMatrix4(worldMatrix(mesh, index))
    .applyMatrix4(relativeTo.clone().invert());
}

afterEach(() => {
  const completed = fixtures.splice(0);
  for (const f of completed) f.composition.dispose();
  vi.restoreAllMocks();
  // Source assets belong to the fixture/bundle, never the composition.
  for (const f of completed) f.assets.dispose();
});

describe('silhouette pilot through the existing composition update boundary', () => {
  it('blends registered atlas UVs through Twilight and Radiant without rebuilding material or batches', () => {
    const f = fixture();
    update(f, 1.25, false, { phase: 'audience' });
    const originalBatches = batches(crowd(f));
    const body = batch(f, 'Body.A');
    const arm = batch(f, 'Arm.A');
    const bodyGeometry = body.geometry;
    const armGeometry = arm.geometry;
    const cardMaterial = body.material as THREE.MeshBasicMaterial;
    const shaderUniforms = cardMaterial.userData.silhouetteCrowdUniforms as
      | {
          twilightMap: { value: THREE.Texture };
          blend: { value: number };
        }
      | undefined;

    expect(shaderUniforms).toBeDefined();
    if (!shaderUniforms) throw new Error('Crowd blend shader uniforms missing');
    expect(cardMaterial.map).toBe(f.texture);
    expect(shaderUniforms.twilightMap.value).toBe(f.twilightTexture);
    const audienceBodyUv = bodyGeometry.getAttribute('uv').array.slice();
    const audienceArmUv = armGeometry.getAttribute('uv').array.slice();
    const twilightBodyUv = bodyGeometry
      .getAttribute('crowdTwilightUv')
      .array.slice();
    const twilightArmUv = armGeometry
      .getAttribute('crowdTwilightUv')
      .array.slice();
    expect(twilightBodyUv).not.toEqual(audienceBodyUv);
    expect(twilightArmUv).not.toEqual(audienceArmUv);
    expect(
      f.assets.silhouetteCrowdTwilight.metadata.parts.map(
        (part) => part.card_bounds_local,
      ),
    ).not.toEqual(
      f.assets.silhouetteCrowd.metadata.parts.map(
        (part) => part.card_bounds_local,
      ),
    );
    const armTwilightPart = f.assets.silhouetteCrowdTwilight.metadata.parts[1];
    const [armTwilightU, , armTwilightWidth] =
      armTwilightPart.uv_rect_bottom_left;
    const originalArmPart = f.assets.silhouetteCrowd.metadata.parts[1];
    const unionArmRight = Math.max(
      originalArmPart.card_bounds_local[2]!,
      armTwilightPart.card_bounds_local[2]!,
    );
    const unionRightArmUv = arm.geometry
      .getAttribute('crowdTwilightUv')
      .getX(1);
    expect(
      unionRightArmUv,
      'sinister UV stays affine past its narrower local bound; fragment mask handles outside pixels',
    ).toBeCloseTo(
      armTwilightU +
        ((unionArmRight - armTwilightPart.card_bounds_local[0]!) /
          (armTwilightPart.card_bounds_local[2]! -
            armTwilightPart.card_bounds_local[0]!)) *
          armTwilightWidth,
      6,
    );
    expect(unionRightArmUv).toBeGreaterThan(armTwilightU + armTwilightWidth);
    expect(shaderUniforms.blend.value).toBe(0);
    const materialVersion = cardMaterial.version;

    expect(f.assets.silhouetteCrowd.metadata.atlas).toEqual({
      width: 64,
      height: 32,
      gutter_px: 2,
    });

    update(f, 1.25, false, {
      phase: 'twilight',
      transitionProgress: 0.4,
    });
    expect(batches(crowd(f))).toEqual(originalBatches);
    expect(shaderUniforms.blend.value).toBe(0.4);
    update(f, 2.5, false, {
      phase: 'twilight',
      transitionProgress: 0.8,
    });
    expect(shaderUniforms.blend.value).toBe(0.8);
    expect(cardMaterial.version).toBe(materialVersion);
    expect(body.geometry).toBe(bodyGeometry);
    expect(arm.geometry).toBe(armGeometry);
    expect(f.assets.silhouetteCrowdTwilight.metadata.atlas).toEqual({
      width: 80,
      height: 40,
      gutter_px: 2,
    });
    expect(batches(crowd(f))).toHaveLength(originalBatches.length);

    // Radiant is a victory blend, not a GamePhase. During its exit, the game
    // phase remains Twilight while radiantProgress advances from 0 to 1.
    update(f, 2.75, false, {
      phase: 'twilight',
      victory: true,
      radiantProgress: 0.25,
    });
    expect(shaderUniforms.blend.value).toBe(0.75);
    update(f, 3, false, {
      phase: 'twilight',
      victory: true,
      radiantProgress: 0.5,
    });
    expect(shaderUniforms.blend.value).toBe(0.5);
    update(f, 3.25, false, {
      phase: 'twilight',
      victory: true,
      radiantProgress: 1,
    });
    expect(shaderUniforms.blend.value).toBe(0);
    expect(cardMaterial.map).toBe(f.texture);
    expect(body.geometry.getAttribute('uv').array).toEqual(audienceBodyUv);
    expect(arm.geometry.getAttribute('uv').array).toEqual(audienceArmUv);
    expect(body.geometry.getAttribute('crowdTwilightUv').array).toEqual(
      twilightBodyUv,
    );
    expect(arm.geometry.getAttribute('crowdTwilightUv').array).toEqual(
      twilightArmUv,
    );
    expect(cardMaterial.version).toBe(materialVersion);
    expect(batches(crowd(f))).toEqual(originalBatches);

    update(f, 1.25, false, { phase: 'audience' });
    expect(batches(crowd(f))).toEqual(originalBatches);
    expect(cardMaterial.map).toBe(f.texture);
    expect(body.geometry.getAttribute('uv').array).toEqual(audienceBodyUv);
    expect(arm.geometry.getAttribute('uv').array).toEqual(audienceArmUv);
  });

  it('moves existing crowd instances from absolute transport time, replays/seeks deterministically and freezes with reduced motion', () => {
    const f = fixture();
    const root = f.composition.root;
    const stableRoots = [
      'Brightvale.City',
      'Brightvale.Playfield',
      'Brightvale.Framing',
    ].map((name) => root.getObjectByName(name)!);
    const identities = batches(crowd(f));
    update(f, 0);
    const nonCrowd = stableRoots.map(snapshot);
    const initial = snapshot(crowd(f));
    update(f, 1.25);
    const moved = snapshot(crowd(f));

    // Primary RED: current code assembles normally but leaves every crowd
    // instance static. It must fail HERE, not on a missing future import.
    expect(
      moved,
      'transport time must animate rendered crowd matrices',
    ).not.toEqual(initial);
    expect(moved.flat(2).every(Number.isFinite)).toBe(true);
    expect(batches(crowd(f))).toEqual(identities);
    expect(stableRoots.map(snapshot)).toEqual(nonCrowd);

    const body = batch(f, 'Body.A');
    const arm = batch(f, 'Arm.A');
    expect(body.count).toBe(f.placements.length);
    expect(arm.count, 'unlit people still need their matching arm').toBe(
      f.placements.length,
    );
    expect(batch(f, 'StickCore').count).toBe(
      f.placements.filter((p) => p.stickColor !== undefined).length,
    );
    expect(batch(f, 'StickHalo').count).toBe(batch(f, 'StickCore').count);
    for (const { card, originalPart, twilightPart } of [
      {
        card: body,
        originalPart: f.assets.silhouetteCrowd.metadata.parts[0],
        twilightPart: f.assets.silhouetteCrowdTwilight.metadata.parts[0],
      },
      {
        card: arm,
        originalPart: f.assets.silhouetteCrowd.metadata.parts[1],
        twilightPart: f.assets.silhouetteCrowdTwilight.metadata.parts[1],
      },
    ]) {
      expect(card.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect((card.material as THREE.MeshBasicMaterial).map).toBe(f.texture);
      expect(card.castShadow).toBe(false);
      expect(card.receiveShadow).toBe(false);
      const positions = card.geometry.getAttribute('position');
      const uv = card.geometry.getAttribute('uv');
      const twilightUv = card.geometry.getAttribute('crowdTwilightUv');
      const [originalLeft, originalBottom, originalRight, originalTop] =
        originalPart.card_bounds_local;
      const [twilightLeft, twilightBottom, twilightRight, twilightTop] =
        twilightPart.card_bounds_local;
      const left = Math.min(originalLeft, twilightLeft);
      const bottom = Math.min(originalBottom, twilightBottom);
      const right = Math.max(originalRight, twilightRight);
      const top = Math.max(originalTop, twilightTop);
      const [u, v, width, height] = originalPart.uv_rect_bottom_left;
      const [twilightU, twilightV, twilightWidth, twilightHeight] =
        twilightPart.uv_rect_bottom_left;
      expect(uv.count).toBe(positions.count);
      expect(twilightUv.count).toBe(positions.count);
      const xs = Array.from({ length: positions.count }, (_, vertex) =>
        positions.getX(vertex),
      );
      // Mirror around the actual off-center shoulder origin, not tile center.
      // The body remains unchanged; no reflected instance matrices are needed.
      expect(Math.min(...xs)).toBeCloseTo(card === arm ? -right : left, 6);
      expect(Math.max(...xs)).toBeCloseTo(card === arm ? -left : right, 6);
      const ys = Array.from({ length: positions.count }, (_, vertex) =>
        positions.getY(vertex),
      );
      expect(Math.min(...ys)).toBeCloseTo(bottom, 6);
      expect(Math.max(...ys)).toBeCloseTo(top, 6);
      // Match the fixture tile, with +V upward from its bottom edge. Checking
      // against positions rather than vertex order catches flipped V as well
      // as wrong rectangles without requiring a particular triangulation.
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const localX = (card === arm ? -1 : 1) * positions.getX(vertex);
        const localY = positions.getY(vertex);
        expect(uv.getX(vertex)).toBeCloseTo(
          u +
            ((localX - originalLeft) / (originalRight - originalLeft)) * width,
          6,
        );
        expect(uv.getY(vertex)).toBeCloseTo(
          v +
            ((localY - originalBottom) / (originalTop - originalBottom)) *
              height,
          6,
        );
        expect(twilightUv.getX(vertex)).toBeCloseTo(
          twilightU +
            ((localX - twilightLeft) / (twilightRight - twilightLeft)) *
              twilightWidth,
          6,
        );
        expect(twilightUv.getY(vertex)).toBeCloseTo(
          twilightV +
            ((localY - twilightBottom) / (twilightTop - twilightBottom)) *
              twilightHeight,
          6,
        );
      }
      // For the body's union-left corner, this is deliberately outside the
      // Twilight card: its affine UV must remain unclamped and be masked in
      // the fragment shader instead of stretching its UV rectangle.
      if (card === body) {
        expect(twilightUv.getX(0)).toBeLessThan(twilightU);
      }
    }

    update(f, 9.5);
    update(f, 0);
    expect(snapshot(crowd(f))).toEqual(initial);
    update(f, 1.25);
    expect(snapshot(crowd(f))).toEqual(moved);
    update(f, 8, true);
    expect(snapshot(crowd(f))).toEqual(initial);
    update(f, 93, true);
    expect(snapshot(crowd(f))).toEqual(initial);
    const fresh = fixture();
    update(fresh, 1.25);
    expect(
      snapshot(crowd(fresh)),
      'new scene generations must use the same seeded placement phases',
    ).toEqual(moved);
  });

  it('mirrors arms about their shoulders and keeps mirrored grips, shafts and halos attached throughout the wave', () => {
    const f = fixture();
    const body = batch(f, 'Body.A');
    const arm = batch(f, 'Arm.A');
    const core = batch(f, 'StickCore');
    const halo = batch(f, 'StickHalo');
    const figure = f.assets.silhouetteCrowd.metadata.figures[0];
    const armPoses: number[][] = [];
    for (const time of [0, 1.25, 7.5]) {
      update(f, time);
      let stickIndex = 0;
      f.placements.forEach((placement, index) => {
        const bodyMatrix = worldMatrix(body, index);
        const armMatrix = worldMatrix(arm, index);
        expect(bodyMatrix.determinant()).toBeGreaterThan(0);
        expect(armMatrix.determinant()).toBeGreaterThan(0);
        const shoulder = new THREE.Vector3()
          .applyMatrix4(armMatrix)
          .applyMatrix4(bodyMatrix.clone().invert());
        expectXY(shoulder, figure.shoulder_body_local);
        expect(
          shoulder.z,
          'arm card must sit in front of the overlapping body card',
        ).toBeGreaterThan(0);
        armPoses.push(
          bodyMatrix.clone().invert().multiply(armMatrix).toArray(),
        );
        if (placement.stickColor === undefined) return;
        for (const stick of [core, halo]) {
          const grip = new THREE.Vector3()
            .applyMatrix4(worldMatrix(stick, stickIndex))
            .applyMatrix4(armMatrix.clone().invert());
          expectXY(grip, [-figure.grip_arm_local[0], figure.grip_arm_local[1]]);
          expect(worldMatrix(stick, stickIndex).determinant()).toBeGreaterThan(
            0,
          );
          expect(
            grip.z,
            'original fist must occlude the shaft and halo',
          ).toBeLessThan(0);
        }
        const bottom = shaftPoint(core, stickIndex, 0, armMatrix);
        const top = shaftPoint(core, stickIndex, 1, armMatrix);
        expectXY(bottom, [
          -figure.stick_bottom_arm_local[0],
          figure.stick_bottom_arm_local[1],
        ]);
        expectXY(top, [
          -figure.stick_top_arm_local[0],
          figure.stick_top_arm_local[1],
        ]);
        const coreAxis = top.sub(bottom).normalize();
        const haloAxis = shaftPoint(halo, stickIndex, 1, armMatrix)
          .sub(shaftPoint(halo, stickIndex, 0, armMatrix))
          .normalize();
        expect(haloAxis.distanceTo(coreAxis)).toBeLessThan(1e-5);
        stickIndex += 1;
      });
    }
    // A static hierarchy could satisfy contact alone; require actual relative
    // arm motion, not merely whole-person translation masquerading as a wave.
    expect(armPoses[0]).not.toEqual(armPoses[f.placements.length]);
    expect(
      armPoses[0],
      'different fixture phases must not produce lockstep arms',
    ).not.toEqual(armPoses[1]);

    // A vertical neutral fixture stays vertical after mirroring; no historical
    // artwork-specific angle may leak into the shared attachment transform.
    const neutral = fixture(true);
    neutral.placements[0]!.motionPhase = 0;
    update(neutral, 0);
    const neutralBody = worldMatrix(batch(neutral, 'Body.A'), 0);
    for (const name of ['StickCore', 'StickHalo']) {
      const stick = batch(neutral, name);
      const axis = shaftPoint(stick, 0, 1, neutralBody).sub(
        shaftPoint(stick, 0, 0, neutralBody),
      );
      expect(axis.x).toBeCloseTo(0, 5);
      expect(axis.y).toBeGreaterThan(0);
    }
  });

  it('honors per-person wave amplitude, including zero, without changing body sway or other people', () => {
    const defaults = fixture();
    const still = fixture(false, 0);
    const small = fixture(false, 0.07);
    const large = fixture(false, 0.21);
    const samples = [defaults, still, small, large];
    const angle = (f: ReturnType<typeof fixture>): number => {
      const relative = worldMatrix(batch(f, 'Body.A'), 0)
        .invert()
        .multiply(worldMatrix(batch(f, 'Arm.A'), 0));
      return Math.atan2(relative.elements[1]!, relative.elements[0]!);
    };
    for (const time of [0, 1.25]) {
      samples.forEach((f) => update(f, time));
      // Phase, speed and placement match: only the first person's configured
      // swing size differs. Ratios avoid pinning the live wave formula/tuning.
      expect(
        angle(still),
        'explicit zero must suppress relative arm swing',
      ).toBeCloseTo(0, 5);
      expect(
        Math.abs(angle(defaults)),
        'omitted amplitude retains ordinary motion',
      ).toBeGreaterThan(0.001);
      expect(Math.abs(angle(small))).toBeGreaterThan(0.001);
      expect(angle(large)).toBeCloseTo(angle(small) * 3, 5);
      for (const f of [still, small, large]) {
        expect(worldMatrix(batch(f, 'Body.A'), 0).toArray()).toEqual(
          worldMatrix(batch(defaults, 'Body.A'), 0).toArray(),
        );
        for (const index of [1, 2])
          expect(worldMatrix(batch(f, 'Arm.A'), index).toArray()).toEqual(
            worldMatrix(batch(defaults, 'Arm.A'), index).toArray(),
          );
      }
    }
  });

  it('releases owned silhouette batches, geometry and materials once without disposing the borrowed atlas or imported meshes', () => {
    const f = fixture();
    batch(f, 'Body.A');
    const meshes = batches(crowd(f));
    const geometries = [...new Set(meshes.map((mesh) => mesh.geometry))];
    const materials = [
      ...new Set(
        meshes.flatMap((mesh) =>
          Array.isArray(mesh.material) ? mesh.material : [mesh.material],
        ),
      ),
    ];
    expect(geometries).not.toContain(f.geometry);
    expect(materials).not.toContain(f.material);
    const owned = [...meshes, ...geometries, ...materials].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    const borrowed = [f.geometry, f.material, f.texture, f.twilightTexture].map(
      (resource) => vi.spyOn(resource, 'dispose'),
    );
    f.composition.dispose();
    f.composition.dispose();
    for (const dispose of owned) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of borrowed) expect(dispose).not.toHaveBeenCalled();
    expect(() => update(f, 2)).toThrow(/disposed/i);
  });
});
