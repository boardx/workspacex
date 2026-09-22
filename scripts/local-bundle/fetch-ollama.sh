#!/usr/bin/env bash
# Put the Ollama binary where the desktop bundle expects it (apps/desktop/bin/ollama).
#
# Ollama publishes standalone archives per platform on GitHub Releases; this script downloads
# the one for the current machine (or $OLLAMA_TARGET: darwin-arm64 | darwin-amd64 | windows-amd64)
# and verifies it runs. Requires network; run once per release on the build machine.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/desktop/bin"
VERSION="${OLLAMA_VERSION:-latest}"
case "${OLLAMA_TARGET:-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)}" in
  darwin-arm64|darwin-aarch64) ASSET="ollama-darwin.tgz" ;;
  darwin-x86_64|darwin-amd64)  ASSET="ollama-darwin.tgz" ;;
  windows-amd64|windows-x86_64) ASSET="ollama-windows-amd64.zip" ;;
  linux-x86_64|linux-amd64)    ASSET="ollama-linux-amd64.tgz" ;;
  *) echo "unsupported target ${OLLAMA_TARGET:-}" >&2; exit 1 ;;
esac
if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/ollama/ollama/releases/latest/download/$ASSET"
else
  URL="https://github.com/ollama/ollama/releases/download/$VERSION/$ASSET"
fi
mkdir -p "$OUT"
TMP="$(mktemp -d)"
echo "downloading $URL"
curl -fL --retry 3 -o "$TMP/$ASSET" "$URL"
case "$ASSET" in
  *.tgz) tar -xzf "$TMP/$ASSET" -C "$TMP" ;;
  *.zip) unzip -q "$TMP/$ASSET" -d "$TMP" ;;
esac
BIN="$(find "$TMP" -maxdepth 3 -type f \( -name ollama -o -name ollama.exe \) | head -1)"
[ -n "$BIN" ] || { echo "no ollama binary in $ASSET" >&2; exit 1; }
# The archive is one flat directory: `ollama` + `llama-server` + the ggml/llama dylibs. Ollama
# looks for llama-server NEXT TO its own binary, so ship the whole directory, not just `ollama`
# -- with only the binary, every model load fails with "llama-server binary not found"
# (Mac实测 2026-09-17, only visible on a machine that has no Ollama.app of its own).
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$(dirname "$BIN")/." "$OUT/"
chmod +x "$OUT"/ollama* "$OUT"/llama-* 2>/dev/null || true
[ -f "$OUT/llama-server" ] || [ -f "$OUT/lib/ollama/llama-server" ] || { echo "archive layout changed: llama-server not found" >&2; exit 1; }
rm -rf "$TMP"
"$OUT/ollama" --version 2>/dev/null || "$OUT/ollama.exe" --version
echo "ollama placed in $OUT"
