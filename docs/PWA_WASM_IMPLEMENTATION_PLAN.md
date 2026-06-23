# PWA Wasm Implementation Plan (Capacitor + Native + Web)

## Objective

Implement a single isomorphic LLM runtime for this project that:

- keeps existing high-performance native support on iOS/Android,
- adds a production-ready web/PWA fallback using Rust + Wasm + Web Worker,
- preserves one unified JavaScript API for app code,
- supports user-driven multi-model local workflows (chat, embedding, vision, audio, etc.) in parallel,
- enforces memory-aware model admission with a hard cap of 5 loaded models.

This plan is intended to be implementation-ready for immediate execution by engineering.

---

## Scope and Non-Goals

### In Scope

- Isomorphic provider abstraction and runtime routing.
- Web fallback provider backed by Rust+Wasm worker.
- OPFS model caching for large GGUF assets.
- Memory admission control and model scheduler (max 5 models).
- Streaming token output parity across providers where possible.
- Backward compatibility for existing plugin consumers.

### Out of Scope (Phase 1)

- Full feature parity for every native-only capability on web (e.g., all multimodal/TTS paths).
- Browser support guarantees for environments without required Wasm capabilities.
- Replacing existing native plugin internals beyond required integration points.

---

## Current State Summary

- Native iOS and Android multi-context lifecycle exists (`initContext`, `releaseContext`, context maps, context limit setter).
- New native in-process OpenAI-style server exists in this repo (`cap-native-server.*`) with multiple endpoints and SSE support.
- Web path currently does not execute LLM inference and throws unsupported behavior.
- Installed package in downstream app may lag repo source; release synchronization is required.

---

## Architecture Decision

Adopt an **Isomorphic Abstract Provider Pattern**:

- `NativeProvider` -> `llama-cpp-capacitor` on iOS/Android.
- `WebProvider` -> Rust+Wasm engine inside a Web Worker on browser/PWA.
- `ProviderFactory` dynamically selects provider at runtime via Capacitor platform detection.

UI and business logic interact only with one stable `LlmProvider` contract.

---

## Product Rule: User-Driven Model Selection

- The SDK/plugin must not auto-load any internal/default model.
- Model choice is entirely user/app controlled (download path, model type, load timing).
- The runtime only provides orchestration primitives: load, unload, generate, embed, stream, and memory-aware admission.
- Parallel capacity target is capped at 5 concurrently loaded model contexts/threads, subject to device memory checks.

---

## Proposed Repo Layout

```text
annadata-llama-cpp/
├── src/
│   ├── isomorphic/
│   │   ├── provider.interface.ts
│   │   ├── provider.factory.ts
│   │   ├── provider.native.ts
│   │   ├── provider.web.ts
│   │   ├── model.admission.ts
│   │   ├── model.scheduler.ts
│   │   └── errors.ts
│   ├── workers/
│   │   ├── llm.worker.ts
│   │   └── worker.protocol.ts
│   ├── storage/
│   │   ├── opfs.store.ts
│   │   └── manifest.ts
│   ├── definitions.ts              (update)
│   ├── index.ts                    (update)
│   └── web.ts                      (update)
├── src-rust/
│   ├── Cargo.toml
│   ├── build.rs
│   └── src/
│       ├── lib.rs
│       ├── ffi.rs
│       ├── engine.rs
│       ├── model.rs
│       ├── stream.rs
│       └── memory.rs
├── scripts/
│   ├── build-wasm.sh
│   └── copy-wasm-assets.mjs
├── test/pwa/
│   ├── provider.web.test.ts
│   ├── worker.protocol.test.ts
│   ├── model.admission.test.ts
│   └── scheduler.test.ts
└── docs/
    ├── PWA_PROVIDER_SPEC.md
    └── WASM_BUILD_NOTES.md
```

---

## Unified Provider Contract (Implementation Target)

Define and freeze this interface in `src/isomorphic/provider.interface.ts`:

- `initialize(opts)`
- `loadModel(opts)`
- `unloadModel(modelId)`
- `generate(req)`
- `generateStream(req, onToken)`
- `embed(req)`
- `getMemorySnapshot()`
- `health()`

Standardize:

- request/response shapes,
- token event format,
- error codes (`MODEL_LIMIT_REACHED`, `INSUFFICIENT_MEMORY`, etc.),
- feature capabilities so callers can degrade gracefully.

---

## Memory and Multi-Model Policy

### Hard Rules

- `MAX_MODELS = 5`
- load is rejected if admission policy fails.

### Admission Inputs

- model file size,
- current loaded model count,
- available/free memory snapshot,
- per-model runtime multiplier,
- reserve/safety threshold.

