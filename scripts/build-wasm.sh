#!/usr/bin/env bash
set -euo pipefail

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

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Warning: wasm-pack not found. Non-embed build will fail without it."
fi

if [[ "${LLAMA_WASM_EMBED_CPP:-0}" == "1" ]]; then
  if ! command -v em-config >/dev/null 2>&1 || ! command -v emcc >/dev/null 2>&1 || ! command -v em++ >/dev/null 2>&1; then
    echo "Error: LLAMA_WASM_EMBED_CPP=1 requires Emscripten tools (em-config, emcc, em++)."
    echo "Install via Homebrew: brew install emscripten"
    exit 1
  fi

  EMSDK_CACHE="$(em-config CACHE)"
  LLAMA_WASM_SYSROOT="${EMSDK_CACHE}/sysroot"
  if [[ ! -d "$LLAMA_WASM_SYSROOT/include" ]]; then
    echo "Error: Emscripten sysroot not found at $LLAMA_WASM_SYSROOT"
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

  echo "Using Emscripten toolchain for embedded C/C++ build:"
  echo "  - CC_wasm32_unknown_emscripten=$CC_wasm32_unknown_emscripten"
  echo "  - CXX_wasm32_unknown_emscripten=$CXX_wasm32_unknown_emscripten"
  echo "  - CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER=$CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER"
  echo "  - LLAMA_WASM_SYSROOT=$LLAMA_WASM_SYSROOT"

  if ! command -v wasm-bindgen >/dev/null 2>&1; then
    echo "Error: wasm-bindgen CLI not found. Install with: cargo install wasm-bindgen-cli"
    exit 1
  fi

  rustup target add wasm32-unknown-emscripten >/dev/null 2>&1 || true
  cd "$RUST_DIR"
  echo "Building embedded wasm package via wasm32-unknown-emscripten + wasm-bindgen..."
  CARGO_TARGET_DIR="$TARGET_DIR" cargo build --release --target wasm32-unknown-emscripten
  wasm-bindgen \
    --target web \
    --out-dir "$OUT_DIR" \
    --out-name "$ENGINE_NAME" \
    "$TARGET_DIR/wasm32-unknown-emscripten/release/${ENGINE_NAME}.wasm"
else
  if ! command -v wasm-pack >/dev/null 2>&1; then
    echo "Error: wasm-pack not found. Install it first: https://rustwasm.github.io/wasm-pack/installer/"
    exit 1
  fi
  cd "$RUST_DIR"
  echo "Building wasm package with deterministic JS name..."
  wasm-pack build --target web --release --out-dir "$OUT_DIR" --out-name "$ENGINE_NAME"
fi

JS_PATH="$OUT_DIR/$ENGINE_NAME.js"
WASM_BG_PATH="$OUT_DIR/${ENGINE_NAME}_bg.wasm"
WASM_PATH="$OUT_DIR/$ENGINE_NAME.wasm"

if [[ ! -f "$JS_PATH" ]]; then
  echo "Error: expected JS wrapper not found at $JS_PATH"
  exit 1
fi

if [[ -f "$WASM_BG_PATH" ]]; then
  # wasm-pack output normalization.
  cp "$WASM_BG_PATH" "$WASM_PATH"
  perl -pi -e "s/${ENGINE_NAME}_bg\\.wasm/${ENGINE_NAME}\\.wasm/g" "$JS_PATH"
  rm -f "$OUT_DIR/${ENGINE_NAME}_bg.wasm.d.ts" "$WASM_BG_PATH"
elif [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: expected wasm binary not found at $WASM_PATH"
  exit 1
fi

echo "Wasm build complete:"
echo "  - $JS_PATH"
echo "  - $WASM_PATH"

