#!/usr/bin/env bash
# Put the streaming ASR model into the desktop bundle (apps/desktop/asr-models/<model>), fp32
# files only (the gateway ignores the int8 variants): ~300 MB instead of 530 MB. Downloads via
# fetch-asr-model.sh into a temp store first if the data dir does not already have it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${ASR_MODEL_NAME:-sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20}"
SRC_ROOT="${1:-$HOME/.workspacex-local/asr-models}"
# Git Bash 下传进来的常是 Windows 路径（D:\a\_temp\…）：GNU tar 把 `D:` 当成远程主机名
# （windows-latest 实测：tar: D\:\a\\_temp/asr-src: Cannot open）。统一成 POSIX 形式（#4315）。
command -v cygpath >/dev/null 2>&1 && SRC_ROOT="$(cygpath -u "$SRC_ROOT")"
DEST="$ROOT/apps/desktop/asr-models/$MODEL"
if [ ! -f "$SRC_ROOT/$MODEL/tokens.txt" ]; then "$ROOT/scripts/local-bundle/fetch-asr-model.sh" "$SRC_ROOT"; fi
mkdir -p "$DEST"
for f in tokens.txt bpe.model bpe.vocab README.md encoder-epoch-99-avg-1.onnx decoder-epoch-99-avg-1.onnx joiner-epoch-99-avg-1.onnx; do
  [ -f "$SRC_ROOT/$MODEL/$f" ] && cp "$SRC_ROOT/$MODEL/$f" "$DEST/$f"
done
[ -f "$DEST/tokens.txt" ] && [ -f "$DEST/encoder-epoch-99-avg-1.onnx" ] || { echo "bundle incomplete" >&2; exit 1; }
du -sh "$DEST"; echo "asr model bundled: $DEST"