### Initial Policy

- estimate footprint as `modelBytes * multiplier + overhead`.
- recommend initial multiplier `1.5` (configurable).
- enforce reserve floor after admission (e.g., leave at least 20% free memory or fixed MB floor).

### Scheduling Policy (User-Defined Models)

- no model is pinned by default by the SDK,
- app may mark specific models as preferred/pinned via scheduler options,
- apply LRU unload to non-pinned models under pressure,
- keep policy generic so users can run any combination of models (e.g., VL/chat/audio/embedding) in parallel.

---

## Web/PWA Runtime Design

### Worker Pipeline

- `llm.worker.ts` owns Wasm lifecycle and model handles.
- Main thread posts commands (`INIT`, `LOAD_MODEL`, `GENERATE`, `EMBED`, `UNLOAD`).
- Worker emits:
  - token events for streaming,
  - final result event,
  - structured error event.

### OPFS Storage

- Download GGUF by stream/chunks.
- Persist in OPFS with manifest metadata.
- Track checksum, size, last used.
- Support cleanup policy under quota pressure.

---

## Rust + Wasm Build Strategy

### Core Tasks

1. `src-rust/build.rs` compiles required llama.cpp C/C++ sources via `cc`.
2. Target `wasm32-unknown-unknown` with explicit SIMD; thread mode enabled where supported.
3. Expose minimal wasm-bindgen API:
   - init
   - load/unload model
   - generate
   - embed

### Browser Constraints (Must-Haves)

- Wasm threading requires `SharedArrayBuffer`.
- `SharedArrayBuffer` requires cross-origin isolation headers (COOP/COEP).
- Define fallback mode (single-thread Wasm) when threading not available.

---

## Phase Plan and Deliverables

## Implementation Status (Current)

- ✅ Phase 0 started:
  - Added `src/isomorphic/provider.interface.ts`
  - Added `src/isomorphic/errors.ts`
- ✅ Phase 1 started:
  - Added `src/isomorphic/provider.factory.ts`
  - Added `src/isomorphic/provider.native.ts` (initial adapter scaffold)
  - Added `src/isomorphic/provider.web.ts` (explicit web placeholder with structured errors)
  - Added `src/workers/worker.protocol.ts`
  - Added `src/workers/llm.worker.ts` (placeholder worker)
  - Exported new modules from `src/index.ts`
- ✅ Baseline validation:
  - TypeScript compile check passes (`npx tsc -p tsconfig.json --noEmit`)
- ✅ Phase 2 completed (initial implementation):
  - Added admission decision metadata (`deniedBy`) in `model.admission.ts`
  - Refactored `model.scheduler.ts` into provider-independent capacity/scheduler state utility
  - Wired scheduler + memory admission checks into `provider.native.ts` load path
  - Enforced `MAX_MODELS=5` in native provider and native plugin context limit setup
  - Added structured memory override hooks (`availableMemoryBytes`, `totalMemoryBytes`, `reserveBytes`) for app-supplied telemetry
  - Added memory snapshot heuristics from `performance.memory` where available
- ✅ Phase 3 completed (initial implementation):
  - Added `src/storage/manifest.ts` for OPFS metadata persistence
  - Added `src/storage/opfs.store.ts` for model download/cache/read/remove usage
  - Wired `provider.web.ts` model lifecycle to OPFS storage APIs
  - Added explicit storage and download error handling (`STORAGE_UNAVAILABLE`, `STORAGE_IO_FAILED`, `MODEL_DOWNLOAD_FAILED`)
  - Added web provider health details for OPFS usage and runtime readiness
- 🚧 Phase 4 in progress (initial integration scaffold):
  - Upgraded worker protocol to support model buffers and typed generate payloads
  - Implemented worker request router (`INIT`, `LOAD_MODEL`, `UNLOAD_MODEL`, `GENERATE`, `EMBED`, `HEALTH`, `MEMORY`)
  - Added worker-side structured error propagation (`WASM_INIT_FAILED`, `INFERENCE_FAILED`, `MODEL_NOT_LOADED`, `INVALID_REQUEST`)
  - Wired `provider.web.ts` to worker request/response/token streaming flow
  - Added Rust/Wasm scaffold under `src-rust/` (`Cargo.toml`, `build.rs`, `lib.rs`, and module placeholders)
  - Added wasm build scripts (`scripts/build-wasm.sh`, `scripts/copy-wasm-assets.mjs`) and npm commands (`build:wasm`, `build:wasm:assets`, `build:pwa`)
  - Connected worker wasm loader to generated package entry (`llama_engine.js` + `llama_engine.wasm`)
  - Added embedded build profile using Emscripten sysroot (`build:wasm:embed`, `build:pwa:embed`)
  - Added Rust FFI bridge wiring to existing llama.cpp C wrappers (`llama_init_context`, `llama_completion`, `llama_embedding`) behind compile-time embed cfg
  - Expanded wasm embed source list to include ggml/llama/cap translation units needed for real execution path
  - Switched embedded build to `wasm32-unknown-emscripten` with `wasm-bindgen` JS generation for Rust<->JS type conversion
  - Added isolated PWA worker smoke tests (`test/pwa/worker.smoke.test.ts`) to validate request flow (`INIT`, `LOAD_MODEL`, `GENERATE`, `EMBED`, `HEALTH`, `MEMORY`) and core error path (`MODEL_NOT_LOADED`)
  - Added browser-level `WebProvider` contract smoke tests (`test/pwa/web-provider.contract.test.ts`) using test-safe worker indirection
