import { describe, expect, it } from 'vitest';
import { createBrightvaleViewportLayout } from '../rendering/brightvale/viewport';

const labels = {
  time: { x: 120, y: 80, width: 90, height: 24 },
  countdown: { x: 240, y: 80, width: 180, height: 36 },
  legend: { x: 320, y: 660, width: 500, height: 24 },
  feedback: { x: 500, y: 560, width: 240, height: 34 },
} as const;

describe('Brightvale viewport measurement contract', () => {
  it('preserves zero-sized raw CSS content dimensions', () => {
    const layout = createBrightvaleViewportLayout({
      host: { left: 40, top: 20, width: 0, height: 0 },
      hud: [],
      labels,
    });

    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it('converts content-box screen rectangles to host-relative CSS pixels', () => {
    const layout = createBrightvaleViewportLayout({
      host: { left: 100, top: 50, width: 1600, height: 900 },
      hud: [
        {
          kind: 'persistent',
          rect: { x: 124, y: 82, width: 420, height: 96 },
        },
      ],
      labels,
    });

    expect(layout).toEqual({
      width: 1600,
      height: 900,
      persistentHudExclusions: [{ x: 24, y: 32, width: 420, height: 96 }],
      labels: {
        time: { x: 20, y: 30, width: 90, height: 24 },
        countdown: { x: 140, y: 30, width: 180, height: 36 },
        legend: { x: 220, y: 610, width: 500, height: 24 },
        feedback: { x: 400, y: 510, width: 240, height: 34 },
      },
    });
  });

  it('never treats Ready, Pause, Results, or error panels as HUD exclusions', () => {
    const persistent = {
      kind: 'persistent' as const,
      rect: { x: 12, y: 16, width: 500, height: 80 },
    };
    const modals = (['ready', 'pause', 'results', 'error'] as const).map(
      (kind) => ({
        kind,
        rect: { x: 400, y: 200, width: 800, height: 500 },
      }),
    );
    const layout = createBrightvaleViewportLayout({
      host: { left: 0, top: 0, width: 1600, height: 900 },
      hud: [persistent, ...modals],
      labels,
    });

    expect(layout.persistentHudExclusions).toEqual([persistent.rect]);
  });

  it('pure helper keeps fixed label slots unchanged when modal measurements move', () => {
    const base = {
      host: { left: 75, top: 30, width: 1120, height: 700 },
      hud: [
        {
          kind: 'persistent' as const,
          rect: { x: 95, y: 52, width: 480, height: 72 },
        },
        {
          kind: 'ready' as const,
          rect: { x: 250, y: 140, width: 600, height: 400 },
        },
      ],
      labels,
    };
    const modalMoved = {
      ...base,
      hud: [
        base.hud[0],
        {
          kind: 'pause' as const,
          rect: { x: 0, y: 60, width: 1120, height: 640 },
        },
      ],
    };
    const before = createBrightvaleViewportLayout(base);
    const after = createBrightvaleViewportLayout(modalMoved);

    expect(after.labels).toEqual(before.labels);
    expect(after.persistentHudExclusions).toEqual(
      before.persistentHudExclusions,
    );
  });
});
