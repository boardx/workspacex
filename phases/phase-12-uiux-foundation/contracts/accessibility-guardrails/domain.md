# 契约束 `accessibility-guardrails` — 支撑材料：领域模型

覆盖 F05（chat/profile 键盘可达）、F06（org-admin 键盘可达 + axe-core）、
F07（第三方样式覆盖登记）、F08（图片/图标 a11y 标注）。
对应 `requirements/03-*.md`、`requirements/04-*.md`、`requirements/05-*.md`。

## 实体 / 值对象

- **KeyboardTask**：`{ domain, taskName, steps: KeyboardStep[] }`，核心任务的键盘操作序列。
- **StyleOverrideRegistration**：`{ library, selector, tokenRef, reason }`，第三方样式覆盖登记项。
- **AccessibilityLabel**：`{ elementRef, kind: "meaningful-image" | "decorative-icon", value: string | null }`。

## 不变量

- **I-1**：任一 `KeyboardTask.steps` 序列必须能仅用 Tab / Shift+Tab / Enter / Esc / 方向键完成，
  不依赖鼠标事件。
  - 断言形态：Playwright `page.keyboard` 自动化用例，零 `page.mouse` 调用。
- **I-2**：任一在 CSS 中出现的、匹配第三方库 class 前缀的选择器覆盖，必须能在
  `globals.css` 登记表中找到对应 `StyleOverrideRegistration` 条目。
  - 断言形态：`lint-design.sh` U9 规则 exit 0；反证：故意引入未登记覆盖能被拦截。
- **I-3**：任一 `AccessibilityLabel.kind === "decorative-icon"` 的元素必须有 `aria-hidden="true"`；
  `kind === "meaningful-image"` 的元素 `value`（alt 文本）不得为空字符串。
  - 断言形态：`lint-design.sh` U7a 规则（覆盖 `<img>` 与 `next/image`）+ axe-core `image-alt`。
- **I-4**：任一新增的弹层/菜单类交互，`dismissModes.esc` 默认必为 true，除非有记录在案的例外
  （与 `interaction-primitives` 束 I-2 呼应，本束负责验证业务层没有覆盖破坏它）。
  - 断言形态：Playwright 走查用例。

## 明确不是不变量
- 「无障碍体验应该友好」——体验目标，不可断言。

## ③ 件为什么不是 zod 契约文件（本束无对外 HTTP 面）
键盘可达性验证、第三方样式登记、图片/图标标注补全都是前端行为修复与静态标注，不新增
任何 HTTP 端点，因此没有 `packages/contracts/src/accessibility-guardrails.ts` 的必要。
本束的「契约」是 Playwright 键盘走查用例与 lint-design 新规则，逐条落在 `coverage.md`
的可执行门控命令里。
