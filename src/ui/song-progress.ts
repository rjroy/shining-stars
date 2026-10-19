import type { ChartConfig } from '../game/chart';

function clockLabel(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

/** Both the chart boundary and transport time are relative to the playable excerpt. */
export function getSongProgress(chart: ChartConfig, transportTime: number) {
  const elapsed = Math.min(chart.duration, Math.max(0, transportTime));
  return {
    elapsed,
    duration: chart.duration,
    fraction: elapsed / chart.duration,
    twilightFraction: chart.twilightAt / chart.duration,
    valueText: `${clockLabel(elapsed)} of ${clockLabel(chart.duration)}. Twilight begins at ${clockLabel(chart.twilightAt)}.`,
  };
}

/** Render-only binding: no timer, animation loop, or transport subscription. */
export function createSongProgress(root: HTMLElement, chart: ChartConfig) {
  const meter = root.querySelector<HTMLProgressElement>('[data-song-progress]');
  const rail = root.querySelector<HTMLElement>('[data-song-progress-rail]');
  const fill = root.querySelector<HTMLElement>('[data-song-progress-fill]');
  if (meter === null || rail === null || fill === null)
    throw new Error('Song progress markup is missing.');
  const initial = getSongProgress(chart, 0);
  meter.max = initial.duration;
  meter.value = 0;
  fill.style.transform = 'scaleX(0)';
  meter.setAttribute('aria-valuetext', initial.valueText);
  rail.style.setProperty(
    '--twilight-position',
    `${initial.twilightFraction * 100}%`,
  );
  let valueText = initial.valueText;
  let disposed = false;
  return {
    render(transportTime: number): void {
      if (disposed) return;
      const progress = getSongProgress(chart, transportTime);
      if (meter.value !== progress.elapsed) {
        meter.value = progress.elapsed;
        fill.style.transform = `scaleX(${progress.fraction})`;
      }
      if (valueText !== progress.valueText) {
        valueText = progress.valueText;
        meter.setAttribute('aria-valuetext', valueText);
      }
    },
    destroy(): void {
      disposed = true;
    },
  };
}
