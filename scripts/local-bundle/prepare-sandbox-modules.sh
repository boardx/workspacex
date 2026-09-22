#!/usr/bin/env bash
# Materialise the skill sandbox's preinstalled modules (pptxgenjs, docx, exceljs, pdf-lib, ...)
# as a FLAT, REAL directory tree -- the same `npm ci --omit=dev` the sandbox Docker image runs
# (apps/skill-sandbox/Dockerfile). The pnpm workspace layout cannot be used directly: Node's
# permission model does not follow pnpm's second-level symlinks (execute-script.ts header).
#
# Destination: apps/skill-sandbox/preinstalled/node_modules. local-runtime sets
# SKILL_SANDBOX_MODULES_DIR to it when present; electron-builder ships apps/skill-sandbox/**
# so the DMG carries it too. Without it every `require('pptxgenjs')` in a skill script fails
# with MODULE_NOT_FOUND and the model "fixes" the script by dropping the require (Mac实测
# 2026-09-17: exit 0, no file, then a made-up "已生成").
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/apps/skill-sandbox"
DEST="$SRC/preinstalled"
if [ -d "$DEST/node_modules/pptxgenjs" ] && [ "${FORCE:-}" != "1" ]; then
  echo "sandbox modules already present: $DEST/node_modules (FORCE=1 to reinstall)"; exit 0
fi
rm -rf "$DEST"; mkdir -p "$DEST"
cp "$SRC/package.json" "$SRC/package-lock.json" "$DEST/"
( cd "$DEST" && npm ci --omit=dev --ignore-scripts=false --no-audit --no-fund ${NPM_REGISTRY:+--registry "$NPM_REGISTRY"} )
rm -f "$DEST/package.json" "$DEST/package-lock.json"
node -e "for (const m of ['pptxgenjs','docx','exceljs','pdf-lib']) require('$DEST/node_modules/'+m); console.log('sandbox modules ready:', '$DEST/node_modules')"
