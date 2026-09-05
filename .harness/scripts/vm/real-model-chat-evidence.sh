#!/usr/bin/env bash
# real-model-chat-evidence.sh —— devapp 上「真实模型 PDF 用例」取证通道的驱动脚本
# （issue #2802）。在 devapp 自建 runner 上跑，由
# `.github/workflows/real-model-chat-evidence.yml` 手动触发调用。
#
# 用法（三个子命令，workflow 分三步调，好让 job log 的分段与失败点对得上）：
#   real-model-chat-evidence.sh preflight   # 解析凭据/目标，写出这一轮的 env 文件
#   real-model-chat-evidence.sh collect     # 收后端日志与部署指纹（脱敏后进证据包）
#   real-model-chat-evidence.sh summarize   # 把判决打进 job log
#
# ## 它对这台活着的机器做什么、不做什么（与 live-evidence.sh 同一条边界）
#
# 做：① 只读探测（journalctl / docker logs / deploy.env 里**单个** key 的存在性）；
#     ② 用一个**已有账号**在真实 /chat 里开一条新线程、发一条消息、跑一次 run，
#        并下载它产出的 PDF —— 这就是被测用例本身，写入面止于「一条新线程 + 它的产物」。
# 不做：不重启任何服务、不改 deploy.env、不跑迁移、不动别人的线程/组织/文件、
#       不安装系统包、不写 /opt/workspacex 下的任何东西。
#
# ## 凭据从哪来（不新增 secret、不搬运凭据）
#
# 只读**这台机器上已经有的**文件：`$REAL_MODEL_E2E_ENV_FILE`，默认
# `/opt/workspacex/real-model-e2e.env`（0600）。里面只需要两行：登录这套部署的
# 一个已有账号的邮箱与口令。GitHub 那边不新增任何 secret，凭据一步都不离开这台机器。
# 文件不在 ⇒ 逐个点名后红退，**不发明第二条凭据路径**。
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"

# shellcheck source=scripts/real-model-env.sh
source "${REPO_ROOT}/scripts/real-model-env.sh"

ENV_FILE="${REAL_MODEL_E2E_ENV_FILE:-/opt/workspacex/real-model-e2e.env}"
DEPLOY_ENV="${DEPLOY_ENV_FILE:-/opt/workspacex/deploy.env}"
EVIDENCE_DIR="${REAL_MODEL_E2E_EVIDENCE_DIR:-${REPO_ROOT}/apps/web/test-results/real-model-evidence}"
RUN_ENV_FILE="${REAL_MODEL_RUN_ENV_FILE:-${RUNNER_TEMP:-/tmp}/real-model-e2e.env}"
SINCE_FILE="${EVIDENCE_DIR}/.started-at"

scrub_into() { # <输入文件> <证据文件名> [尾部行数]
  pnpm --filter web exec tsx e2e/support/scrub-file.ts "$1" "${EVIDENCE_DIR}/$2" "${3:-2000}" || true
}

preflight() {
  mkdir -p "$EVIDENCE_DIR"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$SINCE_FILE"

  if [ -f "$ENV_FILE" ]; then
    echo "[devapp] 装载凭据文件：$ENV_FILE（值不回显）"
    set -a; # shellcheck disable=SC1090
    source "$ENV_FILE"; set +a
  else
    echo "[devapp] 未找到 $ENV_FILE —— 改用已导出的环境变量"
  fi

  if ! real_model_require_vars "devapp 真实模型取证" REAL_MODEL_E2E_EMAIL REAL_MODEL_E2E_PASSWORD; then
    echo "" >&2
    echo "  这两个变量应当放在这台机器上的 $ENV_FILE（0600，只有 runner 用户能读）：" >&2
    echo "      REAL_MODEL_E2E_EMAIL=<这套部署上一个已有账号>" >&2
    echo "      REAL_MODEL_E2E_PASSWORD=<它的口令>" >&2
    echo "  ⚠ 刻意不走 GitHub secret：凭据不离开这台机器是本通道的设计前提。" >&2
    return 1
  fi

  # 目标站点：优先显式配置；否则从 deploy.env 里**只取 PUBLIC_DOMAIN 这一个 key**
  # （不 source 整个文件、不打印其它任何行）；再否则落到已知的 devapp 域名。
  local domain=""
  if [ -r "$DEPLOY_ENV" ]; then
    domain="$(grep -m1 '^PUBLIC_DOMAIN=' "$DEPLOY_ENV" 2>/dev/null | cut -d= -f2- || true)"
  fi
  local base="${REAL_MODEL_E2E_BASE_URL:-https://${domain:-devapp.boardx.us}}"
  echo "[devapp] 目标站点：$base"
  echo "[devapp] ⚠ 刻意走公网入口而不是 127.0.0.1:APP_WEB_PORT —— #2795 的 SSE/WS 掐断"
  echo "         发生在 Caddy 这一层，绕开网关就把要测的那件事测没了。"

  umask 077
  {
    echo "REAL_MODEL_E2E_EMAIL=${REAL_MODEL_E2E_EMAIL}"
    echo "REAL_MODEL_E2E_PASSWORD=${REAL_MODEL_E2E_PASSWORD}"
    echo "REAL_MODEL_E2E_BASE_URL=${base}"
    echo "REAL_MODEL_E2E_LANE=devapp"
    echo "REAL_MODEL_E2E_EVIDENCE_DIR=${EVIDENCE_DIR}"
    echo "REAL_MODEL_E2E_RUN_TIMEOUT_MS=${REAL_MODEL_E2E_RUN_TIMEOUT_MS:-900000}"
    [ -n "${REAL_MODEL_E2E_PROMPT:-}" ] && echo "REAL_MODEL_E2E_PROMPT=${REAL_MODEL_E2E_PROMPT}"
  } > "$RUN_ENV_FILE"
  chmod 600 "$RUN_ENV_FILE"
  echo "[devapp] 本轮 env 已写入 $RUN_ENV_FILE（0600，仅本 job 可见；值不回显）"
}

