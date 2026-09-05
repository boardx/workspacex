#!/usr/bin/env bash
# real-model-env.sh —— 真实模型 e2e 通道的**可移植**环境装载与校验（唯一事实源）。
#
# 用法：`source scripts/real-model-env.sh`（被 source，不被执行）。
#
# 它存在的原因（issue #2802）：`e2e-up.sh` 原来第 5 行写死
# `source /Users/shenyanbin/Documents/workspacex/.env.local` —— 一台 Mac 的绝对路径。
# 于是"用真实模型跑通一次完整用例"这件事只有一个人在一台机器上能做。这个文件把
# 「凭据从哪来」「缺了谁怎么报」收敛成一处，本地 Mac / devapp 自建 runner / 任何
# 拿到凭据的机器共用同一套装载与校验口径。
#
# ⚠ 凭据只在进程内部 export，**绝不 echo、绝不 dump 环境表**——这是 `e2e-up.sh`
#   原有的承诺，本文件继承它。新写出的每一份证据文件同样脱敏，见
#   `apps/web/e2e/support/real-model-evidence.ts` 的 `scrubSecrets`。
#
# 装载顺序（先到先得，**不静默降级**）：
#   ① `$WORKSPACEX_ENV_FILE`（默认 `./.env.local`，相对仓库根）—— 文件在就 source 它；
#   ② 文件不在 ⇒ 用**已经 export 在环境里**的变量（CI/自建 runner 的常见形态），
#      这条路径不报错、但会明确打印"未找到 env 文件，改用已导出的环境变量"。
#   两条路都拿不到某个必需变量 ⇒ `real_model_require_vars` 逐个点名后红退。
#   任何情况下都不会退回回环模型再把结果说成真实模型跑通——那正是 #2802 要挡的事。

# shellcheck shell=bash

# 装载 env 文件（若存在）。只打印路径与是否命中，不打印任何变量值。
real_model_load_env_file() {
  local repo_root="${1:?real_model_load_env_file 需要仓库根路径}"
  local env_file="${WORKSPACEX_ENV_FILE:-${repo_root}/.env.local}"

  if [ -f "$env_file" ]; then
    echo "[real-model-env] 装载 env 文件：$env_file"
    # set -a：文件里的赋值自动 export。变量值一个字都不回显。
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  else
    echo "[real-model-env] 未找到 env 文件（$env_file）——改用已导出的环境变量。"
    echo "[real-model-env] 换一个路径：WORKSPACEX_ENV_FILE=/path/to/.env.local"
  fi
}

# 逐个点名缺失的必需变量。**一次列全**，不是发现一个报一个——
# `deploy.sh` 第 5c 步（#620：一天两次"重启崩溃→补一个变量→再重启"）同一条教训。
real_model_require_vars() {
  local context="${1:?real_model_require_vars 需要一个上下文名}"
  shift
  local missing=()
  local name
  for name in "$@"; do
    # 间接展开：只判空/未设，不读值到任何输出里。
    if [ -z "${!name:-}" ]; then
      missing+=("$name")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "✗ [$context] 缺少必需的环境变量（共 ${#missing[@]} 个）：" >&2
    for name in "${missing[@]}"; do
      echo "    · $name" >&2
    done
    # ⚠ 这里刻意**不**印"它们从哪来"——不同调用方的来源不一样（凭据来自 env 文件，
    #   隔离变量来自 with-test-isolation 外壳）。印一句通用的来源提示会把人指错地方。
    #   每个调用方自己在下面补一句属于它的指引。
    return 1
  fi
  echo "[real-model-env] [$context] 必需变量齐了（$# 个，值不回显）"
}

# 隔离外壳注进来的那一套。缺了它们说明没经过 `with-test-isolation.ts`，
# 直接 `docker compose -p ""` 会以一个完全无关的错误形态失败。
real_model_require_isolation() {
  real_model_require_vars "test-isolation" \
    COMPOSE_PROJECT_NAME WORKSPACEX_API_PORT WORKSPACEX_WEB_PORT WORKSPACEX_DB \
    || {
      echo "  ⇒ 这几个由隔离外壳派生（端口/库名/compose 项目名），不该手填。请这样调用：" >&2
      echo "     pnpm run e2e:real-model-smoke" >&2
      echo "     或 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- <命令>" >&2
      return 1
    }
}

# 凭据类变量的校验：在通用点名之外，补一句"它们该放哪"。
real_model_require_credentials() {
  local context="${1:?real_model_require_credentials 需要一个上下文名}"
  shift
  real_model_require_vars "$context" "$@" || {
    echo "  ⇒ 它们从哪来：${WORKSPACEX_ENV_FILE:-<仓库根>/.env.local}（chmod 600，已被 .gitignore 挡住）" >&2
    echo "     模板见仓库根 .env.local.example；或者在调用本命令之前自行 export。" >&2
    echo "  ⚠ 不会退回回环模型继续跑——那样跑出来的绿是假的（issue #2802）。" >&2
    return 1
  }
}
