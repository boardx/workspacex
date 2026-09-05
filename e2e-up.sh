#!/usr/bin/env bash
# e2e-up.sh —— 起一套**接真实模型**的本地全栈（postgres/redis/minio + 技能沙箱 + API）。
#
# 用法（必须经隔离外壳，端口/库名/compose 项目名都由它派生）：
#   pnpm exec tsx .harness/scripts/with-test-isolation.ts -- ./e2e-up.sh
# 或者直接跑封装好的一条命令（起栈 + 跑真实模型 spec + 收证据）：
#   pnpm run e2e:real-model-smoke
#
# 凭据从哪来（issue #2802 之前这里写死了一台 Mac 的绝对路径）：
#   $WORKSPACEX_ENV_FILE，默认仓库根的 ./.env.local；文件不在就用已导出的环境变量。
#   缺变量 ⇒ 逐个点名后红退，**绝不静默退回回环模型**。装载与校验的唯一事实源是
#   `scripts/real-model-env.sh`，本文件不再自己解析路径。
#
# ⚠ 凭据只在本脚本内部 source，绝不 echo、绝不 dump 环境表。
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(pwd)"

# shellcheck source=scripts/real-model-env.sh
source "${REPO_ROOT}/scripts/real-model-env.sh"
real_model_load_env_file "$REPO_ROOT"
real_model_require_isolation
# 真实模型上游三件套。缺任何一个都不许继续——回环模型伪装成"真实模型跑通了"
# 正是 #2802 的整条 issue。
real_model_require_credentials "dashscope 真实模型" DASHSCOPE_API_KEY DASHSCOPE_BASE_URL DASHSCOPE_MODEL

SB="${SKILL_SANDBOX_PORT:-8793}"
docker compose -f apps/api/docker-compose.dev.yml -p "$COMPOSE_PROJECT_NAME" up -d --wait postgres redis minio
SKILL_SANDBOX_PORT=$SB pnpm --filter @repo/skill-sandbox exec tsx src/main.ts > /tmp/e2e-sandbox.log 2>&1 &
echo $! > /tmp/e2e-sandbox.pid
sleep 5
pnpm --filter web exec tsx e2e/dump-fixture-env.ts > /tmp/e2e-fixture.sh
source /tmp/e2e-fixture.sh
export FULLSTACK_E2E_AGENT_MODEL_PROVIDER=dashscope
export FULLSTACK_E2E_AGENT_MODEL_ID="$DASHSCOPE_MODEL"
echo "ADMIN=$FULLSTACK_E2E_ADMIN_EMAIL"
echo "ORG=$FULLSTACK_E2E_ORG_ID"
echo "PROJECT=$FULLSTACK_E2E_PROJECT_ID"
echo "AGENT=$FULLSTACK_E2E_AGENT_ID"
pnpm --filter @repo/api exec tsx scripts/seed-fullstack-smoke.ts >/dev/null 2>&1
# KERNEL_DEEP_AGENT_BASE_URL 是**可选透传**：本机跑着 deep-agent-service 容器时
# （devapp 上是 127.0.0.1:2025）这条链路才跟线上一致；没起它时不伪造一个地址——
# `DeepAgentModelProvider` 会以 MODEL_PROVIDER_NOT_CONFIGURED 诚实失败，而不是
# 悄悄换一条别的路径然后把结果说成"线上同款"。证据包会记下这次到底走的是哪条。
KERNEL_MODEL_PROVIDER=dashscope \
KERNEL_MODEL_BASE_URL="$DASHSCOPE_BASE_URL" \
KERNEL_MODEL_API_KEY="$DASHSCOPE_API_KEY" \
KERNEL_SKILL_TRIALRUN_MODEL_ID="$DASHSCOPE_MODEL" \
KERNEL_MODEL_TIMEOUT_MS="${KERNEL_MODEL_TIMEOUT_MS:-600000}" \
KERNEL_SKILL_SANDBOX_BASE_URL="http://127.0.0.1:$SB" \
MODEL_CREDENTIAL_KEY="e2e-key-not-a-secret" \
KERNEL_ALLOW_TEST_PRINCIPAL=1 \
PORT=$WORKSPACEX_API_PORT FULLSTACK_E2E_FIXTURE=1 \
pnpm --filter @repo/api start > /tmp/e2e-api.log 2>&1 &
echo $! > /tmp/e2e-api.pid
for i in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$WORKSPACEX_API_PORT/healthz" >/dev/null 2>&1 && { echo "API_READY port=$WORKSPACEX_API_PORT sandbox=$SB"; break; }
  sleep 2
done
wait
