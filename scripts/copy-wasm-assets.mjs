import { access, mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const wasmPkgDir = resolve(root, 'src-rust', 'pkg');
const targetDir = resolve(root, 'dist', 'wasm');

// llama_engine.js + llama_engine.wasm are the public entrypoints.
// llama_engine_emscripten.mjs is the Emscripten JS runtime loaded by the shim.
// The _emscripten.wasm is already represented by llama_engine.wasm (same file).
const files = [
  'llama_engine.js',
  'llama_engine.wasm',
  'llama_engine.d.ts',
  'llama_engine_emscripten.mjs',
  'package.json',
];

// Fix #16: assert that wasm-pack output exists before attempting the copy so a
// cold clone produces a clear error rather than silently writing an empty dist/wasm/.
try {
  await access(wasmPkgDir);
} catch {
  console.error(
    `[copy-wasm-assets] ERROR: '${wasmPkgDir}' does not exist.\n` +
    `Run 'npm run build:wasm' first.`,
  );
  process.exit(1);
}

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
for (const file of files) {
  await copyFile(resolve(wasmPkgDir, file), resolve(targetDir, file));
}

console.log(`Copied wasm assets from ${wasmPkgDir} to ${targetDir}`);
console.log('Public entrypoint : dist/wasm/llama_engine.js');
console.log('Wasm binary       : dist/wasm/llama_engine.wasm');
console.log('Emscripten runtime: dist/wasm/llama_engine_emscripten.mjs');
