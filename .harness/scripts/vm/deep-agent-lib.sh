#!/usr/bin/env bash
#
# deep-agent-lib.sh —— deploy.sh 第 4h 步（deep-agent-service）的可测逻辑。
#
# 为什么抽出来（PR #941 rev-feature 审查）：这些逻辑内联在 deploy.sh 里时不可测——
# 现有 deploy-readiness.test.ts 的 9/9 只覆盖 #448 重启后就绪，与 4h 步无关。
# 抽成 sourceable 函数后，deep-agent-lib.test.ts 用假 curl/docker 在 PATH 上
# 逐条覆盖：env 解析（缺 key/空值红退）、端口↔BASE_URL 派生一致、graph 就绪断言、
# 镜像 GC 的 best-effort 语义。
#
# ⚠ pipefail 陷阱（审查 P1-1 指出的坑）：`set -euo pipefail` 下
# `VAR=$(grep ... | tail | cut)` 在 key 缺失时 grep 退 1 → 整条流水线非 0 →
# 脚本**静默退出**，根本走不到后面的诊断分支。所以这里所有读取都走
# read_env_value（内部 `|| true`），把「缺失」变成可判断的空串，再显式红退。

# 读 env 文件里某个 key 的值（取最后一次出现；缺失/文件不存在 → 空串，退出码恒 0）。
read_env_value() {
  local file=$1 key=$2 line
  line=$(grep "^${key}=" "$file" 2>/dev/null | tail -1) || true
  printf '%s' "${line#"${key}="}"
}

