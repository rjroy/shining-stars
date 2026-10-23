import * as THREE from 'three';
import type { BrightvaleSilhouetteCrowdAssets } from './assets';
import type { BrightvaleSilhouetteCrowdPlacement } from './layout';

export interface SilhouetteCrowd {
  readonly root: THREE.Group;
  update(time: number): void;
  dispose(): void;
}

/** Staggered side banks for the authorized waist-up crowd composition. */
export function createSilhouettePilotPlacements(): readonly BrightvaleSilhouetteCrowdPlacement[] {
  const stickColors = [0x55ddff, 0xff65c7, 0xc39aff, 0xffce69];
  return [-1, 1].flatMap((side, sideIndex) =>
    [0, 1, 2, 3, 4, 5].flatMap((row) =>
      Array.from({ length: 10 }, (_, column) => {
        const index = sideIndex * 60 + row * 10 + column;
        // Independent, stateless streams for this person's authored variation.
        // Run only at construction; replay/seek never samples random state.
        const variation = (channel: number): number => {
          let seed =
            Math.imul(index + 1, 0x9e3779b9) ^
            Math.imul(channel + 1, 0x85ebca6b);
          seed = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
          return ((seed ^ (seed >>> 15)) >>> 0) / 0x100000000;
        };
        const x = side * (9.15 + row * 1.25 + (variation(0) - 0.5) * 0.78);
        const z = -1.5 - column * 2.7 - row * 0.83 + (variation(1) - 0.5) * 2;
        const scale = 1.76 + variation(2) * 0.18;
        const quaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.atan2(-x, 15 - z),
        );
        return {
          id: `pilot-${index}`,
          figure: variation(8) < 0.5 ? 'A' : 'B',
          matrixColumnMajor: new THREE.Matrix4()
            .compose(
              new THREE.Vector3(x, 8.25, z),
              quaternion,
              new THREE.Vector3(scale, scale, scale),
            )
            .toArray(),
          motionPhase: variation(3) * Math.PI * 2,
          motionRate: 0.55 + variation(4) * 1.15,
          waveAmplitude: 0.08 + variation(5) * 0.34,
          ...(variation(6) < 0.28
            ? {
                stickColor:
                  stickColors[Math.floor(variation(7) * stickColors.length)]!,
              }
            : {}),
        };
      }),
    ),
  );
}

