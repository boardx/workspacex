#!/usr/bin/env bash
# detect-solid-foreground-without-fill.sh —— 白字白底探测器（2026-09-22，实测缺陷）
#
# ## 它在找什么
#
# `--primary-foreground` / `--destructive-foreground` / `--success-foreground` /
# `--warning-foreground` / `--ai-foreground` / `--inverse-foreground` 在**浅色主题里是白色**
# （见 app/globals.css 的 `:root`）——它们是给同名**实心底**配的前景色。把它们用在一个
# 自己没有 `bg-<同名家族>` 的元素上，在浅色主题下就是**白字白底**。
#
# ## 为什么它能活下来（两条，都实测过）
#
#   1. 深色主题里同一个 token 是近黑色（`--warning-foreground: 33 75% 9.4%`），所以在深色
#      下看起来完全正常。审查者用深色主题就看不见这个缺陷。
#   2. **所有几何判据都说它可见**：Playwright `isVisible()` 为真、`getBoundingClientRect`
#      给出 373×48、`document.elementFromPoint` 返回它自己。对比度不在它们的判据里。
#      实测：修之前 `color: rgb(255,255,255)` / 背景 `rgb(255,255,255)` ⇒ 对比 ≈ 1.0；
#      改成成对的 tint 档之后 ⇒ 6.45:1。
#
# ## 为什么它还不是门控
#
# 全仓当前有 31 处命中（本文件下方即是清单），其中**混着两种情况**：真的白字白底，以及
# 父级元素提供了实心底、子元素只写前景色的合法用法。我今晚没有逐一分辨它们，
# 把一份没分辨过的清单直接做成 `lint-design.sh` 的豁免表，等于把真缺陷和合法用法一起
# 固化成"已知例外"——那比没有门控更糟。
#
# 所以这里先只做**探测器**：它不接进 CI，退出码恒 0，只负责把清单打出来给分辨的人。
# 分辨完之后再按 U10 的既有先例（(path, content) 子串豁免表）接进 lint-design.sh。
#
# 用法：apps/web/scripts/detect-solid-foreground-without-fill.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
TOTAL=0
for FAMILY in primary destructive success warning ai inverse; do
  HITS=$(grep -rnoE "className=[^>]*text-${FAMILY}-foreground[^>]*" app components lib 2>/dev/null \
    | grep -v "bg-${FAMILY}" || true)
  COUNT=$(printf '%s' "$HITS" | grep -c . || true)
  [ "$COUNT" -eq 0 ] && continue
  echo "── ${FAMILY}-foreground 没有同家族实心底：${COUNT} 处"
  printf '%s\n' "$HITS" | sed 's/^/    /'
  TOTAL=$((TOTAL + COUNT))
done
echo "合计 ${TOTAL} 处待分辨（真白字白底 vs 父级提供底色的合法用法）。"
echo "这是探测器，不是门控：退出 0。分辨完请按 U10 的豁免表先例接进 lint-design.sh。"
