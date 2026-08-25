#!/usr/bin/env bash
# init.sh — 一键 bootstrap:安装依赖 + 基础验证 + 安装 git hooks + 打印启动命令
# 改下面三个变量为你项目的真实命令即可。
#
# 默认路径（ADR-106 batch-1/6，#1276）：只跑依赖安装 + 生成物检查 + 快速健康检查，
# 不再默认跑全仓 verify:base:raw（分钟级）——每次新开 worktree 都要付这个成本，
# 而多数场景根本不需要全量证明。想要完整验证：./init.sh --full。
set -euo pipefail

RUN_FULL_VERIFY=0
for arg in "$@"; do
  case "${arg}" in
    --full) RUN_FULL_VERIFY=1 ;;
  esac
done

INSTALL_CMD="pnpm install"
FULL_VERIFY_CMD="pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm -w run verify:base:raw"   # --full 时跑:类型检查 + lint + 单测（全仓）
START_CMD=""   # 模板无应用层；接入你的 app 后改成真实启动命令（如 pnpm -w run dev）

echo "==> 工作目录: $(pwd)"

echo "==> 安装依赖: ${INSTALL_CMD}"
eval "${INSTALL_CMD}"

echo "==> 安装 git hooks"
# 总是覆盖安装（保证 hook 升级生效；内容幂等）。
install_pre_commit_hook() {
  local hook_path
  hook_path="$(git rev-parse --git-path hooks/pre-commit)"
  mkdir -p "$(dirname "${hook_path}")"
  cat > "${hook_path}" << 'HOOK'
#!/usr/bin/env bash
# harness-hook (pre-commit): 三道防线
STAGED=$(git diff --cached --name-only 2>/dev/null || true)

# 1) 禁止手改脚本派生的只读视图
if echo "${STAGED}" | grep -q "active-features.json"; then
  echo "✗ [harness] active-features.json 是脚本派生只读视图，禁止手改。改 feature_list.json 后重跑 new-sprint。"
  exit 1
fi

# 2) lockfile 必须是 pnpm 9（lockfileVersion '9.0'）——防本机 pnpm 8 把它退回 6.0 害 CI
if echo "${STAGED}" | grep -q "pnpm-lock.yaml"; then
  ver=$(git show :pnpm-lock.yaml 2>/dev/null | head -1)
  if ! printf '%s' "$ver" | grep -q "lockfileVersion: '9.0'"; then
    echo "✗ [harness] pnpm-lock.yaml 不是 lockfileVersion '9.0'（你可能用了 pnpm 8）。"
    echo "  用 corepack pnpm@9.0.0 install --lockfile-only 重生成后再提交。"
    exit 1
  fi
fi

# 3) 防误用 git add -A 卷入参考代码/巨量文件
if echo "${STAGED}" | grep -q "phases/requirements/oldcode/"; then
  echo "✗ [harness] oldcode/ 是参考代码（已 gitignore），不要提交。"
  exit 1
fi
cnt=$(printf '%s\n' "${STAGED}" | grep -c . || true)
if [ "${cnt:-0}" -gt 800 ]; then
  echo "✗ [harness] 本次 staged ${cnt} 个文件，疑似误用 git add -A 卷入大目录。请用明确路径 git add。"
  exit 1
fi
HOOK
  chmod +x "${hook_path}"
  echo "  ✓ pre-commit hook（active-features / lockfile 9.0 / 巨量提交 防线）"
}