collect() {
  mkdir -p "$EVIDENCE_DIR"
  local since; since="$(cat "$SINCE_FILE" 2>/dev/null || echo "30 min ago")"
  echo "[devapp] 收证据（自 $since 起），全部只读"

  # 部署指纹：这次跑的到底是哪个 commit、哪个镜像、开了哪些流式开关。
  # deploy.env 只 grep 三个开关键，且逐行把 = 右侧带 KEY 的值打掉（同 live-evidence.sh）。
  {
    echo "== 目标部署指纹 =="
    git -C /opt/workspacex/app log --oneline -1 2>&1 || echo "(读不到 /opt/workspacex/app 的 git 历史)"
    echo "== 本次取证所用仓库版本 =="
    git -C "$REPO_ROOT" log --oneline -1 2>&1 || true
    echo "== deep-agent 容器 =="
    docker inspect workspacex-deep-agent --format '{{.Config.Image}} started={{.State.StartedAt}} status={{.State.Status}}' 2>&1 || echo "(inspect 不可用)"
    echo "== 流式/内核开关（值里带 KEY 的一律打掉）=="
    grep -E '^(KERNEL_DEEP_AGENT_STREAM_ENABLED|KERNEL_DEEP_AGENT_BASE_URL|KERNEL_DEEP_AGENT_MODEL_ID|NEXT_PUBLIC_API_URL)=' \
      "$DEPLOY_ENV" 2>/dev/null | sed 's/\(.*KEY.*\)=.*/\1=<REDACTED>/' || echo "(deploy.env 不可读——不是错误，runner 用户本来就未必有权)"
    echo "== 服务状态（只读 is-active，不做任何 restart）=="
    for unit in workspacex-api workspacex-web; do
      printf '%s: ' "$unit"; systemctl is-active "$unit" 2>&1 || true
    done
  } > "${EVIDENCE_DIR}/70-devapp-context.txt" 2>&1

  # 后端日志：journalctl 需要 systemd-journal 组权限，拿不到就如实写一行——
  # 「取不到」与「取到了但是空的」必须能被区分开，静默产出空文件是骗人的。
  journalctl -u workspacex-api --since "$since" --no-pager > /tmp/real-model-api.log 2>&1 \
    || echo "<journalctl -u workspacex-api 不可读（权限或 unit 不存在）>" > /tmp/real-model-api.log
  scrub_into /tmp/real-model-api.log 60-api-journal.log 4000

  docker logs --since "$since" workspacex-deep-agent > /tmp/real-model-deep-agent.log 2>&1 \
    || echo "<docker logs workspacex-deep-agent 不可读>" > /tmp/real-model-deep-agent.log
  scrub_into /tmp/real-model-deep-agent.log 62-deep-agent.log 3000

  journalctl -u workspacex-web --since "$since" --no-pager > /tmp/real-model-web.log 2>&1 \
    || echo "<journalctl -u workspacex-web 不可读>" > /tmp/real-model-web.log
  scrub_into /tmp/real-model-web.log 63-web-journal.log 1500

  echo "[devapp] 证据目录：$EVIDENCE_DIR"
  ls -la "$EVIDENCE_DIR" || true
}

summarize() {
  # 判决已经由 spec 自己打进 job log 一次（`RealModelEvidence.finish()`）。这里再打一次
  # 是因为 collect/upload 之后 job log 已经翻过好几屏，读日志的人应当在**最后**看到结论。
  echo ""
  echo "════════ 本轮判决（同一份内容也在证据包 01-verdict.txt）════════"
  cat "${EVIDENCE_DIR}/01-verdict.txt" 2>/dev/null \
    || echo "（没有 01-verdict.txt —— spec 没跑到写结论那一步，看上一步的报错与 60-api-journal.log）"
  echo "════════ 证据包内容 ════════"
  ls -1 "$EVIDENCE_DIR" 2>/dev/null || true
}

case "${1:-}" in
  preflight) preflight ;;
  collect)   collect ;;
  summarize) summarize ;;
  *) echo "usage: $0 {preflight|collect|summarize}" >&2; exit 2 ;;
esac
