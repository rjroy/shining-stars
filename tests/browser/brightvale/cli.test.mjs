import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

test('browser CLI rejects malformed mode arguments before launching a runner', () => {
  const result = spawnSync(process.execPath, [cli, 'gameplay', 'never-again'], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gameplay <song-id> <easy\|normal\|hard>/);
  assert.doesNotMatch(result.stdout, /Starting|Chromium|Vite/);
});
