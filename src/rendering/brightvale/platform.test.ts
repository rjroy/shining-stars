import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hideFrontPlatformCaps } from './platform';

describe('approved platform front cap visibility', () => {
  it.each(['original names', 'GLTFLoader metadata'])(
    'hides only the front pair using %s, preserving borrowed resources and other nodes',
    (naming) => {
      const geometry = new THREE.BoxGeometry();
      const sharedGold = new THREE.MeshStandardMaterial({
        color: 0xc79842,
        emissive: 0x281300,
      });
      const platform = new THREE.Group();
      const names = [
        'Corner forging | -1 -1',
        'Corner forging | 1 -1',
        'Corner forging | -1 1',
        'Corner forging | 1 1',
        'Corner forging | -1 -1 extra',
        'Crest | test-owned shared gold',
        'Platform | test-owned chassis',
        'Endcap | test-owned side support',
      ];
      const nested = new THREE.Group();
      platform.add(nested);
      for (const [index, name] of names.entries()) {
        const mesh = new THREE.Mesh(geometry, sharedGold);
        mesh.name =
          naming === 'original names'
            ? name
            : THREE.PropertyBinding.sanitizeNodeName(name);
        if (naming === 'GLTFLoader metadata') mesh.userData.name = name;
        mesh.position.set(index, 1, 2);
        nested.add(mesh);
      }
      const alreadyHidden = new THREE.Mesh(geometry, sharedGold);
      alreadyHidden.name = 'Unrelated hidden stock';
      alreadyHidden.visible = false;
      platform.add(alreadyHidden);
      const otherAsset = new THREE.Mesh(geometry, sharedGold);
      otherAsset.name = names[0] ?? '';
      const clone = platform.clone(true);
      const originalColor = sharedGold.color.clone();
      const originalEmission = sharedGold.emissive.clone();

      try {
        hideFrontPlatformCaps(clone);
        hideFrontPlatformCaps(clone);
        const copiedNodes: THREE.Mesh[] = [];
        clone.traverse((object) => {
          if (object instanceof THREE.Mesh) copiedNodes.push(object);
        });
        expect(copiedNodes).toHaveLength(names.length + 1);
        copiedNodes.forEach((node, index) => {
          expect(node.visible).toBe(index >= 2 && index < names.length);
          expect(node.geometry).toBe(geometry);
          expect(node.material).toBe(sharedGold);
          if (index < names.length)
            expect(node.position.toArray()).toEqual([index, 1, 2]);
        });
        expect(nested.children.every((node) => node.visible)).toBe(true);
        expect(otherAsset.visible).toBe(true);
        expect(alreadyHidden.visible).toBe(false);
        expect(sharedGold.color.equals(originalColor)).toBe(true);
        expect(sharedGold.emissive.equals(originalEmission)).toBe(true);
      } finally {
        geometry.dispose();
        sharedGold.dispose();
      }
    },
  );
});
