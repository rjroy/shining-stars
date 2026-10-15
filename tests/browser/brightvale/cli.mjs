import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const [mode = 'all', ...arguments_] = process.argv.slice(2);
const commands = {
  normal: ['gameplay.mjs', 'the-first-shining-star', 'normal'],
  responsive: ['responsive.mjs'],
};
const sequence =
  mode === 'all'
    ? [['normal'], ['responsive']]
    : mode === 'gameplay'
      ? [['gameplay', ...arguments_]]
      : [[mode]];

if (
  sequence.some(([name]) => !(name in commands) && name !== 'gameplay') ||
  (mode === 'gameplay' && arguments_.length !== 2)
) {
  throw new Error(
    'Usage: npm run test:brightvale:browser -- [normal|responsive|all|gameplay <song-id> <easy|normal|hard>]',
  );
}

for (const [name, ...runArgs] of sequence) {
  const [script, ...args] =
    name === 'gameplay' ? ['gameplay.mjs', ...runArgs] : commands[name];
  const child = spawn(
    process.execPath,
    [path.join(directory, script), ...args],
    {
      stdio: 'inherit',
      env: { ...process.env, VITE_SONG_VOLUME: '0' },
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      resolve(code ?? (signal === null ? 1 : 1)),
    );
  });
  if (exitCode !== 0) process.exit(exitCode);
}
