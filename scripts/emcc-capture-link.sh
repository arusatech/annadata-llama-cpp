#!/usr/bin/env bash
# emcc-capture-link.sh
#
# Used as CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER during `build-wasm.sh`.
# Behaves identically to emcc for cargo's purposes (produces the SIDE_MODULE wasm),
# then — for the final engine link — copies all transient .rcgu.o object files to a
# persistent directory and writes a replay script so build-wasm.sh can later re-run
# emcc as a MAIN_MODULE ESM build without needing a second full cargo invocation.
#
# Environment variables consumed:
#   EMCC_ARGS_FILE    - path where the bash-array replay file is written
#   EMCC_ENGINE_NAME  - cdylib basename to match against (default: llama_engine)

set -euo pipefail

REAL_EMCC="$(command -v emcc)"
ENGINE_NAME="${EMCC_ENGINE_NAME:-llama_engine}"

# ── Run the standard SIDE_MODULE link (cargo's expected output) ───────────────
"$REAL_EMCC" "$@"

# ── Only capture the final engine link ───────────────────────────────────────
[[ -z "${EMCC_ARGS_FILE:-}" ]] && exit 0

OUTPUT_PATH=""
PREV=""
for arg in "$@"; do
  [[ "$PREV" == "-o" ]] && OUTPUT_PATH="$arg"
  PREV="$arg"
done

[[ "$OUTPUT_PATH" != *"${ENGINE_NAME}.wasm"* ]] && exit 0

# ── Copy transient .rcgu.o / .o files to a persistent sibling directory ──────
# Cargo deletes these after the link completes.  We need them for the MAIN_MODULE
# re-link that happens in build-wasm.sh (Stages 3-4), after wasm-bindgen runs.
OBJS_DIR="${EMCC_ARGS_FILE}.objs"
rm -rf "$OBJS_DIR"
mkdir -p "$OBJS_DIR"

declare -a SAVED_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == *.rcgu.o || "$arg" == *.o ]]; then
    DEST="$OBJS_DIR/$(basename "$arg")"
    # Guard against duplicate basenames (different CGUs with the same basename).
    if [[ -e "$DEST" ]]; then
      DEST="$OBJS_DIR/$$_$(basename "$arg")"
    fi
    cp "$arg" "$DEST"
    SAVED_ARGS+=("$DEST")
  else
    SAVED_ARGS+=("$arg")
  fi
done

# ── Write the replay file (bash array format) ─────────────────────────────────
{
  printf 'EMCC_CAPTURED_OUTPUT=%q\n' "$OUTPUT_PATH"
  printf 'EMCC_CAPTURED_ARGS=('
  for arg in "${SAVED_ARGS[@]}"; do
    printf '%q ' "$arg"
  done
  printf ')\n'
} > "$EMCC_ARGS_FILE"
