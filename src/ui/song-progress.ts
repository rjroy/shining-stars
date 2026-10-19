import type { ChartConfig } from '../game/chart';
import {
  createRadiantMarkerMotion,
  getTwilightLabelCenter,
  type RadiantMarkerFrame,
} from './radiant-marker';

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
  const radiant = root.querySelector<HTMLElement>('[data-radiant-marker]');
  const twilightLabel = root.querySelector<HTMLElement>(
    '.song-progress-twilight-label',
  );
  if (meter === null || rail === null || fill === null || radiant === null)
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
  const motion = createRadiantMarkerMotion();
  let previousTransportTime = 0;
  let previousRun: number | undefined;
  return {
    render(transportTime: number, marker?: RadiantMarkerFrame): void {
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
      const reset =
        transportTime < previousTransportTime ||
        (previousRun !== undefined && marker?.runId !== previousRun);
      previousTransportTime = transportTime;
      previousRun = marker?.runId;
      const displayed = motion.update(
        marker?.target ?? null,
        marker?.clockTime ?? 0,
        {
          paused: marker?.paused,
          reducedMotion: marker?.reducedMotion,
          reset,
        },
      );
      if (radiant.hidden !== (displayed === null))
        radiant.hidden = displayed === null;
      const fraction =
        displayed === null
          ? null
          : Math.min(1, Math.max(0, displayed / chart.duration));
      if (fraction !== null) {
        radiant.style.left = `${fraction * 100}%`;
        radiant.classList.toggle('is-attained', marker?.achieved === true);
        const targetText = String(marker?.target);
        if (radiant.getAttribute('data-target-time') !== targetText)
          radiant.setAttribute('data-target-time', targetText);
        const description = `${marker?.achieved ? 'Radiant reached' : 'Radiant target with Perfect remaining notes'}: ${marker?.target?.toFixed(2)} seconds.`;
        if (radiant.getAttribute('aria-label') !== description)
          radiant.setAttribute('aria-label', description);
      } else if (radiant.getAttribute('data-target-time') !== null) {
        radiant.removeAttribute('data-target-time');
      }
      const width = rail.getBoundingClientRect().width;
      const labelWidth = twilightLabel?.getBoundingClientRect().width ?? 0;
      if (width > 0 && labelWidth > 0) {
        const labelCenter = getTwilightLabelCenter(
          width,
          labelWidth,
          initial.twilightFraction,
          fraction,
          radiant.getBoundingClientRect().width,
        );
        rail.style.setProperty('--twilight-label-position', `${labelCenter}px`);
      }
    },
    destroy(): void {
      disposed = true;
      motion.destroy();
    },
  };
}
