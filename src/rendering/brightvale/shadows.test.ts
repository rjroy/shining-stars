import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BRIGHTVALE_SHADOW_MAP_SIZE,
  fitDirectionalShadowCamera,
  setShadowParticipation,
} from './shadows';

describe('Brightvale directional shadow setup', () => {
  it('fits caster silhouettes and their contact projections without using the huge receiver bounds', () => {
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(-12, 20, 15);
    const caster = new THREE.Mesh(
      new THREE.BoxGeometry(4, 8, 3),
      new THREE.MeshToonMaterial(),
    );
    caster.name = 'test-building';
    caster.position.set(14, 6, -22);
    const receiver = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial(),
    );
    receiver.rotation.x = -Math.PI / 2;
    receiver.position.y = 0;
    receiver.updateMatrixWorld(true);

    fitDirectionalShadowCamera(light, [caster], [receiver]);

    const camera = light.shadow.camera as THREE.OrthographicCamera;
    const bounds = new THREE.Box3().setFromObject(caster);
    const cameraSpaceCaster = bounds
      .clone()
      .applyMatrix4(camera.matrixWorldInverse);
    expect(camera.left).toBeLessThan(cameraSpaceCaster.min.x);
    expect(camera.right).toBeGreaterThan(cameraSpaceCaster.max.x);
    expect(camera.bottom).toBeLessThan(cameraSpaceCaster.min.y);
    expect(camera.top).toBeGreaterThan(cameraSpaceCaster.max.y);
    expect(camera.right - camera.left).toBeLessThan(100);
    expect(camera.top - camera.bottom).toBeLessThan(100);
    expect(light.shadow.mapSize.toArray()).toEqual([
      BRIGHTVALE_SHADOW_MAP_SIZE,
      BRIGHTVALE_SHADOW_MAP_SIZE,
    ]);
    expect(light.shadow.bias).toBeLessThan(0);
    expect(light.shadow.normalBias).toBeGreaterThan(0);
    expect(light.shadow.intensity).toBeLessThan(1);
  });

  it('fails early for an empty caster set or empty caster object', () => {
    const light = new THREE.DirectionalLight();
    expect(() => fitDirectionalShadowCamera(light, [])).toThrow(
      'at least one caster',
    );
    expect(() =>
      fitDirectionalShadowCamera(light, [new THREE.Group()]),
    ).toThrow("caster '' is empty");
  });

  it('sets casting and receiving flags on meshes and instances only', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshToonMaterial(),
    );
    const instances = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshToonMaterial(),
      2,
    );
    root.add(mesh, instances);

    setShadowParticipation(root, { cast: true, receive: true });

    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(instances.castShadow).toBe(true);
    expect(instances.receiveShadow).toBe(true);
    expect(root.castShadow).toBe(false);
  });
});
