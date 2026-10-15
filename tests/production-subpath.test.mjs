import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateProductionBuild } from '../scripts/validate-production-subpath.mjs';

async function withBuildFixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shining-stars-build-'));
  try {
    await mkdir(path.join(directory, 'assets'));
    await writeFile(
      path.join(directory, 'index.html'),
      '<script type="module" src="/shining-stars/assets/main.js?v=1#entry"></script>',
    );
    await writeFile(path.join(directory, 'assets/main.js'), '');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('validates prefixed JS entries and existing media assets', async () => {
  await withBuildFixture(async (directory) => {
    await writeFile(path.join(directory, 'assets/model.glb'), 'model');
    await writeFile(path.join(directory, 'assets/The Game.mp3'), 'audio');
    await writeFile(path.join(directory, "assets/The Game's Song.mp3"), 'audio');
    await writeFile(
      path.join(directory, 'assets/main.js'),
      `const model = \`/shining-stars/assets/model.glb\`;
        const song = "/shining-stars/assets/The Game.mp3";
        const quotedSong = '/shining-stars/assets/The Game\\'s Song.mp3';`,
    );
    const result = await validateProductionBuild(directory);
    assert.equal(result.entryReferences, 1);
    assert.equal(result.bundlesScanned, 1);
    assert.deepEqual(result.assetReferences, { model: 1, texture: 0, audio: 2 });
  });
});

test('rejects a media asset URL rooted outside the configured prefix', async () => {
  await withBuildFixture(async (directory) => {
    await writeFile(path.join(directory, 'assets/The Game.mp3'), 'audio');
    await writeFile(
      path.join(directory, 'assets/main.js'),
      'const song = "/assets/The Game.mp3";',
    );
    await assert.rejects(
      validateProductionBuild(directory),
      /root\/out-of-prefix asset reference/,
    );
  });
});

test('rejects a prefixed media URL whose emitted asset is missing', async () => {
  await withBuildFixture(async (directory) => {
    await writeFile(
      path.join(directory, 'assets/main.js'),
      'const model = "/shining-stars/assets/missing.glb";',
    );
    await assert.rejects(validateProductionBuild(directory), /references missing asset/);
  });
});

test('rejects a missing asset reference containing spaces', async () => {
  await withBuildFixture(async (directory) => {
    await writeFile(
      path.join(directory, 'assets/main.js'),
      'const song = "/shining-stars/assets/The Missing Song.mp3";',
    );
    await assert.rejects(validateProductionBuild(directory), /references missing asset/);
  });
});

test('decodes percent-encoded spaces and Unicode before checking emitted files', async () => {
  await withBuildFixture(async (directory) => {
    await writeFile(path.join(directory, 'assets/Grýla’s Lullaby.mp3'), 'audio');
    await writeFile(
      path.join(directory, 'assets/main.js'),
      'const song = "/shining-stars/assets/Gr%C3%BDla%E2%80%99s%20Lullaby.mp3";',
    );
    const result = await validateProductionBuild(directory);
    assert.equal(result.assetReferences.audio, 1);
  });
});
