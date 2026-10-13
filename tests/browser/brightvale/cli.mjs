import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? 'all';
const commands = {
  normal: ['gameplay.mjs', 'normal'],
  hard: ['gameplay.mjs', 'hard'],
  responsive: ['responsive.mjs'],
};
const sequence = mode === 'all' ? ['normal', 'hard', 'responsive'] : [mode];

if (sequence.some((name) => !(name in commands))) {
  throw new Error(
    'Usage: npm run test:brightvale:browser -- [normal|hard|responsive|all]',
  );
}

for (const name of sequence) {
  const [script, ...args] = commands[name];
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
