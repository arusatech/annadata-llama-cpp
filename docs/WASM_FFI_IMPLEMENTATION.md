# Wasm FFI Implementation Guide

## Overview

This document explains how the Rust/Wasm implementation of llama-cpp works end-to-end, including the FFI (Foreign Function Interface) bridge to real llama.cpp C/C++ code.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ JavaScript/Browser (Web Provider)                               │
│  - HTML/CSS/JS app running in browser                           │
│  - Calls Wasm functions via typed interface                     │
└────────────────────┬────────────────────────────────────────────┘
                     │ postMessage (worker)
┌────────────────────▼────────────────────────────────────────────┐
│ Web Worker (llm.worker.ts)                                      │
│  - Isolated thread execution                                    │
│  - Communicates with browser via message protocol               │
│  - Calls Wasm exports                                           │
└────────────────────┬────────────────────────────────────────────┘
                     │ wasm-bindgen exports
┌────────────────────▼────────────────────────────────────────────┐
│ Rust/Wasm Runtime (src-rust/src/lib.rs)                         │
│  - init(), load_model(), generate(), embed()                    │
│  - Manages engine state and context lifecycle                   │
│  - Calls FFI functions                                          │
└────────────────────┬────────────────────────────────────────────┘
                     │ extern "C" calls
┌────────────────────▼────────────────────────────────────────────┐
│ FFI Bridge (src-rust/src/ffi.rs)                                │
│  - Safe Rust wrappers around C functions                        │
│  - Handles string/pointer conversions                           │
│  - Error handling and JSON parsing                              │
└────────────────────┬────────────────────────────────────────────┘
                     │ compiled llama.cpp symbols
┌────────────────────▼────────────────────────────────────────────┐
│ Compiled llama.cpp (C/C++ static libs)                           │
│  - llama_engine_embedded_c.a                                    │
│  - llama_engine_embedded_cpp.a                                  │
│  - Real inference engine                                        │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

### Rust/Wasm Source Files

- **src-rust/src/lib.rs** - Main Wasm exports (init, load_model, generate, embed, health, memory_snapshot)
- **src-rust/src/ffi.rs** - FFI bridge with extern "C" declarations and safe wrappers
- **src-rust/src/engine.rs** - Engine state management (context tracking, model lifecycle)
- **src-rust/src/model.rs** - Request/response types (GenerateRequest, EmbedRequest, etc.)
- **src-rust/src/memory.rs** - Memory management and pressure detection
- **src-rust/src/stream.rs** - Token streaming support for future use
- **src-rust/build.rs** - Build script that compiles llama.cpp C/C++ sources

### JavaScript/TypeScript Files

- **src/workers/wasm.engine.ts** - Wasm module loader and JS-side wrapper
- **src/workers/llm.worker.ts** - Web worker that owns Wasm lifecycle
- **src/isomorphic/provider.web.ts** - Web provider that communicates with worker
- **src/storage/opfs.store.ts** - OPFS file persistence for models

## FFI Functions

The FFI bridge exposes these core functions from llama.cpp:

### Context Management

```rust
pub fn init_context(model_path: &str, params_json: &str) -> Result<i64, String>
```

Initializes a new inference context. The `params_json` should contain:
```json
{
  "model": "/path/to/model.gguf",
  "n_ctx": 2048,
  "n_threads": 4,
  "n_batch": 512,
  "n_gpu_layers": 0,
  "embedding": false,
  "use_mmap": true,
  "use_mlock": false
}
```

Returns a context ID (handle) for subsequent operations.

### Generation

```rust
pub fn completion(context_id: i64, params_json: &str) -> Result<String, String>
```

Runs text completion. The `params_json` should contain:
```json
{
  "prompt": "Once upon a time",
  "n_predict": 128,
  "temperature": 0.7,
  "top_p": 0.95,
  "top_k": 40,
  "stop": []
}
```

Returns JSON with:
```json
{
  "text": "generated text here",
  "tokens_predicted": 50,
  "tokens_evaluated": 20,
  "stopped_limit": false
}
```

### Embeddings

```rust
pub fn embedding(context_id: i64, text: &str, params_json: &str) -> Result<Vec<f32>, String>
```

Generates embeddings for text. Returns a vector of floats representing the embedding.

### Cleanup

```rust
pub fn release_context(context_id: i64)
```

Frees context resources and unloads the model.

## Building the Wasm Module

### Build with llama.cpp embedded (real inference)

```bash
cd annadata-llama-cpp
npm run build:wasm:embed
```

This:
1. Runs `build.rs` which compiles all llama.cpp C/C++ sources
2. Links them with the Rust code
3. Generates `llama_engine.wasm` and `llama_engine.js` (wasm-bindgen wrapper)
4. Copies outputs to `dist/wasm/`

### Build without embedding (mock mode)

```bash
npm run build:wasm
```

