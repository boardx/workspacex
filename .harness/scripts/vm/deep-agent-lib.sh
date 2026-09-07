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

# #2929: provision/deploy share this one idempotent writer. Existing non-empty values are
# never changed; malformed values fail closed instead of being silently rotated. The helper
# reports key names only, never their values.
native_runtime_ensure_deploy_env() {
  local file=$1 default_socket=$2 default_admission=${3:-1}
  local socket binding service_key admission generated=()
  [ -f "$file" ] || { echo "✗ native runtime env file missing: ${file}" >&2; return 1; }
  [[ "$default_socket" == /*/skill-sandbox.sock ]] || {
    echo "✗ native runtime default socket must be an absolute skill-sandbox.sock path" >&2
    return 1
  }
  [[ "$default_admission" == "0" || "$default_admission" == "1" ]] || {
    echo "✗ native runtime default admission must be 0 or 1" >&2
    return 1
  }

  socket=$(read_env_value "$file" NATIVE_SESSION_SOCKET)
  if [ -z "$socket" ]; then
    socket=$default_socket
    printf 'NATIVE_SESSION_SOCKET=%s\n' "$socket" >> "$file"
    generated+=(NATIVE_SESSION_SOCKET)
  fi
  binding=$(read_env_value "$file" NATIVE_SESSION_BINDING_KEY)
  if [ -z "$binding" ]; then
    binding=$(openssl rand -hex 32)
    printf 'NATIVE_SESSION_BINDING_KEY=%s\n' "$binding" >> "$file"
    generated+=(NATIVE_SESSION_BINDING_KEY)
  fi
  service_key=$(read_env_value "$file" DEEP_AGENT_SERVICE_INTERNAL_KEY)
  if [ -z "$service_key" ]; then
    service_key=$(openssl rand -hex 32)
    printf 'DEEP_AGENT_SERVICE_INTERNAL_KEY=%s\n' "$service_key" >> "$file"
    generated+=(DEEP_AGENT_SERVICE_INTERNAL_KEY)
  fi
  admission=$(read_env_value "$file" KERNEL_NATIVE_RUNTIME)
  if [ -z "$admission" ]; then
    admission=$default_admission
    printf 'KERNEL_NATIVE_RUNTIME=%s\n' "$admission" >> "$file"
    generated+=(KERNEL_NATIVE_RUNTIME)
  fi

  [[ "$socket" == /*/skill-sandbox.sock && "$socket" != *$'\n'* ]] || {
    echo "✗ native runtime NATIVE_SESSION_SOCKET is invalid" >&2
    return 1
  }
  [[ "$binding" =~ ^[a-f0-9]{64}$ ]] || {
    echo "✗ native runtime NATIVE_SESSION_BINDING_KEY must be 64 lowercase hex characters" >&2
    return 1
  }
  [[ "$service_key" =~ ^[^[:space:]]{32,}$ ]] || {
    echo "✗ native runtime DEEP_AGENT_SERVICE_INTERNAL_KEY must be at least 32 non-space characters" >&2
    return 1
  }
  [[ "$admission" == "0" || "$admission" == "1" ]] || {
    echo "✗ native runtime KERNEL_NATIVE_RUNTIME must be 0 or 1" >&2
    return 1
  }
  if ((${#generated[@]} > 0)); then
    echo "  native runtime 已补齐配置键：${generated[*]}（值不回显）" >&2
  fi
}

# Deep Agent needs the UDS and API callback key for both new native runs and recovery of an
# already-persisted native-v1 run. Therefore this projection intentionally remains present
# when KERNEL_NATIVE_RUNTIME=0; that flag controls admission only.
deep_agent_project_native_env() {
  local src=$1 dest=$2 container_socket=$3 service_base=$4
  local host_socket binding service_key admission
  host_socket=$(read_env_value "$src" NATIVE_SESSION_SOCKET)
  binding=$(read_env_value "$src" NATIVE_SESSION_BINDING_KEY)
  service_key=$(read_env_value "$src" DEEP_AGENT_SERVICE_INTERNAL_KEY)
  admission=$(read_env_value "$src" KERNEL_NATIVE_RUNTIME)
  [[ "$host_socket" == /*/skill-sandbox.sock ]] || { echo "✗ native runtime host socket is invalid" >&2; return 1; }
  [[ "$binding" =~ ^[a-f0-9]{64}$ ]] || { echo "✗ native runtime binding key is unavailable" >&2; return 1; }
  [[ "$service_key" =~ ^[^[:space:]]{32,}$ ]] || { echo "✗ native runtime service key is unavailable" >&2; return 1; }
  [[ "$admission" == "0" || "$admission" == "1" ]] || { echo "✗ native runtime admission is invalid" >&2; return 1; }
  [[ "$container_socket" == /*/skill-sandbox.sock ]] || { echo "✗ native runtime container socket is invalid" >&2; return 1; }
  [[ "$service_base" =~ ^http://[a-zA-Z0-9.-]+:[0-9]+$ ]] || { echo "✗ native runtime service base URL is invalid" >&2; return 1; }
  {
    printf 'NATIVE_SESSION_SOCKET=%s\n' "$container_socket"
    printf 'NATIVE_SESSION_SERVICE_BASE_URL=%s\n' "$service_base"
    printf 'NATIVE_SESSION_SERVICE_KEY=%s\n' "$service_key"
  } >> "$dest"
  echo "  Native recovery env 已投影：admission=${admission} socket=PRESENT service-key=PRESENT" >&2
}

# Read the restarted process' NUL-delimited /proc environ and assert the runtime bindings
# were actually loaded. Error messages contain key names/boolean state only.
native_runtime_assert_api_env_file() {
  local file=$1 expected_socket=$2 expected_admission=$3
  local socket binding service_key admission
  [ -r "$file" ] || { echo "✗ native runtime process env is unreadable" >&2; return 1; }
  socket=$(tr '\0' '\n' < "$file" | grep '^NATIVE_SESSION_SOCKET=' | tail -1) || true
  socket=${socket#NATIVE_SESSION_SOCKET=}
  binding=$(tr '\0' '\n' < "$file" | grep '^NATIVE_SESSION_BINDING_KEY=' | tail -1) || true
  binding=${binding#NATIVE_SESSION_BINDING_KEY=}
  service_key=$(tr '\0' '\n' < "$file" | grep '^DEEP_AGENT_SERVICE_INTERNAL_KEY=' | tail -1) || true
  service_key=${service_key#DEEP_AGENT_SERVICE_INTERNAL_KEY=}
  admission=$(tr '\0' '\n' < "$file" | grep '^KERNEL_NATIVE_RUNTIME=' | tail -1) || true
  admission=${admission#KERNEL_NATIVE_RUNTIME=}
  if [[ "$socket" != "$expected_socket" || ! "$binding" =~ ^[a-f0-9]{64}$ ||
        ! "$service_key" =~ ^[^[:space:]]{32,}$ || "$admission" != "$expected_admission" ]]; then
    echo "✗ native runtime process env missing or inconsistent" >&2
    return 1
  fi
}

# Deep Agent must have exactly one host bind: the native UDS directory, read-only. The
# in-container probe validates env presence, absence of the binding encryption key, and an
# actual HTTP health exchange through that socket without printing any secret.
native_runtime_assert_deep_agent_container() {
  local container=$1 host_socket=$2 container_socket=$3 service_base=$4
  local host_dir container_dir expected binds
  host_dir=${host_socket%/*}
  container_dir=${container_socket%/*}
  expected="${host_dir}:${container_dir}:ro"
  binds=$(docker inspect --format '{{json .HostConfig.Binds}}' "$container" 2>/dev/null) || {
    echo "✗ native runtime Deep Agent topology cannot be inspected" >&2
    return 1
  }
  [[ "$binds" == "[\"${expected}\"]" ]] || {
    echo "✗ native runtime Deep Agent must mount only the session socket directory read-only" >&2
    return 1
  }
  docker exec \
    -e WX_EXPECTED_NATIVE_SOCKET="$container_socket" \
    -e WX_EXPECTED_NATIVE_SERVICE_BASE="$service_base" \
    "$container" python -c 'import os,socket
p=os.environ["WX_EXPECTED_NATIVE_SOCKET"]
assert os.environ.get("NATIVE_SESSION_SOCKET")==p
assert os.environ.get("NATIVE_SESSION_SERVICE_BASE_URL")==os.environ["WX_EXPECTED_NATIVE_SERVICE_BASE"]
assert len(os.environ.get("NATIVE_SESSION_SERVICE_KEY", ""))>=32
assert "NATIVE_SESSION_BINDING_KEY" not in os.environ
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(2);s.connect(p)
s.sendall(b"GET /healthz HTTP/1.1\r\nHost: sandbox\r\nConnection: close\r\n\r\n")
status=s.recv(128).split(b"\r\n",1)[0];s.close()
assert b" 200 " in status' >/dev/null 2>&1 || {
    echo "✗ native runtime Deep Agent env or UDS probe failed" >&2
    return 1
  }
}

# After API restart, a request with the projected internal key must cross the container-to-
# host boundary and reach the Native controller. A deliberately invalid binding/body must
# return 400: 401 means key mismatch, 5xx means the owner is absent, and connection failure
# means the host-gateway topology is broken.
native_runtime_assert_deep_agent_api_callback() {
  local container=$1
  docker exec "$container" python -c 'import os,httpx
base=os.environ.get("NATIVE_SESSION_SERVICE_BASE_URL", "").rstrip("/")
key=os.environ.get("NATIVE_SESSION_SERVICE_KEY", "")
assert base and len(key)>=32
r=httpx.post(base+"/internal/native-sessions/invalid/resolve",headers={"x-deep-agent-internal-key":key},json={},timeout=3,follow_redirects=False,trust_env=False)
assert r.status_code==400' >/dev/null 2>&1 || {
    echo "✗ native runtime Deep Agent → API authenticated callback probe failed" >&2
    return 1
  }
}
