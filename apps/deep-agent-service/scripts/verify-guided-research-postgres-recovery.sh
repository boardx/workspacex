#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
service_dir="$repo_root/apps/deep-agent-service"
compose_file="$repo_root/apps/api/docker-compose.dev.yml"
project_name="wsx-f195-postgres-recovery-$$"
pg_port="$(
  python3 - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"
db_name="wsx_f195_postgres_recovery"

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
GUIDED_RESEARCH_TEST_POSTGRES_URL="postgresql://postgres:postgres_dev@127.0.0.1:${pg_port}/${db_name}" \
  uv run pytest tests/test_guided_research_postgres_recovery.py
