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
DEPLOY_STATUS_NONCE=""
DEPLOY_STAGE=started

if (($# > 1)); then
  [[ $# -eq 3 && "$2" == "--status-nonce" && "$3" =~ ^[0-9a-f]{32}$ ]] || {
    echo "usage: workspacex-deploy [git-ref] [--status-nonce <32-hex>]" >&2
    exit 2
  }
  DEPLOY_STATUS_NONCE=$3
fi

write_deploy_status() {
  local exit_code=$1
  local status_dir=/run/workspacex-deploy
  local status_file="${status_dir}/${DEPLOY_STATUS_NONCE}.status"
  local temp_file="${status_file}.tmp.$$"

  [[ -n "$DEPLOY_STATUS_NONCE" ]] || return 0
  install -d -o root -g root -m 0755 "$status_dir"
  find "$status_dir" -type f -name '*.status' -mmin +60 -delete
  (umask 022; printf 'protocol=workspacex-deploy/v1\nnonce=%s\nstage=%s\nexit=%s\n' \
    "$DEPLOY_STATUS_NONCE" "$DEPLOY_STAGE" "$exit_code" > "$temp_file")
  chown root:root "$temp_file"
  chmod 0644 "$temp_file"
  mv -f "$temp_file" "$status_file"
}

finish_deploy_status() {
  local exit_code=$?
  trap - EXIT
  write_deploy_status "$exit_code" || true
  exit "$exit_code"
}

if [[ -n "$DEPLOY_STATUS_NONCE" ]]; then
  write_deploy_status 0
  trap finish_deploy_status EXIT
fi

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
# ⚠ 2026-08-07 事故：这里曾经是
#   `git reset --hard "$REF" 2>/dev/null || git reset --hard FETCH_HEAD`。
# 当 $REF 是一个裸分支名（"main"，#635 加的 push-to-main 自动部署路径就是这么传的）
# 时，`git reset --hard main` **不会报错**——它成功重置到本地那份 `main` 分支指针，
# 但那份指针从来没人更新过（只有 `git fetch` 写的 FETCH_HEAD 是新的），于是
# `||` 后面的 FETCH_HEAD 分支永远不会被触发。表现是：CI 报 deploy 成功，
# 冒烟也过，但服务器上跑的其实是几小时前的旧代码——直到有人拿真实浏览器去点，
# 才会发现"代码明明改了，线上还是老样子"。
#
# ⇒ 不再尝试把 $REF 解释成一个本地能直接 reset 到的 ref。`git fetch origin <REF>`
#   无论 REF 是分支名、tag 还是 SHA，执行完之后 FETCH_HEAD 永远精确指向刚刚
#   fetch 到的那个提交——直接用它，不留一个"看起来成功但值不对"的中间状态。
sudo -u "$RUN_AS" git reset --hard FETCH_HEAD
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

step "4c. 默认 agent 补种（#662 —— 已有组织不会自己长出默认 agent）"
# `ensureDefaultAgent` 只在组织**创建那一刻**触发（`/auth/bootstrap` 与 `/auth/register`
# 各自的 controller 里）。#662 落地之前就存在的每一个组织永远不会自己补上——没有 cron，
# 没有"首次聊天时顺便种一个"这种懒加载。这一步幂等（按 `agents.stable_name` 去重，脚本
# 内部还先查一遍存在性），每次部署都跑，成本是一次全表扫描 + 至多几行 INSERT，换来的是
# "已有组织的默认 agent 缺口"不需要人手动 SSH 上服务器补一次就能自愈。
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter api exec tsx scripts/backfill-default-agents.ts

step "4d. deep-research agent 补种（同一条裁决延伸到第二个系统 agent，2026-08-07）"
# 同 4c 的理由，另一个 stable_name。这两步分开跑（不是同一个脚本里循环两个模板）是因为
# 各自失败模式不同：默认 agent 缺配置会导致"能建但发消息 422"，deep-research agent
# 缺配置（`KERNEL_DEEP_RESEARCH_BASE_URL` 没设）此时并不阻塞——落库本身不依赖那个服务
# 是否可达，只在真的发一条消息时才会报错，且报错是诚实的 MODEL_PROVIDER_NOT_CONFIGURED，
# 不是一个吞掉的静默失败。
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter api exec tsx scripts/backfill-deep-research-agent.ts

step "4e. 图片生成 agent 补种（第三个系统 agent，2026-08-07 —— 人类指令"要能直接看到图片"）"
# 同 4c/4d 的理由，第三个 stable_name。落库不依赖 DashScope 是否可达，只在真的发一条
# 消息时才会报错（诚实的 MODEL_CALL_FAILED/MODEL_PROVIDER_NOT_CONFIGURED）。
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter api exec tsx scripts/backfill-image-gen-agent.ts

step "4f. URL 导入 skill 的 capability_listings 补种（2026-08-07 —— 人类实测"看不到导入的 skills"）"
# `pg-skill-url-import-repository.ts` 在这次改动之前从未写 capability_listings（后台
# 「Skill 目录」页唯一真读的那张表）——每一个在这次修复落地之前通过 URL 导入的 skill
# 都缺这一行，backfill 一次性补齐。
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter api exec tsx scripts/backfill-skill-capability-listings.ts

step "4g. 对象存储根目录（2026-08-11 —— 头像/文件对象曾落在 /tmp/workspacex-objects，重启或 tmp 清理即丢）"
# `object-store-root.ts`：WORKSPACEX_OBJECT_ROOT 未设时落回 tmpdir——那是开发默认值，
# 文件头逐字写着「A deployment that leaves this unset and expects durability has
# misconfigured itself」。devapp 从 provision 起就是这个误配状态。
# 幂等：已有配置则只确保目录存在、属 ${RUN_AS} 可写。
OBJECT_ROOT_DEFAULT=/opt/workspacex/objects
if ! grep -q '^WORKSPACEX_OBJECT_ROOT=' "$ENV_FILE"; then
  echo "WORKSPACEX_OBJECT_ROOT=${OBJECT_ROOT_DEFAULT}" >> "$ENV_FILE"
  echo "  deploy.env 里没有 WORKSPACEX_OBJECT_ROOT，已写入默认值 ${OBJECT_ROOT_DEFAULT}"
fi
OBJECT_ROOT=$(grep '^WORKSPACEX_OBJECT_ROOT=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
install -d -o "$RUN_AS" -g "$RUN_AS" "$OBJECT_ROOT"
# 把误配时期已经落在 /tmp 的对象搬过来（-n 不覆盖：正式根目录里已有的对象是权威——
# putOnce 语义下同 key 不会有第二个版本，搬运只补缺不改写）。
if [ -d /tmp/workspacex-objects ]; then
  cp -an /tmp/workspacex-objects/. "$OBJECT_ROOT"/ 2>/dev/null || true
  chown -R "$RUN_AS":"$RUN_AS" "$OBJECT_ROOT"
  echo "  已把 /tmp/workspacex-objects 的存量对象合并进 ${OBJECT_ROOT}（不覆盖既有）"
fi
echo "  对象存储根目录就绪：${OBJECT_ROOT}"

step "4h. deep-agent-service（通用助手内核，2026-08-11 —— 此前从未进部署链，线上只有手工镜像）"
# 背景：用户实测「通用助手」报 MODEL_PROVIDER_NOT_CONFIGURED，根因是 deep-agent-service
# 压根没被任何脚本部署过——devapp 上的 `:latest` 镜像是从 #766 修复前的旧源码手工 build 的
# （graph.py 相对导入 → langgraph dev 按文件路径加载时报 GraphLoadError），能跑的
# `:test-fix` 又是一个无出处的手工镜像。这一步把整个生命周期仓库化：
# 从当前部署的源码 build（tag = git SHA，有出处）→ 幂等生成专属 env 文件 → 起容器 →
# 健康检查。宿主侧绑 127.0.0.1:2025（2024 被 open_deep_research 容器占了），容器内 2024。
DEEP_AGENT_ENV_FILE=${DEEP_AGENT_ENV_FILE:-/opt/workspacex/deep-agent.env}
DEEP_AGENT_HOST_PORT=${DEEP_AGENT_HOST_PORT:-2025}
DEEP_AGENT_SHA=$(sudo -u "$RUN_AS" git rev-parse --short HEAD)
DEEP_AGENT_IMAGE="deep-agent-service:${DEEP_AGENT_SHA}"

# deploy.env 幂等补 KERNEL_DEEP_AGENT_BASE_URL——apps/api 的 DeepAgentModelProvider 读它；
# 没有它，「通用助手」永远是诚实的 MODEL_PROVIDER_NOT_CONFIGURED。
if ! grep -q '^KERNEL_DEEP_AGENT_BASE_URL=' "$ENV_FILE"; then
  echo "KERNEL_DEEP_AGENT_BASE_URL=http://127.0.0.1:${DEEP_AGENT_HOST_PORT}" >> "$ENV_FILE"
  echo "  deploy.env 里没有 KERNEL_DEEP_AGENT_BASE_URL，已写入 http://127.0.0.1:${DEEP_AGENT_HOST_PORT}"
fi

# 模型凭据复用 deploy.env 里 apps/api 同名的那一对值（model.py 的头注就是这么约定的，
# 不引入新凭据）。缺了就红——静默跳过只会把故障推迟到用户第一次发消息。
DEEP_AGENT_MODEL_BASE_URL=$(grep '^KERNEL_MODEL_BASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
DEEP_AGENT_MODEL_API_KEY=$(grep '^KERNEL_MODEL_API_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
[ -n "$DEEP_AGENT_MODEL_BASE_URL" ] && [ -n "$DEEP_AGENT_MODEL_API_KEY" ] || {
  echo "✗ deploy.env 缺 KERNEL_MODEL_BASE_URL / KERNEL_MODEL_API_KEY —— deep-agent-service 起了也无法调模型"
  exit 1
}
# 模型 ID：deploy.env 里显式设了就用它，否则默认 qwen3.8-max（2026-08-11 devapp 实测可用；
# 是否参数化为每环境必填项待 coord-main 裁决，见对应 issue）。
DEEP_AGENT_MODEL_ID=$(grep '^KERNEL_DEEP_AGENT_MODEL_ID=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
DEEP_AGENT_MODEL_ID=${DEEP_AGENT_MODEL_ID:-qwen3.8-max}

# env 文件整体重写（单一来源是 deploy.env，本文件只是投影）——幂等且不会越追加越长。
(umask 077; cat > "$DEEP_AGENT_ENV_FILE" <<EOF
# 由 deploy.sh 第 4h 步于 $(date -Is) 生成。不要手改——每次部署都会重写。
# 值来自 deploy.env（KERNEL_MODEL_* 与 apps/api 同名同值，见 model.py 头注）。
KERNEL_MODEL_BASE_URL=${DEEP_AGENT_MODEL_BASE_URL}
KERNEL_MODEL_API_KEY=${DEEP_AGENT_MODEL_API_KEY}
KERNEL_DEEP_AGENT_MODEL_ID=${DEEP_AGENT_MODEL_ID}
EOF
)
chown "$RUN_AS":"$RUN_AS" "$DEEP_AGENT_ENV_FILE"

echo "  构建镜像 ${DEEP_AGENT_IMAGE}（从当前部署源码，有出处）"
docker build -t "$DEEP_AGENT_IMAGE" "$APP_DIR/apps/deep-agent-service" >/dev/null

# 同名容器存在（无论手工的还是上一轮部署的）先停删再起新的——幂等替换，不留手工痕迹。
docker rm -f workspacex-deep-agent >/dev/null 2>&1 || true
docker run -d --name workspacex-deep-agent --restart unless-stopped \
  -p "127.0.0.1:${DEEP_AGENT_HOST_PORT}:2024" \
  --env-file "$DEEP_AGENT_ENV_FILE" \
  "$DEEP_AGENT_IMAGE" >/dev/null

# 健康检查：轮询 /ok 直到 200 或超时。部署失败要红——devapp 上那个 GraphLoadError 的
# `:latest` 容器就是这样默默躺了好几天没人发现的。
DEEP_AGENT_OK=""
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://127.0.0.1:${DEEP_AGENT_HOST_PORT}/ok" >/dev/null 2>&1; then
    DEEP_AGENT_OK=1
    break
  fi
  sleep 2
done
[ -n "$DEEP_AGENT_OK" ] || {
  echo "✗ deep-agent-service /ok 超时（60s）—— 容器日志："
  docker logs --tail 40 workspacex-deep-agent 2>&1 || true
  exit 1
}
echo "  deep-agent-service ${DEEP_AGENT_IMAGE} 已就绪（127.0.0.1:${DEEP_AGENT_HOST_PORT}/ok → 200）"

step "5. 构建前端"
# ⚠ 必须带上 $ENV_FILE。`NEXT_PUBLIC_*` 是 Next.js 在**构建期**内联进客户端 bundle 的，
# 构建时读不到就永远读不到——重启服务、重跑迁移、改 Caddy 都救不回来。
#
# 2026-08-05 实测事故：本行原来只传 NODE_ENV，于是 `NEXT_PUBLIC_API_URL`
# （provision.sh 写在 deploy.env 里的 `https://<domain>/api`）没进构建，
# `api-client.ts` 落回缺省值 `http://localhost:3200`，线上前端把请求发到
# **访问者自己电脑的 3200 端口**：
#   POST http://localhost:3200/auth/bootstrap  net::ERR_CONNECTION_REFUSED
# 后端与反向代理全程健康（外网 curl https://<domain>/api/auth/bootstrap 返 201），
# 所以服务器日志里一条错误都没有——症状完全不像部署问题，人只会以为「服务坏了」。
#
# 第 3、4 步本来就是这么传的，唯独这一步漏了。
sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) NODE_ENV=production \
  pnpm --filter web run build >/dev/null
echo "  built"

# 反证：构建产物里必须找得到真实 API 源，找不到就是又落回 localhost 缺省值了。
# 这条断言便宜（一次 grep），但它拦的是一类「服务器全绿、用户全红」的故障。
if [ -n "${NEXT_PUBLIC_API_URL:-}" ]; then
  if ! grep -rqF "$NEXT_PUBLIC_API_URL" apps/web/.next/static 2>/dev/null; then
    echo "✗ 构建产物里找不到 NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL"
    echo "  ⇒ 前端会把请求发到 http://localhost:3200，线上必然 ERR_CONNECTION_REFUSED。"
    exit 1
  fi
  echo "  NEXT_PUBLIC_API_URL 已内联进 bundle"
else
  echo "⚠ deploy.env 里没有 NEXT_PUBLIC_API_URL —— 前端将落回 http://localhost:3200 缺省值"
  exit 1
fi

step "5c. 校验必需 env var —— 一次性列全缺失项，重启服务之前"
# #620：2026-08-06 同一天两次崩溃循环（MODEL_CREDENTIAL_KEY，之前是
# EMAIL_VERIFICATION_SECRET），处理方式都是"重启崩溃→看日志→补一个变量→再重启"，
# 一次只发现一个。这一步在 systemctl restart 之前把 createApp() 实际会读的每一个
# 必需 env var 都探测一遍（不是手写清单——见 verify-required-env.ts 文件头），
# 缺什么、缺几个，一次性列全；非 0 就在这里止步，不产生新的崩溃循环。
if ! sudo -u "$RUN_AS" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter api exec tsx scripts/verify-required-env.ts; then
  echo "✗ 缺失/无效的必需 env var（见上方清单）—— 不重启服务，避免崩溃循环"
  exit 1
fi
echo "  必需 env var 就绪"

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
DEPLOY_STAGE=smoke
write_deploy_status 0
run_post_restart_smoke

printf '\n✅ 部署完成：%s\n' "$(sudo -u "$RUN_AS" git log --oneline -1)"