This builds without the C/C++ compilation, useful for quick iteration on the JS/TS side.

## How It Works End-to-End

### 1. User loads a model

```typescript
await webProvider.loadModel({
  modelId: 'my-model',
  modelUrl: 'https://example.com/model.gguf',
  modelPath: '/path/to/model.gguf',
  n_ctx: 2048
});
```

### 2. Browser downloads and caches model

- Downloads GGUF file
- Stores in OPFS (Origin Private File System)
- Creates manifest entry

### 3. Worker loads into Wasm engine

```typescript
worker.postMessage({
  type: 'LOAD_MODEL',
  modelId: 'my-model',
  modelBuffer: arrayBuffer,  // OPFS file content
  opts: {
    modelPath: '/path/to/model.gguf',
    n_ctx: 2048,
    ...
  }
});
```

### 4. Wasm calls FFI to init context

```rust
// In Rust/Wasm:
let context_id = ffi::init_context(
  "/path/to/model.gguf",
  r#"{"n_ctx": 2048, ...}"#
)?;
```

### 5. FFI calls C/C++ function

```c
// C function (compiled from llama.cpp)
int64_t llama_init_context(
  const char* model_path,
  const char* params_json
)
```

### 6. llama.cpp loads model and creates context

- Parses GGUF header
- Allocates KV cache
- Loads weights from disk/memory
- Returns context handle

### 7. Generation works the same way

```typescript
worker.postMessage({
  type: 'GENERATE',
  modelId: 'my-model',
  req: {
    prompt: 'Hello world',
    max_tokens: 100,
    temperature: 0.7,
    stream: false
  }
});
```

→ Wasm calls `ffi::completion()` → C function `llama_completion()` → Returns JSON result

## Configuration and Build Flags

### LLAMA_WASM_EMBED_CPP

Set to `1` to enable C/C++ embedding during build:

```bash
LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed
```

### LLAMA_WASM_SYSROOT (advanced)

For Emscripten cross-compilation:

```bash
LLAMA_WASM_SYSROOT=/path/to/emsdk/upstream/emscripten npm run build:wasm:embed
```

## Debugging

### Check compiled outputs

```bash
ls -lh dist/wasm/
# Should show:
# -rw-r--r--  1 user  staff  2.5M  Dec 17 12:00 llama_engine.wasm
# -rw-r--r--  1 user  staff   50K  Dec 17 12:00 llama_engine.js
```

### Test individual Wasm functions

```typescript
// In browser console:
const { init, load_model, generate } = wasm;
await init();  // Initialize
console.log('Wasm initialized');
```

### Check OPFS storage

```javascript
// In browser DevTools:
const root = await navigator.storage.getDirectory();
const files = await root.entries();
for await (const [name, handle] of files) {
  console.log(name, handle.kind);
}
```

### Enable verbose logging in C/C++

Add to build.rs or cmake:
```c
#define CAPLLAMA_VERBOSE 1
```

## Performance Considerations

### Memory Usage

- Wasm runtime: ~100-500KB
- Model loading: Varies by model (7B ≈ 5-15GB for different quantizations)
- KV cache: `n_ctx * n_batch * model_dim * 2 bytes` (for both K and V)

### Speed

- First generation: ~1-2s (context creation + inference)
- Subsequent: ~100-500ms for 7B model (Q4 quantization)
- Embeddings: ~10-100ms depending on text length

### Optimization

- Use quantized models (Q4_0, Q4_1, Q5_K_M)
- Adjust `n_ctx` to actual requirements
- Disable `use_mlock` on memory-constrained devices
- Enable speculative decoding for drafting tasks

## Error Handling

Common errors and their causes:

| Error | Cause | Solution |
|-------|-------|----------|
| "Model file not found" | GGUF file not in OPFS or download failed | Re-download or check file path |
| "Engine not initialized" | `init()` not called before `load_model()` | Call `init()` first |
| "Model not loaded" | Model not loaded before `generate()` | Call `load_model()` first |
| "Invalid GGUF file" | Corrupted download or wrong format | Re-download model |
| "Out of memory" | Model too large for device | Use smaller quantization |

## Testing

### Unit tests

```bash
npm run test:pwa:smoke
```

### Integration tests

```bash
npm run test:integration
```

### Manual testing

```bash
# Start dev server
npm run build
npm run dev

# Open browser console
# Test load and generate
```

## Future Improvements

- [ ] Streaming token callback support
- [ ] Speculative decoding for faster generation
- [ ] Multimodal support (vision models)
- [ ] LoRA adapter loading
- [ ] Reranking support
- [ ] Advanced sampling parameters
- [ ] Session save/load
- [ ] Batch processing for embeddings

## References

- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [wasm-bindgen](https://rustwasm.org/docs/wasm-bindgen/)
- [Emscripten](https://emscripten.org/)
- [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
