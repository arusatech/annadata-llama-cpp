# PWA Release Checklist

This checklist is the release gate for the current PWA Wasm phase.

## 1) Contract and test conformance

- [x] TypeScript contract compiles (`npx tsc -p tsconfig.json --noEmit`)
- [x] PWA smoke suites pass (`npm run test:pwa:smoke`)
  - worker protocol flow tests
  - scheduler/admission policy tests
  - browser-level `WebProvider` contract tests
  - multi-model parallel orchestration tests

## 2) Wasm build outputs

- [x] Standard wasm build passes (`npm run build:wasm`)
- [x] Embedded llama.cpp wasm build passes (`npm run build:wasm:embed`)
- [x] Runtime assets copied (`npm run build:wasm:assets`)
- [x] Runtime entrypoints present:
  - `dist/wasm/llama_engine.js`
  - `dist/wasm/llama_engine.wasm`

## 3) One-command release gate

- [x] `npm run release:gate:pwa` passes end-to-end
  - runs typecheck
  - runs PWA smoke tests
  - runs both wasm build variants
  - copies runtime assets

## 4) Downstream package sync

- [x] Bump package version for release candidate (`0.2.0-rc.0`)
- [x] Run `npm pack --dry-run` and review included files
- [ ] Publish/package internal artifact
- [ ] Update downstream app dependency (`annadata-app`)
- [ ] Verify downstream app uses latest wasm artifacts and provider exports

Latest dry-run snapshot (`llama-cpp-capacitor@0.2.0-rc.0`):

- tarball: `llama-cpp-capacitor-0.2.0-rc.0.tgz`
- package size: `23.0 MB`
- unpacked size: `97.1 MB`
- total files: `196`
- shasum: `fb1ff2b17fb585cf18448542a872dd1264fe65bd`

## 5) Release notes

- [x] Add user-facing release summary (`docs/PWA_RELEASE_NOTES.md`)
- [x] Add migration notes for web/PWA consumers (`docs/PWA_RELEASE_NOTES.md`)
- [x] Note embed pipeline target (`wasm32-unknown-emscripten`) and `wasm-bindgen` bridge usage (`docs/PWA_RELEASE_NOTES.md`)

