import type { ChartConfig } from '../game/chart';
import type { GameSnapshot } from '../game/game';
import { getDifficultyProfile } from '../game/game-balance';

export interface ResourceBarValue {
  readonly value: number;
  readonly maximum: number;
  readonly fraction: number;
}

export interface ResourceBars {
  readonly audience: ResourceBarValue;
  readonly personal: ResourceBarValue;
  readonly twilight: ResourceBarValue;
}

function bar(value: number, maximum: number): ResourceBarValue {
  const safeMaximum = Math.max(0, maximum);
  const fraction =
    safeMaximum === 0 ? 0 : Math.min(1, Math.max(0, value / safeMaximum));
  return { value, maximum: safeMaximum, fraction };
}

/** Derive HUD ranges from this run's chart, difficulty, and configured enemy strength. */
export function getResourceBars(
  chart: ChartConfig,
  game: GameSnapshot,
): ResourceBars {
  const audienceNoteCount = chart.notes.filter(
    (note) => note.time < chart.twilightAt,
  ).length;
  const maximumRenown =
    audienceNoteCount * getDifficultyProfile(game.difficulty).audience.perfect;
  return {
    audience: bar(game.renown, maximumRenown),
    personal: bar(game.personalStrength, game.renown),
    twilight: bar(game.twilightStrength, chart.twilightStrength),
  };
}
