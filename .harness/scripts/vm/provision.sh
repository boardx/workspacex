#!/usr/bin/env bash
#
# provision.sh —— 首次把一台干净 VM 变成 deploy.sh 能用的样子。**在目标机器上执行一次**。
#
# 背景：2026-08-01，devapp.boardx.us 的旧机被释放，新机重装。deploy.sh 假设
# workspacex 用户、/opt/workspacex/app、systemd unit、Caddy、sudoers 都已经存在——
# 而这些在旧机上是**手敲出来的，从未写成脚本**。这次连脚本一起补上，否则下次机器
# 再换，又是同一场手敲考古。
#
# 幂等：能重复跑。已存在的东西跳过，不存在的补上。**不生成密码**——
# deploy.env 的密码字段只在文件不存在时才用 openssl rand 生成一次；已存在则保留，
# 避免误跑把线上密码换掉导致服务连不上自己的数据库。
#
# 用法（在 VM 上，root）：
#   PUBLIC_DOMAIN=devapp.boardx.us DEPLOY_KEY_PATH=/root/wsx-deploy-key \
#     ./provision.sh
#
# 不做的事（有意）：
#   - 不跑 deploy.sh 本身、不拉代码之外的任何应用逻辑——provision 只搭台子。
#   - 不把 app_rw 的密码从迁移里改掉的那一步放在这里——那是 deploy.sh 首次跑完之后
#     的收尾动作（migrations/0001-kernel-roles.sql 硬编码了 app_rw_dev，
#     ALTER ROLE 必须在角色真正被 CREATE 出来之后才能跑），写在这个脚本的最后一步
#     只做"如果角色已存在且密码字段里有真值，就对齐"，不在这里創建角色。
#
# 踩过的坑（2026-08-01，同一台机器重置了两次，两次都在这个脚本上摔了跤，记下来
# 避免第三次）：
#   1. 第一版没有装 Docker/Node/pnpm 这一步，假设它们已经在——只在"第一次手敲"时
#      成立，全新机器上不成立。usermod -aG docker 因为 docker 组不存在而失败，
#      set -e 中止整个脚本，但 useradd 已经成功执行过了。
#   2. 更隐蔽的后果：下一次重跑（这时 Docker 已经手动装好），`if ! id 用户 exists`
#      判断为"已存在"，直接跳过整个 if 分支——包括跳过分支里那行本该修复的
#      usermod。用"资源是否已创建"当幂等判据，会连带把资源创建时的其它副作用一起
#      跳过，这是这类判据的通病，不是这个脚本独有。现在 usermod 已经挪到 if 分支
#      外面无条件执行（对已在组里的用户是安全的 no-op）。
#   3. deploy.sh 用 workspacex 身份跑 pnpm install/build，但 provision.sh 从没给
#      这个新建用户装过 Node/pnpm——GitHub Actions 的 setup-node/pnpm 只把它们放进
#      当次 job 的 PATH，`sudo -u workspacex` 起的新进程看不到。现在 Node/pnpm 装
#      在系统级路径（NodeSource + corepack），sudo 的默认 secure_path 与 workspacex
#      的 shell 都能直接解析到。
set -euo pipefail

PUBLIC_DOMAIN=${PUBLIC_DOMAIN:?set PUBLIC_DOMAIN, e.g. devapp.boardx.us}
DEPLOY_KEY_PATH=${DEPLOY_KEY_PATH:?set DEPLOY_KEY_PATH to the private half of the read-only GitHub deploy key}
APP_USER=${APP_USER:-workspacex}
APP_DIR=${APP_DIR:-/opt/workspacex/app}
ENV_FILE=${ENV_FILE:-/opt/workspacex/deploy.env}
RUNNER_USER=${RUNNER_USER:-ghrunner}
APP_API_PORT=${APP_API_PORT:-3200}
APP_WEB_PORT=${APP_WEB_PORT:-3100}
PGPORT=${PGPORT:-55433}

step() { printf '\n══════ %s ══════\n' "$1"; }

step "0. Docker Engine（⚠ 2026-08-01 补：见下方「踩过的坑」第一条）"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "装了 Docker $(docker --version)"
else
  echo "Docker 已装：$(docker --version)"
fi

