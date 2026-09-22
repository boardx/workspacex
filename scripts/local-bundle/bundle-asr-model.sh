#!/usr/bin/env bash
# Put the streaming ASR model into the desktop bundle (apps/desktop/asr-models/<model>), fp32
# files only (the gateway ignores the int8 variants): ~300 MB instead of 530 MB. Downloads via
# fetch-asr-model.sh into a temp store first if the data dir does not already have it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${ASR_MODEL_NAME:-sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20}"
SRC_ROOT="${1:-$HOME/.workspacex-local/asr-models}"
DEST="$ROOT/apps/desktop/asr-models/$MODEL"
if [ ! -f "$SRC_ROOT/$MODEL/tokens.txt" ]; then "$ROOT/scripts/local-bundle/fetch-asr-model.sh" "$SRC_ROOT"; fi
mkdir -p "$DEST"
for f in tokens.txt bpe.model bpe.vocab README.md encoder-epoch-99-avg-1.onnx decoder-epoch-99-avg-1.onnx joiner-epoch-99-avg-1.onnx; do
  [ -f "$SRC_ROOT/$MODEL/$f" ] && cp "$SRC_ROOT/$MODEL/$f" "$DEST/$f"
done
[ -f "$DEST/tokens.txt" ] && [ -f "$DEST/encoder-epoch-99-avg-1.onnx" ] || { echo "bundle incomplete" >&2; exit 1; }
du -sh "$DEST"; echo "asr model bundled: $DEST"
