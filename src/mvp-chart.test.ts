import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateChart } from './chart';
import { MVP_CHART } from './mvp-chart';

interface OnsetArtifactNote {
  readonly source_onset_index: number;
  readonly source_time: number;
  readonly relative_time: number;
  readonly lane: number;
}

interface OnsetArtifact {
  readonly source: { readonly path: string; readonly sha256: string };
  readonly source_sha256: string;
  readonly config: {
    readonly source_start: number;
    readonly duration: number;
    readonly twilight_strength: number;
    readonly boundary: number;
    readonly stride: number;
    readonly minimum_delta_ms: number;
    readonly lane_pattern: readonly number[];
  };
  readonly onsets: readonly number[];
  readonly notes: readonly OnsetArtifactNote[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOnsetArtifact(): OnsetArtifact {
  const artifactPath = resolve(
    process.cwd(),
    'data/charts/the-first-shining-star.beats.json',
  );
  const raw: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'));
  if (
    !isRecord(raw) ||
    !isRecord(raw.source) ||
    !isRecord(raw.config) ||
    typeof raw.source.path !== 'string' ||
    typeof raw.source.sha256 !== 'string' ||
    typeof raw.source_sha256 !== 'string' ||
    !Array.isArray(raw.onsets) ||
    !raw.onsets.every((onset: unknown) => typeof onset === 'number') ||
    !Array.isArray(raw.notes) ||
    !raw.notes.every(
      (note: unknown) =>
        isRecord(note) &&
        typeof note.source_onset_index === 'number' &&
        typeof note.source_time === 'number' &&
        typeof note.relative_time === 'number' &&
        typeof note.lane === 'number',
    ) ||
    typeof raw.config.source_start !== 'number' ||
    typeof raw.config.duration !== 'number' ||
    typeof raw.config.twilight_strength !== 'number' ||
    typeof raw.config.boundary !== 'number' ||
    typeof raw.config.stride !== 'number' ||
    typeof raw.config.minimum_delta_ms !== 'number' ||
    !Array.isArray(raw.config.lane_pattern) ||
    !raw.config.lane_pattern.every((lane: unknown) => typeof lane === 'number')
  ) {
    throw new Error('Onset reference artifact has an invalid schema');
  }
  return raw as unknown as OnsetArtifact;
}

describe('MVP onset-detected chart', () => {
  it('satisfies chart timing guards without claiming musical verification', () => {
    expect(validateChart(MVP_CHART)).toEqual([]);
    expect(MVP_CHART.notes.at(-1)?.time).toBeLessThanOrEqual(
      MVP_CHART.duration - 0.85,
    );
  });

  it('matches selected full-track onset provenance and the source audio', () => {
    const artifact = readOnsetArtifact();
    const sourcePath = resolve(process.cwd(), artifact.source.path);
    const actualSourceHash = createHash('sha256')
      .update(readFileSync(sourcePath))
      .digest('hex');

    expect(artifact.source.sha256).toBe(actualSourceHash);
    expect(artifact.source_sha256).toBe(actualSourceHash);
    expect(MVP_CHART.sourceStart).toBe(artifact.config.source_start);
    expect(MVP_CHART.duration).toBe(artifact.config.duration);
    expect(MVP_CHART.twilightStrength).toBe(artifact.config.twilight_strength);
    expect(MVP_CHART.twilightAt).toBe(artifact.config.boundary);
    expect(artifact.config.minimum_delta_ms).toBe(64);
    expect(MVP_CHART.notes).toHaveLength(artifact.notes.length);

    artifact.notes.forEach((reference, index) => {
      const chartNote = MVP_CHART.notes[index];
      expect(chartNote.time).toBe(reference.relative_time);
      expect(chartNote.lane).toBe(reference.lane);
      expect(
        Math.abs(
          MVP_CHART.sourceStart + chartNote.time - reference.source_time,
        ),
      ).toBeLessThanOrEqual(1e-6);
      expect(artifact.onsets[reference.source_onset_index]).toBe(
        reference.source_time,
      );
    });
  });
});