- ⏭️ Next implementation target:
  - Validate end-to-end runtime semantics for `generate` and `embed` through browser contract tests
  - Add explicit model path and OPFS file-visibility strategy for Emscripten FS integration
  - Decide whether to keep dual-path builds (`unknown-unknown` for fallback + `emscripten` for full llama.cpp) or converge on a single web target
  - Add conformance tests for worker error/recovery scenarios

## Phase Completion Tracker

- **Phase 0: Contract and Design Freeze** — ✅ Completed  
  Provider contract and error model are implemented and exported.
- **Phase 1: Isomorphic TS Skeleton** — ✅ Completed  
  Native/web providers, factory, worker protocol, and worker bridge scaffolding are implemented.
- **Phase 2: Admission + Scheduler** — ✅ Completed  
  `MAX_MODELS=5`, admission checks, and scheduler state transitions are implemented.
- **Phase 3: OPFS and Model Lifecycle** — ✅ Completed  
  OPFS manifest/store lifecycle and error handling are implemented in web provider.
- **Phase 4: Rust+Wasm Inference Baseline** — ✅ Completed (current scope)  
  Emscripten + wasm-bindgen embed pipeline is active, worker wiring is integrated, and both standard + embedded wasm builds pass.
- **Phase 5: Streaming and RAG Parallelism** — ✅ Completed (current scope)  
  Worker streaming flow, scheduler/admission tests, browser-level `WebProvider` contract tests, and multi-model parallel orchestration tests are in place.  
  Current smoke baseline: `4 suites / 16 tests passing` via `npm run test:pwa:smoke`.
- **Phase 6: Hardening and Release** — ✅ Completed (engineering gate scope)  
  Conformance checks are automated with `npm run release:gate:pwa`, and release artifacts/checklists are documented in:
  - `docs/PWA_RELEASE_CHECKLIST.md`
  - `docs/PWA_ROLLOUT_GUIDE.md`
  - `docs/PWA_RELEASE_NOTES.md`

## Phase 0: Contract and Design Freeze (1-2 days)

Deliverables:

- `src/isomorphic/provider.interface.ts`
- `src/isomorphic/errors.ts`
- `docs/PWA_PROVIDER_SPEC.md`

Exit Criteria:

- API contract approved by app and plugin maintainers.

## Phase 1: Isomorphic TS Skeleton (2-3 days)

Deliverables:

- `provider.factory.ts`, `provider.native.ts`, `provider.web.ts` (stubbed worker bridge),
- worker protocol definitions,
- no-op/mock web inference pipeline.

Exit Criteria:

- App can run with factory-selected provider on native or web paths.

## Phase 2: Admission + Scheduler (2-3 days)

Deliverables:

- `model.admission.ts`, `model.scheduler.ts`,
- enforced max 5 models,
- memory gate integration.

Exit Criteria:

- attempted load #6 fails deterministically,
- low-memory load fails with structured error.

## Phase 3: OPFS and Model Lifecycle (3-5 days)

Deliverables:

- `opfs.store.ts`, `manifest.ts`,
- model download/cache/remove APIs in WebProvider.

Exit Criteria:

- model survives page reload from OPFS cache,
- cleanup policy tested.

## Phase 4: Rust+Wasm Inference Baseline (1-2 weeks)

Deliverables:

- `src-rust/*` baseline inference path,
- worker integration for generate/embed.

Exit Criteria:

- web provider can run one small GGUF model end-to-end.

## Phase 5: Streaming and RAG Parallelism (4-7 days)

Deliverables:

- token streaming parity improvements,
- concurrent orchestration for up to 5 user-selected models through scheduler.

Exit Criteria:

- embedding and generation can run in parallel without UI jank.

