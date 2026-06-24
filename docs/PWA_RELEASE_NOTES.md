# PWA Release Notes

Version scope: current Phase 6 engineering gate baseline.

## Release summary

This release introduces a production-ready PWA foundation for `llama-cpp-capacitor` using an isomorphic provider pattern, worker-based execution, OPFS-backed model lifecycle, and a Rust+Wasm runtime bridge with optional embedded `llama.cpp` linkage.

## Highlights

- Added a shared `LlmProvider` contract across native and web providers.
- Added web worker inference orchestration and typed worker protocol.
- Added OPFS model persistence (`download`, `load`, `reuse`, `remove`) with manifest metadata tracking.
- Added scheduler + admission controls with `MAX_MODELS=5` and structured memory-limit errors.
- Added token streaming flow through the web worker path for incremental generation events.
- Added multi-model parallel orchestration tests for concurrent stream/embed workflows.

## Wasm build and runtime changes

- Added standard wasm build path via `wasm-pack` (`wasm32-unknown-unknown`).
- Added embedded `llama.cpp` build path targeting `wasm32-unknown-emscripten`.
- Rust<->JavaScript boundary uses `wasm-bindgen` wrappers for data conversion and runtime glue.
- Runtime artifacts are normalized to:
  - `dist/wasm/llama_engine.js`
  - `dist/wasm/llama_engine.wasm`

## Validation baseline

- PWA smoke tests: `4 suites / 16 tests passing`.
- Release gate command: `npm run release:gate:pwa`.
- Gate coverage includes:
  - TypeScript contract compile check.
  - PWA smoke suites.
  - Standard wasm build.
  - Embedded wasm build.
  - Runtime asset staging.

## Migration notes for web/PWA consumers

- Prefer importing provider interfaces from package exports in `src/index.ts`.
- Use `WebProvider` only through the shared `LlmProvider` contract where possible.
- Ensure your hosting pipeline serves `dist/wasm/llama_engine.js` and `dist/wasm/llama_engine.wasm`.
- If embedding `llama.cpp` for web runtime, use the `build:wasm:embed` path.
- Model selection remains user-driven; no default internal model is auto-loaded.

### Downstream import migration

Replace app-local shim imports (for example `llamaCppWebImports.ts`) with package-root imports:

```ts
// Before (app-local shim)
import { WebProvider, createProvider } from './llamaCppWebImports';
import { ensureModelInOpfs, getManifestEntry } from './llamaCppWebImports';
```

```ts
// After (published package exports)
import { WebProvider, createProvider } from 'llama-cpp-capacitor';
import { ensureModelInOpfs, getManifestEntry } from 'llama-cpp-capacitor';
```

Wasm runtime assets are available via package subpath exports when needed:

```ts
import wasmWrapperUrl from 'llama-cpp-capacitor/wasm/llama_engine.js';
import wasmBinaryUrl from 'llama-cpp-capacitor/wasm/llama_engine.wasm';
```

## Compatibility notes

- Native (iOS/Android) and web paths share contract behavior but differ in runtime internals.
- Embedded wasm builds currently rely on Emscripten toolchain availability.
- Browser storage and memory constraints can vary; scheduler/admission guards remain enforced.

## Follow-up release tasks

- Finalize downstream package sync in `annadata-app`.
- Publish artifact/version bump after pack review.
- Run staging rollout and capture telemetry before broad rollout.

