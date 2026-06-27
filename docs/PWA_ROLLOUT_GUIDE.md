# PWA Rollout Guide

This guide describes how to validate and roll out the PWA Wasm runtime safely.

## Pre-release validation

Run the full release gate:

```bash
npm run release:gate:pwa
```

Expected result:

- all checks pass
- wasm artifacts are present in `dist/wasm`

## Artifact expectations¬

The web runtime consumes:

- `dist/wasm/llama_engine.js`
- `dist/wasm/llama_engine.wasm`

These are produced by:

- standard path: `npm run build:wasm`
- embedded path: `npm run build:wasm:embed`
- asset copy: `npm run build:wasm:assets`

## Runtime model

- Worker bridge path: `src/workers/llm.worker.ts`
- Browser provider path: `src/isomorphic/provider.web.ts`
- Rust bridge path: `src-rust/src/lib.rs`
- C/C++ embed compilation path: `src-rust/build.rs`

## Deployment recommendations

1. Deploy to internal staging first.
2. Validate:
   - model load/unload lifecycle
   - stream token emission
   - embed response shape
   - parallel stream/embed across multiple model IDs
3. Roll out to a small production cohort.
4. Monitor errors and memory pressure metrics.
5. Expand rollout after stability window.

## Rollback strategy

If a release regresses:

1. Pin downstream app to previous package version.
2. Revert wasm artifact update in deployment bundle.
3. Keep smoke suite green before attempting re-release.