# pre-push: 快速反馈门，与 CI 的快速迭代策略对齐（见 .github/workflows/harness-verify.yml）——
# 只对受本次改动影响的模块跑 typecheck/lint（turbo --affected）。
#
# ─── 2026-08-26（#504）：从 typecheck/lint/test 收窄为 typecheck/lint ───
# 这是**收窄，不是削弱**。收窄前本地跑的每一项，云端都在跑，且更强：
#
#   本地 pre-push（收窄前）           云端等价物                        强度
#   ────────────────────────────────  ────────────────────────────────  ──────────
#   harness doctor --phase <改动的>   harness-verify / verify-control-  云端更强
#                                     plane 跑全阶段不过滤；backend-
#                                     gates / gates-fast 还带 --strict
#   turbo run typecheck lint test     harness-verify / verify-affected  逐字节
#     --affected                      「受影响模块 typecheck/lint/test」同一条命令
#
# ⇒ 本地那份 `test` 买不到任何云端没有的门控强度，是纯重复。而它的代价是实打实的：
#   `test` 是唯一需要真 postgres 的一项，为它必须套 with-test-isolation.ts 外壳，
#   那个外壳要走 stack-admission 排队 + docker compose 起一次性栈。于是 pre-push 的
#   耗时不取决于你改了多少，而取决于**当时有几个 agent 在抢 docker 槽位**；它同时
#   也是本机 load 的主要来源，把并行的几条开发线串成一条。收窄掉 `test` 之后整个
#   外壳可以一起去掉——typecheck/lint 是纯静态的，不碰 DB、不碰 docker、不占槽位。
#
#   实测（2026-08-26，同一 commit、同一改动面 = 只改 apps/web 一个文件）：
#     收窄前  508s（8m28s），本机 load(1min) 11.88 → 23.20
#     收窄后   39s（冷缓存 --force）/ 6s（热缓存），load 19.90 → 19.68（基本不动）
#
# 为什么留下 typecheck + lint 而不是只留 typecheck（#504 原提案）：
#   两者都是秒级静态检查，且 `lint` 在本仓不是「代码风格」——apps/api 的 lint 链里
#   挂着 lint-error-leak / lint-permission-paths / lint-no-builtin-capabilities /
#   lint-naming-single-source / lint-arch-deps 等**架构与安全断言**；web 的 lint 是
#   `next lint --max-warnings 0 && ./scripts/lint-design.sh`（设计 token 单源门）。
#   ⚠ 这两段必须整条跑：只跑 `next lint` 半段是假绿。turbo 调的是包的 `lint` 脚本
#   （整条 && 链），不是 `next lint`，所以这里天然是整条；改本文件时不要「优化」成
#   直接调 next lint。反证见 #504 的 CP2。
#
# 为什么不干脆整条删掉本地门（"CI 才是真门"）：
#   pre-push 的价值不在门控强度（那由 CI 给），在**反馈时延**——把 typo 级错误在
#   push 之前几十秒内挡住，比几分钟后从 CI 日志里读出来便宜。它是「快速反馈」，
#   不是「权威判定」。权威在 CI。
#
# ⚠ 不要因为「本地过了」就认为 CI 会过：本地**不跑** test、不跑 backend-gates 那套
#   （RLS 反证 / 运行时门 / 迁移幂等 / 契约单源 / 洋葱分层 / core-loop e2e）。
# 全量回归（web build + 全量 e2e）不在 push 时跑：由 CI 定时任务（烟测每小时按需、
# e2e 每 3 小时）+ feature 转 passing 前的 pnpm harness verify / verify:full 承担。
# 跳过用 git push --no-verify；push 前想跑全量：pnpm -w run verify:full。
install_pre_push_hook() {
  local hook_path
  hook_path="$(git rev-parse --git-path hooks/pre-push)"
  mkdir -p "$(dirname "${hook_path}")"
  cat > "${hook_path}" << 'HOOK'
#!/usr/bin/env bash
# harness-hook (pre-push): 快速反馈门（受影响模块 typecheck/lint，对齐 CI）
# 全量验证不在这里：CI 定时回归 + 标 passing 前的 verify:full 负责。
# 2026-08-26（#504）：`test` 已移交 CI —— 见 init.sh 里本 hook 上方的收窄说明与
# 「本地 vs 云端」对照表。一句话：本地这份 test 与 harness-verify 的 `verify-affected`
# 是逐字节同一条命令，纯重复；而它是唯一要起 docker/postgres 的一项，代价
# （stack-admission 排队 + 本机 load）远大于它买到的强度（零）。
echo "==> [harness] pre-push: 受影响模块 typecheck/lint（turbo --affected；跳过用 git push --no-verify）"
# --affected 相对 origin/main 计算改动面。用解析后的单一 merge-base SHA 而非
# origin/main 引用：分支含 merge commit 时 turbo 内部 git 会报
# "fatal: multiple merge bases found"（git merge-base 命令本身总返回单个最优解）。
BASE_SHA="$(git merge-base origin/main HEAD 2>/dev/null || true)"
if [ -z "${BASE_SHA}" ]; then
  # 拿不到 base（首次 clone 未 fetch、origin/main 引用过期等）：先 fetch 一次再试，
  # 不静默退化成全量 verify:base（ADR-106）——全量验证是分钟级的，用它当默认回退
  # 会把"我该 fetch 一下"的小问题伪装成"push 变慢了"的大问题，且不会有人去修根因。
  echo "  ! 解析不到与 origin/main 的 merge-base，先 fetch 一次再试"
  git fetch origin main --quiet || true
  BASE_SHA="$(git merge-base origin/main HEAD 2>/dev/null || true)"
fi
if [ -z "${BASE_SHA}" ]; then
  echo "✗ [harness] fetch 后仍解析不到 merge-base——这是环境错误（网络不通 / origin 引用" >&2
  echo "  异常 / 当前分支不是从 main 分出去的），不是「没有改动」，拒绝假装可以继续验证。" >&2
  echo "  排查：git remote -v；git fetch origin main；确认分支确实基于 main。" >&2
  echo "  确认环境没问题、只是想临时跳过：git push --no-verify" >&2
  exit 1
fi
# 审计链体检（ADR-012）：只体检本次 push 触碰了 feature_list.json / sprints/** 的
# phase（只有这些文件能引入假 passing / 断证据 / 派生视图矛盾；改 adr/、requirements/
# 不触发，否则 phase-01 的历史欠债会卡死所有 ADR 提交）。历史欠债不阻塞无关 push，
# 谁触碰谁先还（存量修复见 ADR-012 remediation）。
# 注意 pathspec 必须用 '**' 递归匹配：'phases/*/sprints/' 对嵌套文件（如
# sprints/sprint-01/evidence/F01.verify.log）返回空，会漏拦 sprint 目录内的
# 全部改动（coord-main 实测：非递归 → 0 文件，'**' → 命中；见 PR #521 review）。
CHANGED_PHASES="$(git diff --name-only "${BASE_SHA}"..HEAD -- 'phases/*/feature_list.json' 'phases/*/sprints/**' 2>/dev/null | awk -F/ '{print $2}' | sed -n 's/^phase-\([^-]*\)-.*/\1/p' | sort -u)"
if [ -n "${CHANGED_PHASES}" ] && ! pnpm exec tsx --version >/dev/null 2>&1; then
  # fresh worktree 依赖未装时 tsx 不可用——doctor 跑不了就 warn 跳过，不能让
  # "环境没装好"伪装成"审计失败"卡死 push。
  echo "  ! tsx 不可用（依赖未安装？），跳过审计链体检（doctor）——先 ./init.sh 装依赖后重推可恢复体检"
  CHANGED_PHASES=""
fi
for PHASE_ID in ${CHANGED_PHASES}; do
  if ! pnpm harness doctor --phase "${PHASE_ID}"; then
    echo "✗ [harness] phase ${PHASE_ID} 审计链体检失败（假 passing / 断证据 / 派生视图矛盾），push 中止。"
    echo "  按 doctor 输出修复（通常是 pnpm harness verify --sprint ${PHASE_ID}/<MM> [--backfill-evidence]）；跳过（不推荐）：git push --no-verify"
    exit 1
  fi
done
export TURBO_SCM_BASE="${BASE_SHA}"
# 不套 with-test-isolation.ts：typecheck 与 lint 是纯静态检查，不连 postgres、
# 不起 docker、不占 stack-admission 槽位。外壳只有 `test` 需要，而 test 已移交 CI。
if ! pnpm turbo run typecheck lint --affected; then
  echo "✗ [harness] 受影响模块 typecheck/lint 失败，push 中止。修复后再推，或 git push --no-verify 临时跳过。"
  exit 1
fi
echo "  ℹ 本地只跑了 typecheck/lint。单元测试与 backend-gates（RLS 反证 / 运行时门 /"
echo "    迁移幂等 / 契约单源 / 洋葱分层 / core-loop e2e）在 PR 的 CI 上跑——本地绿 ≠ CI 绿。"
HOOK
  chmod +x "${hook_path}"
  echo "  ✓ pre-push hook（受影响模块 typecheck/lint 快速反馈门；test 与重门控在 CI，见 #504）"
}

