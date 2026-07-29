#!/usr/bin/env bash
# verify-prod-gates.sh — 生产构建下的可达性门控（UC-0.4 R12 V8）
#
# 断言：`?state=` 与 `?as=` 这两个**预览开关在生产构建中不可达**。
# 它们若泄漏到生产，等于给了一个「自称是引导师」的前端开关（R9 安全约束）。
#
# 用独立 distDir + 独立端口，可与 dev server 并存，CI 与本地都可重复执行。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PROD_GATE_PORT:-3199}"
export NEXT_DIST_DIR=".next-prod-gate"
FAIL=0

cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> 生产构建（distDir=$NEXT_DIST_DIR）"
npx next build >/tmp/prod-gate-build.log 2>&1 || { echo "✗ 构建失败："; tail -20 /tmp/prod-gate-build.log; exit 1; }

echo "==> 启动生产实例（:$PORT）"
npx next start -p "$PORT" >/tmp/prod-gate-run.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "${code:-}" = "200" ] || { echo "✗ 生产实例未就绪（最后状态码 ${code:-无}）"; tail -20 /tmp/prod-gate-run.log; exit 1; }

BODY=$(curl -s "http://localhost:$PORT/kitchen-sink?state=empty&as=observer")

check_absent() { # check_absent <testid> <说明>
  if printf '%s' "$BODY" | grep -q "data-testid=\"$1\""; then
    echo "  ✗ $2（$1 在生产下仍可达）"; FAIL=1
  else
    echo "  ✓ $2"
  fi
}

echo "==> 断言"
check_absent "state-preview-switcher" "状态预览切换器已移除"
check_absent "role-preview-switcher"  "视角预览切换器已移除"
check_absent "empty"                  "?state=empty 不生效，回落默认态"

if printf '%s' "$BODY" | grep -q "本项目：观察者"; then
  echo "  ✗ ?as=observer 在生产下仍改变了角色投影"; FAIL=1
else
  echo "  ✓ ?as=observer 不生效"
fi

echo
[ "$FAIL" -eq 0 ] && { echo "✅ 生产门控通过：预览开关不可达"; exit 0; }
echo "❌ 生产门控失败：预览开关泄漏到生产构建"; exit 1
