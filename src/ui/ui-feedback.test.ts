import { describe, expect, it } from 'vitest';
import {
  createFeedbackAnnouncementTracker,
  createVictoryAnnouncementTracker,
  updateGameplayStatusText,
} from './ui-feedback';

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

  it('clears displayed feedback but preserves duplicate history until a new run', () => {
    const tracker = createFeedbackAnnouncementTracker();
    const judgment = (eventId: number, runId: number) => ({
      eventId,
      runId,
      lane: 2,
      quality: 'good' as const,
    });

    expect(tracker.update([judgment(8, 1)]).announcement).toBe('Lane J: Good.');
    expect(tracker.update([])).toEqual({ announcement: null, clear: true });
    expect(
      tracker.update([
        { ...judgment(1, 2), lane: 0, quality: 'perfect' as const },
      ]),
    ).toEqual({
      announcement: 'Lane D: Perfect.',
      clear: false,
    });

    expect(tracker.update([])).toEqual({ announcement: null, clear: true });
    expect(tracker.update([judgment(2, 2)])).toEqual({
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

describe('accessible victory announcement', () => {
  it('announces once through recovery and rearms after a run reset', () => {
    const tracker = createVictoryAnnouncementTracker();
    expect(tracker.update(false)).toBeNull();
    const first = tracker.update(true);
    expect(first).toMatch(/Twilight is defeated.*continues to the end of the song/);
    expect(tracker.update(true)).toBeNull();
    expect(tracker.update(false)).toBeNull();
    expect(tracker.update(false)).toBeNull();
    expect(tracker.update(true)).toBe(first);
  });

  it('clears stale victory feedback text so a repeated judgment updates the live region', () => {
    const feedback = createFeedbackAnnouncementTracker();
    const victory = createVictoryAnnouncementTracker();
    const writes: string[] = [];
    let currentText = '';
    const status = {
      get textContent() {
        return currentText;
      },
      set textContent(value: string | null) {
        currentText = value ?? '';
        writes.push(currentText);
      },
    };
    const perfect = (eventId: number) => ({
      eventId,
      runId: 1,
      lane: 0,
      quality: 'perfect' as const,
    });
    const render = (victoryState: boolean, events: ReturnType<typeof perfect>[]) =>
      updateGameplayStatusText(
        status,
        victory.update(victoryState),
        feedback.update(events),
      );

    render(false, []);
    render(true, [perfect(1)]);
    const firstAnnouncement = currentText;
    expect(firstAnnouncement).toMatch(/Twilight is defeated.*Lane D: Perfect\./);
    render(true, [perfect(1)]);
    expect(writes).toHaveLength(1);

    render(true, []); // Pause/resume or renderer recovery clears old judgment text.
    expect(currentText).toBe('');
    render(true, [perfect(2)]);

    expect(currentText).toBe('Lane D: Perfect again.');
    expect(currentText).not.toBe(firstAnnouncement);
    expect(writes).toEqual([firstAnnouncement, '', 'Lane D: Perfect again.']);
    expect(writes.filter((text) => text.includes('Twilight is defeated'))).toHaveLength(1);
  });
});
