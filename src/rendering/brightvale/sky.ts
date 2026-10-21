import * as THREE from 'three';
import type { BrightvaleSkyTextures } from './assets';
import type { SceneStateProjection } from '../scene-state';
import { STATIC_AMBIENCE, type BrightvaleAmbience } from './ambience';

const SKY_ASPECT = 1535 / 864;
const SKY_STARS = 156;

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform vec3 audienceTop;
  uniform vec3 audienceHorizon;
  uniform vec3 audienceGlow;
  uniform vec3 twilightTop;
  uniform vec3 twilightHorizon;
  uniform vec3 twilightGlow;
  uniform vec3 radiantTop;
  uniform vec3 radiantHorizon;
  uniform vec3 radiantGlow;
  uniform float twilightAmount;
  uniform float radiantAmount;
  uniform float observatoryAmount;

  vec3 palette(vec3 top, vec3 horizon, vec3 glow, float y, float x) {
    float upper = smoothstep(0.30, 0.94, y);
    float band = exp(-pow((y - 0.42) * 4.1, 2.0));
    float center = 0.62 + 0.38 * exp(-pow((x - 0.5) * 2.2, 2.0));
    vec3 color = mix(horizon, top, upper);
    return color + glow * band * center * 0.20;
  }

  void main() {
    vec3 audience = palette(audienceTop, audienceHorizon, audienceGlow, vUv.y, vUv.x);
    vec3 twilight = palette(twilightTop, twilightHorizon, twilightGlow, vUv.y, vUv.x);
    vec3 radiant = palette(radiantTop, radiantHorizon, radiantGlow, vUv.y, vUv.x);
    vec3 gameplay = mix(audience, twilight, twilightAmount);
    gameplay = mix(gameplay, radiant, radiantAmount);
    vec3 observatory = mix(audience, twilight, 0.58);
    observatory = mix(observatory, radiant, 0.12);
    vec3 color = mix(gameplay, observatory, observatoryAmount);
    float haze = exp(-pow((vUv.y - 0.38) * 6.0, 2.0));
    color = mix(color, mix(audienceGlow, twilightGlow, twilightAmount), haze * 0.07);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface BrightvaleSky {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  update(
    state: SceneStateProjection,
    aspect: number,
    options?: {
      readonly observatory?: boolean;
      readonly ambience?: BrightvaleAmbience;
    },
  ): void;
  dispose(): void;
}

function makeStars(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  let seed = 0x4b1d;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const positions = new Float32Array(SKY_STARS * 3);
  for (let index = 0; index < SKY_STARS; index += 1) {
    positions[index * 3] = random() * 2 - 1;
    positions[index * 3 + 1] = 0.12 + random() * 0.84;
    positions[index * 3 + 2] = 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffe9c0,
    size: 1.35,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.48,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = 'Brightvale.Sky.Stars';
  stars.frustumCulled = false;
  stars.renderOrder = 2;
  return stars;
}

/** Shared screen-space sky rendered behind both the 3D city and gameplay. */
export function createBrightvaleSky(
  textures: BrightvaleSkyTextures,
): BrightvaleSky {
  const scene = new THREE.Scene();
  scene.name = 'Brightvale.Sky';
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const backgroundMaterial = new THREE.ShaderMaterial({
    uniforms: {
      audienceTop: { value: new THREE.Color('#29385f') },
      audienceHorizon: { value: new THREE.Color('#b97977') },
      audienceGlow: { value: new THREE.Color('#f2ba83') },
      twilightTop: { value: new THREE.Color('#11162f') },
      twilightHorizon: { value: new THREE.Color('#3c3157') },
      twilightGlow: { value: new THREE.Color('#9173c0') },
      radiantTop: { value: new THREE.Color('#282d55') },
      radiantHorizon: { value: new THREE.Color('#dd9e59') },
      radiantGlow: { value: new THREE.Color('#ffd27f') },
      twilightAmount: { value: 0 },
      radiantAmount: { value: 0 },
      observatoryAmount: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    backgroundMaterial,
  );
  background.name = 'Brightvale.Sky.Gradient';
  background.frustumCulled = false;
  background.renderOrder = 0;
  scene.add(background);

  const cloudGradeColor = { value: new THREE.Color(1, 1, 1) };
  const cloudGradeAmount = { value: 0 };
  const makeCloudLayer = (
    texture: THREE.Texture,
    name: string,
  ): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    material.customProgramCacheKey = () => 'brightvale-cloud-grade-v1';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.brightvaleCloudGrade = cloudGradeColor;
      shader.uniforms.brightvaleCloudGradeAmount = cloudGradeAmount;
      shader.fragmentShader = `
        uniform vec3 brightvaleCloudGrade;
        uniform float brightvaleCloudGradeAmount;
        ${shader.fragmentShader}`.replace(
        '#include <map_fragment>',
        `
          #include <map_fragment>
          vec3 brightvaleLumaWeights = vec3(0.2126, 0.7152, 0.0722);
          float brightvaleCloudLight = dot(diffuseColor.rgb, brightvaleLumaWeights);
          vec3 brightvaleGradedCloud = brightvaleCloudLight * brightvaleCloudGrade
            / max(dot(brightvaleCloudGrade, brightvaleLumaWeights), 0.001);
          diffuseColor.rgb = mix(diffuseColor.rgb, brightvaleGradedCloud, brightvaleCloudGradeAmount);
        `,
      );
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    return mesh;
  };
  const warmClouds = makeCloudLayer(
    textures.warm,
    'Brightvale.Sky.Clouds.Warm',
  );
  const twilightClouds = makeCloudLayer(
    textures.twilight,
    'Brightvale.Sky.Clouds.Twilight',
  );
  const stars = makeStars();
  scene.add(stars);

  const ownedGeometries = new Set<THREE.BufferGeometry>([
    background.geometry,
    warmClouds.geometry,
    twilightClouds.geometry,
    stars.geometry,
  ]);
  const ownedMaterials = new Set<THREE.Material>([
    backgroundMaterial,
    warmClouds.material,
    twilightClouds.material,
    stars.material,
  ]);
  let disposed = false;

  return {
    scene,
    camera,
    update(state, aspect, options = {}) {
      if (disposed) throw new Error('Brightvale sky has been disposed');
      const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
      camera.left = -safeAspect;
      camera.right = safeAspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
      background.scale.x = safeAspect;

      // Keep the cloud banks in the upper half of the visible scene: the lower
      // half is occupied by the horizon, city, highway, and gameplay HUD.
      const planeWidth = 2 * SKY_ASPECT;
      const planeHeight = 2;
      const planeY = 0.72;
      const planeX = safeAspect < 0.95 ? -planeWidth * 0.22 : 0;
      for (const cloud of [warmClouds, twilightClouds]) {
        cloud.scale.set(planeWidth, planeHeight, 1);
        cloud.position.set(planeX, planeY, 0);
      }

      const transitionProgress = Number.isFinite(state.transitionProgress)
        ? THREE.MathUtils.clamp(state.transitionProgress, 0, 1)
        : 0;
      const twilightAmount = transitionProgress;
      const radiantAmount = state.victory ? state.radiantProgress : 0;
      const observatoryAmount = options.observatory ? 1 : 0;
      backgroundMaterial.uniforms.twilightAmount.value = twilightAmount;
      backgroundMaterial.uniforms.radiantAmount.value = radiantAmount;
      backgroundMaterial.uniforms.observatoryAmount.value = observatoryAmount;

      const observatoryDimming = options.observatory ? 0.34 : 1;
      const ambience = options.ambience ?? STATIC_AMBIENCE;
      for (const cloud of [warmClouds, twilightClouds])
        cloud.material.color.setRGB(...ambience.cloudTint);
      cloudGradeColor.value.setRGB(...ambience.cloudGradeColor);
      cloudGradeAmount.value = ambience.cloudGradeAmount;
      const warmOpacity = state.victory
        ? THREE.MathUtils.lerp((1 - twilightAmount) * 0.86, 0.96, radiantAmount)
        : (1 - twilightAmount) * 0.86;
      const twilightOpacity = twilightAmount * (1 - radiantAmount) * 0.82;
      warmClouds.visible = warmOpacity > 0.01;
      twilightClouds.visible = twilightOpacity > 0.01;
      (warmClouds.material as THREE.MeshBasicMaterial).opacity =
        warmOpacity * observatoryDimming;
      (twilightClouds.material as THREE.MeshBasicMaterial).opacity =
        twilightOpacity * observatoryDimming;
      (stars.material as THREE.PointsMaterial).opacity = options.observatory
        ? 0.36
        : 0.48;
      stars.scale.x = safeAspect;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      scene.clear();
    },
  };
}
