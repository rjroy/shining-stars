import { describe, expect, it } from 'vitest';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './layout';

function expectFiniteMatrix(matrix: readonly number[]): void {
  expect(matrix).toHaveLength(16);
  expect(matrix.every(Number.isFinite)).toBe(true);
}

describe('Brightvale runtime layout contract', () => {
  it('declares a compact versioned Y-up layout without source reports', () => {
    const layout = BRIGHTVALE_RUNTIME_LAYOUT;
    expect(layout.schemaVersion).toBe('brightvale-runtime-layout-v1');
    expect(layout.coordinateSystem).toBe('gltf-y-up');
    expect(layout.units).toBe('provisional-authoring-units');
    expect(layout).not.toHaveProperty('sourceHash');
    expect(layout).not.toHaveProperty('report');
  });

  it('provides finite transforms for scene and geometry placements', () => {
    const layout = BRIGHTVALE_RUNTIME_LAYOUT;
    expectFiniteMatrix(layout.playfield.matrixColumnMajor);
    expectFiniteMatrix(layout.city.matrixColumnMajor);
    for (const entry of layout.framingInstances)
      expectFiniteMatrix(entry.matrixColumnMajor);
    for (const surface of layout.groundSurfaces)
      expectFiniteMatrix(surface.matrixColumnMajor);
  });
});
