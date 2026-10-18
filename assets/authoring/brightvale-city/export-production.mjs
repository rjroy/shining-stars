import { mkdtemp, rm, mkdir, stat, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
let output = resolve(root, 'test-results/brightvale-city/city-candidate.glb');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
  else throw new Error(`Unknown argument: ${args[i]}`);
}
await mkdir(dirname(output), { recursive: true });
const temp = await mkdtemp(join(dirname(output), '.brightvale-export-'));
const raw = join(temp, 'city-uncompressed.glb');
const candidate = join(temp, 'city-candidate.glb');
const run = (command, commandArgs) => new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
});
try {
  const blender = process.env.BLENDER ?? 'blender';
  const source = join(here, 'production.blend');
  await run(blender, ['-b', source, '--python', join(here, 'export.py'), '--', raw]);
  await run(process.execPath, [join(here, 'compress-glb.mjs'), raw, candidate]);
  const bytes = (await stat(candidate)).size;
  if (bytes >= 100 * 1024 * 1024) throw new Error(`Candidate is ${bytes} bytes; delivery limit is 100 MiB`);
  await rename(candidate, output);
  console.log(`Candidate ready: ${output} (${bytes} bytes). Review before replacing shipped asset.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
