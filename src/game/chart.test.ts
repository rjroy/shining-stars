import { describe, expect, it } from 'vitest';
import {
  type ChartConfig,
  type ChartIssueCode,
  type ChartLane,
  type ChartNote,
  getInitialTwilightStrength,
  validateChart,
} from './chart';
import { DIFFICULTY_PROFILES, maximumGoodWindowSeconds } from './game-balance';

const validConfig: ChartConfig = {
  sourceStart: 107.1,
  duration: 65.8,
  twilightAt: 39.2,
  allowedDifficulties: ['normal', 'hard'],
  notes: [
    { id: 'audience-note', time: 10, lane: 0 },
    { id: 'twilight-note', time: 50, lane: 3 },
  ],
};
const inputOffset = 0.2;
const normalEnvelope =
  maximumGoodWindowSeconds(['normal', 'hard']) + inputOffset;
const easyEnvelope = maximumGoodWindowSeconds(['easy']) + inputOffset;

function withConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return { ...validConfig, ...overrides };
}

function withDifficultyConfig(
  notes: readonly ChartNote[],
  allowedDifficulties: readonly ('easy' | 'normal' | 'hard')[],
): ChartConfig {
  return {
    ...validConfig,
    notes,
    allowedDifficulties,
  } as ChartConfig;
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
    { allowedDifficulties: [] as unknown[] },
    { allowedDifficulties: ['normal', 'normal'] },
    { allowedDifficulties: ['easy', 'expert'] },
  ])(
    'rejects malformed allowed difficulty lists ($allowedDifficulties)',
    ({ allowedDifficulties }) => {
      const invalid = {
        ...validConfig,
        allowedDifficulties,
      } as unknown as ChartConfig;
      expectIssue(invalid, 'invalid-allowed-difficulties');
    },
  );

  it('derives Twilight Strength from difficulty, Twilight-phase notes and Perfect damage', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const profile = DIFFICULTY_PROFILES[difficulty];
      const twilightNoteCount = validConfig.notes.filter(
        ({ time }) => time >= validConfig.twilightAt,
      ).length;
      const independentlyDerivedStrength = Math.ceil(
        twilightNoteCount *
          profile.twilight.perfect.damage *
          (profile.twilightStrengthPercent / 100),
      );

      expect(getInitialTwilightStrength(validConfig, difficulty)).toBe(
        independentlyDerivedStrength,
      );
    }
  });

  it('counts only notes assigned to Twilight and rounds fractional strength up', () => {
    const chart = withConfig({
      notes: [
        { id: 'before', time: validConfig.twilightAt - 0.001, lane: 0 },
        { id: 'at-boundary', time: validConfig.twilightAt, lane: 1 },
      ],
    });
    expect(getInitialTwilightStrength(chart, 'normal')).toBe(3);
    expect(
      getInitialTwilightStrength(withConfig({ notes: [] }), 'normal'),
    ).toBe(0);
  });

  it('uses the selected difficulty profile when deriving the initial strength', () => {
    const chart = withConfig({
      notes: [{ id: 'twilight', time: validConfig.twilightAt, lane: 0 }],
    });

    // The boundary belongs to Twilight; Hard damage and its configured
    // strength percentage produce a fractional value that rounds upward.
    const hardProfile = DIFFICULTY_PROFILES.hard;
    expect(getInitialTwilightStrength(chart, 'hard')).toBe(
      Math.ceil(
        hardProfile.twilight.perfect.damage *
          (hardProfile.twilightStrengthPercent / 100),
      ),
    );
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
    const edgeNote: ChartNote = {
      id: 'start-edge',
      time: normalEnvelope,
      lane: 0,
    };

    expect(validateChart(withConfig({ notes: [edgeNote] }))).toEqual([]);
  });

  it('rejects an envelope that begins before excerpt time zero', () => {
    const earlyNote: ChartNote = {
      id: 'too-early',
      time: normalEnvelope - 0.001,
      lane: 0,
    };

    expectIssue(withConfig({ notes: [earlyNote] }), 'before-excerpt-start');
  });

  it('uses the maximum allowed Good window plus the input offset for excerpt-start safety', () => {
    const easyEdge: ChartNote = {
      id: 'easy-start-edge',
      time: easyEnvelope,
      lane: 0,
    };
    const easyTooEarly: ChartNote = {
      id: 'easy-before-start',
      time: easyEnvelope - 0.001,
      lane: 0,
    };
    const normalEdge: ChartNote = {
      id: 'normal-start-edge',
      time: normalEnvelope,
      lane: 0,
    };

    expect(validateChart(withDifficultyConfig([easyEdge], ['easy']))).toEqual(
      [],
    );
    expectIssue(
      withDifficultyConfig([easyTooEarly], ['easy']),
      'before-excerpt-start',
    );
    expect(
      validateChart(withDifficultyConfig([normalEdge], ['normal', 'hard'])),
    ).toEqual([]);
  });

  it("requires an audience envelope's latest edge strictly before the handoff guard", () => {
    const edgeNote: ChartNote = {
      id: 'audience-edge',
      time: validConfig.twilightAt - 0.5 - normalEnvelope,
      lane: 0,
    };

    expectIssue(
      withConfig({ notes: [edgeNote] }),
      'audience-window-near-twilight',
    );
  });

  it('uses the maximum allowed Good window to protect the Audience side of Twilight handoff', () => {
    const audienceEdge: ChartNote = {
      id: 'easy-audience-handoff',
      time:
        validConfig.twilightAt -
        0.5 -
        (maximumGoodWindowSeconds(['easy', 'normal']) + inputOffset),
      lane: 0,
    };
    expectIssue(
      withDifficultyConfig([audienceEdge], ['easy', 'normal']),
      'audience-window-near-twilight',
    );
  });

  it("requires a Twilight envelope's earliest edge strictly after the handoff guard", () => {
    const edgeNote: ChartNote = {
      id: 'twilight-edge',
      time: validConfig.twilightAt + 0.5 + normalEnvelope,
      lane: 0,
    };

    expectIssue(
      withConfig({ notes: [edgeNote] }),
      'twilight-window-near-audience',
    );
  });

  it('uses the maximum allowed Good window to protect the Twilight side of handoff', () => {
    const twilightEdge: ChartNote = {
      id: 'easy-twilight-handoff',
      time:
        validConfig.twilightAt +
        0.5 +
        maximumGoodWindowSeconds(['easy', 'normal']) +
        inputOffset,
      lane: 0,
    };
    expectIssue(
      withDifficultyConfig([twilightEdge], ['easy', 'normal']),
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
    const finalNote: ChartNote = {
      id: 'end-edge',
      time: validConfig.duration - 0.5 - normalEnvelope,
      lane: 0,
    };

    expect(validateChart(withConfig({ notes: [finalNote] }))).toEqual([]);
  });

  it('rejects a final note whose latest timing edge passes duration minus 0.5s', () => {
    const lateNote: ChartNote = {
      id: 'too-late',
      time: validConfig.duration - 0.5 - normalEnvelope + 0.001,
      lane: 0,
    };

    expectIssue(withConfig({ notes: [lateNote] }), 'after-excerpt-end');
  });

  it('uses the maximum allowed Good window plus the input offset for excerpt-end safety', () => {
    const endEdge: ChartNote = {
      id: 'easy-end-edge',
      time: validConfig.duration - 0.5 - easyEnvelope,
      lane: 0,
    };
    const tooLate: ChartNote = {
      id: 'easy-too-late',
      time: validConfig.duration - 0.5 - easyEnvelope + 0.001,
      lane: 0,
    };

    expect(validateChart(withDifficultyConfig([endEdge], ['easy']))).toEqual(
      [],
    );
    expectIssue(withDifficultyConfig([tooLate], ['easy']), 'after-excerpt-end');
    expect(
      validateChart(withDifficultyConfig([tooLate], ['normal', 'hard'])),
    ).toEqual([]);
  });

  it('rejects simultaneous notes rather than authoring a chord', () => {
    const simultaneous: readonly ChartNote[] = [
      { id: 'chord-a', time: 10, lane: 0 },
      { id: 'chord-b', time: 10, lane: 1 },
    ];

    expectIssue(withConfig({ notes: simultaneous }), 'simultaneous-notes');
  });
});
