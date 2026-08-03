#!/usr/bin/env bash
# #74 acceptance: exactly five full-suite runs, never retrying a failed subset.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EVIDENCE="${ISSUE74_EVIDENCE:-${ROOT}/.harness/state/issue-74-db-isolation-evidence.md}"
STAMP="${ISSUE74_RUN_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
COMPOSE_FILE="${ROOT}/apps/api/docker-compose.dev.yml"
IDS=(
  "issue74-${STAMP}-1"
  "issue74-${STAMP}-reuse"
  "issue74-${STAMP}-reuse"
  "issue74-${STAMP}-4"
  "issue74-${STAMP}-5"
)
PROJECTS=()
OVERALL=0
TEMP_LOGS=()

make_raw_log() {
  local round="$1"
  # BSD and GNU mktemp both require the X run to terminate the template.
  mktemp "${TMPDIR:-/tmp}/issue74-round-${round}.XXXXXX"
}

check_tempfiles() {
  local first second
  first="$(make_raw_log self-test)"
  second="$(make_raw_log self-test)"
  if [ "${first}" = "${second}" ] || [ ! -f "${first}" ] || [ ! -f "${second}" ]; then
    rm -f -- "${first}" "${second}"
    echo "portable tempfile check failed" >&2
    return 1
  fi
  printf 'portable tempfile check passed: %s != %s\n' "$(basename "${first}")" "$(basename "${second}")"
  rm -f -- "${first}" "${second}"
}

if [ "${1:-}" = "--check-tempfiles" ]; then
  check_tempfiles
  exit 0
fi

cleanup() {
  local project raw_log
  for project in "${PROJECTS[@]:-}"; do
    [ -n "${project}" ] || continue
    docker compose -f "${COMPOSE_FILE}" -p "${project}" down -v >/dev/null 2>&1 || true
  done
  for raw_log in "${TEMP_LOGS[@]:-}"; do
    [ -n "${raw_log}" ] || continue
    rm -f -- "${raw_log}"
  done
}
trap cleanup EXIT

{
  echo "# Issue #74 database isolation stability evidence"
  echo
  echo "- commit: \`$(git -C "${ROOT}" rev-parse HEAD)\`"
  echo "- started_at: \`${STAMP}\`"
  echo "- command: \`pnpm --filter @repo/api run test:stability\`"
  echo "- policy: five complete runs; no failed-test retry; rounds 2 and 3 reuse one isolation id/database"
  echo
  echo "| round | isolation id | database | compose project | result | peak connections | failure set |"
  echo "|---:|---|---|---|---|---:|---|"
} > "${EVIDENCE}"

for index in 0 1 2 3 4; do
  round=$((index + 1))
  isolation_id="${IDS[$index]}"
  raw_log="$(make_raw_log "${round}")"
  TEMP_LOGS+=("${raw_log}")

  set +e
  (
    cd "${ROOT}"
    WORKSPACEX_ISOLATION_ID="${isolation_id}" \
    WORKSPACEX_KEEP_TEST_STACK=1 \
      pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api run test
  ) > "${raw_log}" 2>&1
  code=$?
  set -e

  marker="$(grep -m1 '^\[test-isolation\]' "${raw_log}" || true)"
  database="$(printf '%s\n' "${marker}" | sed -n 's/.* db=\([^ ]*\).*/\1/p')"
  project="$(printf '%s\n' "${marker}" | sed -n 's/.* compose=\([^ ]*\).*/\1/p')"
  peak="$(grep '^\[db-isolation\].*peak_connections=' "${raw_log}" | tail -1 | sed -n 's/.*peak_connections=\([0-9][0-9]*\).*/\1/p')"
  summary="$(grep -E '^ Test Files ' "${raw_log}" | tail -1 | sed 's/^[[:space:]]*//' || true)"
  failures="$(grep -E '^( FAIL | ❯ )' "${raw_log}" | sed 's/|/\\|/g' | paste -sd ';' - || true)"
  [ -n "${failures}" ] || failures="none"
  [ -n "${peak}" ] || peak="n/a"
  [ -n "${summary}" ] || summary="exit ${code} before Vitest summary"
  PROJECTS+=("${project}")

  printf '| %s | `%s` | `%s` | `%s` | %s | %s | %s |\n' \
    "${round}" "${isolation_id}" "${database}" "${project}" "${summary}" "${peak}" "${failures}" \
    >> "${EVIDENCE}"

  if [ "${code}" -ne 0 ]; then OVERALL=1; fi

  next_id="${IDS[$((index + 1))]:-}"
  if [ "${next_id}" != "${isolation_id}" ] && [ -n "${project}" ]; then
    docker compose -f "${COMPOSE_FILE}" -p "${project}" down -v >/dev/null
  fi
done

{
  echo
  echo "- finished_at: \`$(date -u +%Y-%m-%dT%H:%M:%SZ)\`"
  echo "- overall: $([ "${OVERALL}" -eq 0 ] && echo GREEN || echo RED)"
} >> "${EVIDENCE}"

cat "${EVIDENCE}"
exit "${OVERALL}"
