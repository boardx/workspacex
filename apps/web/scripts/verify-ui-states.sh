#!/usr/bin/env bash
# verify-ui-states.sh — 七态与两层身份投影的可达性断言（UC-0.4 R12 V6·V7）
#
# 自带 dev server（独立端口 + 独立 distDir），可与常驻 dev 并存，CI 可直接跑。
# 断言的是**服务端渲染出来的 HTML 里有没有那个固定 testid**——比截图稳定，
# 且正是 verification 该锚的东西（原型零 testid 导致的问题在此闭环）。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${UI_GATE_PORT:-3198}"
export NEXT_DIST_DIR=".next-ui-gate"
FAIL=0
cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> 启动 dev 实例（:$PORT）"
npx next dev -p "$PORT" >/tmp/ui-gate.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/kitchen-sink" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "${code:-}" = "200" ] || { echo "✗ dev 实例未就绪（${code:-无}）"; tail -20 /tmp/ui-gate.log; exit 1; }

# 七态保留 testid 的**唯一事实源**是 lib/ui-state.ts 的 RESERVED_STATE_TESTID。
# 这里 sed 读它，不在本脚本里重列一遍——照 lint-design.sh 读 font-scale.ts 的成例。
# （此前这份映射在 JSX 与本脚本各写一遍，是第六次「同一事实声明在两处」的候选。）
reserved_testid() {
  # ⚠ 必须限定在 RESERVED_STATE_TESTID 块内 —— 文件里 UI_STATE_LABEL 先出现且键名相同，
  #   不限定会读到中文标签（第一版就踩了这个）。
  awk -v k="$1" '
    /RESERVED_STATE_TESTID/ { inblk = 1; next }
    inblk && /^\};/ { exit }
    inblk && $0 ~ "^[[:space:]]*\"?" k "\"?:" {
      if (match($0, /:[[:space:]]*"[^"]*"/)) {
        v = substr($0, RSTART); sub(/^:[[:space:]]*"/, "", v); sub(/".*/, "", v); print v; exit
      }
    }' lib/ui-state.ts
}
if [ -z "$(reserved_testid loading)" ]; then
  echo "✗ 无法从 lib/ui-state.ts 读出 RESERVED_STATE_TESTID（单一事实源读取失败）"; exit 1
fi

echo "==> 七种必现状态（每态一个固定 testid）"
assert_state() { # assert_state <state> <期望 testid>
  local body; body=$(curl -s "http://localhost:$PORT/kitchen-sink?state=$1")
  if printf '%s' "$body" | grep -q "data-testid=\"$2\""; then
    printf "  ✓ %-12s → %s\n" "$1" "$2"
  else
    printf "  ✗ %-12s → %s 缺失\n" "$1" "$2"; FAIL=1
  fi
}
assert_state default    section-states
assert_state loading    loading
assert_state empty      empty
assert_state invalid    err-email
assert_state dep-failed dep-failed
assert_state denied     denied
assert_state success    saved

echo "==> 七态互斥（切到 A 时不得同时渲染 B）"
body=$(curl -s "http://localhost:$PORT/kitchen-sink?state=empty")
for other in loading denied dep-failed saved; do
  if printf '%s' "$body" | grep -q "data-testid=\"$other\""; then
    echo "  ✗ empty 态下同时出现了 $other"; FAIL=1
  fi
done
[ "$FAIL" -eq 0 ] && echo "  ✓ 互斥成立"

echo "==> 全屏七态矩阵（每屏 × 六个异常态，保留 testid 必须可选中）"
# 契约：屏处于某态时，该态的**固定保留 testid** 必须出现在 SSR 出的 HTML 里。
# 与降级粒度无关——分区级降级（如 /tasks 的 ③ 区）也必须挂保留名，
# 否则该屏在矩阵里被判为漏做异常态，而「漏做异常态」正是已有原型最大的缺陷。
# ⚠ 2026-08-02（#350）：/studio/prototype、/studio/interview 已于 2026-07-30 永久
#   redirect() 到现行实现 /canvas、/itv（见两个 studio/* page.tsx 的头注）。
#   纯 redirect 页面结构上渲染不出任何 testid，脚本改测现行路由，覆盖不变。
SCREENS="login join consent group chat projects projects/demo/canvas projects/demo/files \
tasks brain admin admin/model admin/mcp admin/members canvas \
itv studio/survey studio/research"
matrix_fail=0
for scr in $SCREENS; do
  for st in loading empty invalid dep-failed denied success; do
    want=$(reserved_testid "$st")
    if ! curl -s "http://localhost:$PORT/$scr?state=$st" | grep -q "data-testid=\"$want"; then
      echo "  ✗ /$scr → $st 缺保留 testid（期望 $want）"; matrix_fail=$((matrix_fail+1)); FAIL=1
    fi
  done
