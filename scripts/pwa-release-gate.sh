#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== PWA Release Gate: start ==="

echo "[1/4] TypeScript contract check"
npx tsc -p tsconfig.json --noEmit

echo "[2/4] PWA smoke contract tests"
npm run test:pwa:smoke

echo "[3/4] Embedded llama.cpp wasm build"
npm run build:wasm

echo "[4/4] Copy runtime wasm assets"
npm run build:wasm:assets

echo "=== PWA Release Gate: PASS ==="
