#!/usr/bin/env bash
# 自托管升级演练（backlog E7 / issue #4263）。CI：.github/workflows/self-host-upgrade-drill.yml；
# 人工版步骤见 docs/deployment/open-source-human-actions.md §7。
#
#   scripts/self-host-upgrade-drill.sh --old-ref <旧版本> [--new-ref <新版本，默认 HEAD>] [--keep]
#
# 步骤：a. 在临时 git worktree 里检出旧版本（不碰当前 checkout）
#       b. 用旧版本的 compose.yaml 起依赖栈（一次性 env，全部随机生成，不读任何密钥）
#       c. 等健康（up --wait，带超时）→ 装依赖 → 跑旧版本迁移
#       d. 用 psql 写一行标记数据（随机 token）
#       e. worktree 检出新版本
#       f. 非交互跑新版本的 scripts/upgrade.sh --skip-api（含升级前备份、重建镜像、迁移）
#       g. 再断言：所有服务 running 且无 unhealthy、迁移表不倒退、标记行 token 一致、备份目录非空
#       h. 无论成败：dump 日志 + `compose down -v` + 删 worktree（--keep 则保留栈与 worktree）
#
# ⚠ 项目名固定 workspacex（upgrade.sh 与 compose.yaml 写死）。本机若已有同名栈（真实自托管
#   实例），脚本拒绝运行——结尾的 `down -v` 会删掉它的数据卷。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLD_REF=""
NEW_REF="HEAD"
KEEP=0
PROJECT="workspacex"
UP_TIMEOUT="${DRILL_UP_TIMEOUT:-900}"          # 秒；首次构建镜像占大头
UPGRADE_TIMEOUT="${DRILL_UPGRADE_TIMEOUT:-1800}"
LOG_DIR="${DRILL_LOG_DIR:-$ROOT/.selfhost/drill-logs}"

while [ $# -gt 0 ]; do
  case "$1" in
    --old-ref) OLD_REF="$2"; shift 2 ;;
    --new-ref) NEW_REF="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[ -n "$OLD_REF" ] || { echo "✗ 需要 --old-ref" >&2; exit 2; }
for c in git docker pnpm node openssl timeout; do
  command -v "$c" >/dev/null 2>&1 || { echo "✗ 缺命令 $c" >&2; exit 1; }
done
docker compose version >/dev/null

OLD_SHA="$(git -C "$ROOT" rev-parse --verify "$OLD_REF^{commit}")"
NEW_SHA="$(git -C "$ROOT" rev-parse --verify "$NEW_REF^{commit}")"
[ "$OLD_SHA" != "$NEW_SHA" ] || echo "  ⚠ 旧版本与新版本是同一个 commit（$OLD_SHA）：只演练「原地重跑升级」"
git -C "$ROOT" cat-file -e "$OLD_SHA:compose.yaml" 2>/dev/null \
  || { echo "✗ 旧版本 $OLD_SHA 没有 compose.yaml（早于 E7），无从演练" >&2; exit 1; }

if [ -n "$(docker compose -p "$PROJECT" ps -a -q 2>/dev/null)" ] || docker volume inspect "${PROJECT}_workspacex_pgdata" >/dev/null 2>&1; then
  echo "✗ 本机已有 compose 项目 $PROJECT 的容器或数据卷——可能是真实自托管实例，演练结尾会 down -v。拒绝运行。" >&2
  exit 1
fi

step() { echo; echo "══ $* ══"; }
WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/wsx-drill.XXXXXX")"
WT="$WORK/repo"
ENV_FILE="$WORK/selfhost.env"
mkdir -p "$LOG_DIR"
PG_CONTAINER="${PROJECT}-postgres-1"
compose() { docker compose -p "$PROJECT" -f "$WT/compose.yaml" --env-file "$ENV_FILE" "$@"; }

cleanup() {
  local rc=$?
  set +e
  step "h. 收尾（退出码 $rc）"
  if [ -f "$ENV_FILE" ] && [ -f "$WT/compose.yaml" ]; then
    compose ps -a > "$LOG_DIR/ps.txt" 2>&1
    compose logs --no-color --timestamps > "$LOG_DIR/compose.log" 2>&1
    echo "  日志 → $LOG_DIR"
    [ "$rc" -eq 0 ] || { cat "$LOG_DIR/ps.txt"; tail -n 200 "$LOG_DIR/compose.log"; }
  fi
  if [ "$KEEP" = 1 ]; then
    echo "  --keep：保留栈与 worktree $WT（手动清理：docker compose -p $PROJECT down -v; git worktree remove --force $WT）"
  else
    [ -f "$ENV_FILE" ] && [ -f "$WT/compose.yaml" ] && compose down -v --remove-orphans >/dev/null 2>&1
    git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1
    rm -rf "$WORK"
  fi
  exit "$rc"
}
trap cleanup EXIT

load_apparmor() {
  # skill-sandbox-sessions 引用 apparmor=workspacex-native-sessions；不加载则容器起不来。
  # 与 backend-gates.yml 同一做法：用当前检出版本的策略文件。
  local policy="$WT/apps/skill-sandbox/security/docker-apparmor-sessions"
  [ -r "$policy" ] || return 0
  if command -v apparmor_parser >/dev/null 2>&1; then
    sudo -n apparmor_parser -r -W "$policy" || { echo "✗ 加载 AppArmor 策略失败（需要免密 sudo）" >&2; return 1; }
  else
    echo "  ⚠ 无 apparmor_parser：skill-sandbox-sessions 可能起不来"
  fi
}