step "0b. Node.js 22 + pnpm（deploy.sh 用 workspacex 身份跑 pnpm install/build，见「踩过的坑」第三条）"
if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get -qq install -y nodejs >/dev/null
  echo "装了 Node $(node --version)"
else
  echo "Node 已装：$(node --version)"
fi
corepack enable
PNPM_VER=$(grep -oE '"packageManager": *"pnpm@[0-9.]+"' "$(dirname "${BASH_SOURCE[0]}")/../../../package.json" 2>/dev/null | grep -oE '[0-9.]+$' || echo "9.15.0")
corepack prepare "pnpm@${PNPM_VER}" --activate
echo "pnpm $(pnpm --version)（要求 ${PNPM_VER}，来自根 package.json 的 packageManager）"

step "1. 系统用户 ${APP_USER}（非 root、非 sudo——deploy.sh 里所有应用动作都以它身份跑）"
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  echo "创建 ${APP_USER}"
else
  echo "${APP_USER} 已存在"
fi
# usermod 故意不放在上面的 if 分支里：2026-08-01 实测过的坑——第一次跑 provision.sh
# 时 Docker 还没装（那时候这个脚本还没有第 0 步），useradd 成功、usermod 因为 docker
# 组不存在而失败，set -e 中止整个脚本；用户已经建了但没入 docker 组。下一次重跑，
# 「用户已存在」直接进 else 分支，usermod 那行原本在 if 分支里，永远不会再被跑到——
# 幂等判断保护的是"用户创建"这个事实，却连带把它内部的其它副作用也一起跳过了，
# 这是"用存在性判断做幂等"的通病，不是这一个脚本独有。usermod 本身对已在组里的
# 用户是安全的 no-op，放在分支外无条件跑，不需要额外的存在性判断。
usermod -aG docker "$APP_USER"

step "2. GitHub 只读 deploy key（不复用装 runner 用的那把管理员钥匙）"
sudo -u "$APP_USER" mkdir -p "/home/${APP_USER}/.ssh"
if [ ! -f "/home/${APP_USER}/.ssh/id_ed25519" ]; then
  cp "$DEPLOY_KEY_PATH" "/home/${APP_USER}/.ssh/id_ed25519"
  chown "${APP_USER}:${APP_USER}" "/home/${APP_USER}/.ssh/id_ed25519"
  chmod 600 "/home/${APP_USER}/.ssh/id_ed25519"
fi
sudo -u "$APP_USER" bash -c "grep -q github.com /home/${APP_USER}/.ssh/config 2>/dev/null" || \
  sudo -u "$APP_USER" tee -a "/home/${APP_USER}/.ssh/config" >/dev/null <<EOF
Host github.com
  IdentityFile /home/${APP_USER}/.ssh/id_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
chmod 600 "/home/${APP_USER}/.ssh/config" 2>/dev/null || true

step "3. clone（幂等：已存在就跳过，deploy.sh 负责之后的 fetch/reset）"
if [ ! -d "$APP_DIR/.git" ]; then
  mkdir -p "$(dirname "$APP_DIR")"
  # 父目录必须先归属 workspacex，否则 git clone 以它身份跑会撞 Permission denied——
  # mkdir -p 默认建出来是 root:root。
  chown "${APP_USER}:${APP_USER}" "$(dirname "$APP_DIR")"
  sudo -u "$APP_USER" git clone git@github.com:boardx/workspacex.git "$APP_DIR"
else
  echo "$APP_DIR 已是 git 仓库，跳过 clone"
fi

step "4. deploy.env（0600，属 ${APP_USER}——密码只在文件不存在时生成一次）"
if [ ! -f "$ENV_FILE" ]; then
  gen() { openssl rand -base64 24; }
  cat > "$ENV_FILE" <<EOF