# reference-transaction: 见 ADR-005（共享主 checkout 隔离）——只在共享主 checkout
# （非 linked worktree）里挡 refs/heads/* 的非快进更新，防止一个会话的 reset --hard /
# branch -f 让另一个恰好检出同一分支的并发会话无声丢失 commit。worktree 内天然隔离，
# 不受影响。临时放行：ALLOW_HISTORY_REWRITE=1 <原命令>。
install_reference_transaction_hook() {
  local hook_path
  hook_path="$(git rev-parse --git-path hooks/reference-transaction)"
  mkdir -p "$(dirname "${hook_path}")"
  cat > "${hook_path}" << 'HOOK'
#!/usr/bin/env bash
# harness-hook (reference-transaction): 见 ADR-005
STATE="${1:-}"
[ "${STATE}" = "prepared" ] || exit 0
[ "${ALLOW_HISTORY_REWRITE:-0}" = "1" ] && exit 0

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || true)"
COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
# linked worktree（git-dir != git-common-dir）天然隔离，不拦截
[ -n "${GIT_DIR}" ] && [ "${GIT_DIR}" = "${COMMON_DIR}" ] || exit 0

is_zero() { [[ "$1" =~ ^0+$ ]]; }

while read -r old new ref; do
  case "${ref}" in
    refs/heads/*) ;;
    *) continue ;;
  esac
  is_zero "${old}" && continue   # 分支创建
  is_zero "${new}" && continue   # 分支删除
  if ! git merge-base --is-ancestor "${old}" "${new}" 2>/dev/null; then
    echo "✗ [harness] 共享主 checkout 检测到非快进更新: ${ref} ${old:0:8} -> ${new:0:8}" >&2
    echo "  reset --hard / branch -f / 强制 rebase 等操作会让其他并发使用这个目录" >&2
    echo "  的会话看到分支 commit 无声消失（见 ADR-005，docs/adr）。" >&2
    echo "  请改用独立 worktree：git worktree add <path> -b <branch>。" >&2
    echo "  确认这个目录当前只有你在用、且就是要这么做：ALLOW_HISTORY_REWRITE=1 <原命令>" >&2
    exit 1
  fi
done
exit 0
HOOK
  chmod +x "${hook_path}"
  echo "  ✓ reference-transaction hook（共享主 checkout 非快进更新防护，ADR-005）"
}

if git rev-parse --git-dir >/dev/null 2>&1; then
  install_pre_commit_hook
  install_pre_push_hook
  install_reference_transaction_hook
else
  echo "  ! 不在 git 仓库中，跳过 hook 安装"
fi

echo "==> 生成 subagent（从 .harness/agents/*.yaml → .claude/agents + .codex/agents）"
pnpm harness gen-subagents

# 可选：起本地依赖服务（Postgres + Redis）。默认不起，保证基础验证无 docker 也能跑。
if [ "${RUN_INFRA:-0}" = "1" ]; then
  echo "==> RUN_INFRA=1，起本地依赖服务（infra/docker-compose.yml）"
  docker compose -f infra/docker-compose.yml up -d --wait
  echo "==> 应用数据库 migrations"
  pnpm --filter @repo/data run migrate
fi

# 快速健康检查：不是语法检查，是"关键依赖真的装上了、真的能跑"这一级——
# ADR-106 负面后果里点名要求的底线，默认路径弱化后不能连这个都不查，否则
# "环境根本没装对"会被无限期延后到 --full 或 CI 才暴露。
fast_health_check() {
  echo "==> 快速健康检查（关键依赖是否真的装上、真的能跑）"
  local missing=()
  for bin in tsx turbo vitest; do
    [ -x "node_modules/.bin/${bin}" ] || missing+=("${bin}")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "!! 关键依赖缺失：${missing[*]}（node_modules/.bin 下找不到对应可执行文件）" >&2
    echo "   pnpm install 可能没有成功完成，或 lockfile 与实际依赖不一致。" >&2
    exit 1
  fi
  if ! pnpm exec tsx --version >/dev/null 2>&1; then
    echo "!! tsx 文件存在但跑不起来（pnpm exec tsx --version 失败）" >&2
    exit 1
  fi
  if ! pnpm exec turbo --version >/dev/null 2>&1; then
    echo "!! turbo 文件存在但跑不起来（pnpm exec turbo --version 失败）" >&2
    exit 1
  fi
  echo "   ✓ 关键依赖已安装且可执行"
}

if [ "${RUN_FULL_VERIFY}" = "1" ]; then
  echo "==> --full：跑完整验证: ${FULL_VERIFY_CMD}"
  if ! eval "${FULL_VERIFY_CMD}"; then
    echo "!! 完整验证失败。请先修复基础状态,不要在坏的基础上继续叠功能。" >&2
    exit 1
  fi
else
  fast_health_check
  echo "==> 快速路径通过（跳过全仓验证）。需要完整证明时运行：./init.sh --full"
fi

if [ -n "${START_CMD}" ]; then
  echo "==> 启动命令: ${START_CMD}"
  if [ "${RUN_START_COMMAND:-0}" = "1" ]; then
    echo "==> RUN_START_COMMAND=1,直接启动"
    eval "${START_CMD}"
  fi
else
  echo "==> 初始化完成。下一步（README『十分钟接入』）："
  echo "    1. 填 .harness/instructions/project/PROJECT.md 与 .harness/config/github-sync.yaml"
  echo "    2. pnpm harness new-phase --id 01 --name <名字> --goal \"<目标>\""
  echo "    3. 把原始需求写进 phases/phase-01-*/requirements/ 后让 agent 读 AGENTS.md 开工"
fi
