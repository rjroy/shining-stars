import { describe, expect, it } from 'vitest';
import type { SceneStateProjection } from '../scene-state';
import {
  projectBrightvaleAmbience,
  STATIC_AMBIENCE,
  windowAmbienceMultiplier,
} from './ambience';

const audience: SceneStateProjection = {
  phase: 'audience',
  victory: false,
  cityIntensity: 0.5,
  cityBrightness: 0.6,
  transitionProgress: 0,
  radiantProgress: 0,
  motion: {
    powerLinePulse: false,
    buildingPulse: false,
    windTravel: false,
    cameraPush: 0,
  },
  playerDefiant: true,
  twilightConsumed: false,
};
const twilight = {
  ...audience,
  phase: 'twilight' as const,
  transitionProgress: 1,
};
const radiant = { ...twilight, victory: true, radiantProgress: 1 };

describe('transport-derived Brightvale ambience', () => {
  it('keeps generated colors finite and bounded while varying the Audience grade', () => {
    const samples = [0, 3, 6, 12, 18, 24, 81].map((time) =>
      projectBrightvaleAmbience(audience, time, false),
    );
    for (const sample of samples) {
      for (const channel of [...sample.cloudGradeColor, ...sample.cloudTint]) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(Number.isFinite(sample.cloudGradeAmount)).toBe(true);
      expect(sample.cloudGradeAmount).toBeGreaterThanOrEqual(0);
      expect(sample.cloudGradeAmount).toBeLessThanOrEqual(1);
    }
    expect(
      new Set(samples.map((sample) => sample.cloudGradeColor.join(','))).size,
    ).toBeGreaterThan(1);
  });
  it('varies all modes continuously, with the smallest rate of change in Radiant', () => {
    const rates = [audience, twilight, radiant].map((state) => {
      let maximumRate = 0;
      let prior = projectBrightvaleAmbience(state, 0, false).cloudTint;
      for (let step = 1; step <= 1800; step += 1) {
        const current = projectBrightvaleAmbience(
          state,
          step / 10,
          false,
        ).cloudTint;
        current.forEach((value, channel) => {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
          maximumRate = Math.max(
            maximumRate,
            Math.abs(value - (prior[channel] ?? value)) / 0.1,
          );
        });
        prior = current;
      }
      expect(maximumRate).toBeGreaterThan(0);
      return maximumRate;
    });
    expect(rates[1]).toBeGreaterThan(rates[0] ?? Infinity);
    expect(rates[0]).toBeGreaterThan(rates[2] ?? Infinity);
    expect(rates[1]).toBeGreaterThan(rates[2] ?? Infinity);
  });

  it('keeps grade strength independent of color phase and freezes it for reduced motion', () => {
    const times = [0, 6, 13, 30, 51];
    const active = times.map((time) =>
      projectBrightvaleAmbience(audience, time, false),
    );
    expect(new Set(active.map((sample) => sample.cloudGradeAmount)).size).toBe(
      1,
    );
    for (const time of times) {
      expect(projectBrightvaleAmbience(audience, time, true)).toEqual(
        projectBrightvaleAmbience(audience, 0, false),
      );
    }
    expect(
      new Set(active.map((sample) => sample.cloudGradeColor.join(','))).size,
    ).toBeGreaterThan(1);
  });

  it('blends saturated mode pigments through both handoffs at constant strength', () => {
    for (const time of [0, 6, 13, 30, 51]) {
      const a = projectBrightvaleAmbience(audience, time, false);
      const t = projectBrightvaleAmbience(twilight, time, false);
      const r = projectBrightvaleAmbience(radiant, time, false);
      const first = projectBrightvaleAmbience(
        { ...twilight, transitionProgress: 0.5 },
        time,
        false,
      );
      const second = projectBrightvaleAmbience(
        { ...radiant, radiantProgress: 0.5 },
        time,
        false,
      );
      for (const channel of [0, 1, 2] as const) {
        expect(first.cloudGradeColor[channel]).toBeCloseTo(
          (a.cloudGradeColor[channel] + t.cloudGradeColor[channel]) / 2,
        );
        expect(second.cloudGradeColor[channel]).toBeCloseTo(
          (t.cloudGradeColor[channel] + r.cloudGradeColor[channel]) / 2,
        );
      }
      for (const projection of [a, t, r, first, second])
        expect(projection.cloudGradeAmount).toBe(a.cloudGradeAmount);
      expect(
        projectBrightvaleAmbience(
          { ...radiant, radiantProgress: 0 },
          time,
          false,
        ),
      ).toEqual(t);
      expect(
        projectBrightvaleAmbience(
          { ...twilight, transitionProgress: 0 },
          time,
          false,
        ),
      ).toEqual(a);
    }
    expect(STATIC_AMBIENCE.cloudGradeAmount).toBe(0);
  });

  it('varies by phase continuously, with deterministic samples and no frame jumps', () => {
    for (const state of [audience, twilight, radiant]) {
      const sample = (time: number) =>
        projectBrightvaleAmbience(state, time, false).cloudGradeColor;
      const range = (intervals: number) => {
        const values = Array.from({ length: intervals + 1 }, (_, i) =>
          sample((i / intervals) * 100),
        );
        const excursions = [0, 1, 2].map(
          (channel) =>
            Math.max(...values.map((value) => value[channel]!)) -
            Math.min(...values.map((value) => value[channel]!)),
        );
        return Math.max(...excursions);
      };
      const coarseRange = range(1000);
      const fineRange = range(2000);
      expect(coarseRange).toBeGreaterThan(0);
      expect(fineRange).toBeGreaterThan(0);
      const maxAdjacentStep = (intervals: number) => {
        let maximum = 0;
        let previous = sample(0);
        for (let i = 1; i <= intervals; i += 1) {
          const current = sample((i / intervals) * 100);
          for (const channel of [0, 1, 2] as const)
            maximum = Math.max(
              maximum,
              Math.abs(current[channel] - previous[channel]),
            );
          previous = current;
        }
        return maximum;
      };
      expect(maxAdjacentStep(2000)).toBeLessThan(maxAdjacentStep(1000));
      expect(projectBrightvaleAmbience(state, 12, true)).toEqual(
        projectBrightvaleAmbience(state, 99, true),
      );
      expect(projectBrightvaleAmbience(state, 12, false)).toEqual(
        projectBrightvaleAmbience(state, 12, false),
      );
      expect(sample(12)).toEqual(sample(12));
      expect(projectBrightvaleAmbience(state, 0, false)).toEqual(
        projectBrightvaleAmbience(state, 0, true),
      );
    }
  });

  it('layers tint variation over both existing linear phase blends without endpoint jumps', () => {
    const time = 23;
    const a = projectBrightvaleAmbience(audience, time, false).cloudTint;
    const t = projectBrightvaleAmbience(twilight, time, false).cloudTint;
    const r = projectBrightvaleAmbience(radiant, time, false).cloudTint;
    const first = projectBrightvaleAmbience(
      { ...twilight, transitionProgress: 0.5 },
      time,
      false,
    ).cloudTint;
    const second = projectBrightvaleAmbience(
      { ...radiant, radiantProgress: 0.5 },
      time,
      false,
    ).cloudTint;
    for (const channel of [0, 1, 2] as const) {
      expect(first[channel]).toBeCloseTo((a[channel] + t[channel]) / 2);
      expect(second[channel]).toBeCloseTo((t[channel] + r[channel]) / 2);
    }
    expect(
      projectBrightvaleAmbience({ ...radiant, radiantProgress: 0 }, time, false)
        .cloudTint,
    ).toEqual(t);
    expect(
      projectBrightvaleAmbience(
        { ...twilight, transitionProgress: 0 },
        time,
        false,
      ).cloudTint,
    ).toEqual(a);
  });

  it('holds the same saved time during pause, repeats on restart and freezes under reduced motion', () => {
    const initial = projectBrightvaleAmbience(audience, 0, false);
    const playing = projectBrightvaleAmbience(audience, 12, false);
    expect(projectBrightvaleAmbience(audience, 12, false)).toEqual(playing);
    expect(projectBrightvaleAmbience(audience, 14, false)).not.toEqual(playing);
    expect(projectBrightvaleAmbience(audience, 0, false)).toEqual(initial);
    expect(projectBrightvaleAmbience(twilight, 12, true)).toEqual(
      projectBrightvaleAmbience(twilight, 99, true),
    );
    expect(projectBrightvaleAmbience(audience, NaN, false)).toEqual(initial);
    expect(projectBrightvaleAmbience(audience, -12, false)).toEqual(initial);
  });

  it('varies selected window groups over transport time and out of phase', () => {
    const names = [
      'District detail | Left lit glazing',
      'District detail | Right lit glazing',
    ];
    const valuesByName = names.map(() => new Set<number>());
    for (const time of [0, 3, 9, 24, 67]) {
      const ambience = projectBrightvaleAmbience(twilight, time, false);
      const values = names.map((name) =>
        windowAmbienceMultiplier(name, ambience),
      );
      expect(values[0]).not.toBeCloseTo(values[1] ?? 0, 5);
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      values.forEach((value, index) => valuesByName[index]?.add(value));
      expect(
        windowAmbienceMultiplier('test-owned unselected glass', ambience),
      ).toBe(1);
      expect(
        windowAmbienceMultiplier(names[0] ?? '', {
          ...STATIC_AMBIENCE,
          windowsEnabled: false,
        }),
      ).toBe(1);
    }
    for (const samples of valuesByName) expect(samples.size).toBeGreaterThan(1);
  });
});
