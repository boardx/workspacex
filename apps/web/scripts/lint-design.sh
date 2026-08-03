#!/usr/bin/env bash
# lint-design.sh — 设计规范机械门控（UC-0.4 R3 步骤 4 / R12 V5 ｜ uiux-standards §0 U1–U8）
#
# 立场：**没有脚本的规范条目视为未落地**（UC-0.4 R7）。
# `uiux-standards.md` §0 的每一条 U1–U8 都必须在这里或 e2e spec 里有对应检查。
#
# 用法：./scripts/lint-design.sh [目标目录…]（默认 app components lib）
# 退出码：0 = 全过；1 = 有违规（逐条打印文件:行号）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(app components lib)

VIOLATIONS=0
report() { # report <规则号> <说明> <grep 输出>
  local rule="$1" desc="$2" hits="$3"
  [ -z "$hits" ] && return 0
  echo "✗ [$rule] $desc"
  echo "$hits" | sed 's/^/    /'
  VIOLATIONS=$((VIOLATIONS + $(echo "$hits" | grep -c .)))
}

# 只扫 tsx/ts。默认排除 __fixtures__（它们是门控自身的测试输入，含故意违规）；
# 但当调用方**显式**把 fixture 作为目标传进来时不排除——否则 lint-design-gate 测试
# 会把待测文件本身滤掉，导致「门控看起来通过了，其实什么都没扫」。
case "${TARGETS[*]}" in *__fixtures__*) IS_FIXTURE_RUN=1 ;; *) IS_FIXTURE_RUN=0 ;; esac

