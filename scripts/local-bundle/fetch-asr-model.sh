#!/usr/bin/env bash
# Download the streaming bilingual (zh + en) Zipformer model for the local ASR gateway.
#
# Source: k2-fsa/sherpa-onnx GitHub release "asr-models". ~ 300 MB unpacked (fp32 + int8
# variants); the gateway prefers the fp32 files and ignores int8 ones.
#
# Destination: $1 or ~/.workspacex-local/asr-models/<model-name>. local-runtime looks there.
set -euo pipefail
MODEL="${ASR_MODEL_NAME:-sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20}"
DEST_ROOT="${1:-$HOME/.workspacex-local/asr-models}"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2"
mkdir -p "$DEST_ROOT"
if [ -f "$DEST_ROOT/$MODEL/tokens.txt" ]; then
  echo "model already present: $DEST_ROOT/$MODEL"; exit 0
fi
TMP="$(mktemp -d)"
echo "downloading $URL"
curl -fL --retry 3 -o "$TMP/model.tar.bz2" "$URL"
tar -xjf "$TMP/model.tar.bz2" -C "$DEST_ROOT"
rm -rf "$TMP"
# drop test wavs to save space; keep onnx + tokens
rm -rf "$DEST_ROOT/$MODEL/test_wavs" 2>/dev/null || true
ls -la "$DEST_ROOT/$MODEL"
echo "model ready: $DEST_ROOT/$MODEL"
