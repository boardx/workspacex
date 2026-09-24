#!/usr/bin/env bash
# WorkSpaceX 单机自托管升级（backlog E7）。文档：docs/deployment/SELF-HOST-UPGRADE.md
#
#   scripts/upgrade.sh [--env-file selfhost.env] [--ref origin/main] [--backup-dir DIR]
#                      [--skip-backup] [--api-service workspacex-api] [--dry-run]
#
# 步骤：①记录当前版本 → ②升级前备份（复用 @repo/cloud-deploy 的 starter-backup-cli）
#       → ③切到新版本并装依赖 → ④拉/构建镜像并重启依赖栈（根 compose.yaml）
#       → ⑤迁移（与 .harness/scripts/vm/deploy.sh 第 4 步同一条 migrate-cli）
#       → ⑥重启 API 宿主服务 → ⑦健康检查 → 打印回滚步骤。
# 任一步失败即退出（set -e），并打印回滚步骤。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/selfhost.env"
REF="origin/main"
BACKUP_DIR=""
SKIP_BACKUP=0
API_SERVICE="workspacex-api"
DRY=0
PROJECT="workspacex"   # 与 compose.yaml 的 name: 以及生产 deploy.sh 的 -p 一致

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    --api-service) API_SERVICE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

run() { echo "+ $*"; if [ "$DRY" != 1 ]; then "$@"; fi; }
step() { echo; echo "── $* ──"; }

[ -f "$ENV_FILE" ] || { echo "✗ 找不到 env 文件 $ENV_FILE（从 selfhost.env.example 复制并填写）" >&2; exit 1; }
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$ROOT"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
STATE_DIR="$ROOT/.selfhost/upgrades/$TS"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.selfhost/backups/$TS}"
PG_CONTAINER="${PROJECT}-postgres-1"
COMPOSE=(docker compose -p "$PROJECT" -f "$ROOT/compose.yaml" --env-file "$ENV_FILE")

step "① 记录当前版本"
OLD_REV="$(git rev-parse HEAD)"
NEW_REV=""
mkdir -p "$STATE_DIR"
printf 'old_rev=%s\nref=%s\nstarted_at=%s\n' "$OLD_REV" "$REF" "$TS" > "$STATE_DIR/state"
SOURCE_REVISION="${SOURCE_REVISION:-$OLD_REV}" "${COMPOSE[@]}" images > "$STATE_DIR/images-before.txt" 2>&1 || true
echo "  当前版本 $OLD_REV（记录于 $STATE_DIR）"

print_rollback() {
  cat <<ROLLBACK

── 回滚方法 ──
  1. 代码回到旧版本：   git -C "$ROOT" checkout --detach $OLD_REV && pnpm install --frozen-lockfile
  2. 依赖栈回到旧版本： SOURCE_REVISION=$OLD_REV docker compose -p $PROJECT -f compose.yaml --env-file "$ENV_FILE" up -d --build --wait
  3. 迁移只前进不回退——若新版本已跑过迁移，用升级前备份恢复数据库：
       WORKSPACEX_DEPLOY_PROFILE=starter STARTER_POSTGRES_CONTAINER=$PG_CONTAINER \\
       PGUSER=postgres PGDATABASE=${PGDATABASE:-workspacex} PGPASSWORD="\$MIGRATION_DB_PASSWORD" \\
       pnpm --filter @repo/cloud-deploy exec node --import tsx src/starter-backup-cli.ts restore "$BACKUP_DIR"
  4. 重启 API：         sudo systemctl restart $API_SERVICE
  （升级前镜像清单：$STATE_DIR/images-before.txt）
ROLLBACK
}
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then echo "✗ 升级失败（退出码 $rc）"; print_rollback; fi
}
trap on_exit EXIT

step "② 升级前备份"
if [ "$SKIP_BACKUP" = 1 ]; then
  echo "  ⚠ --skip-backup：跳过备份。失败时将无法回滚数据库。"
else
  mkdir -p "$(dirname "$BACKUP_DIR")"
  run env WORKSPACEX_DEPLOY_PROFILE=starter STARTER_POSTGRES_CONTAINER="$PG_CONTAINER" \
    PGUSER=postgres PGDATABASE="${PGDATABASE:-workspacex}" PGPASSWORD="${MIGRATION_DB_PASSWORD:?set MIGRATION_DB_PASSWORD}" \
    pnpm --filter @repo/cloud-deploy exec node --import tsx src/starter-backup-cli.ts backup "$BACKUP_DIR"
  echo "backup_dir=$BACKUP_DIR" >> "$STATE_DIR/state"
fi

step "③ 切到新版本 $REF"
run git fetch --tags origin
run git checkout --detach "$REF"
NEW_REV="$(git rev-parse HEAD)"
echo "new_rev=$NEW_REV" >> "$STATE_DIR/state"
run pnpm install --frozen-lockfile

step "④ 拉取/构建镜像并重启依赖栈"
export SOURCE_REVISION="$NEW_REV"
run "${COMPOSE[@]}" pull --ignore-buildable
# --build 不是可选项：compose 对带 build: 的服务只在镜像不存在时才构建（deploy.sh 2026-09-06 事故）。
run "${COMPOSE[@]}" up -d --build --wait

step "⑤ 数据库迁移（与 deploy.sh 第 4 步同一条命令）"
run pnpm --filter api exec tsx src/infrastructure/db/migrate-cli.ts
if [ -n "${APP_DB_PASSWORD:-}" ]; then
  # deploy.sh 4b：0001 迁移以开发默认密码建 app_rw，需对齐到 env 里的真实密码（幂等）。
  run docker exec "$PG_CONTAINER" psql -U postgres -d "${PGDATABASE:-workspacex}" \
    -c "ALTER ROLE app_rw PASSWORD '${APP_DB_PASSWORD}';"
fi

step "⑥ 重启 API"
if command -v systemctl >/dev/null 2>&1 && systemctl cat "$API_SERVICE.service" >/dev/null 2>&1; then
  run sudo systemctl restart "$API_SERVICE"
else
  echo "  ⚠ 没找到 systemd 单元 $API_SERVICE —— 请按你的方式手动重启 API（--api-service 可指定单元名）"
fi

step "⑦ 健康检查"
HEALTH_URL="http://127.0.0.1:${APP_API_PORT:-3200}/healthz"
if [ "$DRY" = 1 ]; then
  echo "+ curl $HEALTH_URL（dry-run 不执行）"
else
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || { echo "✗ API $HEALTH_URL 60s 内未就绪"; exit 1; }
  echo "  API /healthz → 200；依赖栈健康由上一步 up --wait 保证"
fi

echo; echo "✓ 升级完成：$OLD_REV → $NEW_REV"
print_rollback