step "a. 旧版本 $OLD_SHA → worktree $WT"
git -C "$ROOT" worktree add --detach "$WT" "$OLD_SHA" >/dev/null
# upgrade.sh 第③步 `git fetch --tags origin`；worktree 共享 $ROOT 的 remote，无需额外配置。

step "b. 生成一次性 env（随机值，不含任何真实密钥）"
mkdir -p "$WORK/sandbox" "$WORK/sessions"
chmod 0777 "$WORK/sandbox" "$WORK/sessions"
{
  echo "# 演练用一次性 env —— 由 $(basename "$0") 生成，结束即删"
  echo "MIGRATION_DB_PASSWORD=drill-$(openssl rand -hex 16)"
  echo "S3_ACCESS_KEY_ID=drill$(openssl rand -hex 6)"
  echo "S3_SECRET_ACCESS_KEY=drill-$(openssl rand -hex 16)"
  echo "SOURCE_REVISION=$OLD_SHA"
  echo "SANDBOX_UID=$(id -u)"
  echo "SANDBOX_GID=$(id -g)"
  echo "SANDBOX_SOCKET_DIR=$WORK/sandbox"
  echo "NATIVE_SESSION_SOCKET_DIR=$WORK/sessions"
  # pg-config.ts 的 PGPORT 缺省是门控栈的 55432；deploy compose 的缺省是 55433。
  echo "PGHOST=127.0.0.1"
  echo "PGPORT=55433"
  echo "PGDATABASE=workspacex"
} > "$ENV_FILE"
# 必填变量以旧版本的 selfhost.env.example 为准：漏一个就在这里红，而不是在 compose 里报 ?err。
if [ -f "$WT/selfhost.env.example" ]; then
  for v in $(grep -oE '^[A-Z0-9_]+' "$WT/selfhost.env.example"); do
    grep -q "^$v=" "$ENV_FILE" || { echo "✗ 演练 env 缺 $v（selfhost.env.example 新增了必填项？同步本脚本）" >&2; exit 1; }
  done
fi
set -a; . "$ENV_FILE"; set +a

step "c. 旧版本起栈并等健康（超时 ${UP_TIMEOUT}s）"
load_apparmor
SOURCE_REVISION="$OLD_SHA" timeout "$UP_TIMEOUT" docker compose -p "$PROJECT" -f "$WT/compose.yaml" --env-file "$ENV_FILE" \
  up -d --build --wait --wait-timeout "$UP_TIMEOUT"
(cd "$WT" && pnpm install --frozen-lockfile --prefer-offline)
(cd "$WT" && timeout 600 pnpm --filter api exec tsx src/infrastructure/db/migrate-cli.ts)

psql_q() { docker exec -i "$PG_CONTAINER" psql -U postgres -d "$PGDATABASE" -v ON_ERROR_STOP=1 -tAq "$@"; }
MIG_BEFORE="$(psql_q -c 'SELECT count(*) FROM _kernel_migrations')"
echo "  旧版本迁移数：$MIG_BEFORE"

step "d. 写标记行"
TOKEN="drill-$(openssl rand -hex 12)"
psql_q <<SQL
CREATE TABLE IF NOT EXISTS selfhost_upgrade_drill_marker (token text PRIMARY KEY, old_rev text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO selfhost_upgrade_drill_marker (token, old_rev) VALUES ('$TOKEN', '$OLD_SHA');
SQL
echo "  token=$TOKEN"

step "e. worktree 检出新版本 $NEW_SHA"
git -C "$WT" checkout --detach -q "$NEW_SHA"
load_apparmor

step "f. 跑新版本 scripts/upgrade.sh（非交互，超时 ${UPGRADE_TIMEOUT}s）"
# --ref 用 SHA：CI 上 PR 的合并提交不在 origin 的分支里，但就在本地对象库中。
timeout "$UPGRADE_TIMEOUT" bash "$WT/scripts/upgrade.sh" \
  --env-file "$ENV_FILE" --ref "$NEW_SHA" --backup-dir "$WORK/backup" --skip-api < /dev/null

step "g. 升级后断言"
[ "$(git -C "$WT" rev-parse HEAD)" = "$NEW_SHA" ] || { echo "✗ worktree 不在新版本" >&2; exit 1; }
bad="$(compose ps -a --format '{{.Service}} {{.State}} {{.Health}}' | awk '$2!="running" || $3=="unhealthy" || $3=="starting"')"
[ -z "$bad" ] || { echo "✗ 升级后有服务不健康：" >&2; echo "$bad" >&2; exit 1; }
echo "  服务全部 running，无 unhealthy"
MIG_AFTER="$(psql_q -c 'SELECT count(*) FROM _kernel_migrations')"
[ "$MIG_AFTER" -ge "$MIG_BEFORE" ] || { echo "✗ 迁移表倒退：$MIG_BEFORE → $MIG_AFTER" >&2; exit 1; }
echo "  迁移数：$MIG_BEFORE → $MIG_AFTER"
GOT="$(psql_q -c "SELECT old_rev FROM selfhost_upgrade_drill_marker WHERE token = '$TOKEN'")"
[ "$GOT" = "$OLD_SHA" ] || { echo "✗ 标记行丢失或被改（期望 $OLD_SHA，读到 '${GOT}'）" >&2; exit 1; }
echo "  标记行仍在：$TOKEN"
[ -n "$(ls -A "$WORK/backup" 2>/dev/null)" ] || { echo "✗ 升级前备份目录为空：$WORK/backup" >&2; exit 1; }
echo "  升级前备份已产出：$(ls "$WORK/backup" | tr '\n' ' ')"

echo; echo "✓ 自托管升级演练通过：$OLD_SHA → $NEW_SHA"