# 剥注释行：文档里写「严禁 disabled:opacity-*」不该被判成违规本身。
# 覆盖四种：块注释续行 `*`、行注释 `//`、块注释起始 `/*`、JSX 注释 `{/*`
# （JSX 注释不渲染，里面的文案不是用户可见文本）。
#
# ⚠ 已知局限：**多行 JSX 注释的续行认不出**——`{/*` 只在首行，续行没有任何标记，
#   逐行 grep 无从判断它在注释内。代价是「在多行 JSX 注释里写 Markdown 语法」会误报。
#   取舍：不为此上 JSX 解析器（成本不成比例），改用约定——注释里用「」而不是 **。
#   误报时脚本会准确指出行号，改措辞即可，不会漏报真违规。
strip_comments() { grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\{/\*|/\*|//|\*)' || true; }
scan() {
  local hits
  hits=$(grep -rnE "$1" "${TARGETS[@]}" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
  [ "$IS_FIXTURE_RUN" -eq 0 ] && hits=$(printf '%s' "$hits" | grep -v "__fixtures__" || true)
  printf '%s' "$hits" | strip_comments
}

# ── U5a 硬编码颜色 ─────────────────────────────────────────────────────────
# 语义色必须来自 token。命中 #rgb/#rrggbb 字面量、rgb()/hsl() 字面量、Tailwind 调色板类。
report "U5a" "硬编码颜色（必须用语义 token，见 uiux-standards §1）" \
  "$(scan '(text|bg|border|ring|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]|className=[^>]*#[0-9a-fA-F]{6}\b|(text|bg|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}')"

# ── U5b 任意值像素 ─────────────────────────────────────────────────────────
# 间距必须落在 4/8px 律动上。宽高类的任意值放行（骨架尺寸 76/272/300 是实测值）。
report "U5b" "任意值像素间距（必须用 Tailwind 间距刻度，见 uiux-standards §2）" \
  "$(scan '\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-\[[0-9.]+px\]')"

# ── U1.1 禁用态用 opacity ───────────────────────────────────────────────────
# 统一透明度作用在深色实心控件上会把黑底白字压成灰对灰（§1.1 记录的真实事故）。
report "U1.1" "disabled:opacity-*（禁用态必须用 disabled:bg-disabled + disabled:text-disabled-foreground）" \
  "$(scan 'disabled:opacity-')"

# ── U1.2 opacity 表达语义状态 ───────────────────────────────────────────────
# 透明度只允许做过渡动画与遮罩层；语义状态必须落在 token 上，否则对比度不可静态验证。
report "U1.2" "opacity-* 用于表达状态（只允许 transition/遮罩用；语义状态请改 token）" \
  "$(scan '\b(hover|focus|active|aria-[a-z]+|data-\[[^]]+\]):opacity-')"

# ── U6 裸原生表单元素 ───────────────────────────────────────────────────────
# app/ 层必须用封装组件（内部保证 bg+fg 成对、焦点环、禁用态 token）。
# U6 是「app/ 层」的规则，不随任意扫描目标漂移；定向扫 fixture 时跳过。
if [ "$IS_FIXTURE_RUN" -eq 0 ]; then
  report "U6" "裸 <input>/<select>/<button>（app/ 层必须用 components/ui 的封装）" \
    "$(grep -rnE '<(input|select|button)[ />]' app --include='*.tsx' 2>/dev/null | strip_comments)"
fi

# ── U4 hover 无过渡 ─────────────────────────────────────────────────────────
report "U4" "有 hover: 但同一 className 内无 transition-*（见 uiux-standards §5）" \
  "$(scan 'className=("|\{`)[^"`]*hover:[^"`]*("|`)' | grep -v 'transition-' || true)"

# ── U7a 图片缺 alt ──────────────────────────────────────────────────────────
report "U7a" "<img> 缺 alt 属性" \
  "$(scan '<img[ />]' | grep -v 'alt=' || true)"

# ── U7b 裸 outline-none 消除焦点环 ──────────────────────────────────────────
# 允许 outline-none 与 focus-visible:ring-* 同现；单独出现即违规。
report "U7b" "outline-none 未配 focus-visible:ring-*（严禁隐藏焦点可见性而不作替代）" \
  "$(scan 'outline-none' | grep -v 'focus-visible:ring' || true)"

# ── §1.2 字号档位表外值 ─────────────────────────────────────────────────────
# 白名单从 lib/font-scale.ts 动态取，**不在本脚本里手抄第二份清单**。
ALLOWED=$(sed -nE 's/^  ([0-9]+): \[.*/\1/p' lib/font-scale.ts | paste -sd'|' -)
if [ -z "$ALLOWED" ]; then
  echo "✗ [§1.2] 无法从 lib/font-scale.ts 解析出档位白名单（单一事实源读取失败）"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  BAD=$(scan '\btext-[0-9]+\b' | grep -vE "text-($ALLOWED)\b" || true)
  report "§1.2" "字号档位不在 lib/font-scale.ts 白名单内（当前允许：${ALLOWED}）" "$BAD"
fi

# ── §1.2 字号清单副本 ───────────────────────────────────────────────────────
# tailwind.config.ts 必须 import FONT_SCALE，不得手写 fontSize 字面量对象。
if ! grep -q 'from "./lib/font-scale"' tailwind.config.ts; then
  echo "✗ [§1.2] tailwind.config.ts 未从 lib/font-scale.ts import —— 字号清单出现第二份副本"
  VIOLATIONS=$((VIOLATIONS + 1))
fi
if grep -qE 'fontSize:\s*\{' tailwind.config.ts; then
  echo "✗ [§1.2] tailwind.config.ts 里出现字面量 fontSize 对象 —— 必须直接用 FONT_SCALE"
  VIOLATIONS=$((VIOLATIONS + 1))
fi
if ! grep -q 'FONT_SCALE_KEYS' lib/utils.ts; then
  echo "✗ [§1.2] lib/utils.ts 未登记 FONT_SCALE_KEYS —— tailwind-merge 会把自定义档位当颜色类吞掉"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# ── MD 残留 ────────────────────────────────────────────────────────────────
# JSX 文本里的 `**加粗**` 是**字面量**，浏览器原样显示星号，不会渲染成粗体。
# 写文案时从 Markdown 复制过来最容易带进这个。要加粗请用 <strong className="font-medium">。
# （注释行已被 strip_comments 剥掉，本规则只看真实 JSX 文本。）
report "MD" "JSX 文本里残留 Markdown 加粗（**...**），应改用 <strong>" \
  "$(scan '\*\*[^*]+\*\*')"

# ── D-35 data-testid 命名规范 ───────────────────────────────────────────────
# 结构 <域>-<对象>-<角色>，全小写 kebab-case；禁止携带业务数据（中文 / 大写 / 下划线）。
report "D-35" "data-testid 不合命名规范（应为小写 kebab-case，且不得携带业务数据）" \
  "$(scan 'data-testid="[^"]*[^a-z0-9\"-]' || true)"

# ── 收口 ────────────────────────────────────────────────────────────────────
echo
if [ "$VIOLATIONS" -eq 0 ]; then
  echo "✅ lint-design：全部通过（扫描 ${TARGETS[*]}）"
  exit 0
else
  echo "❌ lint-design：$VIOLATIONS 处违规"
  echo "   规范见 .harness/instructions/uiux-standards.md；对比度问题请改 app/globals.css 的 token。"
  exit 1
fi
