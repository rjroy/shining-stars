import * as THREE from 'three';
import type { BrightvaleSilhouetteCrowdAssets } from './assets';
import type { BrightvaleSilhouetteCrowdPlacement } from './layout';

export interface SilhouetteCrowd {
  readonly root: THREE.Group;
  update(time: number): void;
  setAtlasBlend(blend: number): void;
  dispose(): void;
}

/** Staggered side banks for the authorized waist-up crowd composition. */
export function createSilhouettePilotPlacements(): readonly BrightvaleSilhouetteCrowdPlacement[] {
  const stickColors = [0x55ddff, 0xff65c7, 0xc39aff, 0xffce69];
  return [-1.05, 1].flatMap((side, sideIndex) =>
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
        const x = side * (9 + row * 2 + (variation(0) - 0.5) * 2);
        const z = 1 - column * 2.7 - row * 0.83 + (variation(1) - 0.5) * 2.1;
        const scale = 1.78 + variation(2) * 0.3;
        const quaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.atan2(-x, 45 - z),
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

function dualAtlasQuad(
  originalPart: BrightvaleSilhouetteAtlasPart,
  twilightPart: BrightvaleSilhouetteAtlasPart,
  mirrored = false,
): THREE.BufferGeometry {
  const originalBounds = originalPart.card_bounds_local;
  const twilightBounds = twilightPart.card_bounds_local;
  const [left, bottom, right, top] = [
    Math.min(originalBounds[0]!, twilightBounds[0]!),
    Math.min(originalBounds[1]!, twilightBounds[1]!),
    Math.max(originalBounds[2]!, twilightBounds[2]!),
    Math.max(originalBounds[3]!, twilightBounds[3]!),
  ];
  const geometry = new THREE.BufferGeometry();
  const local = [
    [left, bottom],
    [right, bottom],
    [right, top],
    [left, top],
  ];
  const uvFor = (
    point: readonly number[],
    bounds: readonly number[],
    rect: readonly number[],
  ): number[] => {
    // Keep UVs affine across the enclosing quad. Fragments outside this
    // variant's card bounds are masked below; clamping corners stretches its
    // sprite over the other variant's wider local extent.
    const x = (point[0]! - bounds[0]!) / (bounds[2]! - bounds[0]!);
    const y = (point[1]! - bounds[1]!) / (bounds[3]! - bounds[1]!);
    return [rect[0]! + x * rect[2]!, rect[1]! + y * rect[3]!];
  };
  const positions = local.flatMap(([x, y]) => [mirrored ? -x! : x!, y!, 0]);
  const uv = local.flatMap((point) =>
    uvFor(point, originalBounds, originalPart.uv_rect_bottom_left),
  );
  const twilightUv = local.flatMap((point) =>
    uvFor(point, twilightBounds, twilightPart.uv_rect_bottom_left),
  );
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute(
    'crowdTwilightUv',
    new THREE.Float32BufferAttribute(twilightUv, 2),
  );
  geometry.setAttribute(
    'crowdSourceLocal',
    new THREE.Float32BufferAttribute(
      local.flatMap((point) => point),
      2,
    ),
  );
  geometry.setAttribute(
    'crowdOriginalBounds',
    new THREE.Float32BufferAttribute(
      Array.from({ length: 4 }, () => originalBounds).flatMap((bounds) => [
        bounds[0]!,
        bounds[1]!,
        bounds[2]!,
        bounds[3]!,
      ]),
      4,
    ),
  );
  geometry.setAttribute(
    'crowdTwilightBounds',
    new THREE.Float32BufferAttribute(
      Array.from({ length: 4 }, () => twilightBounds).flatMap((bounds) => [
        bounds[0]!,
        bounds[1]!,
        bounds[2]!,
        bounds[3]!,
      ]),
      4,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  if (mirrored) geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeBoundingSphere();
  return geometry;
}

interface BrightvaleSilhouetteAtlasPart {
  readonly card_bounds_local: readonly number[];
  readonly uv_rect_bottom_left: readonly number[];
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

function configureCrowdAtlasBlend(
  material: THREE.MeshBasicMaterial,
  twilightTexture: THREE.Texture,
): {
  readonly twilightMap: { value: THREE.Texture };
  readonly blend: { value: number };
} {
  const uniforms = {
    twilightMap: { value: twilightTexture },
    blend: { value: 0 },
  };
  material.userData.silhouetteCrowdUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.crowdTwilightMap = uniforms.twilightMap;
    shader.uniforms.crowdAtlasBlend = uniforms.blend;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 crowdTwilightUv;
attribute vec2 crowdSourceLocal;
attribute vec4 crowdOriginalBounds;
attribute vec4 crowdTwilightBounds;
varying vec2 vCrowdTwilightUv;
varying vec2 vCrowdSourceLocal;
varying vec4 vCrowdOriginalBounds;
varying vec4 vCrowdTwilightBounds;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vCrowdTwilightUv = crowdTwilightUv;
vCrowdSourceLocal = crowdSourceLocal;
vCrowdOriginalBounds = crowdOriginalBounds;
vCrowdTwilightBounds = crowdTwilightBounds;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D crowdTwilightMap;
uniform float crowdAtlasBlend;
varying vec2 vCrowdTwilightUv;
varying vec2 vCrowdSourceLocal;
varying vec4 vCrowdOriginalBounds;
varying vec4 vCrowdTwilightBounds;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
vec4 crowdOriginalSample = texture2D( map, vMapUv );
vec4 crowdTwilightSample = texture2D( crowdTwilightMap, vCrowdTwilightUv );
float crowdOriginalInside = step(vCrowdOriginalBounds.x, vCrowdSourceLocal.x)
  * step(vCrowdSourceLocal.x, vCrowdOriginalBounds.z)
  * step(vCrowdOriginalBounds.y, vCrowdSourceLocal.y)
  * step(vCrowdSourceLocal.y, vCrowdOriginalBounds.w);
float crowdTwilightInside = step(vCrowdTwilightBounds.x, vCrowdSourceLocal.x)
  * step(vCrowdSourceLocal.x, vCrowdTwilightBounds.z)
  * step(vCrowdTwilightBounds.y, vCrowdSourceLocal.y)
  * step(vCrowdSourceLocal.y, vCrowdTwilightBounds.w);
crowdOriginalSample.a *= crowdOriginalInside;
crowdTwilightSample.a *= crowdTwilightInside;
float crowdBlendedAlpha = mix(crowdOriginalSample.a, crowdTwilightSample.a, crowdAtlasBlend);
vec3 crowdBlendedPremultiplied = mix(
  crowdOriginalSample.rgb * crowdOriginalSample.a,
  crowdTwilightSample.rgb * crowdTwilightSample.a,
  crowdAtlasBlend
);
vec3 crowdBlendedStraight = crowdBlendedAlpha > 1e-6
  ? crowdBlendedPremultiplied / crowdBlendedAlpha
  : vec3(0.0);
diffuseColor *= vec4(crowdBlendedStraight, crowdBlendedAlpha);
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'brightvale-crowd-atlas-blend-v1';
  return uniforms;
}

/** Shared local chain: placement * quiet body sway * shoulder * arm wave * grip. */
export function createSilhouetteCrowd(
  assets: BrightvaleSilhouetteCrowdAssets,
  twilightAssets: BrightvaleSilhouetteCrowdAssets | undefined,
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
    const atlasUniforms = configureCrowdAtlasBlend(
      cardMaterial,
      (twilightAssets ?? assets).texture,
    );
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
    const twilightMetadata = twilightAssets?.metadata ?? metadata;
    if (twilightMetadata.schema !== 'brightvale-silhouette-crowd-v1')
      throw new Error('Unsupported Twilight silhouette atlas schema');
    const records = metadata.figures.flatMap((figure) => {
      const selected = placements.filter((p) => p.figure === figure.id);
      if (selected.length === 0) return [];
      const parts = (
        atlas: typeof metadata,
        id: string,
      ): BrightvaleSilhouetteAtlasPart => {
        const part = atlas.parts.find((item) => item.id === id);
        if (
          !part ||
          part.card_bounds_local.length !== 4 ||
          part.uv_rect_bottom_left.length !== 4 ||
          ![...part.card_bounds_local, ...part.uv_rect_bottom_left].every(
            Number.isFinite,
          ) ||
          part.card_bounds_local[2]! <= part.card_bounds_local[0]! ||
          part.card_bounds_local[3]! <= part.card_bounds_local[1]!
        )
          throw new Error(`Invalid silhouette atlas part ${id}`);
        return part;
      };
      const bodyGeometry = dualAtlasQuad(
        parts(metadata, figure.body_part),
        parts(twilightMetadata, figure.body_part),
      );
      geometries.add(bodyGeometry);
      const armGeometry = dualAtlasQuad(
        parts(metadata, figure.arm_part),
        parts(twilightMetadata, figure.arm_part),
        true,
      );
      geometries.add(armGeometry);
      // Reflect the artwork about its shoulder origin, not the tile center.
      // Both UV registrations use the unmirrored local card coordinates.
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
          figure,
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
    const setAtlasBlend = (blend: number): void => {
      if (disposed) throw new Error('Silhouette crowd has been disposed');
      atlasUniforms.blend.value = THREE.MathUtils.clamp(
        Number.isFinite(blend) ? blend : 0,
        0,
        1,
      );
    };
    return {
      root,
      update,
      setAtlasBlend,
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
