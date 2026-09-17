#!/usr/bin/env bash
# Build the deep-agent-service Python runtime for the local/desktop build (issue #3716).
#
# Mirrors apps/deep-agent-service/Dockerfile step for step, on the host instead of in a
# container: uv resolves the frozen lock into a venv at apps/deep-agent-service/.venv.
# `uv` fetches a managed CPython if the host has none (python-build-standalone), which is
# also what a relocatable installer bundle needs.
#
# Network is required once (PyPI + python download). Re-runs are no-ops when the lock is
# unchanged. Output: the .venv that `packages/local-runtime` looks for.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SVC="$ROOT/apps/deep-agent-service"
PYPI_INDEX_URL="${PYPI_INDEX_URL:-https://pypi.org/simple}"

command -v uv >/dev/null 2>&1 || { echo "uv not found: https://docs.astral.sh/uv/ (brew install uv | winget install astral-sh.uv)" >&2; exit 1; }

cd "$SVC"
uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file .requirements.lock >/dev/null
uv venv --python 3.11 --allow-existing .venv
uv pip install --python .venv --require-hashes --no-cache --default-index "$PYPI_INDEX_URL" -r .requirements.lock
rm -f .requirements.lock
echo "deep-agent-service runtime ready: $SVC/.venv"
"$SVC/.venv/bin/python" -c "import deepagents, langgraph; print('deepagents', deepagents.__version__ if hasattr(deepagents,'__version__') else 'ok')" 2>/dev/null || true
