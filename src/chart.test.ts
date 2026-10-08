import { describe, expect, it } from 'vitest';
import {
  type ChartConfig,
  type ChartIssueCode,
  type ChartLane,
  type ChartNote,
  validateChart,
} from './chart';

const validConfig: ChartConfig = {
  sourceStart: 107.1,
  duration: 65.8,
  twilightAt: 39.2,
  notes: [
    { id: 'audience-note', time: 10, lane: 0 },
    { id: 'twilight-note', time: 50, lane: 3 },
  ],
};

function withConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return { ...validConfig, ...overrides };
}

function expectIssue(config: ChartConfig, expected: ChartIssueCode): void {
  expect(validateChart(config).some((issue) => issue.code === expected)).toBe(
    true,
  );
}

describe('validateChart', () => {
  it('accepts a safe synthetic chart', () => {
    expect(validateChart(validConfig)).toEqual([]);
  });

  it('allows an empty chart for the later No notes result', () => {
    expect(validateChart(withConfig({ notes: [] }))).toEqual([]);
  });

  it.each([
    -0.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects invalid source offsets (%s)', (sourceStart) => {
    expectIssue(withConfig({ sourceStart }), 'invalid-source-start');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid excerpt durations (%s)',
    (duration) => {
      expectIssue(withConfig({ duration }), 'invalid-duration');
    },
  );

  it.each([
    0,
    validConfig.duration,
    -0.01,
    validConfig.duration + 0.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('requires a finite interior Twilight boundary (%s)', (twilightAt) => {
    expectIssue(withConfig({ twilightAt }), 'invalid-twilight');
  });

  it('rejects duplicate note IDs', () => {
    const duplicate: ChartNote = {
      ...validConfig.notes[0],
      time: 11,
      lane: 1,
    };

    expectIssue(
      withConfig({ notes: [validConfig.notes[0], duplicate] }),
      'duplicate-note-id',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite note times (%s)',
    (time) => {
      const invalidTime: ChartNote = { id: 'bad-time', time, lane: 0 };
      expectIssue(withConfig({ notes: [invalidTime] }), 'non-finite-note-time');
    },
  );

  it('rejects a runtime lane outside 0..3', () => {
    // Narrowly bypass the compile-time lane union to verify runtime validation.
    const invalidLane = 4 as unknown as ChartLane;
    const invalidNote: ChartNote = {
      id: 'bad-lane',
      time: 2,
      lane: invalidLane,
    };

    expectIssue(withConfig({ notes: [invalidNote] }), 'invalid-lane');
  });

  it('accepts an earliest timing envelope exactly at excerpt time zero', () => {
    const edgeNote: ChartNote = { id: 'start-edge', time: 0.35, lane: 0 };

    expect(validateChart(withConfig({ notes: [edgeNote] }))).toEqual([]);
  });

  it('rejects an envelope that begins before excerpt time zero', () => {
    const earlyNote: ChartNote = { id: 'too-early', time: 0.349, lane: 0 };

    expectIssue(withConfig({ notes: [earlyNote] }), 'before-excerpt-start');
  });

  it("requires an audience envelope's latest edge strictly before the handoff guard", () => {
    const edgeNote: ChartNote = { id: 'audience-edge', time: 38.35, lane: 0 };

    expectIssue(
      withConfig({ notes: [edgeNote] }),
      'audience-window-near-twilight',
    );
  });

  it("requires a Twilight envelope's earliest edge strictly after the handoff guard", () => {
    const edgeNote: ChartNote = { id: 'twilight-edge', time: 40.05, lane: 0 };

    expectIssue(
      withConfig({ notes: [edgeNote] }),
      'twilight-window-near-audience',
    );
  });

  it('rejects a note centered exactly on the Twilight boundary', () => {
    const boundaryNote: ChartNote = {
      id: 'boundary-note',
      time: validConfig.twilightAt,
      lane: 0,
    };

    expectIssue(withConfig({ notes: [boundaryNote] }), 'note-at-twilight');
  });

  it('accepts a final note whose latest timing edge is exactly duration minus 0.5s', () => {
    const finalNote: ChartNote = { id: 'end-edge', time: 64.95, lane: 0 };

    expect(validateChart(withConfig({ notes: [finalNote] }))).toEqual([]);
  });

  it('rejects a final note whose latest timing edge passes duration minus 0.5s', () => {
    const lateNote: ChartNote = { id: 'too-late', time: 64.951, lane: 0 };

    expectIssue(withConfig({ notes: [lateNote] }), 'after-excerpt-end');
  });

  it('rejects simultaneous notes rather than authoring a chord', () => {
    const simultaneous: readonly ChartNote[] = [
      { id: 'chord-a', time: 10, lane: 0 },
      { id: 'chord-b', time: 10, lane: 1 },
    ];

    expectIssue(withConfig({ notes: simultaneous }), 'simultaneous-notes');
  });
});
