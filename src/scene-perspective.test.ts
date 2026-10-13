import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BRIGHTVALE_RUNTIME_LAYOUT } from './brightvale/layout';
import { createBrightvalePlayfieldContract } from './brightvale/playfield';
import { createBrightvaleCameraProjection } from './brightvale/projection';
import type { BrightvaleViewportLayout } from './brightvale/viewport';

function layout(width: number, height: number): BrightvaleViewportLayout {
  const top = Math.round(height * 0.07);
  const bottom = Math.round(height * 0.08);
  return {
    width,
    height,
    persistentHudExclusions: [
      { x: 0, y: 0, width, height: top },
      { x: 0, y: height - bottom, width, height: bottom },
    ],
    labels: {
      time: { x: width - 160, y: 12, width: 120, height: 26 },
      countdown: { x: width / 2 - 90, y: height - 130, width: 180, height: 32 },
      legend: {
        x: 100,
        y: height - bottom - 34,
        width: width - 200,
        height: 24,
      },
      feedback: {
        x: width / 2 - 130,
        y: height - bottom - 70,
        width: 260,
        height: 28,
      },
    },
  };
}

describe('perspective gameplay anchor projection', () => {
  it('projects canonical hit anchors in CSS pixels with increasing lane order', () => {
    const viewport = layout(1600, 900);
    const playfield = createBrightvalePlayfieldContract();
    const projection = createBrightvaleCameraProjection(playfield, viewport, {
      minimum: 0,
      maximum: 1,
    });
    const anchors = [0, 1, 2, 3].map((lane) =>
      projection.project(playfield.hitAnchor(lane)),
    );

    anchors.forEach((anchor) => {
      expect(Number.isFinite(anchor.x) && Number.isFinite(anchor.y)).toBe(true);
      expect(anchor.x).toBeGreaterThanOrEqual(0);
      expect(anchor.x).toBeLessThanOrEqual(viewport.width);
      expect(anchor.y).toBeGreaterThan(
        viewport.persistentHudExclusions[0]!.height,
      );
      expect(anchor.y).toBeLessThan(
        viewport.height - viewport.persistentHudExclusions[1]!.height,
      );
    });
    for (let lane = 1; lane < anchors.length; lane += 1)
      expect(anchors[lane]!.x).toBeGreaterThan(anchors[lane - 1]!.x);

    for (let lane = 0; lane < 4; lane += 1) {
      expect(projection.project(playfield.hitAnchor(lane)).y).toBeCloseTo(
        projection.project(playfield.point(lane, 1)).y,
        8,
      );
    }
  });

  it('keeps the authored view direction and recomputes raw-host aspect on resize', () => {
    const playfield = createBrightvalePlayfieldContract();
    const desktop = layout(1600, 900);
    const narrow = layout(1120, 700);
    const range = { minimum: 0, maximum: 1.2 };
    const projection = createBrightvaleCameraProjection(
      playfield,
      desktop,
      range,
    );
    const authoredQuaternion = new THREE.Quaternion()
      .fromArray([...BRIGHTVALE_RUNTIME_LAYOUT.camera.quaternionXyzw])
      .normalize();
    expect(
      projection.camera.quaternion.angleTo(authoredQuaternion),
    ).toBeLessThan(1e-7);

    projection.resize(narrow, range);
    expect(
      projection.camera.quaternion.angleTo(authoredQuaternion),
    ).toBeLessThan(1e-7);
    expect(projection.camera.aspect).toBeCloseTo(
      narrow.width / narrow.height,
      10,
    );
    const hit = projection.project(playfield.hitAnchor(2));
    expect(hit.x).toBeGreaterThanOrEqual(0);
    expect(hit.x).toBeLessThanOrEqual(narrow.width);
    expect(hit.y).toBeGreaterThan(narrow.persistentHudExclusions[0]!.height);
    expect(hit.y).toBeLessThan(
      narrow.height - narrow.persistentHudExclusions[1]!.height,
    );
  });
});
