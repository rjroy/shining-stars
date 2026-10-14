import { describe, expect, it } from 'vitest';
import { createFeedbackAnnouncementTracker } from './ui-feedback';

describe('accessible gameplay feedback announcements', () => {
  it('changes repeated identical judgments into distinct live-region text', () => {
    const tracker = createFeedbackAnnouncementTracker();
    const perfect = (eventId: number) => ({
      eventId,
      runId: 1,
      lane: 0,
      quality: 'perfect' as const,
    });

    expect(tracker.update([perfect(1)])).toEqual({
      announcement: 'Lane D: Perfect.',
      clear: false,
    });
    expect(tracker.update([perfect(1)])).toEqual({
      announcement: null,
      clear: false,
    });
    expect(tracker.update([perfect(2)])).toEqual({
      announcement: 'Lane D: Perfect again.',
      clear: false,
    });
    expect(tracker.update([perfect(3)])).toEqual({
      announcement: 'Lane D: Perfect again, 3.',
      clear: false,
    });
  });

  it('clears duplicate history at lifecycle boundaries without replaying stale events', () => {
    const tracker = createFeedbackAnnouncementTracker();
    const judgment = (eventId: number, runId: number) => ({
      eventId,
      runId,
      lane: 2,
      quality: 'good' as const,
    });

    expect(tracker.update([judgment(8, 1)]).announcement).toBe('Lane J: Good.');
    expect(tracker.update([])).toEqual({ announcement: null, clear: true });
    expect(tracker.update([judgment(1, 2)])).toEqual({
      announcement: 'Lane J: Good.',
      clear: false,
    });
  });

  it('keeps a same-text first judgment distinct if a restart skips an empty render', () => {
    const tracker = createFeedbackAnnouncementTracker();
    const judgment = (eventId: number, runId: number) => ({
      eventId,
      runId,
      lane: 0,
      quality: 'perfect' as const,
    });

    expect(tracker.update([judgment(8, 1)]).announcement).toBe('Lane D: Perfect.');
    expect(tracker.update([judgment(1, 2)]).announcement).toBe(
      'Lane D: Perfect again.',
    );
  });

  it('announces every unseen simultaneous lane event in event order', () => {
    const tracker = createFeedbackAnnouncementTracker();
    expect(
      tracker.update([
        { eventId: 2, runId: 1, lane: 2, quality: 'good' as const },
        { eventId: 1, runId: 1, lane: 0, quality: 'perfect' as const },
      ]),
    ).toEqual({
      announcement: 'Lane D: Perfect. Lane J: Good.',
      clear: false,
    });
  });
});
