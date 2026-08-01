#!/usr/bin/env bash
#
# deploy.sh —— 把当前 main 部署到目标机器。**在目标机器上执行**（CD 通过 ssh 调它）。
#
# 这一趟第一次是手敲完成的，固化成脚本的理由不是省事，是 `architecture.md` 的三条硬规则：
#   ① 有 CD 的目标**不手动部署** —— 手敲的步骤没人知道漏没漏
#   ② **迁移先于部署且幂等** —— 顺序写死在这里，不靠人记
#   ③ 冒烟带漂移探针 —— 收尾的健康检查断言的是 trustworthy，不是「返回了 200」
#
# 用法（在 VM 上）：
#   /opt/workspacex/app/.harness/scripts/vm/deploy.sh [git-ref]
#
# 幂等：重复跑安全。失败即中止（set -e），不做「尽力而为」——
# 半部署的状态比没部署更难查。
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/workspacex/app}
ENV_FILE=${ENV_FILE:-/opt/workspacex/deploy.env}
RUN_AS=${RUN_AS:-workspacex}
REF=${1:-origin/main}

step() { printf '\n══════ %s ══════\n' "$1"; }

[ -f "$ENV_FILE" ] || { echo "缺 $ENV_FILE（0600，含部署凭据）"; exit 1; }
# shellcheck disable=SC2046
export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)

step "1. 取代码"
cd "$APP_DIR"
sudo -u "$RUN_AS" git fetch --depth 50 origin "${REF#origin/}"
sudo -u "$RUN_AS" git reset --hard "$REF" 2>/dev/null || sudo -u "$RUN_AS" git reset --hard FETCH_HEAD
sudo -u "$RUN_AS" git log --oneline -1

step "2. 依赖"
sudo -u "$RUN_AS" pnpm install --frozen-lockfile

step "3. 依赖服务（具名卷；项目名与门控栈分开，端口也分开）"
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | xargs) \
  docker compose -f apps/api/docker-compose.deploy.yml -p workspacex up -d
until docker exec workspacex-postgres-1 pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

step "4. 迁移 —— 先于部署，且幂等"
# 幂等在别处已被证明：migrate:check 会无视版本表强制重放每个文件再比对 schema 摘要。
# 这里只是应用，不重复证明。
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | xargs) \
  pnpm --filter api exec tsx src/infrastructure/db/migrate-cli.ts

step "4b. app_rw 密码对齐 deploy.env"
# migrations/0001-kernel-roles.sql 首次 CREATE ROLE app_rw 时写死了开发默认密码
# app_rw_dev（不读任何环境变量——那是给本地/CI 一次性数据库用的，故意的，见该文件
# 注释）。deploy.env 里的 APP_DB_PASSWORD 是 provision.sh 用 openssl rand 生成的
# 真实密码，两者从 CREATE ROLE 那一刻起就不一致，API 直接连不上自己的数据库
# （2026-08-01 实测：password authentication failed for user "app_rw"）。
# ALTER ROLE PASSWORD 天然幂等——重复设成同一个值不会报错、不会有副作用，不需要
# 额外的条件判断；只在 migrate-cli 之后跑是因为角色要先存在。
# shellcheck disable=SC1090
source <(grep -v '^#' "$ENV_FILE")
docker exec workspacex-postgres-1 psql -U "${MIGRATION_DB_USER:-postgres}" -d "${PGDATABASE:-workspacex}" \
  -c "ALTER ROLE app_rw PASSWORD '${APP_DB_PASSWORD}';" >/dev/null
echo "  app_rw 密码已对齐"

step "5. 构建前端"
sudo -u "$RUN_AS" env NODE_ENV=production pnpm --filter web run build >/dev/null
echo "  built"

step "6. 重启服务"
systemctl restart workspacex-api workspacex-web
for s in workspacex-api workspacex-web; do
  systemctl is-active --quiet "$s" || { echo "✗ $s 没起来"; journalctl -u "$s" -n 20 --no-pager; exit 1; }
done
echo "  workspacex-api / workspacex-web active"

step "7. 冒烟 —— 断言的是内核自检，不是「有响应」"
# 只测 200 的冒烟会在「RLS 没生效但服务活着」时全绿，而那正是最该被拦下的状态。
#
# 固定 sleep 3 曾经导致冒烟假红（2026-08-01 实测两次）：systemd 报 active 的那一刻，
# tsx 才刚 fork 出 esbuild 子进程做首次编译，端口还没绑；冷启动（首次跑这份代码、
# 没有任何进程/文件缓存热度）量级是 4~5 秒，远比这条重启路径平时快得多的热态更慢。
# 用「轮询直到端口应答或超时」而不是加大固定 sleep——加大值只是把同一个赌注下得
# 更大，轮询才是真的不赌。
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null "http://127.0.0.1:${APP_API_PORT:-3200}/healthz" 2>/dev/null && break
  sleep 1
done
H=$(curl -fsS "http://127.0.0.1:${APP_API_PORT:-3200}/healthz")
echo "  $H"
echo "$H" | grep -q '"trustworthy":true'  || { echo "✗ 内核自检不可信"; exit 1; }
echo "$H" | grep -q '"rlsForced":true'    || { echo "✗ 有表未 FORCE RLS"; exit 1; }
echo "$H" | grep -q '"appRoleIsOwner":false' || { echo "✗ 应用角色是表 owner —— RLS 写了但没生效"; exit 1; }
# Next.js 生产启动同样有冷启动量级，同一个理由，同一个轮询而不是加大固定等待。
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null "http://127.0.0.1:${APP_WEB_PORT:-3100}/" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:${APP_WEB_PORT:-3100}/" || { echo "✗ 前端无响应"; exit 1; }

# 门控探针不该对外可达。这条是反向断言：它绿不代表功能好，它红代表暴露了不该暴露的面。
if curl -fsS -o /dev/null "https://${PUBLIC_DOMAIN:-devapp.boardx.us}/kernel/probe/identity-session" 2>/dev/null; then
  echo "✗ /kernel/probe/* 从公网可达 —— 那是门控的被测面，不是对外 API"; exit 1
fi
echo "  ✓ 探针面未对外暴露"

printf '\n✅ 部署完成：%s\n' "$(sudo -u "$RUN_AS" git log --oneline -1)"
