#!/usr/bin/env bash
set -euo pipefail

export LLAMA_WASM_EMBED_CPP=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_DIR="$ROOT_DIR/src-rust"
OUT_DIR="$RUST_DIR/pkg"
ENGINE_NAME="llama_engine"
TARGET_DIR="$RUST_DIR/target"

# Homebrew rustup is keg-only on macOS; include it when present.
if [[ -d "/opt/homebrew/opt/rustup/bin" ]]; then
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
fi
if [[ -d "$HOME/.cargo/bin" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  echo "Error: Rust toolchain not found (cargo/rustc). Install rustup and run: rustup toolchain install stable"
  exit 1
fi

if ! command -v em-config >/dev/null 2>&1 || ! command -v emcc >/dev/null 2>&1 || ! command -v em++ >/dev/null 2>&1; then
  echo "Error: Embedded wasm build requires Emscripten tools (em-config, emcc, em++)."
  echo "Install via Homebrew: brew install emscripten"
  exit 1
fi

EMSDK_CACHE="$(em-config CACHE)"
if [[ ! -d "$EMSDK_CACHE" ]]; then
  # Some Homebrew Emscripten installs report a cache path under Cellar that is not writable/present.
  # Fallback to user-local cache and force tools to use it.
  export EM_CACHE="${HOME}/.emscripten_cache"
  mkdir -p "$EM_CACHE"
  EMSDK_CACHE="$EM_CACHE"
fi

LLAMA_WASM_SYSROOT="${EMSDK_CACHE}/sysroot"
if [[ ! -d "$LLAMA_WASM_SYSROOT/include" ]]; then
  if command -v embuilder >/dev/null 2>&1; then
    echo "Emscripten sysroot missing at $LLAMA_WASM_SYSROOT; populating cache via embuilder..."
    embuilder build sysroot >/dev/null
  else
    # Fallback: trigger emcc once; it may initialize cache/sysroot in some setups.
    emcc -v >/dev/null 2>&1 || true
  fi
fi
if [[ ! -d "$LLAMA_WASM_SYSROOT/include" ]]; then
  echo "Error: Emscripten sysroot not found at $LLAMA_WASM_SYSROOT"
  echo "Try: export EM_CACHE=\"\$HOME/.emscripten_cache\" && embuilder build sysroot"
  exit 1
fi

export LLAMA_WASM_SYSROOT
EMSDK_ROOT="$(em-config EMSCRIPTEN_ROOT)"
LLVM_BIN_DIR="${EMSDK_ROOT}/llvm/bin"
if [[ ! -x "${LLVM_BIN_DIR}/clang" || ! -x "${LLVM_BIN_DIR}/clang++" ]]; then
  echo "Error: Emscripten LLVM clang toolchain not found in ${LLVM_BIN_DIR}"
  exit 1
fi

export CC_wasm32_unknown_emscripten="$(command -v emcc)"
export CXX_wasm32_unknown_emscripten="$(command -v em++)"
export AR_wasm32_unknown_emscripten="$(command -v emar)"
# Linker wrapper captures the final emcc invocation so we can replay it as MAIN_MODULE.
export CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER="$ROOT_DIR/scripts/emcc-capture-link.sh"
export EMCC_ENGINE_NAME="$ENGINE_NAME"

echo "Using Emscripten toolchain for embedded llama.cpp wasm build:"
echo "  - CC_wasm32_unknown_emscripten=$CC_wasm32_unknown_emscripten"
echo "  - CXX_wasm32_unknown_emscripten=$CXX_wasm32_unknown_emscripten"
echo "  - CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER=$CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER"
echo "  - EMSDK_CACHE=$EMSDK_CACHE"
echo "  - LLAMA_WASM_SYSROOT=$LLAMA_WASM_SYSROOT"

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "Error: wasm-bindgen CLI not found. Install with: cargo install wasm-bindgen-cli"
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── Stage 1: cargo build (SIDE_MODULE wasm) + capture linker args ────────────
# The capture wrapper (emcc-capture-link.sh) runs emcc normally for cargo's
# SIDE_MODULE output and saves the full argument list to EMCC_ARGS_FILE.
export EMCC_ARGS_FILE="$OUT_DIR/emcc-link-args.sh"
rustup target add wasm32-unknown-emscripten >/dev/null 2>&1 || true
cd "$RUST_DIR"
echo "Stage 1: cargo build (wasm32-unknown-emscripten, SIDE_MODULE) ..."
CARGO_TARGET_DIR="$TARGET_DIR" cargo build --release --target wasm32-unknown-emscripten

CARGO_WASM_PATH="$TARGET_DIR/wasm32-unknown-emscripten/release/${ENGINE_NAME}.wasm"
if [[ ! -f "$CARGO_WASM_PATH" ]]; then
  echo "Error: expected cargo wasm binary not found at $CARGO_WASM_PATH"
  exit 1
fi
if [[ ! -f "$EMCC_ARGS_FILE" ]]; then
  echo "Error: linker capture file not created at $EMCC_ARGS_FILE — emcc-capture-link.sh may not have run"
  exit 1
fi

# ── Stage 2: wasm-bindgen → library_bindgen.js + _bg.wasm ────────────────────
# --target no-modules emits the Emscripten-aware library_bindgen.js glue
# (addToLibrary calls) alongside the _bg.wasm binary.
echo "Stage 2: wasm-bindgen --target no-modules ..."
wasm-bindgen \
  --target no-modules \
  --out-dir "$OUT_DIR" \
  --out-name "$ENGINE_NAME" \
  "$CARGO_WASM_PATH"

WASM_BG_PATH="$OUT_DIR/${ENGINE_NAME}_bg.wasm"
LIBRARY_BINDGEN="$OUT_DIR/library_bindgen.js"
if [[ ! -f "$WASM_BG_PATH" ]]; then
  echo "Error: wasm-bindgen did not produce $WASM_BG_PATH"
  exit 1
fi
if [[ ! -f "$LIBRARY_BINDGEN" ]]; then
  echo "Error: wasm-bindgen did not produce $LIBRARY_BINDGEN"
  exit 1
fi

# ── Stage 3: patch library_bindgen.js ────────────────────────────────────────
# Remove the `memory: memory || new WebAssembly.Memory(...)` addToLibrary entry.
# That line references the linker-level 'memory' symbol which is undefined when
# library_bindgen.js is evaluated as a --js-library in a standalone emcc run.
# Emscripten's own runtime sets up wasm memory correctly; this entry is redundant.
echo "Stage 3: patching library_bindgen.js ..."
PATCHED_GLUE="$OUT_DIR/library_bindgen_patched.js"
node -e "
const { readFileSync, writeFileSync } = require('fs');
let src = readFileSync(process.argv[1], 'utf8');
src = src.replace(
  /addToLibrary\(\{\s*memory:\s*memory\s*\|\|\s*new WebAssembly\.Memory\([^)]+\),\s*\}\);/g,
  ''
);
writeFileSync(process.argv[2], src);
" "$LIBRARY_BINDGEN" "$PATCHED_GLUE"

# ── Stage 4: emcc MAIN_MODULE re-link → llama_engine_emscripten.{mjs,wasm} ──
# Replay the captured linker args, replacing -sSIDE_MODULE=2 with -sMAIN_MODULE=1
# and redirecting output to an ESM file (.mjs).  This produces a self-contained
# browser module that includes both the llama.cpp C/C++ code and the Rust glue.
echo "Stage 4: emcc MAIN_MODULE re-link ..."
source "$EMCC_ARGS_FILE"  # loads: EMCC_CAPTURED_OUTPUT, EMCC_CAPTURED_ARGS

ESM_OUT="$OUT_DIR/${ENGINE_NAME}_emscripten.mjs"
NEW_ARGS=()
SKIP=0
for arg in "${EMCC_CAPTURED_ARGS[@]}"; do
  if [[ "$SKIP" == "1" ]]; then SKIP=0; continue; fi
  case "$arg" in
    -o) NEW_ARGS+=("-o" "$ESM_OUT"); SKIP=1 ;;
    -sSIDE_MODULE=*) ;;       # removed: we build MAIN_MODULE instead
    -sENVIRONMENT=*) ;;      # removed: we set web,worker explicitly below
    *) NEW_ARGS+=("$arg") ;;
  esac
