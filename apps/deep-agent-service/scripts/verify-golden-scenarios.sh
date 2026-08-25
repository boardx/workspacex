#!/usr/bin/env bash
# verify-golden-scenarios.sh —— TC-1~TC-5 黄金压测场景一键跑（DA-09，issue #2051）。
#
# 五条场景里 TC-1~TC-4 是纯进程内的，`pytest tests/golden` 直接就能跑；只有 TC-5
# 需要真 Postgres（它要 SIGKILL 一个真进程再从 checkpoint 续跑）。这个脚本负责
# 起一个一次性 Postgres、跑完五条、退出时把栈销毁——照抄
# verify-deep-agent-postgres-recovery.sh 的同一套模式（同一个 compose 文件、
# 同一套随机端口 + trap 清理），不新造基础设施。
#
# 只想在同一套一次性 Postgres 上跑别的目标（比如全量 tests/）：
#   GOLDEN_PYTEST_TARGET=tests bash apps/deep-agent-service/scripts/verify-golden-scenarios.sh
#
# 产物：证据目录（默认 apps/deep-agent-service/.golden-evidence/<utc>/，可用
# DEEP_AGENT_GOLDEN_EVIDENCE_DIR 指到别处），逐场景一个 JSON，直接归档进
# .harness/state/deepagent-eval/<date>-<sha>/ 即可作为 rubric 的物理证据。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
service_dir="$repo_root/apps/deep-agent-service"
compose_file="$repo_root/apps/api/docker-compose.dev.yml"
project_name="wsx-da09-golden-$$"
pg_port="$(
  python3 - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"
db_name="wsx_da09_golden"

cleanup() {
  PGPORT="$pg_port" docker compose -f "$compose_file" -p "$project_name" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

PGPORT="$pg_port" docker compose -f "$compose_file" -p "$project_name" up -d postgres >/dev/null

for _ in {1..60}; do
  if PGPORT="$pg_port" docker compose -f "$compose_file" -p "$project_name" \
    exec -T postgres pg_isready -U postgres -d workspacex >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

PGPORT="$pg_port" docker compose -f "$compose_file" -p "$project_name" \
  exec -T postgres pg_isready -U postgres -d workspacex >/dev/null
PGPORT="$pg_port" docker compose -f "$compose_file" -p "$project_name" \
  exec -T postgres createdb -U postgres "$db_name" 2>/dev/null || true

cd "$service_dir"
# 两个变量指同一个一次性库：TC-5 用前者，guided_research 那条恢复测试用后者——
# GOLDEN_PYTEST_TARGET=tests 时它也在收集范围里，不给它库就会以 pytest.fail 早退，
# 那是缺环境不是缺能力，别让它污染这个脚本的红绿。
DEEP_AGENT_TEST_POSTGRES_URL="postgresql://postgres:postgres_dev@127.0.0.1:${pg_port}/${db_name}" \
GUIDED_RESEARCH_TEST_POSTGRES_URL="postgresql://postgres:postgres_dev@127.0.0.1:${pg_port}/${db_name}" \
  uv run --extra dev pytest "${GOLDEN_PYTEST_TARGET:-tests/golden}" -v "$@"
