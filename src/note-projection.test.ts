import { describe, expect, it } from 'vitest';
import { projectNotes } from './note-projection';

describe('projectNotes', () => {
  it('projects unresolved upcoming notes into the visible runway and hides resolved or distant notes', () => {
    const notes = [
      { id: 'far', phase: 'audience' as const, outcome: null },
      { id: 'near', phase: 'audience' as const, outcome: null },
      { id: 'hit', phase: 'audience' as const, outcome: 'good' as const },
    ];

    expect(
      projectNotes(
        notes,
        [
          { id: 'far', lane: 0, time: 4 },
          { id: 'near', lane: 2, time: 2 },
          { id: 'hit', lane: 1, time: 1 },
        ],
        1,
        2,
      ),
    ).toEqual([{ id: 'near', lane: 2, progress: 0.5, bottomPercent: 50 }]);
  });

  it('clamps an imminent note to the hit line', () => {
    expect(
      projectNotes(
        [{ id: 'now', phase: 'audience', outcome: null }],
        [{ id: 'now', lane: 3, time: 0.8 }],
        1,
        2,
      ),
    ).toEqual([{ id: 'now', lane: 3, progress: 1, bottomPercent: 18 }]);
  });
});
