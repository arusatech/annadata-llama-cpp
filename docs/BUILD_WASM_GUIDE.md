# Building the Wasm Module with Real llama.cpp

## Prerequisites

### System Requirements

- **Node.js** 18+ (with npm)
- **Rust** 1.70+ (`rustup` recommended)
- **wasm-pack** 1.3.0+ (`cargo install wasm-pack`)
- **Emscripten** (optional, for Emscripten target)
- **CMake** 3.16+ (for native builds)
- **C/C++ compiler** (gcc/clang on Linux/Mac, MSVC on Windows)

### Install Tools

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack

# Verify installations
rustc --version
cargo --version
wasm-pack --version
npm --version
```

## Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/arusatech/llama-cpp.git
cd llama-cpp
npm install
```

### 2. Build Wasm with Real llama.cpp

```bash
# Build Wasm module with llama.cpp embedded
npm run build:wasm:embed

# Copy built assets to dist/
npm run build:wasm:assets

# Verify outputs
ls -lh dist/wasm/
```

### 3. Test

```bash
# Run smoke tests
npm run test:pwa:smoke

# Expected output:
# PASS  test/pwa/worker.smoke.test.ts (5.234 s)
# PASS  test/pwa/web-provider.contract.test.ts (3.127 s)
# Tests:       16 passed, 16 total
```

## Build Process Explained

### Step 1: TypeScript Compilation

```bash
npx tsc -p tsconfig.json
```

Compiles:
- `src/**/*.ts` → `dist/esm/`
- Type definitions → `dist/esm/*.d.ts`

### Step 2: Rust + Wasm Build

```bash
LLAMA_WASM_EMBED_CPP=1 wasm-pack build src-rust --target web --release
```

What happens:
1. **build.rs executes:**
   - Locates `cpp/` directory
   - Compiles all llama.cpp `.c` and `.cpp` files
   - Creates `libllama_engine_embedded_c.a` (C sources)
   - Creates `libllama_engine_embedded_cpp.a` (C++ sources)

2. **Rust compilation:**
   - Compiles `src-rust/src/**/*.rs` to Wasm target
   - Links against compiled llama.cpp libraries
   - Generates `pkg/llama_engine.wasm`

3. **wasm-bindgen runs:**
   - Generates JavaScript wrapper (`pkg/llama_engine.js`)
   - Generates TypeScript definitions (`pkg/llama_engine.d.ts`)
   - Creates `pkg/package.json`

Output directory: `src-rust/pkg/`

### Step 3: Asset Copy

```bash
node scripts/copy-wasm-assets.mjs
```

Copies:
- `pkg/llama_engine.wasm` → `dist/wasm/`
- `pkg/llama_engine.js` → `dist/wasm/`
- `pkg/llama_engine.d.ts` → `dist/wasm/`
- `pkg/package.json` → `dist/wasm/`

### Step 4: Bundle

```bash
npx rollup -c rollup.config.mjs
```

Creates distribution bundles:
- `dist/plugin.cjs.js` (CommonJS)
- `dist/esm/index.js` (ES Module)
- `dist/esm/index.d.ts` (TypeScript types)

## Build Flags

### Enable/Disable llama.cpp Embedding

```bash
# WITH real llama.cpp compilation
LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed

# WITHOUT llama.cpp (mock mode, fast iteration)
npm run build:wasm
```

### Custom Emscripten Sysroot

```bash
# If using Emscripten instead of wasm32-unknown-unknown
LLAMA_WASM_SYSROOT=/path/to/emsdk/upstream/emscripten \
  LLAMA_WASM_EMBED_CPP=1 \
  npm run build:wasm:embed
```

## Build Outputs

After successful build, you'll have:

```
dist/
├── esm/
│   ├── index.js           # Main ES module export
│   ├── index.d.ts         # TypeScript definitions
│   ├── isomorphic/        # Provider implementations
│   ├── storage/           # OPFS storage
│   ├── workers/           # Worker code
│   └── ...
├── plugin.cjs.js          # CommonJS bundle
├── plugin.js              # UMD bundle
├── docs.json              # API docs
└── wasm/
    ├── llama_engine.wasm  # ⭐ Binary Wasm module (2-5MB)
    ├── llama_engine.js    # wasm-bindgen wrapper
    ├── llama_engine.d.ts  # TypeScript types
    └── package.json       # Wasm package metadata
```

