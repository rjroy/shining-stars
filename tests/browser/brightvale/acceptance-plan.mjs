const SMOKE_CASES = [
  { songId: 'the-first-shining-star', difficulty: 'normal' },
  { songId: 'never-again', difficulty: 'hard' },
  { songId: 'beautiful-disaster', difficulty: 'easy' },
];

export function createAcceptancePlan(songs, mode = 'smoke') {
  if (mode !== 'smoke' && mode !== 'exhaustive') {
    throw new TypeError(`Unknown acceptance mode '${mode}'.`);
  }
  if (!Array.isArray(songs)) throw new TypeError('Songs must be an array.');
  const byId = new Map(songs.map((song) => [song.id, song]));
  if (byId.size !== songs.length)
    throw new TypeError('Song IDs must be unique.');

  const runs =
    mode === 'exhaustive'
      ? songs.flatMap((song) =>
          song.difficulties.map((difficulty) => ({
            songId: song.id,
            difficulty,
          })),
        )
      : SMOKE_CASES.map((run) => ({ ...run }));
  for (const run of runs) {
    const song = byId.get(run.songId);
    if (song === undefined || !song.difficulties.includes(run.difficulty)) {
      throw new TypeError(
        `Acceptance chart is unavailable: ${run.songId}/${run.difficulty}.`,
      );
    }
  }
  return Object.freeze({
    mode,
    runs: Object.freeze(runs.map((run) => Object.freeze(run))),
  });
}

export const SMOKE_ACCEPTANCE_CASES = Object.freeze(
  SMOKE_CASES.map((run) => Object.freeze({ ...run })),
);
