import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STATIC_AMBIENCE } from './ambience';
import { attachWaterShimmer } from './water-shimmer';

describe('water surface shader', () => {
  it.each([
    'city.water.fall',
    'city.water.surface',
    'city.water.highlight',
    'city.water.foam',
  ])(
    'moves a constant wave crest downward on vertical %s faces without reversing horizontal travel',
    (role) => {
      const material = new THREE.MeshStandardMaterial();
      attachWaterShimmer(material, role);
      // The real shader hook supplies the wave parameters used by the GPU.
      const shader = {
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
        uniforms: {},
      } as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      const direction = shader.uniforms.brightvaleWaterDirection?.value;
      const speed = shader.uniforms.brightvaleWaterSpeed?.value;
      if (!(direction instanceof THREE.Vector3) || typeof speed !== 'number')
        throw new Error('Water wave parameters must be supplied to the shader');
      expect(shader.fragmentShader).toContain(
        'dot(vBrightvaleWaterPosition, brightvaleWaterDirection)',
      );
      expect(shader.fragmentShader).toContain(
        'brightvaleWaterTime * brightvaleWaterSpeed',
      );
      const phase = (position: THREE.Vector3, time: number): number =>
        position.dot(direction) - time * speed;

      // Controlled world positions: follow a crest down a fixed vertical face.
      const start = new THREE.Vector3(0, 8, 0);
      start.x = (Math.PI / 2 - start.dot(direction)) / direction.x;
      const elapsed = 2.75;
      const lower = start.clone();
      lower.y += (elapsed * speed) / direction.y;
      expect(lower.y).toBeLessThan(start.y);
      expect(Math.sin(phase(start, 0))).toBeCloseTo(1);
      expect(Math.sin(phase(lower, elapsed))).toBeCloseTo(1);
      const mirroredUpward = start.clone();
      mirroredUpward.y -= lower.y - start.y;
      expect(phase(mirroredUpward, elapsed)).not.toBeCloseTo(phase(start, 0));

      // A horizontal channel retains increasing-X/Z travel at the same rate.
      expect(direction.x).toBeGreaterThan(0);
      expect(direction.z).toBeGreaterThan(0);
      const horizontal = new THREE.Vector3(direction.x, 0, direction.z);
      horizontal.multiplyScalar((elapsed * speed) / horizontal.lengthSq());
      const downstream = start.clone().add(horizontal);
      expect(downstream.y).toBe(start.y);
      expect(phase(downstream, elapsed)).toBeCloseTo(phase(start, 0));
      material.dispose();
    },
  );

  it('adds spatial traveling glints to existing instanced PBR surfaces, controlled by reusable uniforms', () => {
    const material = new THREE.MeshPhysicalMaterial({ roughness: 0.37 });
    const update = attachWaterShimmer(material, 'city.water.surface');
    if (!update) throw new Error('Test water must support shimmer');
    // The hook consumes only these shader fields and never accesses the renderer.
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {},
    } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const timeUniform = shader.uniforms.brightvaleWaterTime;
    const strengthUniform = shader.uniforms.brightvaleWaterStrength;
    expect(shader.vertexShader).toContain(
      'instanceMatrix * brightvalePosition',
    );
    expect(shader.vertexShader).toContain('modelMatrix * brightvalePosition');
    expect(shader.fragmentShader).toContain('dot(vBrightvaleWaterPosition');
    expect(shader.fragmentShader).toContain('- brightvaleWaterTime *');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
    expect(strengthUniform?.value).toBe(0);
    update({ ...STATIC_AMBIENCE, time: 8.5, waterStrength: 1 });
    expect(timeUniform?.value).toBe(8.5);
    expect(strengthUniform?.value).toBe(1);
    update({ ...STATIC_AMBIENCE, time: 0, waterStrength: 1 });
    expect(timeUniform?.value).toBe(0);
    expect(shader.uniforms.brightvaleWaterTime).toBe(timeUniform);
    update(STATIC_AMBIENCE);
    expect(strengthUniform?.value).toBe(0);
    expect(material.roughness).toBe(0.37);
    material.dispose();
  });

  it('does not attach to unrelated city materials or broad water-like name guesses', () => {
    const material = new THREE.MeshStandardMaterial();
    const hook = material.onBeforeCompile;
    expect(attachWaterShimmer(material, 'city.stone')).toBeUndefined();
    expect(attachWaterShimmer(material, 'water')).toBeUndefined();
    expect(material.onBeforeCompile).toBe(hook);
    material.dispose();
  });
});
