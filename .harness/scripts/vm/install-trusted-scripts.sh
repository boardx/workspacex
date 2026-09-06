#!/usr/bin/env bash
#
# install-trusted-scripts.sh —— 把 `/usr/local/{bin,lib}` 下那几份 **root 拥有的副本**
# 更新成 `origin/main` 当前的版本。**在目标机器上以 root 执行**，由
# `.github/workflows/devapp-install-trusted-scripts.yml` 手动触发时经 sudo 调它。
#
# ## 为什么需要它
#
# `provision.sh` 第 7 步装的那三份副本，此前**只有人手动跑 provision.sh 才会更新**。
# 2026-09-06 实测事故：`deploy.sh` 的修复合入 main、CI 全绿、deploy job success，而机器上
# 跑的仍是旧副本——「改了脚本并合入 main」对真正被执行的东西没有任何影响，部署照样绿。
# #2833 把这条缝变成了会红的门；本脚本是那道门的**修复动作**，让它不必每次都 ssh。
#
# ## ⚠ 这是一条提权面，设计上按最小化处理（人类 2026-09-06 明确要求做这个入口）
#
# 装进 /usr/local/bin 的脚本会被 root 执行。因此**谁能决定装什么内容**就等于谁能拿到
# root。这里的约束是：
#
#   ① **不接受任何参数**。sudoers 白名单钉死这一条无参命令，调用方指不了别的源文件、
#      改不了目标路径。
#   ② **只装 `origin/main` 上的版本**：脚本自己 fetch，然后 `git show origin/main:<路径>`
#      取内容——**不读工作区文件**。runner 能改工作区（它就在那儿 checkout），改不了
#      origin/main（那要过 PR review + 合并）。
#   ③ 装完打印每份的 sha256 与 origin/main 的 SHA，留在 workflow 日志里可追。
#
# ⚠ 这三条一起才成立，少一条这个入口就退化成「任何一个 PR 分支都能拿到 root」。
#   特别是 ②：改成 `install "$APP_DIR/.harness/scripts/vm/deploy.sh"` 看起来更简单，
#   但那读的是工作区——deploy.sh 会 checkout 本次要部署的 ref，于是一个未合并的分支
#   就能把任意脚本装成 root 拥有的副本。**不要那样改。**
set -euo pipefail

if (($# != 0)); then
  echo "usage: workspacex-install-trusted-scripts   (不接受参数——见脚本头注 ①)" >&2
  exit 2
fi

APP_DIR=${APP_DIR:-/opt/workspacex/app}
BRANCH=${TRUSTED_SCRIPTS_BRANCH:-main}

[ -d "$APP_DIR/.git" ] || { echo "✗ $APP_DIR 不是一个 git 仓库" >&2; exit 1; }

echo "→ fetch origin/${BRANCH}"
git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
SOURCE_SHA=$(git -C "$APP_DIR" rev-parse "origin/${BRANCH}")
echo "  origin/${BRANCH} = ${SOURCE_SHA}"

# 源文件路径 → 安装目标 + 权限。与 provision.sh 第 7 步**同一张表**；
# 那边是首次搭台，这边是后续更新，两处必须同时改（deploy-trusted-copy-drift.test.ts
# 与 devapp-install-trusted-scripts.test.ts 各自钉住一半）。
install_from_main() {
  local repo_path=$1 target=$2 mode=$3 tmp
  tmp=$(mktemp)
  # ⚠ 从 origin/main 的**对象**里取内容，不读工作区（见头注 ②）。
  if ! git -C "$APP_DIR" show "${SOURCE_SHA}:${repo_path}" > "$tmp"; then
    rm -f "$tmp"
    echo "✗ origin/${BRANCH} 上没有 ${repo_path}" >&2
    exit 1
  fi
  install -o root -g root -m "$mode" "$tmp" "$target"
  rm -f "$tmp"
  echo "  已装 ${target}  sha256=$(sha256sum "$target" | cut -d' ' -f1)"
}

echo "→ 安装 root 拥有的副本"
install_from_main ".harness/scripts/vm/deploy-readiness.sh" /usr/local/lib/workspacex-deploy-readiness.sh 0644
install_from_main ".harness/scripts/vm/deep-agent-lib.sh" /usr/local/lib/workspacex-deep-agent-lib.sh 0644
install_from_main ".harness/scripts/vm/deploy.sh" /usr/local/bin/workspacex-deploy 0755

echo "✅ 已更新到 origin/${BRANCH} @ ${SOURCE_SHA}"
