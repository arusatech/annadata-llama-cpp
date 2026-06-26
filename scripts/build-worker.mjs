import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist/workers');
const outfile = resolve(outDir, 'llm.worker.js');

mkdirSync(outDir, { recursive: true });

execSync(
  [
    'npx --yes esbuild',
    'src/workers/llm.worker.ts',
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2020',
    `--outfile=${outfile}`,
    '--sourcemap',
    '--log-level=warning',
  ].join(' '),
  { cwd: root, stdio: 'inherit' },
);

console.log(`Built worker: ${outfile}`);
