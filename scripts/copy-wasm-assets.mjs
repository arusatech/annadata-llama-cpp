import { mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const wasmPkgDir = resolve(root, 'src-rust', 'pkg');
const targetDir = resolve(root, 'dist', 'wasm');
const files = [
  'llama_engine.js',
  'llama_engine.wasm',
  'llama_engine.d.ts',
  'package.json',
];

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
for (const file of files) {
  await copyFile(resolve(wasmPkgDir, file), resolve(targetDir, file));
}

console.log(`Copied wasm assets from ${wasmPkgDir} to ${targetDir}`);
console.log('Expected runtime entrypoints: dist/wasm/llama_engine.js and dist/wasm/llama_engine.wasm');

