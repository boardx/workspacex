#!/usr/bin/env bash
# Narrow runner capability: immutable source export only; no staging/write mode.
set -euo pipefail
[[ ${EUID} -eq 0 && $# -eq 3 ]] || exit 2
[[ "$1" =~ ^[a-f0-9]{40}$ && "$2" =~ ^[a-f0-9]{40}$ && "$3" =~ ^gha-[0-9]+-[0-9]+$ ]] || exit 2
exec /usr/local/lib/workspacex-cn/stage-cn-offline-source-cache.sh --export-bundle "$@"
