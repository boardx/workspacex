#!/usr/bin/env bash
# Put the chat + embedding models into the desktop bundle (apps/desktop/models), so the DMG
# needs no download on first start. Pulls them into the local Ollama store first if missing,
# then exports exactly those manifests + blobs (packages/local-runtime/src/model-bundle.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE="${OLLAMA_MODELS:-$HOME/.ollama/models}"
MODELS="${MODELS:-qwen3.5:4b,qwen3.5:2b,qwen3-embedding:0.6b}"
command -v ollama >/dev/null || { echo "ollama CLI not found; install Ollama first" >&2; exit 1; }
IFS=, read -ra LIST <<< "$MODELS"
for m in "${LIST[@]}"; do
  ollama show "$m" >/dev/null 2>&1 || { echo "pulling $m"; ollama pull "$m"; }
done
cd "$ROOT/packages/local-runtime"
pnpm exec tsx src/cli.ts export-models --source "$STORE" --dest "$ROOT/apps/desktop/models" --models "$MODELS"
du -sh "$ROOT/apps/desktop/models"