# 由 provision.sh 于 $(date -Is) 生成。0600，只有 ${APP_USER} 能读。
# 改这个文件不需要重新 provision——deploy.sh 每次部署都会重新 export 它。
PGHOST=127.0.0.1
PGPORT=${PGPORT}
PGDATABASE=workspacex
APP_DB_USER=app_rw
APP_DB_PASSWORD=$(gen)
MIGRATION_DB_USER=postgres
MIGRATION_DB_PASSWORD=$(gen)
S3_ACCESS_KEY_ID=$(gen)
S3_SECRET_ACCESS_KEY=$(gen)
APP_API_PORT=${APP_API_PORT}
APP_WEB_PORT=${APP_WEB_PORT}
# ⚠ 2026-08-05 事故：NEXT_PUBLIC_API_URL 曾经带路径（.../api），而
# apps/web/lib/api-client.ts 的 buildUrl 用 `new URL(absolutePath, base)` 拼 URL——
# 那个 API 会把 base 的路径段整个丢掉，于是线上请求全部打到了不带 /api 的路径，
# 注册页 404。buildUrl 已经修成对两种写法都健壮，但这里仍然使用推荐写法
# （origin-only + 显式 PATH_PREFIX），别再把路径揉进 URL 里。
NEXT_PUBLIC_API_URL=https://${PUBLIC_DOMAIN}
NEXT_PUBLIC_API_PATH_PREFIX=/api
PUBLIC_DOMAIN=${PUBLIC_DOMAIN}
# 2026-08-11：不设它时 object-store-root.ts 落回 /tmp（开发默认值），头像/文件对象
# 重启或 tmp 清理即丢。deploy.sh 第 4g 步会兜底补写并建目录，这里写上是让新机器
# 从第一天就不经过误配状态。
WORKSPACEX_OBJECT_ROOT=/opt/workspacex/objects
# 2026-08-11：deep-agent-service（「通用助手」内核，deploy.sh 第 4h 步 build+run 的
# 本机容器）。这一行是宿主端口的**单一声明处**——deploy.sh 从它反解端口，端口归属
# 登记见 .harness/instructions/project/PROJECT.md「本机端口分配」，此处不复述。
# deploy.sh 第 4h 步会兜底补写这一行；模型凭据 KERNEL_MODEL_BASE_URL /
# KERNEL_MODEL_API_KEY 是人工填的部署密钥（不在此模板生成），第 4h 步会把它们投影进
# /opt/workspacex/deep-agent.env 给容器用，缺了部署直接红。
KERNEL_DEEP_AGENT_BASE_URL=http://127.0.0.1:2025
# DA-03/DA-05（#1749，rubric D3）：deep-agent 通路 token 级流式的灰度开关。
# 1 = provider 消费 langgraph /runs/stream SSE 并写 delta 账本，前端 streamingText
# 逐 token 渲染；任何流路失败自动回退轮询（S1=B 双轨）。关掉即回到纯轮询。
KERNEL_DEEP_AGENT_STREAM_ENABLED=1
# DA-10（rubric D10④）：LangSmith tracing，可选。三行都填才生效（deploy.sh 4h 步
# 会在设了 TRACING 却缺 API_KEY 时红退）。默认注释 = 关闭。
# LANGSMITH_TRACING=true
# LANGSMITH_API_KEY=
# LANGSMITH_PROJECT=workspacex-deep-agent
# ⚠ 必填、无默认值（coord-main 裁决，PR #941）：deep-agent-service 调模型用的模型 ID，
# 每环境显式填写。留空则 deploy.sh 第 4h 步显式红退并指回这里补。
KERNEL_DEEP_AGENT_MODEL_ID=
EOF
  chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "生成了新的 ${ENV_FILE}（密码值不回显）"
else
  echo "${ENV_FILE} 已存在，不覆盖——避免把线上密码换成新值后服务连不上自己的库"
fi

step "5. Caddy（TLS 终结，同源反代——避免碰应用代码里没有的 CORS 配置）"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get -qq update >/dev/null
  apt-get -qq install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get -qq update >/dev/null
  apt-get -qq install -y caddy >/dev/null
  echo "装了 Caddy"
else
  echo "Caddy 已装"