# 校验 deep-agent 模型三元组齐全。缺哪个、在哪个文件补，一次性列全（人话诊断）。
# 用法：deep_agent_assert_model_env <env_file> <base_url> <api_key> <model_id>
deep_agent_assert_model_env() {
  local file=$1 base_url=$2 api_key=$3 model_id=$4
  local missing=()
  [ -n "$base_url" ] || missing+=(KERNEL_MODEL_BASE_URL)
  [ -n "$api_key" ] || missing+=(KERNEL_MODEL_API_KEY)
  [ -n "$model_id" ] || missing+=(KERNEL_DEEP_AGENT_MODEL_ID)
  if ((${#missing[@]} > 0)); then
    {
      echo "✗ deep-agent-service 无法部署：${file} 缺以下 key（或值为空）："
      local key
      for key in "${missing[@]}"; do
        echo "    ${key}="
      done
      echo "  ⇒ 在 ${file} 里补上以上每一行（KERNEL_DEEP_AGENT_MODEL_ID 每环境必填，"
      echo "    无默认值——coord-main 裁决，见 PR #941；KERNEL_MODEL_* 与 apps/api 同名同值）。"
    } >&2
    return 1
  fi
}

# 端口 → BASE_URL 的唯一派生式。同一事实只声明一处（PROJECT.md「本机端口分配」）。
deep_agent_base_url_for_port() {
  printf 'http://127.0.0.1:%s' "$1"
}

# 从 BASE_URL 反解端口；解析不出（非 http://host:port 形状）→ 非 0。
deep_agent_port_from_base_url() {
  local url=$1 port
  port=${url##*:}
  port=${port%%/*}
  case "$port" in
    '' | *[!0-9]*) return 1 ;;
  esac
  printf '%s' "$port"
}

# 决定宿主端口并保证 deploy.env 的 KERNEL_DEEP_AGENT_BASE_URL 与之机械一致
# （审查 P1-4：此前 HOST_PORT 可配而 BASE_URL 写死 2025，可各指一个端口）。
# 规则：deploy.env 已有 BASE_URL ⇒ 它是单一事实源，端口从它反解；
#       此时若外部又传了不一致的 override_port ⇒ 红退（两处声明冲突，不猜）；
#       deploy.env 没有 ⇒ 用 override_port（缺省 default_port）派生 BASE_URL 写入。
# stdout 输出最终端口；诊断走 stderr。
deep_agent_resolve_host_port() {
  local env_file=$1 default_port=$2 override_port=${3:-}
  local existing port
  existing=$(read_env_value "$env_file" KERNEL_DEEP_AGENT_BASE_URL)
  if [ -n "$existing" ]; then
    if ! port=$(deep_agent_port_from_base_url "$existing"); then
      echo "✗ ${env_file} 的 KERNEL_DEEP_AGENT_BASE_URL=${existing} 解析不出端口（期望 http://127.0.0.1:<port>）" >&2
      return 1
    fi
    if [ -n "$override_port" ] && [ "$override_port" != "$port" ]; then
      echo "✗ DEEP_AGENT_HOST_PORT=${override_port} 与 ${env_file} 里 KERNEL_DEEP_AGENT_BASE_URL 的端口 ${port} 冲突" >&2
      echo "  ⇒ 端口的单一事实源是 deploy.env 那一行（登记见 .harness/instructions/project/PROJECT.md），改它，不要传 override" >&2
      return 1
    fi
  else
    port=${override_port:-$default_port}
    echo "KERNEL_DEEP_AGENT_BASE_URL=$(deep_agent_base_url_for_port "$port")" >> "$env_file"
    echo "  ${env_file} 里没有 KERNEL_DEEP_AGENT_BASE_URL，已按端口 ${port} 派生写入" >&2
  fi
  printf '%s' "$port"
}

# 有界 graph 就绪断言（审查 P1-3）：/ok 在 graph 加载失败时也可能 200（#940 红/绿
# 证据实测），必须 POST /assistants/search 看到目标 graph_id 才算就绪。
# 用法：deep_agent_wait_graph_ready <base_url> <graph_id> [attempts] [interval_s]
deep_agent_wait_graph_ready() {
  local base=$1 graph=$2 attempts=${3:-30} interval=${4:-2}
  local attempt payload
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if payload=$(curl -fsS -m 5 -X POST "${base}/assistants/search" \
      -H 'Content-Type: application/json' -d '{"limit":100,"offset":0}' 2>/dev/null); then
      if printf '%s' "$payload" | grep -qE "\"graph_id\"[[:space:]]*:[[:space:]]*\"${graph}\""; then
        return 0
      fi
    fi
    sleep "$interval"
  done
  return 1
}

# 镜像 GC（审查 P1-2）：每次部署产生 ~500MB 的 SHA tag，旧 tag 无人回收会撑爆磁盘。
# 仓库局部、best-effort：只动 <repo>:* 的 tag；保留传入的 keep 列表（当前 SHA +
# 可选上一个作回滚）；单个 rmi 失败只打日志不红整个部署；函数退出码恒 0。
# 用法：deep_agent_gc_images <repo> <keep_tag> [keep_tag...]
deep_agent_gc_images() {
  local repo=$1
  shift
  local keep=" $* " tag tags
  tags=$(docker images "$repo" --format '{{.Tag}}' 2>/dev/null) || true
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    [ "$tag" != "<none>" ] || continue
    case "$keep" in *" ${tag} "*) continue ;; esac
    if docker rmi "${repo}:${tag}" >/dev/null 2>&1; then
      echo "  GC：已回收旧镜像 ${repo}:${tag}"
    else
      echo "  GC：回收 ${repo}:${tag} 失败（best-effort，不阻塞部署）"
    fi
  done <<< "$tags"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# issue #2076：引擎能力开关的 env 投影。
#
# 为什么需要这个函数（实测根因，不是预防性设计）：deep-agent 容器读的是 deploy.sh
# 第 4h 步当场重写的 deep-agent.env，而那段投影原本是一份**固定三键白名单**
# （KERNEL_MODEL_* + KERNEL_DEEP_AGENT_MODEL_ID）。于是 `DEEP_AGENT_HITL_TOOLS` /
# `DEEP_AGENT_SUBAGENTS_ENABLED` / `DEEP_AGENT_CHECKPOINT_DB` 这三个引擎侧开关
# （读它们的是 apps/deep-agent-service/src/deep_agent_service/harness.py 的
# build_interrupt_on / build_subagents / build_checkpointer）**无论在 deploy.env
# 里怎么写都到不了容器进程**——2026-08-26 devapp 实测：
#   docker exec workspacex-deep-agent env | grep '^DEEP_AGENT'  →  零命中。
# 这正是本仓那条铁律的形态：配置文件里有这一行 ≠ 进程真的读到了它。
#
# 语义刻意与 LangSmith 三件套一致——**可选投影**：deploy.env 里没设（或值为空）就
# 一行都不写，deep-agent.env 里不留 `KEY=` 的空值假象。空值假象在这里不是洁癖问题：
# harness.py 的三个 build_* 都用 `(os.environ.get(K) or "").strip()` 判空，投一个
# 空串进去与不投影行为相同，但会让运维读 deep-agent.env 时误以为"开关配过了"。
#
# 用法：deep_agent_project_capability_env <src_env_file> <dest_env_file> <key>...
# 投影了哪些 key 走 stderr（部署日志里可见，便于事后对账）；退出码恒 0。
deep_agent_project_capability_env() {
  local src=$1 dest=$2
  shift 2
  local key value projected=()
  for key in "$@"; do
    value=$(read_env_value "$src" "$key")
    [ -n "$value" ] || continue
    printf '%s=%s\n' "$key" "$value" >> "$dest"
    projected+=("$key")
  done
  if ((${#projected[@]} > 0)); then
    echo "  引擎能力开关已投影进 $(basename "$dest")：${projected[*]}" >&2
  fi
  return 0
}