done
[ "$matrix_fail" -eq 0 ] && echo "  ✓ $(echo $SCREENS | wc -w | tr -d ' ') 屏 × 6 态全覆盖"

echo "==> 两层身份投影的**作用域**（UC-0.3：项目角色只在项目里成立）"
# 2026-07-28 修正：此前顶栏无条件渲染「本项目：X」，等于宣称项目角色是全局属性。
# UC-0.3 R4 E1 明写「有组织角色但无项目角色」是正常状态，故新契约是**双向**的：
#   在项目里  → 组织层 + 项目层都在
#   不在项目里 → 只有组织层，且项目层与视角切换器都**不得出现**
assert_in_project() { # assert_in_project <路由> <as> <期望项目层文案>
  local body; body=$(curl -s "http://localhost:$PORT/$1?as=$2")
  if printf '%s' "$body" | grep -q 'data-testid="role-bar-project"' && printf '%s' "$body" | grep -q "$3"; then
    printf "  ✓ /%-18s as=%-12s → %s\n" "$1" "$2" "$3"
  else
    printf "  ✗ /%-18s as=%-12s → 期望项目层含「%s」\n" "$1" "$2" "$3"; FAIL=1
  fi
}
# /chat 是项目上下文（线程挂在某项目下）
assert_in_project chat facilitator 引导师
assert_in_project chat groupLead   组长
assert_in_project chat member      组员
assert_in_project chat observer    观察者
assert_in_project projects/p1/canvas facilitator 引导师

echo "==> 反向：非项目页面**不得**出现项目层与视角切换器"
for scr in tasks brain admin kitchen-sink projects; do
  body=$(curl -s "http://localhost:$PORT/$scr?as=facilitator")
  leaked=""
  printf '%s' "$body" | grep -q 'data-testid="role-bar-project"'      && leaked="$leaked role-bar-project"
  printf '%s' "$body" | grep -q 'data-testid="role-preview-switcher"' && leaked="$leaked role-preview-switcher"
  printf '%s' "$body" | grep -q 'data-testid="topbar-project-context"' && leaked="$leaked topbar-project-context"
  if [ -n "$leaked" ]; then
    echo "  ✗ /$scr 泄漏了项目层：$leaked"; FAIL=1
  else
    printf "  ✓ /%-14s 只有组织层\n" "$scr"
  fi
done

echo "==> 本地组织：承诺与策略必须可分辨（UC-0.5 V12）"
# 同样是「只用自托管」，个人本地组织是**不可关闭的产品承诺**，
# 正式组织的 self-hosted-only 是**管理员可改的策略**。用同一个开关表示会让承诺退化成默认值。
assert_guarantee() { # assert_guarantee <org> <期望 source|none>
  local body; body=$(curl -s "http://localhost:$PORT/tasks?org=$1")
  # ⚠ set -e + pipefail 下 grep 无命中会让整条管道失败并终止脚本——必须 || true
  local got; got=$(printf '%s' "$body" | grep -oE 'data-guarantee-source="[a-z]+"' 2>/dev/null | head -1 | sed 's/.*="//;s/"//' || true)
  got="${got:-none}"
  if [ "$got" = "$2" ]; then printf "  ✓ %-14s → %s\n" "$1" "$2"
  else printf "  ✗ %-14s → 期望 %s，实得 %s\n" "$1" "$2" "$got"; FAIL=1; fi
}
assert_guarantee org-yuanyang none      # 不限制
assert_guarantee org-hengtai  policy    # 组织策略，管理员可改
assert_guarantee org-local    promise   # 产品承诺，不可关闭

echo "==> 组织切换（裁决 O-12：切换后团队归属随之改变）"
curl -s "http://localhost:$PORT/kitchen-sink?org=org-yuanyang" | grep -q "能源组"   && echo "  ✓ 远洋新能源 → 能源组"   || { echo "  ✗ 远洋新能源"; FAIL=1; }
curl -s "http://localhost:$PORT/kitchen-sink?org=org-hengtai"  | grep -q "供应链组" && echo "  ✓ 恒泰供应链 → 供应链组" || { echo "  ✗ 恒泰供应链"; FAIL=1; }

echo "==> 骨架完整性"
body=$(curl -s "http://localhost:$PORT/kitchen-sink")
for t in app-shell shell-rail shell-topbar shell-main shell-left-panel shell-right-panel shell-ambient org-switcher role-bar-org; do
  printf '%s' "$body" | grep -q "data-testid=\"$t\"" || { echo "  ✗ 缺 $t"; FAIL=1; }
done
[ "$FAIL" -eq 0 ] && echo "  ✓ 三栏骨架 + 顶部条 + 环境态条齐备"

echo
[ "$FAIL" -eq 0 ] && { echo "✅ UI 状态门控通过"; exit 0; }
echo "❌ UI 状态门控失败"; exit 1
