#!/usr/bin/env bash
#
# Bootstrap script: sync native llama.cpp source from upstream into cpp/
#
# Use this when you need to update the native layer (e.g. for a newer
# llama.cpp version or vision model support) while keeping the project-specific
# Capacitor/React Native adapter code intact.
#
# Project-specific files (never overwritten):
#   - cap-*.cpp, cap-*.h, cap-*.hpp (Capacitor bridge: cap-llama, cap-completion, cap-tts, cap-embedding, cap-mtmd)
#   - cpp/README.md
#   - cpp/tools/mtmd/ (multimodal/vision tooling)
#
# Everything else in cpp/ (ggml*, llama*, common, chat, etc.) is synced from upstream.
#
# Usage:
#   ./scripts/bootstrap.sh [REF]
#
#   REF optional: branch, tag, or commit (default: master)
#   Example: ./scripts/bootstrap.sh master
#   Example: ./scripts/bootstrap.sh b5234
#
set -e

REPO_URL="${LLAMA_CPP_REPO:-https://github.com/ggerganov/llama.cpp}"
REF="${1:-master}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CPP_DIR="$ROOT_DIR/cpp"
TMP_DIR="${TMPDIR:-/tmp}/llama_cpp_bootstrap_$$"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
  if [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# Check we're in the right repo
if [ ! -d "$CPP_DIR" ] || [ ! -f "$CPP_DIR/cap-llama.cpp" ]; then
  err "Expected project root with cpp/ and cpp/cap-llama.cpp. Run from repo root or fix paths."
  exit 1
fi

info "Bootstrap: sync native source from upstream llama.cpp"
info "  Repo: $REPO_URL"
info "  Ref:  $REF"
info "  Target: $CPP_DIR"
echo

# Clone upstream shallow
info "Cloning upstream (shallow, ref=$REF)..."
mkdir -p "$TMP_DIR"
if ! git clone --depth 1 --branch "$REF" "$REPO_URL" "$TMP_DIR/upstream" 2>/dev/null; then
  # Branch might not exist; try fetch by commit
  info "Branch/tag '$REF' not found, trying as commit..."
  rm -rf "$TMP_DIR/upstream"
  git clone "$REPO_URL" "$TMP_DIR/upstream"
  (cd "$TMP_DIR/upstream" && git checkout "$REF")
fi
UPSTREAM="$TMP_DIR/upstream"

# Exclude project-specific files/dirs (we keep our copies)
# These are the Capacitor/mobile adapter and mtmd tooling — do not overwrite.
EXCLUDE_NAMES=(
  'cap-llama.cpp' 'cap-llama.h'
  'cap-completion.cpp' 'cap-completion.h'
  'cap-tts.cpp' 'cap-tts.h'
  'cap-embedding.cpp' 'cap-embedding.h'
  'cap-mtmd.hpp'
  'README.md'
)
EXCLUDE_DIRS=(
  'tools/mtmd'
)

# Build rsync exclude args
RSYNC_EXCLUDES=()
for n in "${EXCLUDE_NAMES[@]}"; do
  RSYNC_EXCLUDES+=(--exclude="$n")
done
for d in "${EXCLUDE_DIRS[@]}"; do
  RSYNC_EXCLUDES+=(--exclude="/$d")
done

# Sync upstream into cpp/ (exclude project-specific; no --delete so we don't remove cpp/tools/mtmd)
info "Syncing upstream into cpp/ (excluding project-specific files)..."
rsync -a \
  "${RSYNC_EXCLUDES[@]}" \
  "$UPSTREAM/" \
  "$CPP_DIR/"

ok "Native source synced from upstream (ref=$REF)."
info "Preserved (unchanged): cap-*.cpp/h, cap-mtmd.hpp, cpp/README.md, cpp/tools/mtmd/"
echo
info "Next steps:"
echo "  1. Resolve any merge conflicts in cpp/ if you had local changes."
echo "  2. Reconcile cap-llama.cpp / cap-completion.cpp / cap-tts.cpp with upstream API changes if needed."
echo "  3. Rebuild native libraries:"
echo "       npm run build:native"
echo "     or: ./build-native.sh"
echo "  4. For iOS: open the app in Xcode and run, or run tests."
echo ""
info "For vision/multimodal: after bootstrap, ensure cpp/tools/mtmd and cap-mtmd.hpp are still compatible with updated llama.cpp APIs."
echo
