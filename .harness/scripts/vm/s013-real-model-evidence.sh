#!/usr/bin/env bash
# Main-only DevApp driver for the bounded S013 web-artifact acceptance (#2958).
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"
source "${REPO_ROOT}/scripts/real-model-env.sh"

EVIDENCE_DIR="${WX_AUDIO_REAL_EVIDENCE:?WX_AUDIO_REAL_EVIDENCE is required}"
RUN_ENV_FILE="${RUNNER_TEMP:-/tmp}/s013-real-model.env"
ENV_FILE="${S013_REAL_MODEL_ENV_FILE:-/opt/workspacex/deploy.env}"
BROWSER_COMPOSE="${REPO_ROOT}/apps/browser-runtime/docker-compose.browser.yml"
BROWSER_PROJECT="${S013_BROWSER_PROJECT:-wsx-browser-runtime}"
BROWSER_PROBE="${REPO_ROOT}/.harness/scripts/vm/browser-mcp-probe.mjs"

# The isolated Playwright MCP stack. Nothing else on this host deploys it: `vm/deploy.sh`
# never mentions the browser, so before #2930 the lane pointed at 127.0.0.1:58931 with
# nothing listening, and the first `browser_navigate` died inside the model turn as an
# opaque StandardBrowserError. Start it here, prove it live, and always release it.
browser_up() {
  set -a
  # shellcheck disable=SC1091
  . "${REPO_ROOT}/apps/browser-runtime/image-digests.env"
  set +a
  docker compose -f "$BROWSER_COMPOSE" -p "$BROWSER_PROJECT" up -d
}

# `up -d` returns as soon as containers are created — that is not readiness. Poll the real
# MCP handshake instead; a published port with a browser still booting looks identical to a
# working runtime until the model asks it to navigate.
browser_ready() {
  local attempt
  for attempt in $(seq 1 30); do
    if node "$BROWSER_PROBE"; then return 0; fi
    echo "[s013] browser MCP not ready yet (attempt ${attempt}/30); retrying in 2s." >&2
    sleep 2
  done
  echo "✗ [s013] 浏览器运行时 60 秒内没有就绪——不继续跑真实模型验收。" >&2
  docker compose -f "$BROWSER_COMPOSE" -p "$BROWSER_PROJECT" ps >&2 || true
  docker compose -f "$BROWSER_COMPOSE" -p "$BROWSER_PROJECT" logs --tail 80 >&2 || true
  return 1
}

browser_down() {
  docker compose -f "$BROWSER_COMPOSE" -p "$BROWSER_PROJECT" down -v --remove-orphans || true
}

preflight() {
  mkdir -p "$EVIDENCE_DIR"
  WORKSPACEX_ENV_FILE="$ENV_FILE" real_model_load_env_file "$REPO_ROOT"
  real_model_require_credentials "S013 provider" DASHSCOPE_API_KEY DASHSCOPE_BASE_URL DASHSCOPE_MODEL
  real_model_require_vars "S013 runtime" WX_NATIVE_SANDBOX_CONTAINER WX_AUDIO_REAL_EVIDENCE WORKSPACEX_BROWSER_MCP_ENDPOINT
  docker inspect "$WX_NATIVE_SANDBOX_CONTAINER" >/dev/null
  # A set endpoint string is not a runtime. The workflow hardcodes WORKSPACEX_BROWSER_MCP_ENDPOINT
  # in `env:`, so the presence check above can never go red — it measures nothing. The handshake
  # below is the check that can actually fail (#2930).
  browser_ready | tee "$EVIDENCE_DIR/01-browser-mcp.txt"

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
    echo 'WORKSPACEX_BROWSER_MCP_ENDPOINT=LIVE'
  } > "$EVIDENCE_DIR/01-preflight.txt"
}

scrub() {
  local raw_log="${1:?raw log required}"
  # scrubSecrets removes exact credential values only when they are available to
  # this process. Load the ephemeral 0600 file without echoing it.
  #
  # #2930: `scrub` also runs on the failure path (`if: always()`), where preflight
  # may have died BEFORE minting the ephemeral file. Sourcing it unconditionally
  # then failed with "No such file or directory" and became the last error in the
  # log — burying preflight's real message (the actual cause) under an unrelated
  # one. A run that never reached the provider cannot have an exact credential in
  # its log, so scrub with the generic patterns instead of dying here.
  if [ -f "$RUN_ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$RUN_ENV_FILE"
    set +a
  else
    echo "[s013] ${RUN_ENV_FILE} absent — preflight failed before any credential was used; pattern-only scrub." >&2
  fi
  mkdir -p "$EVIDENCE_DIR"
  # Same reason: the raw log may not exist yet when preflight fails early.
  [ -f "$raw_log" ] || : > "$raw_log"
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
  browser-up) browser_up ;;
  browser-down) browser_down ;;
  preflight) preflight ;;
  scrub) scrub "${2:-}" ;;
  cleanup) cleanup ;;
  *) echo "usage: $0 {browser-up|browser-down|preflight|scrub <raw-log>|cleanup}" >&2; exit 2 ;;
esac