## File Size Breakdown

| Component | Size | Notes |
|-----------|------|-------|
| Wasm binary (`llama_engine.wasm`) | 2-5MB | Compressed with llama.cpp |
| wasm-bindgen wrapper | 50-100KB | JavaScript glue code |
| TypeScript definitions | 10-20KB | Type information |
| Total npm package | 5-10MB | Includes native libraries |

### Optimization

- Use `release` mode for production (already done in npm scripts)
- Enable LTO: `lto = true` in `Cargo.toml` (already configured)
- Strip symbols: `strip = "symbols"` (already configured)

## Incremental Development

### During Development

Skip the expensive wasm embed build:

```bash
# Fast iteration on JS/TS without C/C++ recompilation
npm run build
npm run test:pwa:smoke
```

### Before Release

Rebuild Wasm with real llama.cpp:

```bash
# Full build with C/C++ compilation
npm run build:wasm:embed
npm run build:wasm:assets
npm run build
npm run test:pwa:smoke
```

## Troubleshooting

### Build Failures

#### Error: "wasm-pack not found"

```bash
cargo install wasm-pack
```

#### Error: "LLAMA_WASM_EMBED_CPP not enabled"

The build script skips C/C++ compilation by default. Enable it:

```bash
LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed
```

#### Error: "undefined reference to llama_init_context"

The linker can't find the llama.cpp libraries. Check:

1. `cpp/` directory exists and has files
2. `build.rs` correctly identifies source files
3. Compiler can access `cpp/` from working directory

```bash
ls -la cpp/llama.cpp  # Should exist
head cpp/llama.cpp    # Should show C++ code
```

#### Error: "LLVM not found" / Emscripten issues

Either:

1. Install Emscripten:
   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source emsdk_env.sh
   ```

2. Or use `wasm32-unknown-unknown` target (default):
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

### Runtime Issues

#### "Wasm module not loaded"

Check that `llama_engine.js` is being imported:

```typescript
// Should see this log
console.log('Wasm module loaded:', typeof wasmModule);
```

#### "Model loading fails"

1. Check model file path is accessible
2. Verify GGUF format is valid
3. Check memory constraints

```bash
# Validate GGUF file header
hexdump -C /path/to/model.gguf | head
# Should start with: GGUF magic bytes
```

## Performance Monitoring

### Build Time

```bash
time npm run build:wasm:embed
# Expected: 30-120 seconds depending on CPU
```

### Runtime Performance

```typescript
// Measure inference time
const start = performance.now();
const result = await context.generate({
  prompt: 'Hello world',
  n_predict: 100
});
const elapsed = performance.now() - start;
console.log(`Generated in ${elapsed}ms`);
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build Wasm
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      
      - name: Install wasm-pack
        run: cargo install wasm-pack
      
      - name: Install Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build Wasm
        run: npm run build:wasm:embed
      
      - name: Run tests
        run: npm run test:pwa:smoke
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: wasm-build
          path: dist/wasm/
```

## Advanced: Custom Build Targets

### Build for Emscripten

```bash
rustup target add wasm32-emscripten

LLAMA_WASM_SYSROOT=/path/to/emscripten \
  LLAMA_WASM_EMBED_CPP=1 \
  wasm-pack build src-rust --target web --release
```

### Build with SIMD Support

Add to `Cargo.toml`:

```toml
[profile.release]
# ... existing config ...
opt-level = 3
lto = true
```

Then rebuild:

```bash
LLAMA_WASM_EMBED_CPP=1 npm run build:wasm:embed
```

## Next Steps

1. ✅ Build the Wasm module
2. ✅ Run tests
3. ✅ Try it in a web app
4. ✅ Deploy to production

## Support

For issues:

1. Check [WASM_FFI_IMPLEMENTATION.md](docs/WASM_FFI_IMPLEMENTATION.md)
2. Review [GitHub Issues](https://github.com/arusatech/llama-cpp/issues)
3. See [llama.cpp README](cpp/README.md) for C/C++ details

## License

MIT - See LICENSE file
