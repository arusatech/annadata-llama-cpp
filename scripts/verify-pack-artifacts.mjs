import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const MIN_EMBEDDED_WASM_BYTES = 1_000_000;

const requiredArtifacts = [
  {
    path: 'android/src/main/jniLibs/arm64-v8a/libllama-cpp-arm64.so',
    reason: 'Android native runtime binary',
  },
  {
    path: 'ios/Frameworks/llama-cpp.framework/llama-cpp',
    reason: 'iOS native framework binary',
  },
  {
    path: 'dist/wasm/llama_engine.js',
    reason: 'PWA wasm JavaScript wrapper',
  },
  {
    path: 'dist/wasm/llama_engine.wasm',
    reason: 'PWA wasm binary',
    minBytes: MIN_EMBEDDED_WASM_BYTES,
  },
];

const missing = [];
const invalid = [];

for (const artifact of requiredArtifacts) {
  const absolutePath = resolve(root, artifact.path);
  try {
    await access(absolutePath, constants.R_OK);
  } catch {
    missing.push(artifact);
    continue;
  }

  if (artifact.minBytes != null) {
    const { size } = await stat(absolutePath);
    if (size < artifact.minBytes) {
      invalid.push({
        ...artifact,
        size,
      });
    }
  }
}

if (missing.length > 0) {
  console.error('Packaging guard failed: required artifacts are missing.');
  for (const artifact of missing) {
    console.error(`- ${artifact.path} (${artifact.reason})`);
  }
  console.error('');
  console.error('Run `npm run build:package` and retry packaging.');
  process.exit(1);
}

if (invalid.length > 0) {
  console.error('Packaging guard failed: wasm binary looks like a scaffold build.');
  for (const artifact of invalid) {
    console.error(
      `- ${artifact.path} is ${artifact.size} bytes (expected at least ${artifact.minBytes} for embedded llama.cpp)`,
    );
  }
  console.error('');
  console.error('Run `npm run build:pwa` to rebuild embedded wasm assets.');
  process.exit(1);
}

console.log('Packaging guard passed: native + PWA artifacts are present.');
