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

echo "==> 两层身份投影（UC-0.3 R8：必须同时显示组织层与项目层）"
assert_role() { # assert_role <as> <期望文案片段>
  local body; body=$(curl -s "http://localhost:$PORT/kitchen-sink?as=$1")
  if printf '%s' "$body" | grep -q "$2"; then printf "  ✓ %-12s → %s\n" "$1" "$2"
  else printf "  ✗ %-12s → 期望含「%s」\n" "$1" "$2"; FAIL=1; fi
}
assert_role facilitator "本项目：引导师"
assert_role groupLead   "本项目：组长"
assert_role member      "本项目：组员"
assert_role observer    "本项目：观察者"

echo "==> 组织切换（裁决 O-12：切换后团队归属随之改变）"
curl -s "http://localhost:$PORT/kitchen-sink?org=org-yuanyang" | grep -q "能源组"   && echo "  ✓ 远洋新能源 → 能源组"   || { echo "  ✗ 远洋新能源"; FAIL=1; }
curl -s "http://localhost:$PORT/kitchen-sink?org=org-hengtai"  | grep -q "供应链组" && echo "  ✓ 恒泰供应链 → 供应链组" || { echo "  ✗ 恒泰供应链"; FAIL=1; }

echo "==> 骨架完整性"
body=$(curl -s "http://localhost:$PORT/kitchen-sink")
for t in app-shell shell-rail shell-topbar shell-main shell-left-panel shell-right-panel shell-ambient org-switcher role-bar; do
  printf '%s' "$body" | grep -q "data-testid=\"$t\"" || { echo "  ✗ 缺 $t"; FAIL=1; }
done
[ "$FAIL" -eq 0 ] && echo "  ✓ 三栏骨架 + 顶部条 + 环境态条齐备"

echo
[ "$FAIL" -eq 0 ] && { echo "✅ UI 状态门控通过"; exit 0; }
echo "❌ UI 状态门控失败"; exit 1
