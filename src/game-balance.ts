import rawDifficultyProfiles from '../data/charts/difficulty-profiles.json';

export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

type OutcomeValues = Readonly<Record<'perfect' | 'good' | 'miss', number>>;

export interface DifficultyProfile {
  readonly timing: {
    readonly perfectWindowSeconds: number;
    readonly goodWindowSeconds: number;
  };
  readonly audience: OutcomeValues;
  readonly twilight: Readonly<
    Record<
      'perfect' | 'good' | 'miss',
      { readonly personalCost: number; readonly damage: number }
    >
  >;
}

interface RawOutcomeValues {
  readonly perfect: number;
  readonly good: number;
  readonly miss: number;
}

interface RawTwilightValues {
  readonly perfect: { readonly personal_cost: number; readonly damage: number };
  readonly good: { readonly personal_cost: number; readonly damage: number };
  readonly miss: { readonly personal_cost: number; readonly damage: number };
}

interface RawDifficultyProfile {
  readonly timing: {
    readonly perfect_ms: number;
    readonly good_ms: number;
  };
  readonly audience: RawOutcomeValues;
  readonly twilight: RawTwilightValues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(
      `Difficulty profile ${name} must be finite and non-negative.`,
    );
  }
  return value;
}

function parseProfile(raw: unknown, difficulty: Difficulty): DifficultyProfile {
  if (
    !isRecord(raw) ||
    !isRecord(raw.timing) ||
    !isRecord(raw.audience) ||
    !isRecord(raw.twilight)
  ) {
    throw new TypeError(
      `Difficulty profile ${difficulty} has an invalid shape.`,
    );
  }

  const timing = raw.timing as unknown as RawDifficultyProfile['timing'];
  const audience = raw.audience as unknown as RawOutcomeValues;
  const twilight = raw.twilight as unknown as RawTwilightValues;
  const perfectWindowMilliseconds = finiteNonNegative(
    timing.perfect_ms,
    `${difficulty}.timing.perfect_ms`,
  );
  const goodWindowMilliseconds = finiteNonNegative(
    timing.good_ms,
    `${difficulty}.timing.good_ms`,
  );
  if (
    perfectWindowMilliseconds <= 0 ||
    goodWindowMilliseconds < perfectWindowMilliseconds
  ) {
    throw new TypeError(
      `Difficulty profile ${difficulty} has invalid timing windows.`,
    );
  }

  const parsedAudience = Object.freeze({
    perfect: finiteNonNegative(
      audience.perfect,
      `${difficulty}.audience.perfect`,
    ),
    good: finiteNonNegative(audience.good, `${difficulty}.audience.good`),
    miss: finiteNonNegative(audience.miss, `${difficulty}.audience.miss`),
  });
  const parsedTwilight = Object.freeze({
    perfect: Object.freeze({
      personalCost: finiteNonNegative(
        twilight.perfect?.personal_cost,
        `${difficulty}.twilight.perfect.personal_cost`,
      ),
      damage: finiteNonNegative(
        twilight.perfect?.damage,
        `${difficulty}.twilight.perfect.damage`,
      ),
    }),
    good: Object.freeze({
      personalCost: finiteNonNegative(
        twilight.good?.personal_cost,
        `${difficulty}.twilight.good.personal_cost`,
      ),
      damage: finiteNonNegative(
        twilight.good?.damage,
        `${difficulty}.twilight.good.damage`,
      ),
    }),
    miss: Object.freeze({
      personalCost: finiteNonNegative(
        twilight.miss?.personal_cost,
        `${difficulty}.twilight.miss.personal_cost`,
      ),
      damage: finiteNonNegative(
        twilight.miss?.damage,
        `${difficulty}.twilight.miss.damage`,
      ),
    }),
  });

  return Object.freeze({
    timing: Object.freeze({
      perfectWindowSeconds: perfectWindowMilliseconds / 1000,
      goodWindowSeconds: goodWindowMilliseconds / 1000,
    }),
    audience: parsedAudience,
    twilight: parsedTwilight,
  });
}

function loadProfiles(
  raw: unknown,
): Readonly<Record<Difficulty, DifficultyProfile>> {
  if (!isRecord(raw) || !isRecord(raw.profiles)) {
    throw new TypeError(
      'Difficulty profile file must contain a profiles object.',
    );
  }
  const rawProfiles = raw.profiles;
  const keys = Object.keys(rawProfiles);
  if (
    keys.length !== DIFFICULTIES.length ||
    DIFFICULTIES.some((difficulty) => !(difficulty in rawProfiles))
  ) {
    throw new TypeError(
      'Difficulty profile file must define Easy, Normal, and Hard exactly once.',
    );
  }

  return Object.freeze({
    easy: parseProfile(rawProfiles.easy, 'easy'),
    normal: parseProfile(rawProfiles.normal, 'normal'),
    hard: parseProfile(rawProfiles.hard, 'hard'),
  });
}

export const DIFFICULTY_PROFILES = loadProfiles(rawDifficultyProfiles);

/** Compatibility view for existing consumers, backed by the shared Normal profile. */
export const GAME_BALANCE = DIFFICULTY_PROFILES.normal;

export function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === 'string' && DIFFICULTIES.includes(value as Difficulty)
  );
}

export function parseAllowedDifficulties(
  value: unknown,
): readonly Difficulty[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('allowed_difficulties must be a non-empty array.');
  }
  const seen = new Set<Difficulty>();
  const allowed: Difficulty[] = [];
  for (const candidate of value as unknown[]) {
    if (!isDifficulty(candidate)) {
      throw new TypeError(`Unknown difficulty: ${String(candidate)}.`);
    }
    if (seen.has(candidate)) {
      throw new TypeError(`Duplicate allowed difficulty: ${candidate}.`);
    }
    seen.add(candidate);
    allowed.push(candidate);
  }
  return Object.freeze(allowed);
}

export function defaultDifficulty(
  allowedDifficulties: readonly Difficulty[],
): Difficulty {
  if (allowedDifficulties.includes('normal')) return 'normal';
  const first = allowedDifficulties[0];
  if (first === undefined) {
    throw new TypeError('At least one difficulty must be allowed.');
  }
  return first;
}

export function maximumGoodWindowSeconds(
  allowedDifficulties: readonly Difficulty[],
): number {
  return Math.max(
    ...allowedDifficulties.map(
      (difficulty) => DIFFICULTY_PROFILES[difficulty].timing.goodWindowSeconds,
    ),
  );
}

export function getDifficultyProfile(
  difficulty: Difficulty,
): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty];
}
