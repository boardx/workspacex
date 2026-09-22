#!/usr/bin/env bash
# Build a RELOCATABLE Python runtime for deep-agent-service so the DMG works on a Mac that
# is not the build machine (issue #3716, human decision 2026-09-17: "做 1").
#
# Why not ship apps/deep-agent-service/.venv: a venv hard-codes the interpreter it was created
# from (pyvenv.cfg `home`, bin/python symlink, every console-script shebang) -- all absolute
# paths on the build machine. On another Mac none of them exist and uvicorn never starts.
#
# Shape (apps/desktop/python/, picked up by electron-builder as resources/python):
#   cpython/   python-build-standalone CPython 3.11 (uv's managed download, @executable_path
#              linked, no absolute paths) -- the interpreter
#   site/      `uv pip install --target` of the frozen lock -- plain site-packages, no venv,
#              no console scripts; launched as `cpython/bin/python3 -m uvicorn` with
#              PYTHONPATH=site:apps/deep-agent-service/src (packages/local-runtime up.ts)
#
# Self-check at the end: the tree is copied to a throwaway path and imported from there with
# HOME pointed at an empty dir, and no file in the tree may mention the build directory.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SVC="$ROOT/apps/deep-agent-service"
OUT="${1:-$ROOT/apps/desktop/python}"
PY_VERSION="${PY_VERSION:-3.11}"
PYPI_INDEX_URL="${PYPI_INDEX_URL:-https://pypi.org/simple}"

command -v uv >/dev/null 2>&1 || { echo "uv not found: https://docs.astral.sh/uv/" >&2; exit 1; }

# 1. interpreter: uv's managed CPython is python-build-standalone (relocatable install tree)
uv python install "$PY_VERSION" >/dev/null
SRC_PY="$(uv python find --managed-python "$PY_VERSION")"        # .../cpython-3.11.x-.../bin/python3.11
# `uv python find` answers through the version alias (cpython-3.11-… -> cpython-3.11.16-…), a
# symlink; `pwd -P` + copying the directory CONTENTS keeps the copy from being that symlink
# (first cut of this script shipped a symlink into the build machine's uv store, 2026-09-17).
SRC_DIR="$(cd "$(dirname "$SRC_PY")/.." && pwd -P)"
rm -rf "$OUT"; mkdir -p "$OUT/cpython"
cp -R "$SRC_DIR/." "$OUT/cpython/"
# trim what a runtime never needs (tests, headers, static libs, idle/tk) -- ~30 MB
PYLIB="$OUT/cpython/lib/python$PY_VERSION"
rm -rf "$OUT/cpython/include" "$OUT/cpython/share" "$PYLIB/test" "$PYLIB/idlelib" "$PYLIB/tkinter" "$PYLIB/turtledemo" \
       "$PYLIB/ensurepip" "$PYLIB/lib2to3" "$PYLIB/config-$PY_VERSION"*/libpython*.a 2>/dev/null || true
find "$OUT/cpython" -name '__pycache__' -type d -prune -exec rm -rf {} +
PY="$OUT/cpython/bin/python$PY_VERSION"

# 2. dependencies: frozen lock -> plain --target site dir (no venv, no shebangs)
cd "$SVC"
uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file "$OUT/requirements.lock" >/dev/null
uv pip install --python "$PY" --target "$OUT/site" --require-hashes --no-cache --default-index "$PYPI_INDEX_URL" -r "$OUT/requirements.lock" >/dev/null
rm -rf "$OUT/site/bin"                      # console scripts carry absolute shebangs; unused
find "$OUT/site" -name '__pycache__' -type d -prune -exec rm -rf {} +

# 3. counter-proof: nothing links or points outside the tree; no build-machine path inside;
#    imports work from a different location with an empty HOME and the uv store unreachable.
if [ -L "$OUT/cpython" ] || find "$OUT" -type l -exec readlink {} + | grep -q '^/'; then
  echo "bundle-python: the runtime tree contains absolute symlinks (would point at the build machine):" >&2
  find "$OUT" -type l -exec readlink {} + | grep '^/' | head -5 >&2
  exit 1
fi
UV_STORE="$(dirname "$SRC_DIR")"
for needle in "$ROOT" "$UV_STORE"; do
  if grep -rIl --exclude='requirements.lock' --exclude='_sysconfigdata*' -- "$needle" "$OUT" | head -1 | grep -q .; then
    echo "bundle-python: build-machine path '$needle' leaked into the runtime tree:" >&2
    grep -rIl --exclude='requirements.lock' --exclude='_sysconfigdata*' -- "$needle" "$OUT" | head -5 >&2
    exit 1
  fi
done
# libpython's install name is the uv store path (uv rewrites it); the interpreter is statically
# linked and no wheel links against it, but make the id relative so nothing can ever resolve it.
if [ -f "$OUT/cpython/lib/libpython$PY_VERSION.dylib" ]; then
  install_name_tool -id "@rpath/libpython$PY_VERSION.dylib" "$OUT/cpython/lib/libpython$PY_VERSION.dylib" 2>/dev/null || true
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp -R "$OUT" "$TMP/moved"; mkdir -p "$TMP/home"
HOME="$TMP/home" PYTHONNOUSERSITE=1 PYTHONPATH="$TMP/moved/site:$SVC/src" \
  "$TMP/moved/cpython/bin/python$PY_VERSION" -c "
import sys, uvicorn, deepagents, langgraph, psycopg, deep_agent_service.http_app
import os; assert os.path.realpath(sys.prefix).startswith(os.path.realpath('$TMP/moved')), 'prefix still points at the build machine: ' + sys.prefix
print('relocatable python ok:', sys.version.split()[0], 'prefix', sys.prefix)"
echo "deep-agent-service relocatable runtime ready: $OUT ($(du -sh "$OUT" | cut -f1))"
