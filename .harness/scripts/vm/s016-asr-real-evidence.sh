#!/usr/bin/env bash
# Main-only DevApp driver for the S016 supported-provider ASR acceptance (#2932).
set -euo pipefail
cd "$(dirname "$0")/../../.."
EVIDENCE_DIR="${WX_ASR_REAL_EVIDENCE:?WX_ASR_REAL_EVIDENCE is required}"
ENV_FILE="${S016_ASR_ENV_FILE:-/opt/workspacex/deploy.env}"
RUN_ENV_FILE="${RUNNER_TEMP:-/tmp}/s016-asr-real.env"
RAW_LOG="${RUNNER_TEMP:-/tmp}/s016-asr-real-raw.log"
ASR_KEYS=(KERNEL_ASR_PROVIDER KERNEL_ASR_BASE_URL KERNEL_ASR_API_KEY KERNEL_ASR_MODEL)

preflight() {
  mkdir -p "$EVIDENCE_DIR"
  local readable=MISSING
  if [ -r "$ENV_FILE" ]; then
    readable=PRESENT
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
  local missing=0 name status
  : > "$EVIDENCE_DIR/01-preflight.txt"
  echo "DEPLOY_ENV_READABLE=$readable" | tee -a "$EVIDENCE_DIR/01-preflight.txt"
  for name in "${ASR_KEYS[@]}"; do
    status=MISSING
    if [ -n "${!name:-}" ]; then status=PRESENT; else missing=1; fi
    printf '%s=%s\n' "$name" "$status" | tee -a "$EVIDENCE_DIR/01-preflight.txt"
  done
  if [ "$missing" -ne 0 ]; then
    echo 'ASR_CONFIG_READY=MISSING' | tee -a "$EVIDENCE_DIR/01-preflight.txt"
    return 1
  fi
  echo 'ASR_CONFIG_READY=PRESENT' | tee -a "$EVIDENCE_DIR/01-preflight.txt"
  umask 077
  {
    for name in "${ASR_KEYS[@]}"; do printf '%s=%q\n' "$name" "${!name}"; done
  } > "$RUN_ENV_FILE"
  chmod 600 "$RUN_ENV_FILE"
}

scrub() {
  set -a
  # shellcheck disable=SC1090
  source "$RUN_ENV_FILE"
  set +a
  pnpm --filter web exec tsx e2e/support/scrub-file.ts "$RAW_LOG" "$EVIDENCE_DIR/03-run.log" 10000
  local file temporary
  while IFS= read -r -d '' file; do
    temporary="${file}.scrubbed"
    pnpm --filter web exec tsx e2e/support/scrub-file.ts "$file" "$temporary" 1000000
    mv "$temporary" "$file"
  done < <(find "$EVIDENCE_DIR" -type f \( -name '*.json' -o -name '*.txt' \) -print0)
}

cleanup() { rm -f "$RUN_ENV_FILE" "$RAW_LOG"; }

case "${1:-}" in
  preflight) preflight ;;
  scrub) scrub ;;
  cleanup) cleanup ;;
  *) echo 'usage: s016-asr-real-evidence.sh {preflight|scrub|cleanup}' >&2; exit 2 ;;
esac