fi
cat > /etc/caddy/Caddyfile <<EOF
${PUBLIC_DOMAIN} {
	# /api/* 剥前缀转发给 NestJS —— 它的路由挂在根路径（/healthz 不是 /api/healthz），
	# 且代码里没有开 CORS，所以路由必须同源，不能走独立子域名。
	handle_path /api/* {
		reverse_proxy 127.0.0.1:${APP_API_PORT}
	}
	# ⚠ 2026-08-08 事故：composer 麦克风（#726 WS /chat/asr-draft）与正式录音转写
	# （#466 WS /recording/sessions/:id/asr-stream）点了没反应；2026-08-14 个人实时
	# 转录也复现同一问题。不是权限提示缺失，是这些 WS 面没有路由到这里就落进了
	# 下面的兜底 handle，打到 Next.js 前端，
	# Upgrade 请求在那断了（Next 的 rewrite 不代理 WebSocket，见
	# apps/web/lib/api-client.ts 里 apiWebSocketUrl() 的头注）。这两条面不走 /api
	# 前缀（apiWebSocketUrl() 直连 API 源、不套 NEXT_PUBLIC_API_PATH_PREFIX），所以
	# 必须在这里单独各开一条路由，不能指望上面那条 /api/* 顺带盖住。
	handle /chat/asr-draft {
		reverse_proxy 127.0.0.1:${APP_API_PORT}
	}
	handle /recording/sessions/*/asr-stream {
		reverse_proxy 127.0.0.1:${APP_API_PORT}
	}
	handle /recording/realtime-asr/sessions/*/captures/*/stream {
		reverse_proxy 127.0.0.1:${APP_API_PORT}
	}
	# 门控自检面绝不能从公网可达——deploy.sh 自己的冒烟会验这一条（反向断言：
	# 它绿代表暴露了不该暴露的东西）。这里在 Caddy 层再挡一次，双重防线。
	handle /kernel/probe/* {
		respond 404
	}
	handle {
		reverse_proxy 127.0.0.1:${APP_WEB_PORT}
	}
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy
systemctl enable caddy >/dev/null

step "6. systemd unit：workspacex-api / workspacex-web"
cat > /etc/systemd/system/workspacex-api.service <<EOF
[Unit]
Description=workspacex API (NestJS)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/env pnpm --filter api run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/workspacex-web.service <<EOF
[Unit]
Description=workspacex Web (Next.js)
After=network.target workspacex-api.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/apps/web
EnvironmentFile=${ENV_FILE}
# 2026-08-01 实测踩过：\`pnpm run start -- -p \${PORT}\` 在 systemd ExecStart 里跑，
# next 收到的实际 argv 里带着字面的 "--"，被解析成"项目目录"，直接崩
# （Invalid project directory provided, no such directory: .../apps/web/-p）。
# Next.js 原生认 PORT 环境变量，不需要经过 pnpm 的参数转发这层——改用环境变量，
# 绕开这整类"--是不是被中间层吃掉"的不确定性，ExecStart 也因此变得更简单。
Environment=PORT=${APP_WEB_PORT}
ExecStart=/usr/bin/env pnpm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable workspacex-api workspacex-web >/dev/null
echo "两个 unit 已写入并 enable（不在这里 start——首次内容还没部署，交给 deploy.sh）"

step "7. /usr/local/bin/workspacex-deploy（root 拥有的副本，仓库里那份不可信）"
# ⚠ deploy.sh 的全部 helper lib 必须与它**同批 install**——2026-08-11 devapp 实测：只装
#   deploy.sh 不装 deep-agent-lib.sh，首跑 source 报 No such file or directory 静默跳过
#   4h 步。以后给 deploy.sh 新增 source 依赖时，这里必须同步加一行 install。
install -o root -g root -m 0644 "${APP_DIR}/.harness/scripts/vm/deploy-readiness.sh" /usr/local/lib/workspacex-deploy-readiness.sh
install -o root -g root -m 0644 "${APP_DIR}/.harness/scripts/vm/deep-agent-lib.sh" /usr/local/lib/workspacex-deep-agent-lib.sh
install -o root -g root -m 0755 "${APP_DIR}/.harness/scripts/vm/deploy.sh" /usr/local/bin/workspacex-deploy
echo "已装 $(sha256sum /usr/local/bin/workspacex-deploy | cut -d' ' -f1)"

step "8. sudoers：${RUNNER_USER} 只许免密跑这一条命令"
SUDOERS_FILE=/etc/sudoers.d/workspacex-deploy
cat > "$SUDOERS_FILE" <<EOF
${RUNNER_USER} ALL=(root) NOPASSWD: /usr/local/bin/workspacex-deploy
EOF
chmod 440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" && echo "sudoers 语法通过"

printf '\n✅ provision 完成。下一步：打 tag，让 backend-gates.yml 的 deploy job 触发\n'
printf '   sudo /usr/local/bin/workspacex-deploy <tag>（不要在这里手动跑它）。\n'
