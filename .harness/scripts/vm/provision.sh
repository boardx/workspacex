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

step "1. 系统用户 ${APP_USER}（非 root、非 sudo——deploy.sh 里所有应用动作都以它身份跑）"
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  usermod -aG docker "$APP_USER"
  echo "创建 ${APP_USER}"
else
  echo "${APP_USER} 已存在"
fi

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
NEXT_PUBLIC_API_URL=https://${PUBLIC_DOMAIN}/api
PUBLIC_DOMAIN=${PUBLIC_DOMAIN}
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
ExecStart=/usr/bin/env pnpm run start -- -p ${APP_WEB_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable workspacex-api workspacex-web >/dev/null
echo "两个 unit 已写入并 enable（不在这里 start——首次内容还没部署，交给 deploy.sh）"

step "7. /usr/local/bin/workspacex-deploy（root 拥有的副本，仓库里那份不可信）"
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
