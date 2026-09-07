#!/usr/bin/env bash
# Main-only DevApp driver for the bounded S013 web-artifact acceptance (#2958).
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"
source "${REPO_ROOT}/scripts/real-model-env.sh"

EVIDENCE_DIR="${WX_AUDIO_REAL_EVIDENCE:?WX_AUDIO_REAL_EVIDENCE is required}"
RUN_ENV_FILE="${RUNNER_TEMP:-/tmp}/s013-real-model.env"
ENV_FILE="${S013_REAL_MODEL_ENV_FILE:-/opt/workspacex/deploy.env}"

preflight() {
  mkdir -p "$EVIDENCE_DIR"
  WORKSPACEX_ENV_FILE="$ENV_FILE" real_model_load_env_file "$REPO_ROOT"
  real_model_require_credentials "S013 provider" DASHSCOPE_API_KEY DASHSCOPE_BASE_URL DASHSCOPE_MODEL
  real_model_require_vars "S013 runtime" WX_NATIVE_SANDBOX_CONTAINER WX_AUDIO_REAL_EVIDENCE WORKSPACEX_BROWSER_MCP_ENDPOINT
  docker inspect "$WX_NATIVE_SANDBOX_CONTAINER" >/dev/null

  umask 077
  {
    printf 'DASHSCOPE_API_KEY=%q\n' "$DASHSCOPE_API_KEY"
    printf 'DASHSCOPE_BASE_URL=%q\n' "$DASHSCOPE_BASE_URL"
    printf 'DASHSCOPE_MODEL=%q\n' "$DASHSCOPE_MODEL"
  } > "$RUN_ENV_FILE"
  chmod 600 "$RUN_ENV_FILE"
  {
    echo 'DASHSCOPE_API_KEY=PRESENT'
    echo 'DASHSCOPE_BASE_URL=PRESENT'
    echo 'DASHSCOPE_MODEL=PRESENT'
    echo 'WX_NATIVE_SANDBOX_CONTAINER=PRESENT'
    echo 'WX_AUDIO_REAL_EVIDENCE=PRESENT'
    echo 'WORKSPACEX_BROWSER_MCP_ENDPOINT=PRESENT'
  } > "$EVIDENCE_DIR/01-preflight.txt"
}

scrub() {
  local raw_log="${1:?raw log required}"
  # scrubSecrets removes exact credential values only when they are available to
  # this process. Load the ephemeral 0600 file without echoing it.
  set -a
  # shellcheck disable=SC1090
  source "$RUN_ENV_FILE"
  set +a
  mkdir -p "$EVIDENCE_DIR"
  pnpm --filter web exec tsx e2e/support/scrub-file.ts "$raw_log" "$EVIDENCE_DIR/02-run.log" 5000
  while IFS= read -r -d '' file; do
    local temporary="${file}.scrubbed"
    pnpm --filter web exec tsx e2e/support/scrub-file.ts "$file" "$temporary" 1000000
    mv "$temporary" "$file"
  done < <(find "$EVIDENCE_DIR" -type f \( -name '*.json' -o -name '*.txt' -o -name '*.md' -o -name '*.html' \) -print0)
}

cleanup() {
  rm -f "$RUN_ENV_FILE" "${RUNNER_TEMP:-/tmp}/s013-real-model-raw.log"
}

case "${1:-}" in
  preflight) preflight ;;
  scrub) scrub "${2:-}" ;;
  cleanup) cleanup ;;
  *) echo "usage: $0 {preflight|scrub <raw-log>|cleanup}" >&2; exit 2 ;;
esac
