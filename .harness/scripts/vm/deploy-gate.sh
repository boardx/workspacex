#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-readiness.sh"

deploy_status_content_allows_recovery() {
  local content=$1 nonce=$2 root_status=$3
  local expected
  printf -v expected 'protocol=workspacex-deploy/v1\nnonce=%s\nstage=smoke\nexit=%s' "$nonce" "$root_status"
  [[ "$content" == "$expected" ]]
}

root_owned_status_allows_recovery() {
  local nonce=$1 root_status=$2
  local status_dir=/run/workspacex-deploy
  local status_file="${status_dir}/${nonce}.status"
  local content

  [[ "$nonce" =~ ^[0-9a-f]{32}$ ]] || return 1
  [[ "$(/usr/bin/stat -c '%u:%a' "$status_dir" 2>/dev/null)" == "0:755" ]] || return 1
  [[ "$(/usr/bin/stat -c '%u:%a' "$status_file" 2>/dev/null)" == "0:644" ]] || return 1
  content=$(<"$status_file") || return 1
  deploy_status_content_allows_recovery "$content" "$nonce" "$root_status"
}

# ── 2026-09-06：装好的那份脚本可能不是仓库里这一份 ────────────────────────────
#
# workflow 跑的是 `sudo /usr/local/bin/workspacex-deploy`（root 拥有的副本，sudoers 只
# 许这一条路径——仓库里那份不可信，见 provision.sh 第 7 步）。那份副本**只在有人以 root
# 跑 provision.sh 时才更新**。所以「改了 deploy.sh 并合入 main」这件事，对真正被执行的
# 脚本**没有任何影响**，而部署照样是绿的。
#
# 这次实测：`up -d --build` 的修复合进 main、CI 全绿、部署 job success——而 devapp 上跑的
# 仍然是旧副本，沙箱镜像照旧没重建。与它掩护的那个 bug 是同一类（AGENTS.md「静态痕迹 ≠
# 动态事实」）：`git log` 说改动在 main 上，说明不了那台机器上跑的是哪一份。
#
# ⇒ 这里对**装好的那份**取一次动态事实：与仓库当前这一份逐字节比对，不一致就**红退**，
#   并打印重新 provision 的命令。fail-closed 是刻意的：一次"绿的但其实没生效"的部署，
#   比一次红部署难查得多——这条注释本身就是花了一整轮才查出来的。
#
# ⚠ 这里**不自动安装**新副本。runner 用户能改仓库文件，若让它把仓库里的脚本装进
#   /usr/local/bin，等于任何一个 PR 都能拿到 root——那正是 provision.sh 把副本与仓库
#   分开的理由。安装必须由人以 root 执行。
TRUSTED_DEPLOY_BIN=${TRUSTED_DEPLOY_BIN:-/usr/local/bin/workspacex-deploy}
TRUSTED_LIB_DIR=${TRUSTED_LIB_DIR:-/usr/local/lib}

assert_trusted_copies_match_repo() {
  local drifted=0 repo installed name
  local pairs=(
    "deploy.sh:${TRUSTED_DEPLOY_BIN}"
    "deploy-readiness.sh:${TRUSTED_LIB_DIR}/workspacex-deploy-readiness.sh"
    "deep-agent-lib.sh:${TRUSTED_LIB_DIR}/workspacex-deep-agent-lib.sh"
  )

  for pair in "${pairs[@]}"; do
    name=${pair%%:*}
    installed=${pair#*:}
    repo="$SCRIPT_DIR/$name"
    [[ -r "$repo" ]] || { echo "✗ 仓库里缺 $repo" >&2; drifted=1; continue; }
    if [[ ! -r "$installed" ]]; then
      echo "✗ 目标机器上没有 $installed（provision.sh 从没跑过？）" >&2
      drifted=1
      continue
    fi
    if [[ "$(sha256sum <"$repo" | cut -d' ' -f1)" != "$(sha256sum <"$installed" | cut -d' ' -f1)" ]]; then
      echo "✗ $installed 与仓库的 $name 不一致 —— 这台机器上跑的不是本次要部署的那份脚本" >&2
      drifted=1
    fi
  done

  if ((drifted)); then
    echo "" >&2
    echo "  装好的副本只在 root 跑 provision.sh 时更新，合入 main 不会更新它。" >&2
    echo "  在目标机器上以 root 执行（幂等）：" >&2
    echo "    cd /opt/workspacex/app && git fetch --all && git checkout <本次 ref> && ./.harness/scripts/vm/provision.sh" >&2
    return 1
  fi
}

deploy_gate_main() {
  local root_deploy_status nonce

  if (($# != 1)); then
    echo "usage: deploy-gate.sh <git-ref>" >&2
    return 2
  fi
  # 先确认「要跑的那份脚本」就是本次提交里的那份，再去跑它。
  assert_trusted_copies_match_repo || return 1

  nonce=$(/usr/bin/openssl rand -hex 16)
  [[ "$nonce" =~ ^[0-9a-f]{32}$ ]] || { echo "✗ could not create deploy invocation nonce" >&2; return 1; }

  set +e
  sudo /usr/local/bin/workspacex-deploy "$1" --status-nonce "$nonce"
  root_deploy_status=$?
  set -e

  if ((root_deploy_status != 0)); then
    if ! root_owned_status_allows_recovery "$nonce" "$root_deploy_status"; then
      echo "✗ trusted deploy failed and root-owned invocation status contract was absent or invalid; refusing recovery" >&2
      print_deploy_diagnostics
      return "$root_deploy_status"
    fi
    echo "  trusted deploy entered smoke but returned ${root_deploy_status}; applying the stable postcondition gate"
  fi

  run_post_restart_smoke
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  deploy_gate_main "$@"
fi
