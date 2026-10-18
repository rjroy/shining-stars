#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../../..');
const MASTER = path.join(REPO, 'assets/authoring/brightvale-city/city.blend');
const EXPECTED_MASTER =
  'edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff';
const MAX_DELIVERY_BYTES = 90 * 1024 * 1024;
const workspaceArg = process.argv[2];
if (!workspaceArg) {
  throw new Error(
    'Usage: node reproduce-city.mjs /absolute/path/to/new-workspace',
  );
}
const WORK = path.resolve(workspaceArg);
if (WORK === REPO || WORK.startsWith(`${REPO}${path.sep}`))
  throw new Error('Reproduction workspace must be outside the repository');
const blender = process.env.BLENDER ?? 'blender';
const node = process.execPath;
const MIN_WORKSPACE_BYTES = 2 * 1024 * 1024 * 1024;

function run(command, args) {
  console.info('RUN', command, ...args);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}`);
}

async function hash(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

await mkdir(WORK, { recursive: false });
const dirs = Object.fromEntries(
  ['full', 'reduced', 'spatial', 'delivery', 'scratch'].map((name) => [
    name,
    path.join(WORK, name),
  ]),
);
const available = await statfs(path.dirname(WORK)).then(
  (filesystem) => filesystem.bavail * filesystem.bsize,
);
if (available < MIN_WORKSPACE_BYTES)
  throw new Error(
    `Need at least 2 GiB free for intermediate GLBs; found ${available} bytes`,
  );
for (const dir of Object.values(dirs)) await mkdir(dir);
if ((await hash(MASTER)) !== EXPECTED_MASTER)
  throw new Error('Approved native city source checksum changed');

run(blender, [
  '-b',
  MASTER,
  '--threads',
  '8',
  '--python-exit-code',
  '1',
  '--python',
  path.join(ROOT, 'produce.py'),
  '--',
  '--output-dir',
  dirs.full,
]);
run(blender, [
  '-b',
  MASTER,
  '--threads',
  '8',
  '--python-exit-code',
  '1',
  '--python',
  path.join(ROOT, 'produce_optimized.py'),
  '--',
  '--output-dir',
  dirs.reduced,
  '--scratch',
  dirs.scratch,
  '--baseline',
  path.join(dirs.full, 'city.glb'),
  '--material-map',
  path.join(dirs.full, 'material-map.json'),
]);

const config = JSON.parse(
  await readFile(path.join(ROOT, 'spatial-config.json'), 'utf8'),
);
config.source_optimized_sha256 = await hash(
  path.join(dirs.reduced, 'city-optimized.glb'),
);
config.source_batch_coverage_sha256 = await hash(
  path.join(dirs.reduced, 'batch-coverage.json'),
);
config.source_native_sha256 = await hash(MASTER);
config.full_baseline_sha256 = await hash(path.join(dirs.full, 'city.glb'));
const workConfig = path.join(dirs.scratch, 'spatial-config.json');
await writeFile(workConfig, `${JSON.stringify(config, null, 2)}\n`, {
  flag: 'wx',
});
run(blender, [
  '-b',
  '--threads',
  '8',
  '--python-exit-code',
  '1',
  '--python',
  path.join(ROOT, 'produce_spatial.py'),
  '--',
  '--output-dir',
  dirs.spatial,
  '--config',
  workConfig,
  '--optimized',
  path.join(dirs.reduced, 'city-optimized.glb'),
  '--batch-coverage',
  path.join(dirs.reduced, 'batch-coverage.json'),
  '--full-baseline',
  path.join(dirs.full, 'city.glb'),
]);

const spatial = path.join(dirs.spatial, 'city-optimized-spatial.glb');
const spatialHash = await hash(spatial);
const finalAsset = path.join(dirs.delivery, 'city-meshopt.glb');
run(node, [
  '--max-old-space-size=4096',
  path.join(ROOT, 'meshopt-compress.mjs'),
  '--write',
  '--input',
  spatial,
  '--output',
  finalAsset,
  '--expected-source-sha256',
  spatialHash,
]);
const finalStat = (await stat(finalAsset)).size;
if (finalStat > MAX_DELIVERY_BYTES)
  throw new Error(`Compressed output exceeds 90 MiB: ${finalStat} bytes`);
run(node, [
  '--max-old-space-size=4096',
  '--expose-gc',
  path.join(ROOT, 'verify-meshopt.mjs'),
  spatial,
  finalAsset,
  spatialHash,
]);
console.info(
  JSON.stringify(
    {
      status: 'PASS',
      masterSha256: EXPECTED_MASTER,
      fullBaseline: path.join(dirs.full, 'city.glb'),
      reduced: path.join(dirs.reduced, 'city-optimized.glb'),
      spatial: { path: spatial, sha256: spatialHash },
      delivery: {
        path: finalAsset,
        bytes: finalStat,
        sha256: await hash(finalAsset),
      },
      workspace: WORK,
    },
    null,
    2,
  ),
);