done

emcc "${NEW_ARGS[@]}" \
  -sMAIN_MODULE=1 \
  -sENVIRONMENT=web,worker \
  --js-library "$PATCHED_GLUE" \
  -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  2>&1 | grep -v "^warning:" | grep -v "^emcc: warning:" || true

if [[ ! -f "$ESM_OUT" ]]; then
  echo "Error: emcc MAIN_MODULE link did not produce $ESM_OUT"
  exit 1
fi
ESM_WASM="$OUT_DIR/${ENGINE_NAME}_emscripten.wasm"
if [[ ! -f "$ESM_WASM" ]]; then
  echo "Error: emcc MAIN_MODULE link did not produce $ESM_WASM"
  exit 1
fi
echo "  - $ESM_OUT ($(wc -c < "$ESM_OUT" | tr -d ' ') bytes)"
echo "  - $ESM_WASM ($(wc -c < "$ESM_WASM" | tr -d ' ') bytes)"

# Clean up intermediates
rm -f "$EMCC_ARGS_FILE" "$PATCHED_GLUE"

# ── Stage 5: assemble the final pkg/ directory ────────────────────────────────
cd "$ROOT_DIR"
node ./scripts/package-embed-wasm.mjs

JS_PATH="$OUT_DIR/$ENGINE_NAME.js"
WASM_PATH="$OUT_DIR/$ENGINE_NAME.wasm"
DTS_PATH="$OUT_DIR/$ENGINE_NAME.d.ts"
PACKAGE_JSON_PATH="$OUT_DIR/package.json"

for f in "$JS_PATH" "$WASM_PATH" "$DTS_PATH" "$PACKAGE_JSON_PATH"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: expected artifact not found at $f"
    exit 1
  fi
done

echo "Wasm build complete:"
echo "  - $JS_PATH"
echo "  - $WASM_PATH"
echo "  - $OUT_DIR/${ENGINE_NAME}_emscripten.mjs"
echo "  - $DTS_PATH"
