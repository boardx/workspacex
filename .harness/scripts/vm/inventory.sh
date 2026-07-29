#!/usr/bin/env bash
#
# inventory.sh —— 只读盘点。**这个脚本不删任何东西，一行都不删。**
#
# 在动这台机器上任何已有服务之前，先把「上面到底跑着什么」变成一份可以一起看的清单。
# 「服务器上有些旧服务，清理一下」这句话，在没有清单之前，和「rm 掉我不认识的东西」
# 是同一件事——而这台机器同时是 staging（ANSWER_Q1=Both），删错的代价不是重装。
#
# 用法：
#   ssh -p <port> <user>@<host> 'bash -s' < .harness/scripts/vm/inventory.sh
#
# 输出分九段，每段回答一个「删之前必须知道」的问题。
set -uo pipefail   # 刻意不用 -e：某一段查不到（比如没装 docker）不该让整份盘点中断

hr() { printf '\n══════ %s ══════\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

hr "0. 这台机器是什么"
uname -srm
( . /etc/os-release 2>/dev/null && echo "OS: $PRETTY_NAME" ) || true
echo "uptime: $(uptime -p 2>/dev/null || uptime)"
echo "CPU: $(nproc) cores"
free -h 2>/dev/null | sed -n '1,2p'
df -h / /var /opt /srv 2>/dev/null | sort -u

hr "1. 谁在监听端口 —— 冲突面"
# 端口是最先撞车的东西。CI 计划占用 55432 / 59000 / 56379，
# staging 计划占用 3100 / 3200 —— 下面这份清单决定这些数字要不要改。
if have ss; then ss -tulpnH 2>/dev/null | awk '{print $1, $5, $7}' | sort -u
elif have netstat; then netstat -tulpn 2>/dev/null | tail -n +3
else echo "(ss/netstat 都没有)"; fi

hr "2. systemd 里跑着的服务（只列 running）"
if have systemctl; then
  systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}'
  echo "--- 开机自启（enabled）---"
  systemctl list-unit-files --type=service --state=enabled --no-pager --no-legend 2>/dev/null | awk '{print $1}'
else echo "(无 systemd)"; fi

hr "3. Docker —— 容器 / 镜像 / 卷 / 网络 / 磁盘占用"
if have docker; then
  echo "--- 运行中的容器 ---"
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
  echo "--- 已停止的容器（清理的主要目标）---"
  docker ps -a --filter status=exited --filter status=created --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null
  echo "--- compose 项目（同一项目的东西要整组处理，不能挑单个容器删）---"
  docker ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u | sed '/^$/d'
  echo "--- 卷：⚠ 这里是唯一会丢数据的地方 ---"
  docker volume ls --format '{{.Name}}\t{{.Driver}}' 2>/dev/null
  echo "--- 卷是否还被引用（无引用 ≠ 可以删，可能是停着的服务的数据）---"
  docker volume ls -q 2>/dev/null | while read -r v; do
    users=$(docker ps -a --filter volume="$v" --format '{{.Names}}' 2>/dev/null | paste -sd, -)
    echo "$v -> ${users:-（当前无容器引用）}"
  done
  echo "--- 网络 ---"
  docker network ls --format '{{.Name}}\t{{.Driver}}' 2>/dev/null
  echo "--- 磁盘占用 ---"
  docker system df 2>/dev/null
else echo "(未安装 docker —— 那 CI 的第一步就是装它)"; fi

hr "4. 已有的数据库进程 —— ⚠ 与 CI 的 DROP DATABASE 直接相关"
# CI 会 DROP DATABASE。如果这台机器上已经有 PostgreSQL 在跑真数据，
# 「CI 库」和「别人的库」之间就只隔一个库名。这一段决定要不要加前缀门控。
if have psql; then
  echo "宿主机 psql: $(psql --version)"
  su - postgres -c 'psql -tAc "SELECT datname FROM pg_database WHERE NOT datistemplate"' 2>/dev/null \
    || echo "(无法以 postgres 用户列库，可能没有本机实例)"
else echo "(宿主机无 psql)"; fi
pgrep -a postgres 2>/dev/null | head -3 || echo "(无 postgres 进程)"
pgrep -a mysqld 2>/dev/null | head -3
pgrep -a redis-server 2>/dev/null | head -3
pgrep -a mongod 2>/dev/null | head -3

hr "5. Web/反代 —— 部署时会争 80/443"
for s in nginx caddy apache2 httpd traefik; do
  pgrep -a "$s" >/dev/null 2>&1 && echo "运行中: $s"
done
ls -la /etc/nginx/sites-enabled/ 2>/dev/null | tail -n +2
ls -la /etc/caddy/ 2>/dev/null | tail -n +2

hr "6. 已有的 CI runner（可能已经装过一个）"
ls -d /opt/actions-runner* /home/*/actions-runner* 2>/dev/null
systemctl list-units --no-pager --no-legend 2>/dev/null | grep -iE 'actions.runner|gitlab.runner|jenkins' || echo "(无)"

hr "7. 定时任务 —— 删服务前必须看，否则 cron 会把它拉回来"
crontab -l 2>/dev/null | grep -v '^#' | sed '/^$/d' || echo "(root 无 crontab)"
ls -la /etc/cron.d/ 2>/dev/null | tail -n +4
if have systemctl; then systemctl list-timers --no-pager --no-legend 2>/dev/null | head -10; fi

hr "8. 磁盘大头 —— 清理收益在哪"
du -sh /var/lib/docker /var/log /opt /srv /home /tmp 2>/dev/null | sort -rh

hr "9. 防火墙 / 出网 —— X-3 的现状"
have ufw && ufw status verbose 2>/dev/null | head -20
have iptables && iptables -S 2>/dev/null | head -20
have nft && nft list ruleset 2>/dev/null | head -20

printf '\n══════ 盘点结束 —— 本脚本没有删除任何东西 ══════\n'
