#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-readiness.sh"

deploy_status_content_allows_recovery() {
  local content=$1 nonce=$2 root_status=$3
  local expected
  printf -v expected 'protocol=workspacex-deploy/v1\nnonce=%s\nstage=smoke\nexit=%s' "$nonce" "$root_status"
  [[ "$content" == "$expected" ]]
}

root_owned_status_allows_recovery() {
  local nonce=$1 root_status=$2
  local status_dir=/run/workspacex-deploy
  local status_file="${status_dir}/${nonce}.status"
  local content

  [[ "$nonce" =~ ^[0-9a-f]{32}$ ]] || return 1
  [[ "$(/usr/bin/stat -c '%u:%a' "$status_dir" 2>/dev/null)" == "0:755" ]] || return 1
  [[ "$(/usr/bin/stat -c '%u:%a' "$status_file" 2>/dev/null)" == "0:644" ]] || return 1
  content=$(<"$status_file") || return 1
  deploy_status_content_allows_recovery "$content" "$nonce" "$root_status"
}

deploy_gate_main() {
  local root_deploy_status nonce

  if (($# != 1)); then
    echo "usage: deploy-gate.sh <git-ref>" >&2
    return 2
  fi
  nonce=$(/usr/bin/openssl rand -hex 16)
  [[ "$nonce" =~ ^[0-9a-f]{32}$ ]] || { echo "✗ could not create deploy invocation nonce" >&2; return 1; }

  set +e
  sudo /usr/local/bin/workspacex-deploy "$1" --status-nonce "$nonce"
  root_deploy_status=$?
  set -e

  if ((root_deploy_status != 0)); then
    if ! root_owned_status_allows_recovery "$nonce" "$root_deploy_status"; then
      echo "✗ trusted deploy failed and root-owned invocation status contract was absent or invalid; refusing recovery" >&2
      print_deploy_diagnostics
      return "$root_deploy_status"
    fi
    echo "  trusted deploy entered smoke but returned ${root_deploy_status}; applying the stable postcondition gate"
  fi

  run_post_restart_smoke
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  deploy_gate_main "$@"
fi
