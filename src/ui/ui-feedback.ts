export interface FeedbackAnnouncementEvent {
  readonly eventId: number;
  readonly runId: number;
  readonly lane: number;
  readonly quality: 'good' | 'perfect' | 'miss';
}

export interface FeedbackAnnouncementUpdate {
  readonly announcement: string | null;
  readonly clear: boolean;
}

export interface GameplayStatusTextTarget {
  textContent: string | null;
}

/** Apply announcements to the live region only when its text actually changes. */
export function updateGameplayStatusText(
  target: GameplayStatusTextTarget,
  victoryAnnouncement: string | null,
  feedback: FeedbackAnnouncementUpdate,
): void {
  if (feedback.announcement !== null || victoryAnnouncement !== null) {
    setTextIfChanged(
      target,
      [victoryAnnouncement, feedback.announcement]
        .filter((announcement): announcement is string => announcement !== null)
        .join(' '),
    );
  } else if (feedback.clear) {
    setTextIfChanged(target, '');
  }
}

function setTextIfChanged(target: GameplayStatusTextTarget, text: string): void {
  if (target.textContent !== text) target.textContent = text;
}

/** Announces the latched victory once, and rearms only after run reset. */
export function createVictoryAnnouncementTracker(): {
  update(victory: boolean): string | null;
} {
  let announced = false;
  return {
    update(victory) {
      if (!victory) {
        announced = false;
        return null;
      }
      if (announced) return null;
      announced = true;
      return 'Twilight is defeated. Your radiant performance continues to the end of the song.';
    },
  };
}

/** Tracks unseen events and makes repeated identical polite announcements distinct. */
export function createFeedbackAnnouncementTracker(): {
  update(events: readonly FeedbackAnnouncementEvent[]): FeedbackAnnouncementUpdate;
} {
  let runId: number | null = null;
  let lastEventId = 0;
  let lastMessage: string | null = null;
  let lastAnnouncement: string | null = null;
  let consecutiveRepeatCount = 0;

  return {
    update(events) {
      if (events.length === 0) {
        return { announcement: null, clear: true };
      }

      const newestRun = events.reduce((latest, event) =>
        event.eventId > latest.eventId ? event : latest,
      ).runId;
      if (runId !== newestRun) {
        runId = newestRun;
        lastEventId = 0;
        lastMessage = null;
        consecutiveRepeatCount = 0;
      }

      const unseen = events
        .filter((event) => event.runId === runId && event.eventId > lastEventId)
        .sort((left, right) => left.eventId - right.eventId);
      if (unseen.length === 0)
        return { announcement: null, clear: false };

      const messages = unseen.map((event) => {
        const lane = ['D', 'F', 'J', 'K'][event.lane] ?? '';
        const quality =
          event.quality === 'miss'
            ? 'Miss'
            : event.quality === 'perfect'
              ? 'Perfect'
              : 'Good';
        const message = `Lane ${lane}: ${quality}.`;
        let distinctMessage = message;
        if (message === lastMessage) {
          consecutiveRepeatCount += 1;
          distinctMessage =
            consecutiveRepeatCount === 1
              ? `Lane ${lane}: ${quality} again.`
              : `Lane ${lane}: ${quality} again, ${consecutiveRepeatCount + 1}.`;
        } else if (message === lastAnnouncement) {
          consecutiveRepeatCount = 1;
          distinctMessage = `Lane ${lane}: ${quality} again.`;
        } else {
          consecutiveRepeatCount = 0;
        }
        lastMessage = message;
        lastAnnouncement = distinctMessage;
        return distinctMessage;
      });
      lastEventId = Math.max(...unseen.map((event) => event.eventId));
      return { announcement: messages.join(' '), clear: false };
    },
  };
}