## Phase 6: Hardening and Release (1 week)

Status: ✅ Engineering release-gate complete for current scope.

Deliverables:

- conformance tests, docs, release notes,
- package synchronization checklist for downstream app.

Exit Criteria:

- native and web pass shared contract tests,
- rollout guide complete.

---

## File-by-File Backlog

### New Files

- `src/isomorphic/provider.interface.ts`  
  Owner: TS platform engineer  
  Work: define canonical interfaces and event schemas.

- `src/isomorphic/provider.factory.ts`  
  Owner: TS platform engineer  
  Work: runtime selection by platform and capability.

- `src/isomorphic/provider.native.ts`  
  Owner: plugin integration engineer  
  Work: adapter over existing native context/completion/embedding APIs.

- `src/isomorphic/provider.web.ts`  
  Owner: web runtime engineer  
  Work: worker client bridge and lifecycle management.

- `src/isomorphic/model.admission.ts`  
  Owner: systems engineer  
  Work: memory-aware pre-load admission function.

- `src/isomorphic/model.scheduler.ts`  
  Owner: systems engineer  
  Work: loaded model registry, LRU/unload policy, pinning support.

- `src/workers/worker.protocol.ts`  
  Owner: web runtime engineer  
  Work: strict message protocol types.

- `src/workers/llm.worker.ts`  
  Owner: web runtime engineer  
  Work: wasm engine orchestration in worker thread.

- `src/storage/opfs.store.ts`  
  Owner: web storage engineer  
  Work: OPFS file persistence and retrieval.

- `src/storage/manifest.ts`  
  Owner: web storage engineer  
  Work: metadata index and usage tracking.

- `src-rust/Cargo.toml`  
  Owner: Rust engineer  
  Work: crate config and wasm dependencies.

- `src-rust/build.rs`  
  Owner: Rust engineer  
  Work: compile/link llama.cpp sources for wasm target.

- `src-rust/src/lib.rs`  
  Owner: Rust engineer  
  Work: wasm-bindgen exports and error translation.

- `src-rust/src/engine.rs`  
  Owner: Rust engineer  
  Work: model state, infer loop entry points.

- `src-rust/src/model.rs`  
  Owner: Rust engineer  
  Work: load/unload model and memory ownership.

- `src-rust/src/stream.rs`  
  Owner: Rust engineer  
  Work: token emission bridging to worker events.

- `src-rust/src/memory.rs`  
  Owner: Rust engineer  
  Work: memory stats and safeguards.

- `scripts/build-wasm.sh`  
  Owner: build engineer  
  Work: repeatable wasm build command chain.

- `scripts/copy-wasm-assets.mjs`  
  Owner: build engineer  
  Work: move wasm outputs into web assets for bundling/runtime.

- `test/pwa/*.test.ts`  
  Owner: QA + TS engineers  
  Work: protocol, scheduler, admission, provider tests.

### Existing File Updates

- `src/definitions.ts`  
  Add provider-facing types and web capability notes.

- `src/index.ts`  
  Export new isomorphic provider APIs; preserve existing exports.

- `src/web.ts`  
  Replace unsupported stubs for new provider entry path.

- `package.json`  
  Add wasm build/test scripts and CI commands.

- `rollup.config.mjs`  
  Include worker/wasm asset copy and packaging behavior.

---

## Testing and Validation Matrix

Platforms:

- iOS native (Capacitor)
- Android native (Capacitor)
- Chrome desktop PWA
- Android Chrome PWA
- Safari PWA (degraded mode expectations documented)

Scenarios:

- model load/unload lifecycle,
- max model cap and admission failures,
- token streaming correctness,
- parallel execution across mixed user-selected model roles (e.g., chat + embedding + vision + audio),
- cancellation and error propagation,
- cold vs warm startup with OPFS cache.

---

## Risks and Mitigations

- **Wasm threads unsupported in some environments**  
  Mitigation: capability detect + single-thread fallback mode.

- **Storage quota variability across browsers/devices**  
  Mitigation: OPFS usage checks + proactive eviction + user-visible errors.

- **Provider behavior drift across native/web**  
  Mitigation: shared contract tests + conformance checklist in CI.

- **Downstream app uses stale package version**  
  Mitigation: explicit release/version sync workflow before app integration.

---

## Definition of Done

- Single `LlmProvider` API works on native and web.
- PWA path runs wasm inference in worker thread (UI remains responsive).
- Memory admission + `MAX_MODELS=5` enforced.
- parallel user-selected multi-model flows validated (no default model assumptions).
- Token streaming available in both providers.
- Docs and release notes updated; downstream package sync checklist complete.

