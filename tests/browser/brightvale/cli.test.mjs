import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

test('browser CLI rejects the unsupported Hard run before launching a runner', () => {
  const result = spawnSync(process.execPath, [cli, 'hard'], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /normal\|responsive\|all/);
  assert.match(result.stderr, /hard is not currently supported/);
  assert.doesNotMatch(result.stdout, /Starting|Chromium|Vite/);
});
