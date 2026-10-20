import { isDifficulty, type Difficulty } from '../game/game-balance';

export interface StoredPersonalBestScore {
  readonly songId: string;
  readonly difficulty: Difficulty;
  readonly score: number;
}

export interface PersonalBestScoreSnapshot {
  readonly scores: ReadonlyMap<string, ReadonlyMap<Difficulty, number>>;
}

export interface PersonalBestScoreResult {
  /** Null means this song/difficulty has no recorded result yet. */
  readonly previousBest: number | null;
  readonly best: number;
  readonly isNewBest: boolean;
}

export interface PersonalBestScoreStore {
  snapshot(): PersonalBestScoreSnapshot;
  getBest(songId: string, difficulty: Difficulty): number | null;
  recordCompletedScore(
    songId: string,
    difficulty: Difficulty,
    score: number,
  ): PersonalBestScoreResult;
}

export function personalBestScoreKey(
  songId: string,
  difficulty: Difficulty,
): string {
  return JSON.stringify([songId, difficulty]);
}

export function validateCompletedScore(
  songId: string,
  difficulty: unknown,
  score: number,
): asserts difficulty is Difficulty {
  if (
    songId.trim() === '' ||
    !isDifficulty(difficulty) ||
    !Number.isFinite(score) ||
    score < 0
  ) {
    throw new TypeError(
      'Completed score must have a song ID, difficulty, and finite nonnegative score.',
    );
  }
}

export function copyPersonalBestScores(
  scores: ReadonlyMap<string, ReadonlyMap<Difficulty, number>>,
): Map<string, Map<Difficulty, number>> {
  return new Map(
    [...scores].map(([songId, byDifficulty]) => [
      songId,
      new Map(byDifficulty),
    ]),
  );
}

export function flattenPersonalBestScores(
  scores: ReadonlyMap<string, ReadonlyMap<Difficulty, number>>,
): StoredPersonalBestScore[] {
  const records: StoredPersonalBestScore[] = [];
  for (const [songId, byDifficulty] of scores) {
    for (const [difficulty, score] of byDifficulty) {
      records.push({ songId, difficulty, score });
    }
  }
  return records;
}
