import { describe, expect, it } from 'vitest';
import { validateChart } from './chart';
import { MVP_CHART } from './mvp-chart';

describe('provisional MVP rehearsal chart', () => {
  it('satisfies chart timing guards without claiming musical verification', () => {
    expect(validateChart(MVP_CHART)).toEqual([]);
    expect(
      MVP_CHART.notes.filter((note) => note.time < MVP_CHART.twilightAt),
    ).toHaveLength(23);
    expect(MVP_CHART.notes.at(-1)?.time).toBeLessThanOrEqual(
      MVP_CHART.duration - 0.85,
    );
  });
});
