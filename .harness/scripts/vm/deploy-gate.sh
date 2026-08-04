#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-readiness.sh"

DEPLOY_LOG=$(mktemp "${TMPDIR:-/tmp}/workspacex-deploy.XXXXXX")
trap 'rm -f "$DEPLOY_LOG"' EXIT

set +e
sudo /usr/local/bin/workspacex-deploy "$@" 2>&1 | tee "$DEPLOY_LOG"
root_deploy_status=${PIPESTATUS[0]}
set -e

if ((root_deploy_status != 0)); then
  if ! grep -Fq '══════ 7. 冒烟' "$DEPLOY_LOG"; then
    echo "✗ trusted deploy failed before post-restart smoke; refusing recovery" >&2
    print_deploy_diagnostics
    exit "$root_deploy_status"
  fi
  echo "  trusted deploy reached smoke but returned ${root_deploy_status}; applying the stable postcondition gate"
fi

run_post_restart_smoke
