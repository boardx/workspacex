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
DEPLOY_READINESS_LIB=${DEPLOY_READINESS_LIB:-/usr/local/lib/workspacex-deploy-readiness.sh}

step() { printf '\n══════ %s ══════\n' "$1"; }

[ -f "$ENV_FILE" ] || { echo "缺 $ENV_FILE（0600，含部署凭据）"; exit 1; }
[ -r "$DEPLOY_READINESS_LIB" ] || { echo "缺 root-owned readiness helper: $DEPLOY_READINESS_LIB"; exit 1; }
# shellcheck disable=SC1090
source "$DEPLOY_READINESS_LIB"
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
# 单次成功不代表重启已稳定：成功后的进程仍可能退出或拒绝连接。root deploy 与
# CD wrapper 复用同一个 helper，要求连续可信样本，并在终态失败时给出有界脱敏诊断。
run_post_restart_smoke

printf '\n✅ 部署完成：%s\n' "$(sudo -u "$RUN_AS" git log --oneline -1)"
