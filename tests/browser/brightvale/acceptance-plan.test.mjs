import assert from 'node:assert/strict';
import test from 'node:test';
import { createAcceptancePlan } from './acceptance-plan.mjs';

const songs = [
  { id: 'the-first-shining-star', difficulties: ['easy', 'normal', 'hard'] },
  { id: 'never-again', difficulties: ['easy', 'normal', 'hard'] },
  { id: 'beautiful-disaster', difficulties: ['easy', 'normal', 'hard'] },
];

test('smoke plan selects three real chart variants across songs and difficulties', () => {
  const plan = createAcceptancePlan(songs, 'smoke');
  assert.equal(plan.mode, 'smoke');
  assert.deepEqual(plan.runs, [
    { songId: 'the-first-shining-star', difficulty: 'normal' },
    { songId: 'never-again', difficulty: 'hard' },
    { songId: 'beautiful-disaster', difficulty: 'easy' },
  ]);
});

test('exhaustive plan includes every song/difficulty pair exactly once', () => {
  const plan = createAcceptancePlan(songs, 'exhaustive');
  assert.equal(plan.runs.length, 9);
  assert.equal(
    new Set(
      plan.runs.map(({ songId, difficulty }) => `${songId}/${difficulty}`),
    ).size,
    9,
  );
});

test('rejects unavailable smoke variants instead of falling back to another chart', () => {
  assert.throws(
    () => createAcceptancePlan(songs.slice(1), 'smoke'),
    /unavailable: the-first-shining-star\/normal/,
  );
  assert.throws(
    () =>
      createAcceptancePlan(
        [{ id: 'the-first-shining-star', difficulties: ['hard'] }],
        'smoke',
      ),
    /unavailable/,
  );
});
