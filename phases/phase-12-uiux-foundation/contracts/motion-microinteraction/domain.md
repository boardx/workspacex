# 契约束 `motion-microinteraction` — 支撑材料：领域模型

覆盖 F03（动效 token + lint）、F04（编排级动效）、F11（chat/profile 微交互稽核）、
F12（org-admin/canvas 微交互稽核）。对应 `requirements/02-*.md`、`requirements/07-*.md`。

## 实体 / 值对象

- **MotionToken**：`{ tier: "fast" | "base" | "slow", durationMs: number, easing: string }`，
  三档固定枚举，非自由数值。
- **OrchestratedMoment**：`{ trigger: "message-arrival" | "panel-toggle", timeline: MotionStep[] }`，
  `MotionStep` = `{ property, delayMs, durationMs, easing }`。
- **MicroInteractionState**：`{ element, hover?: MotionToken, focus?: MotionToken, active?: MotionToken }`。

## 不变量

- **I-1**：任何 `transition-duration` / `transition-timing-function` 的取值必须 ∈ `MotionToken.tier`
  的三档，不存在裸数值（`duration-[0-9]+`、`ease-[a-z-]+` 字面量）。
  - 断言形态：`lint-design.sh` 新规则对全仓 `.tsx` 扫描 exit 0。
- **I-2**：任一 `OrchestratedMoment` 在 `prefers-reduced-motion: reduce` 下，其 `timeline` 必须
  可被替换为单步瞬时切换（`durationMs → 0`），且状态提示（如颜色变化）不因此消失。
  - 断言形态：Playwright 用 `page.emulateMedia({ reducedMotion: "reduce" })` 验证。
- **I-3**：任一可点击元素若定义了 `MicroInteractionState.hover`，其 `focus` 与 `active` 也必须
  存在且取自同一 `MotionToken.tier`（不能 hover 用 base、active 用另一个未定义档位）。
  - 断言形态：`lint-design.sh` U4 规则扩展。
- **I-4**：同一组件类型（如「主要按钮」）在 chat/profile/org-admin/canvas 四个域中的
  `MicroInteractionState` 必须相等（token 引用相同，不是视觉上「看起来差不多」）。
  - 断言形态：四域抽样组件的 className/style 输出对比脚本或人工截图核对。

## 明确不是不变量
- 「动效应该让用户感觉丝滑」——体验目标，不可断言，不写进本节。

## ③ 件为什么不是 zod 契约文件（本束无对外 HTTP 面）
动效 token、编排级动效、微交互反馈全部是前端展示层行为，不经由 HTTP 端点与后端通信，
因此没有 `packages/contracts/src/motion-microinteraction.ts` 的必要。本束的「契约」是
`tailwind.config.ts` 的语义 token 定义与 `lint-design.sh` 的机械拦截规则，逐条落在
`coverage.md` 的可执行门控命令里。
