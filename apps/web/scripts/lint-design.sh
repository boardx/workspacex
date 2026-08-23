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
# 覆盖裸 <img> 与 next/image 的 <Image>（F08：之前只覆盖前者，后者是漏检口）。
report "U7a" "<img>/<Image> 缺 alt 属性（见 uiux-standards §7；next/image 同样需要 alt，装饰性图传 alt=\"\"）" \
  "$(scan '<(img|Image)[ />]' | grep -v 'alt=' || true)"

# ── U7b 裸 outline-none 消除焦点环 ──────────────────────────────────────────
# 允许 outline-none 与 focus-visible:ring-* 同现；单独出现即违规。
report "U7b" "outline-none 未配 focus-visible:ring-*（严禁隐藏焦点可见性而不作替代）" \
  "$(scan 'outline-none' | grep -v 'focus-visible:ring' || true)"

# ── U9 未登记的第三方组件样式覆盖 ────────────────────────────────────────────
# 登记表见 app/globals.css 头部『第三方组件样式覆盖登记表』（@third-party-override
# 行，机械解析，见该区块说明；F07，防 CopilotKit 类事故复发）。
# 判据：第三方库自带样式类惯用 camelCase（如 .copilotKitParagraph），本仓自己的
# class 命名一律 kebab-case（D-35）——用这个天然边界当"像不像第三方覆盖"的机械判据，
# 不需要手工维护第二份库名单。逐行剥离 CSS `/* */` 注释、保留原始行号后，只在真实
# CSS 规则（本行含 `{`）里找 camelCase 选择器；本规则不识别任何行内 disable 注释，
# 不支持绕过整个文件（R4-E2）。
strip_css_comments() { # 输出 "行号: 剥注释后的内容"（保留行号；CSS 无单行 // 注释）
  awk '
  {
    line = $0
    if (in_comment) {
      idx = index(line, "*/")
      if (idx > 0) { in_comment = 0; line = substr(line, idx + 2) } else { line = "" }
    }
    while (!in_comment) {
      s = index(line, "/*")
      if (s == 0) break
      rest = substr(line, s + 2)
      e = index(rest, "*/")
      if (e > 0) { line = substr(line, 1, s - 1) substr(rest, e + 2) }
      else { line = substr(line, 1, s - 1); in_comment = 1 }
    }
    print NR ": " line
  }' "$1" 2>/dev/null
}
CSS_FILES=$(find "${TARGETS[@]}" -name "*.css" 2>/dev/null)
if [ "$IS_FIXTURE_RUN" -eq 0 ]; then
  CSS_FILES=$(printf '%s\n' "$CSS_FILES" | grep -v "__fixtures__" || true)
fi
REGISTRY_TEXT=""
if [ -n "$CSS_FILES" ]; then
  REGISTRY_TEXT=$(grep -h -oE '@third-party-override:.*' $CSS_FILES 2>/dev/null || true)
fi
U9_HITS=""
if [ -n "$CSS_FILES" ]; then
  for f in $CSS_FILES; do
    while IFS= read -r rec; do
      lineno="${rec%%:*}"
      content="${rec#*: }"
      case "$content" in *"{"*) : ;; *) continue ;; esac
      sel=$(printf '%s' "$content" | grep -oE '\.[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*' | head -1)
      [ -z "$sel" ] && continue
      if ! printf '%s' "$REGISTRY_TEXT" | grep -qF "$sel"; then
        U9_HITS="$U9_HITS
$f:$lineno:$content"
      fi
    done <<< "$(strip_css_comments "$f")"
  done
fi
report "U9" "未登记的第三方组件样式覆盖（先在 globals.css 头部『第三方组件样式覆盖登记表』加一行 @third-party-override 再写覆盖规则；不接受行内 disable 绕过）" \
  "$(printf '%s' "$U9_HITS" | sed '/^$/d')"

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

# ── U10 裸 duration/ease 未走语义动效 token（F03；motion-microinteraction I-1）──
# 语义档位定义在 tailwind.config.ts（transitionDuration/transitionTimingFunction 的
# fast/base/slow），取值依据写在 app/globals.css 顶部注释。裸 `duration-<数字>` 或
# Tailwind 内建 `ease-linear|in|out|in-out` 逃过了语义化，一律拦截；本仓自己新增的
# `ease-fast|base|slow` 是合规写法，不在拦截范围。
#
# 白名单（R4-E2 已知例外，不阻塞其他部分）：scripts/motion-legacy-allowlist.txt 登记
# 全仓存量未迁移用法，一行一条 `<相对路径><TAB><行原始文本（去首尾空白）>`——按
# **内容**而非行号匹配：文件里增删无关行不会误伤，但只要那一行文本本身变了（不论是
# 迁移还是别的改动），豁免立刻失效，逼着改动者过一遍这条规则，不会被静默放行。
# 迁移优先级见 phases/phase-12-uiux-foundation/contracts/motion-microinteraction/
# motion-migration-priority.md；迁移完成后请从白名单删掉对应行。
MOTION_ALLOWLIST_FILE="scripts/motion-legacy-allowlist.txt"
motion_is_allowlisted() { # $1=相对路径 $2=已去首尾空白的行内容
  [ -f "$MOTION_ALLOWLIST_FILE" ] || return 1
  grep -qF "$(printf '%s\t%s' "$1" "$2")" "$MOTION_ALLOWLIST_FILE"
}
motion_scan_raw() { # $1=grep -E 模式
  local hits
  hits=$(grep -rnE "$1" "${TARGETS[@]}" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
  [ "$IS_FIXTURE_RUN" -eq 0 ] && hits=$(printf '%s' "$hits" | grep -v "__fixtures__" || true)
  printf '%s' "$hits" | strip_comments
}
MOTION_RAW=$(motion_scan_raw '\bduration-[0-9]+\b')
MOTION_RAW="$MOTION_RAW
$(motion_scan_raw '\bease-[a-z-]+\b' | grep -vE '\bease-(fast|base|slow)\b' || true)"
MOTION_HITS=""
while IFS= read -r rec; do
  [ -z "$rec" ] && continue
  path="${rec%%:*}"
  rest="${rec#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  trimmed=$(printf '%s' "$content" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if ! motion_is_allowlisted "$path" "$trimmed"; then
    MOTION_HITS="$MOTION_HITS
$path:$lineno:$content"
  fi
done <<< "$MOTION_RAW"
report "U10" "裸 duration-<数字>/ease-<内建名>（必须用语义 token fast/base/slow，见 tailwind.config.ts；存量豁免见 scripts/motion-legacy-allowlist.txt）" \
  "$(printf '%s' "$MOTION_HITS" | sed '/^$/d')"

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
