#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== PWA Release Gate: start ==="

echo "[1/5] TypeScript contract check"
npx tsc -p tsconfig.json --noEmit

echo "[2/5] PWA smoke contract tests"
npm run test:pwa:smoke

echo "[3/5] Embedded wasm compile check (emscripten; not shipped to dist/wasm)"
npm run build:wasm:embed

echo "[4/5] Standard wasm build (wasm-pack web — ships to dist/wasm)"
npm run build:wasm

echo "[5/5] Copy runtime wasm assets"
npm run build:wasm:assets

echo "=== PWA Release Gate: PASS ==="

