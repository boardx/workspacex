#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# ⚠ 凭据只在本脚本内部 source，绝不 echo、绝不 dump 环境表
set -a; source /Users/shenyanbin/Documents/workspacex/.env.local; set +a
SB=8793
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
KERNEL_MODEL_PROVIDER=dashscope \
KERNEL_MODEL_BASE_URL="$DASHSCOPE_BASE_URL" \
KERNEL_MODEL_API_KEY="$DASHSCOPE_API_KEY" \
KERNEL_SKILL_TRIALRUN_MODEL_ID="$DASHSCOPE_MODEL" \
KERNEL_MODEL_TIMEOUT_MS=600000 \
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
