/** Host-relative rectangle in CSS pixels (never device pixels). */
export interface BrightvaleViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type BrightvaleRendererStatus =
  'loading' | 'rendered' | 'suspended' | 'unavailable';

export interface BrightvaleViewportLayout {
  /** Raw host content-box size in CSS pixels; zero is meaningful. */
  readonly width: number;
  readonly height: number;
  /** Persistent in-play HUD only. Modal panels are never exclusions. */
  readonly persistentHudExclusions: readonly BrightvaleViewportRect[];
  /** Stable fixed screen-space slots, measured even when their text is hidden. */
  readonly labels: {
    readonly time: BrightvaleViewportRect;
    readonly countdown: BrightvaleViewportRect;
    readonly legend: BrightvaleViewportRect;
    readonly feedback: BrightvaleViewportRect;
  };
}

/** Convert measured screen-space DOM rectangles to host-relative CSS pixels. */
export function createBrightvaleViewportLayout(measurement: {
  readonly host: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly hud: readonly {
    readonly kind: 'persistent' | 'ready' | 'pause' | 'results' | 'error';
    readonly rect: BrightvaleViewportRect;
  }[];
  readonly labels: {
    readonly time: BrightvaleViewportRect;
    readonly countdown: BrightvaleViewportRect;
    readonly legend: BrightvaleViewportRect;
    readonly feedback: BrightvaleViewportRect;
  };
}): BrightvaleViewportLayout {
  const { host } = measurement;
  const relative = (rect: BrightvaleViewportRect): BrightvaleViewportRect => ({
    x: rect.x - host.left,
    y: rect.y - host.top,
    width: rect.width,
    height: rect.height,
  });

  return {
    width: host.width,
    height: host.height,
    persistentHudExclusions: measurement.hud
      .filter(({ kind }) => kind === 'persistent')
      .map(({ rect }) => relative(rect)),
    labels: {
      time: relative(measurement.labels.time),
      countdown: relative(measurement.labels.countdown),
      legend: relative(measurement.labels.legend),
      feedback: relative(measurement.labels.feedback),
    },
  };
}