function quad(
  bounds: readonly number[],
  uv: readonly number[],
): THREE.BufferGeometry {
  const [left, bottom, right, top] = bounds;
  const [u, v, width, height] = uv;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [left!, bottom!, 0, right!, bottom!, 0, right!, top!, 0, left!, top!, 0],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      [u!, v!, u! + width!, v!, u! + width!, v! + height!, u!, v! + height!],
      2,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

function rod(
  top: readonly number[],
  bottom: readonly number[],
  grip: readonly number[],
  width: number,
  padding = 0,
): THREE.BufferGeometry {
  const a = new THREE.Vector2(top[0]! - grip[0]!, top[1]! - grip[1]!);
  const b = new THREE.Vector2(bottom[0]! - grip[0]!, bottom[1]! - grip[1]!);
  const direction = a.clone().sub(b).normalize();
  a.addScaledVector(direction, padding);
  b.addScaledVector(direction, -padding);
  const normal = new THREE.Vector2(-direction.y, direction.x).multiplyScalar(
    width / 2,
  );
  const points = [
    b.clone().sub(normal),
    b.clone().add(normal),
    a.clone().add(normal),
    a.clone().sub(normal),
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      points.flatMap((p) => [p.x, p.y, 0]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

function haloTexture(): THREE.DataTexture {
  const width = 16,
    height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const across = ((x + 0.5) / width) * 2 - 1;
      const along =
        Math.max(0, Math.abs(((y + 0.5) / height) * 2 - 1) - 0.8) / 0.2;
      data.set(
        [
          255,
          255,
          255,
          Math.round(255 * Math.exp(-across * across * 5 - along * along * 4)),
        ],
        offset,
      );
    }
  const texture = new THREE.DataTexture(data, width, height);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Shared local chain: placement * quiet body sway * shoulder * arm wave * grip. */
export function createSilhouetteCrowd(
  assets: BrightvaleSilhouetteCrowdAssets,
  placements: readonly BrightvaleSilhouetteCrowdPlacement[],
  multisampledFramebuffer = false,
): SilhouetteCrowd {
  const root = new THREE.Group();
  root.name = 'Brightvale.SilhouettePilot';
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances: THREE.InstancedMesh[] = [];
  const glow = haloTexture();
  let disposed = false;
  const release = (): void => {
    instances.forEach((mesh) => mesh.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    glow.dispose();
  };
  try {
    const { metadata } = assets;
    if (metadata.schema !== 'brightvale-silhouette-crowd-v1')
      throw new Error('Unsupported silhouette atlas schema');
    for (const placement of placements) {
      if (
        placement.matrixColumnMajor.length !== 16 ||
        ![
          ...placement.matrixColumnMajor,
          placement.motionPhase,
          placement.motionRate,
          ...(placement.waveAmplitude === undefined
            ? []
            : [placement.waveAmplitude]),
        ].every(Number.isFinite)
      )
        throw new Error(`Invalid silhouette placement ${placement.id}`);
      if (!metadata.figures.some((f) => f.id === placement.figure))
        throw new Error(`Missing silhouette figure ${placement.figure}`);
    }
    const cardMaterial = new THREE.MeshBasicMaterial({
      map: assets.texture,
      // Both modes preserve source alpha without transparent-instance sorting.
      // Coverage needs actual framebuffer samples; hashing is the safe fallback.
      alphaToCoverage: multisampledFramebuffer,
      alphaHash: !multisampledFramebuffer,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const coreMaterial = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: glow,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    [cardMaterial, coreMaterial, glowMaterial].forEach((m) => materials.add(m));

    const makeBatch = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      selected: readonly BrightvaleSilhouetteCrowdPlacement[],
      radius: number,
    ): THREE.InstancedMesh => {
      geometries.add(geometry);
      const mesh = new THREE.InstancedMesh(geometry, material, selected.length);
      mesh.name = `Brightvale.Crowd.${name}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Full-angle spheres about each placement origin conservatively cover
      // sway/wave extrema without per-frame culling-bound allocations.
      const bounds = new THREE.Sphere();
      bounds.makeEmpty();
      selected.forEach((placement) => {
        const matrix = new THREE.Matrix4().fromArray([
          ...placement.matrixColumnMajor,
        ]);
        bounds.union(
          new THREE.Sphere(
            new THREE.Vector3().setFromMatrixPosition(matrix),
            radius * matrix.getMaxScaleOnAxis(),
          ),
        );
      });
      mesh.boundingSphere = bounds;
      root.add(mesh);
      instances.push(mesh);
      return mesh;
    };
    const records = metadata.figures.flatMap((figure) => {
      const selected = placements.filter((p) => p.figure === figure.id);
      if (selected.length === 0) return [];
      const part = (id: string): THREE.BufferGeometry => {
        const data = metadata.parts.find((p) => p.id === id);
        if (
          !data ||
          data.card_bounds_local.length !== 4 ||
          data.uv_rect_bottom_left.length !== 4 ||
          ![...data.card_bounds_local, ...data.uv_rect_bottom_left].every(
            Number.isFinite,
          )
        )
          throw new Error(`Invalid silhouette atlas part ${id}`);
        return quad(data.card_bounds_local, data.uv_rect_bottom_left);
      };
      const bodyGeometry = part(figure.body_part);
      geometries.add(bodyGeometry);
      const armGeometry = part(figure.arm_part);
      geometries.add(armGeometry);
      // Reflect the artwork about its shoulder origin, not the tile center.
      // Bake it into owned geometry: reflected InstancedMesh matrices are not
      // supported. Keep source UVs and restore the front-face winding.
      armGeometry.scale(-1, 1, 1);
      armGeometry.setIndex([0, 2, 1, 0, 3, 2]);
      armGeometry.computeBoundingSphere();
      const radius = (geometry: THREE.BufferGeometry): number =>
        geometry.boundingSphere!.center.length() +
        geometry.boundingSphere!.radius;
      const shoulder = new THREE.Vector3(
        figure.shoulder_body_local[0]!,
        figure.shoulder_body_local[1]!,
        0.004,
      );
      const grip = new THREE.Vector3(
        -figure.grip_arm_local[0]!,
        figure.grip_arm_local[1]!,
        -0.008,
      );
      const stickTop = [
        -figure.stick_top_arm_local[0]!,
        figure.stick_top_arm_local[1]!,
      ];
      const stickBottom = [
        -figure.stick_bottom_arm_local[0]!,
        figure.stick_bottom_arm_local[1]!,
      ];
      if (
        ![
          ...shoulder.toArray(),
          ...grip.toArray(),
          ...stickTop,
          ...stickBottom,
        ].every(Number.isFinite)
      )
        throw new Error('Non-finite silhouette attachment metadata');
      const body = makeBatch(
        `Body.${figure.id}`,
        bodyGeometry,
        cardMaterial,
        selected,
        radius(bodyGeometry),
      );
      const arm = makeBatch(
        `Arm.${figure.id}`,
        armGeometry,
        cardMaterial,
        selected,
        shoulder.length() + radius(armGeometry),
      );
      const lit = selected.filter((p) => p.stickColor !== undefined);
      let core: THREE.InstancedMesh | undefined,
        halo: THREE.InstancedMesh | undefined;
      if (lit.length > 0) {
        const coreGeometry = rod(
          stickTop,
          stickBottom,
          [grip.x, grip.y],
          0.012,
        );
        const haloGeometry = rod(
          stickTop,
          stickBottom,
          [grip.x, grip.y],
          0.05,
          0.025,
        );
        const suffix = root.getObjectByName('Brightvale.Crowd.StickCore')
          ? `.${figure.id}`
          : '';
        core = makeBatch(
          `StickCore${suffix}`,
          coreGeometry,
          coreMaterial,
          lit,
          shoulder.length() + grip.length() + radius(coreGeometry),
        );
        halo = makeBatch(
          `StickHalo${suffix}`,
          haloGeometry,
          glowMaterial,
          lit,
          shoulder.length() + grip.length() + radius(haloGeometry),
        );
        lit.forEach((placement, i) => {
          const color = new THREE.Color(placement.stickColor!);
          core!.setColorAt(i, color);
          halo!.setColorAt(i, color);
        });
      }
      return [
        {
          selected,
          body,
          arm,
          core,
          halo,
          shoulder: new THREE.Matrix4().makeTranslation(
            shoulder.x,
            shoulder.y,
            shoulder.z,
          ),
          grip: new THREE.Matrix4().makeTranslation(grip.x, grip.y, grip.z),
          bases: selected.map((p) =>
            new THREE.Matrix4().fromArray([...p.matrixColumnMajor]),
          ),
        },
      ];
    });
    const bodyMatrix = new THREE.Matrix4(),
      armMatrix = new THREE.Matrix4(),
      stickMatrix = new THREE.Matrix4(),
      rotation = new THREE.Matrix4();
    const update = (time: number): void => {
      if (disposed) throw new Error('Silhouette crowd has been disposed');
      const t = Number.isFinite(time) ? Math.max(0, time) : 0;
      for (const record of records) {
        let litIndex = 0;
        record.selected.forEach((placement, index) => {
          const phase = t * placement.motionRate + placement.motionPhase;
          const sway = 0.012 * Math.sin(phase * 0.63);
          const amplitude =
            placement.waveAmplitude ??
            (placement.stickColor === undefined ? 0.035 : 0.23);
          const wave =
            amplitude * Math.sin(phase + 0.2 * Math.sin(phase * 0.41));
          bodyMatrix
            .copy(record.bases[index]!)
            .multiply(rotation.makeRotationZ(sway));
          armMatrix
            .copy(bodyMatrix)
            .multiply(record.shoulder)
            .multiply(rotation.makeRotationZ(wave));
          record.body.setMatrixAt(index, bodyMatrix);
          record.arm.setMatrixAt(index, armMatrix);
          if (
            placement.stickColor !== undefined &&
            record.core &&
            record.halo
          ) {
            stickMatrix.copy(armMatrix).multiply(record.grip);
            record.core.setMatrixAt(litIndex, stickMatrix);
            record.halo.setMatrixAt(litIndex, stickMatrix);
            litIndex += 1;
          }
        });
      }
      instances.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
      });
    };
    update(0);
    return {
      root,
      update,
      dispose() {
        if (disposed) return;
        disposed = true;
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
