# Quick Reference - Wasm FFI Implementation

## 🚀 Quick Build

```bash
cd annadata-llama-cpp
npm install
LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed
npm run build:wasm:assets
npm run test:pwa:smoke
```

## 📁 Files Created/Modified

| File | Purpose | Status |
|------|---------|--------|
| `src-rust/src/ffi.rs` | FFI bridge to llama.cpp | ✅ Created |
| `src-rust/src/engine.rs` | State management | ✅ Created |
| `src-rust/src/model.rs` | Request/response types | ✅ Created |
| `src-rust/src/memory.rs` | Memory management | ✅ Created |
| `src-rust/src/stream.rs` | Streaming support | ✅ Created |
| `src-rust/src/lib.rs` | Main exports | ✅ Updated |
| `src-rust/Cargo.toml` | Dependencies | ✅ Ready |
| `src-rust/build.rs` | Build script | ✅ Ready |
| `docs/WASM_FFI_IMPLEMENTATION.md` | Technical guide | ✅ Created |
| `docs/WASM_IMPLEMENTATION_SUMMARY.md` | Overview | ✅ Created |
| `BUILD_WASM_GUIDE.md` | Build instructions | ✅ Created |
| `WASM_COMPLETION_CHECKLIST.md` | Detailed checklist | ✅ Created |

## 🔗 FFI Functions

```rust
pub fn init_context(model_path: &str, params_json: &str) -> Result<i64, String>
pub fn release_context(context_id: i64)
pub fn completion(context_id: i64, params_json: &str) -> Result<String, String>
pub fn embedding(context_id: i64, text: &str, params_json: &str) -> Result<Vec<f32>, String>
pub fn tokenize(context_id: i64, text: &str) -> Result<Vec<i32>, String>
pub fn detokenize(context_id: i64, tokens: &[i32]) -> Result<String, String>
```

## 📦 Wasm Exports

```rust
#[wasm_bindgen]
pub fn init() -> Result<(), JsValue>
pub fn load_model(model_id: String, bytes: &[u8], opts_json: String) -> Result<(), JsValue>
pub fn unload_model(model_id: String) -> Result<(), JsValue>
pub fn generate(model_id: String, req_json: String) -> Result<String, JsValue>
pub fn embed(model_id: String, req_json: String) -> Result<String, JsValue>
pub fn health() -> Result<String, JsValue>
pub fn memory_snapshot() -> Result<String, JsValue>
```

## 🏗️ Build Flags

```bash
# WITH real llama.cpp
LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed

# WITHOUT llama.cpp (mock mode)
npm run build:wasm

# With Emscripten (optional)
LLAMA_WASM_SYSROOT=/path/to/emsdk npm run build:wasm:embed
```

## 🧪 Test Commands

```bash
# Smoke tests
npm run test:pwa:smoke

# Integration tests
npm run test:integration

# TypeScript check
npm run verify:pwa

# Release gate
npm run release:gate:pwa
```

## 📊 Build Outputs

```
dist/wasm/
├── llama_engine.wasm    (2-5MB)  - Binary
├── llama_engine.js              - Wrapper
├── llama_engine.d.ts            - Types
└── package.json
```

## 🔄 Data Flow

```
TypeScript Request
    ↓ JSON serialization
Rust/Wasm (lib.rs)
    ↓ Parameter conversion
FFI (ffi.rs)
    ↓ CString conversion
C Function (llama_init_context, etc.)
    ↓ Processing
C Function Result
    ↓ CStr parsing
FFI (ffi.rs)
    ↓ String conversion
Rust/Wasm (lib.rs)
    ↓ JSON serialization
TypeScript Response
```

## ⚙️ Configuration Parameters

### Context Init
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

### Generation
```json
{
  "prompt": "Hello",
  "n_predict": 128,
  "temperature": 0.7,
  "top_p": 0.95,
  "top_k": 40,
  "stop": []
}
```

## 🐛 Debugging

```bash
# Check wasm output
ls -lh dist/wasm/

# Verify wasm works
node -e "
  const wasm = require('./dist/wasm/llama_engine.js');
  console.log('Wasm loaded:', typeof wasm.init);
"

# Check model file
hexdump -C /path/to/model.gguf | head
# Should show GGUF magic bytes
```

## 📈 Performance Tips

- Use quantized models (Q4_0, Q4_1)
- Reduce n_ctx for smaller contexts
- Disable use_mlock on memory-limited devices
- Enable speculative decoding for drafting

## 🔧 Build Issues & Solutions

| Issue | Solution |
|-------|----------|
| wasm-pack not found | `cargo install wasm-pack` |
| LLAMA_WASM_EMBED_CPP not set | Prefix build command: `LLAMA_WASM_EMBED_CPP=1` |
| Link errors | Check cpp/ directory exists and has llama.cpp files |
| Out of memory | Use smaller model or reduce n_ctx |

## 📚 Documentation Map

| Document | Topic |
|----------|-------|
| `WASM_IMPLEMENTATION_SUMMARY.md` | What was implemented, how it works |
| `WASM_FFI_IMPLEMENTATION.md` | Technical architecture & FFI specs |
| `BUILD_WASM_GUIDE.md` | Building instructions & troubleshooting |
| `WASM_COMPLETION_CHECKLIST.md` | Detailed implementation checklist |
| `BUILD_WASM_GUIDE.md` | Build process & CI/CD |

## 🎯 Key Files to Know

| File | Purpose |
|------|---------|
| `src-rust/src/ffi.rs` | The FFI bridge - links to llama.cpp |
| `src-rust/src/lib.rs` | Wasm interface - what JS calls |
| `src/workers/llm.worker.ts` | Worker that owns Wasm |
| `src/isomorphic/provider.web.ts` | Web provider using Wasm |
| `src-rust/build.rs` | Compiles C/C++ sources |

## 💡 Usage Example

```typescript
import { ProviderFactory } from 'llama-cpp-capacitor';

// Create provider (auto-detects platform)
const provider = ProviderFactory.createProvider();

// Initialize
await provider.initialize({});

// Load model
await provider.loadModel({
  modelId: 'llama-7b',
  modelUrl: 'https://example.com/model.gguf',
  modelPath: '/workspace/model.gguf',
  n_ctx: 2048
});

// Generate text
const result = await provider.generate({
  modelId: 'llama-7b',
  prompt: 'Once upon a time',
  max_tokens: 100,
  temperature: 0.7
});

console.log(result.text);

// Clean up
await provider.unloadModel('llama-7b');
```

## ✅ Implementation Checklist

- [x] FFI bridge implemented
- [x] All wasm-bindgen exports
- [x] Type system complete
- [x] Error handling
- [x] Build system
- [x] Documentation
- [x] Tests ready
- [x] Ready for production

## 🚀 Deploy Workflow

1. Build: `LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed`
2. Test: `npm run test:pwa:smoke`
3. Package: `npm run build:package`
4. Publish: `npm publish`

---

**Everything is ready to build and deploy! 🎉**
