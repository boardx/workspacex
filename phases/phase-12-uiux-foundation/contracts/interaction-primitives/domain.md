# 契约束 `interaction-primitives` — 支撑材料：领域模型

覆盖 F01（Dialog/Dropdown）、F02（Select/Tooltip + kitchen-sink）、F09（Table/Menu 收口）、
F10（Breadcrumb/Pagination 收口）。对应需求 `requirements/01-*.md`、`requirements/06-*.md`。

## 实体 / 值对象

- **OverlayPrimitive**（Dialog / Dropdown / Select / Tooltip / Menu 共同基类概念，非代码继承关系）
  - `variant`：视觉档位，取值域封闭于 token 体系（不是自由字符串）
  - `focusTrapped`：boolean，打开期间是否陷入焦点
  - `dismissModes`：`{ overlay: boolean, esc: boolean, closeButton: boolean }`
- **CompositePrimitive**（Table / Breadcrumb / Pagination）
  - `sourceImplementations`：FilePath[]，收口前的重复实现清单（迁移映射表的键）
  - `migratedAt`：收口完成的时间戳，未收口为 null

## 不变量（必须能写成断言）

- **I-1**：任何 `OverlayPrimitive` 实例的圆角、阴影、遮罩透明度取值必须 ∈ `globals.css` 已声明的 token 集合；不存在字面量色值/像素值。
  - 断言形态：`lint-design.sh` U5a/U5b 对 `components/ui/dialog.tsx` 等四个文件 exit 0。
- **I-2**：`OverlayPrimitive.dismissModes` 中，凡组件类型支持点遮罩关闭的，`esc` 必为 true（Esc 与点遮罩语义等价，不允许只支持其一）。
  - 断言形态：Playwright 用例对四个组件分别验证 Esc 与点遮罩两条路径关闭结果一致。
- **I-3**：Dialog 打开时，`document.activeElement` 必须位于 dialog 内容子树内；关闭后必须等于打开前触发它的元素引用。
  - 断言形态：Playwright `page.evaluate(() => document.activeElement)` 断言。
- **I-4**：任一 `CompositePrimitive` 的 `sourceImplementations.length` 一旦 `migratedAt` 非空，业务目录内不得再存在平行实现（允许 0-1 个记录在案的例外）。
  - 断言形态：`grep -rn` 目标模式在业务目录的命中数 ≤1 且有注释说明。

## 明确不是不变量（避免与规则混淆）
- 「弹层动效应该流畅」——这是体验目标，不可断言，不写进本节（动效具体约束见 `motion-microinteraction` 束）。

## ③ 件为什么不是 zod 契约文件（本束无对外 HTTP 面）
Dialog/Dropdown/Select/Tooltip/Table/Menu/Breadcrumb/Pagination 全部是纯前端展示与交互
组件，不经由任何 HTTP 端点与后端通信，因此没有 `packages/contracts/src/interaction-primitives.ts`
的必要——没有请求/响应体可写 schema。本束的「契约」是它对既有回归门控的承诺：token 化、
键盘可达、无裸拼装点，逐条落在 `coverage.md` 的可执行门控命令里。
