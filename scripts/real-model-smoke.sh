#!/usr/bin/env bash
# real-model-smoke.sh —— 本地（Mac/Linux）一条命令跑通**真实模型** PDF 用例（issue #2802）。
#
# 别直接调它，调这个（隔离外壳负责端口/库名/compose 项目名）：
#   pnpm run e2e:real-model-smoke
#
# 它做什么：
#   ① 装载凭据（$WORKSPACEX_ENV_FILE，默认 ./.env.local；缺变量逐个点名后红退）
#   ② 起本地真栈（`e2e-up.sh`：docker 依赖服务 + 技能沙箱 + 接真实 dashscope 的 API）
#   ③ 跑 `playwright.real-model-smoke.config.ts`（它自己起前端；spec 与 devapp lane 同一份）
#   ④ 把后端日志脱敏后收进同一个证据包目录
#   ⑤ 收尾：把自己起的东西全部放掉（agent-resource-cleanup-sop.md：孤儿 compose 栈
#      堆积会把 Docker daemon 拖崩，这不是理论风险，是 2026-08-08 的实测事故）
#
# ⚠ 凭据只在进程内部流转，绝不 echo；写进证据包的每一份日志都过 `scrub-file.ts`。
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# shellcheck source=scripts/real-model-env.sh
source "${REPO_ROOT}/scripts/real-model-env.sh"
real_model_load_env_file "$REPO_ROOT"
real_model_require_isolation
real_model_require_credentials "dashscope 真实模型" DASHSCOPE_API_KEY DASHSCOPE_BASE_URL DASHSCOPE_MODEL

EVIDENCE_DIR="${REAL_MODEL_E2E_EVIDENCE_DIR:-${REPO_ROOT}/apps/web/test-results/real-model-evidence}"
mkdir -p "$EVIDENCE_DIR"
STACK_LOG="${EVIDENCE_DIR}/50-stack-up.log"

cleanup() {
  local code=$?
  echo ""
  echo "[real-model-smoke] 收尾：释放本轮起的资源"
  for pidfile in /tmp/e2e-api.pid /tmp/e2e-sandbox.pid; do
    if [ -f "$pidfile" ]; then
      kill "$(cat "$pidfile")" 2>/dev/null || true
      rm -f "$pidfile"
    fi
  done
  [ -n "${STACK_PID:-}" ] && kill "$STACK_PID" 2>/dev/null || true
  docker compose -f apps/api/docker-compose.dev.yml -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
  echo "[real-model-smoke] 证据包：$EVIDENCE_DIR"
  exit $code
}
trap cleanup EXIT

echo "[real-model-smoke] ① 起本地真栈（日志 → $STACK_LOG）"
# e2e-up.sh 末尾是 `wait`（它要一直持有 API/沙箱两个子进程），所以放后台跑，
# 就绪与否用 healthz 判——不靠解析它的 stdout。
bash "${REPO_ROOT}/e2e-up.sh" > "$STACK_LOG" 2>&1 &
STACK_PID=$!

echo "[real-model-smoke] ② 等 API 就绪（127.0.0.1:${WORKSPACEX_API_PORT}/healthz，上限 5 分钟）"
READY=0
for _ in $(seq 1 150); do
  if curl -sf "http://127.0.0.1:${WORKSPACEX_API_PORT}/healthz" >/dev/null 2>&1; then READY=1; break; fi
  if ! kill -0 "$STACK_PID" 2>/dev/null; then
    echo "✗ 起栈进程已退出——见 $STACK_LOG 末尾" >&2
    tail -30 "$STACK_LOG" >&2 || true
    exit 1
  fi
  sleep 2
done
[ "$READY" = "1" ] || { echo "✗ API 5 分钟内没有就绪，见 $STACK_LOG" >&2; exit 1; }
echo "[real-model-smoke] API 就绪"

echo "[real-model-smoke] ③ 跑真实模型 spec（与 devapp lane 同一份 spec）"
# 账号用 fullstack 种子里的那一位（`e2e-up.sh` 刚种出来的），显式 opt-in ——
# 不是"找不到凭据就自己挑一个"的静默兜底，见 real-model-smoke-fixture.ts 头注。
export REAL_MODEL_E2E_LANE="local"
export REAL_MODEL_E2E_USE_FULLSTACK_SEED=1
export REAL_MODEL_E2E_BASE_URL="http://127.0.0.1:${WORKSPACEX_WEB_PORT}"
export REAL_MODEL_E2E_START_WEB=1
export REAL_MODEL_E2E_EVIDENCE_DIR="$EVIDENCE_DIR"
SPEC_EXIT=0
# 与 devapp lane 调的是**同一条** npm script —— playwright 的调用只声明一次。
pnpm run e2e:real-model-smoke:raw || SPEC_EXIT=$?

echo "[real-model-smoke] ④ 收后端日志（脱敏后进证据包）"
pnpm --filter web exec tsx e2e/support/scrub-file.ts /tmp/e2e-api.log "${EVIDENCE_DIR}/60-api.log" 4000 || true
pnpm --filter web exec tsx e2e/support/scrub-file.ts /tmp/e2e-sandbox.log "${EVIDENCE_DIR}/61-skill-sandbox.log" 2000 || true

exit $SPEC_EXIT
