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
export CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER="$(command -v emcc)"
export AR_wasm32_unknown_emscripten="$(command -v emar)"

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

rustup target add wasm32-unknown-emscripten >/dev/null 2>&1 || true
cd "$RUST_DIR"
echo "Building wasm package via wasm32-unknown-emscripten + wasm-bindgen..."
CARGO_TARGET_DIR="$TARGET_DIR" cargo build --release --target wasm32-unknown-emscripten
CARGO_WASM_PATH="$TARGET_DIR/wasm32-unknown-emscripten/release/${ENGINE_NAME}.wasm"
if [[ ! -f "$CARGO_WASM_PATH" ]]; then
  echo "Error: expected cargo wasm binary not found at $CARGO_WASM_PATH"
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
wasm-bindgen \
  --target web \
  --out-dir "$OUT_DIR" \
  --out-name "$ENGINE_NAME" \
  "$CARGO_WASM_PATH"
WASM_BG_PATH="$OUT_DIR/${ENGINE_NAME}_bg.wasm"
if [[ ! -f "$WASM_BG_PATH" ]]; then
  echo "Error: expected wasm-bindgen output not found at $WASM_BG_PATH"
  exit 1
fi

cd "$ROOT_DIR"
node ./scripts/package-embed-wasm.mjs

JS_PATH="$OUT_DIR/$ENGINE_NAME.js"
WASM_PATH="$OUT_DIR/$ENGINE_NAME.wasm"
DTS_PATH="$OUT_DIR/$ENGINE_NAME.d.ts"
PACKAGE_JSON_PATH="$OUT_DIR/package.json"

if [[ ! -f "$JS_PATH" ]]; then
  echo "Error: expected wasm JS wrapper not found at $JS_PATH"
  exit 1
fi

if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: expected wasm binary not found at $WASM_PATH"
  exit 1
fi

if [[ ! -f "$DTS_PATH" ]]; then
  echo "Error: expected TypeScript definitions not found at $DTS_PATH"
  exit 1
fi

if [[ ! -f "$PACKAGE_JSON_PATH" ]]; then
  echo "Error: expected package manifest not found at $PACKAGE_JSON_PATH"
  exit 1
fi

echo "Wasm build complete:"
echo "  - $JS_PATH"
echo "  - $WASM_PATH"
echo "  - $DTS_PATH"
