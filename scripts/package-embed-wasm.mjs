import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const engineName = 'llama_engine';
const wasmPkgDir = resolve(root, 'src-rust', 'pkg');
const gluePath = resolve(wasmPkgDir, 'library_bindgen.js');
const wasmBgPath = resolve(wasmPkgDir, `${engineName}_bg.wasm`);
const wasmPath = resolve(wasmPkgDir, `${engineName}.wasm`);
const jsPath = resolve(wasmPkgDir, `${engineName}.js`);
const dtsPath = resolve(wasmPkgDir, `${engineName}.d.ts`);
const packageJsonPath = resolve(wasmPkgDir, 'package.json');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const requireFile = async (path, label) => {
  try {
    await readFile(path);
  } catch {
    fail(`Missing ${label} at ${path}`);
  }
};

await requireFile(wasmBgPath, 'embedded wasm-bindgen binary');

const bindgenOutDir = await mkdtemp(join(tmpdir(), 'llama-embed-wasm-'));
const bindgen = spawnSync(
  'wasm-bindgen',
  [
    '--target',
    'web',
    '--out-dir',
    bindgenOutDir,
    '--out-name',
    engineName,
    wasmBgPath,
  ],
  { encoding: 'utf8' },
);

if (bindgen.status !== 0) {
  console.error(bindgen.stdout);
  console.error(bindgen.stderr);
  fail('wasm-bindgen failed to generate browser ESM wrapper for embedded wasm');
}

const generatedJsPath = join(bindgenOutDir, `${engineName}.js`);
const generatedWasmBgPath = join(bindgenOutDir, `${engineName}_bg.wasm`);
const generatedDtsPath = join(bindgenOutDir, `${engineName}.d.ts`);

await requireFile(generatedJsPath, 'generated wasm JS wrapper');
await requireFile(generatedWasmBgPath, 'generated wasm binary');

await copyFile(generatedWasmBgPath, wasmPath);
let jsSource = await readFile(generatedJsPath, 'utf8');
jsSource = jsSource.replaceAll(`${engineName}_bg.wasm`, `${engineName}.wasm`);
await writeFile(jsPath, jsSource);
await copyFile(generatedDtsPath, dtsPath);

const packageJson = {
  name: engineName,
  type: 'module',
  description: 'Embedded llama.cpp wasm runtime for llama-cpp-capacitor web/PWA',
  version: '0.1.0',
  license: 'MIT',
  files: [`${engineName}.wasm`, `${engineName}.js`, `${engineName}.d.ts`],
  main: `${engineName}.js`,
  types: `${engineName}.d.ts`,
  sideEffects: [],
};

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

await requireFile(jsPath, 'embedded wasm JS wrapper');
await requireFile(wasmPath, 'embedded wasm binary');
await requireFile(dtsPath, 'embedded TypeScript definitions');
await requireFile(packageJsonPath, 'embedded package manifest');

const wasmBytes = await readFile(wasmPath);
if (wasmBytes.byteLength === 0) {
  fail(`Embedded wasm binary is empty at ${wasmPath}`);
}

const jsBytes = await readFile(jsPath, 'utf8');
if (!jsBytes.includes(`${engineName}.wasm`)) {
  fail(`Embedded JS wrapper does not reference ${engineName}.wasm`);
}

await rm(bindgenOutDir, { recursive: true, force: true });
await rm(gluePath, { force: true });
await rm(wasmBgPath, { force: true });
await rm(resolve(wasmPkgDir, `${engineName}_bg.wasm.d.ts`), { force: true });
await rm(resolve(wasmPkgDir, `${engineName}_emscripten.mjs`), { force: true });
await rm(resolve(wasmPkgDir, `${engineName}_emscripten.wasm`), { force: true });

console.log('Wasm package ready:');
console.log(`  - ${jsPath}`);
console.log(`  - ${wasmPath}`);
console.log(`  - ${dtsPath}`);
