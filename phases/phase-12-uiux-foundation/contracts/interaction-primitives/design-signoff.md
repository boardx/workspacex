---
bundle: interaction-primitives
phase: "12"
covers: [F01, F02, F09, F10]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:
confirmed_at:
---

# 契约束 `interaction-primitives` 设计签核

> ## ✅ 三件材料均已备齐，可以签核。
>
> **① ✅ UI 材料已产出。** `ui-preview/interaction-primitives/` 下 5 张截图（四原语默认态、
> Dialog 打开态、Dropdown 展开态、Select 键盘导航态、Tooltip 触发态），`lint-ui-material.mjs`
> 对本束报 `5/5` 全绿。⚠ 签核时请确认一处实现取舍：Select 组件**不是**用
> `@radix-ui/react-select`（依赖未装），是用已在库的 `dropdown-menu` 组合出的单选下拉
> （`apps/web/components/ui/select.tsx`），键盘操作模型等价但不是官方实现——能接受就在
> 签核时一并认可，不能接受需要退回重做并补装依赖。
>
> **② ✅ usecases.md / domain.md / coverage.md 已备齐。** 五个用例的 in/out/pre/err
> 均已写明，四条不变量均可写成断言，覆盖表两个方向的核查已列出（反向核查标注为
> 「未核查」，将在 F01 开工时补，不是假装已经查过）。UC-4 BELOW_THRESHOLD 默认值
> 人类 2026-08-23 已确认：复合组件盘点后若不足 3 次重复，接受「不收口」为合法结果。
>
> **③ N/A — 本束无后端 API 契约面。** Dialog/Dropdown/Select/Tooltip/Table/Menu/
> Breadcrumb/Pagination 均为纯前端展示与交互组件，不产生服务端调用，因此
> `packages/contracts/src/interaction-primitives.ts` **不存在也不需要存在**。
> 第③件签核材料在本束里恒为「不适用」，人类签核时只需确认这个判断本身站得住——
> 如果未来某个复合组件（如带服务端分页的 Table）真的需要后端契约，
> 应作为新的 design-delta 处理，不追溯改本束。

## 人类签核时请重点确认

- **① UI**：核对 5 张截图是否覆盖四个弹层原语的关键状态；确认 Select 用
  `dropdown-menu` 组合实现（非 radix-select）这个取舍能接受。
- **② 用例**：UC-4「收口一个复合组件模式」的 `BELOW_THRESHOLD` 分支——如果盘点后
  发现某个候选模式其实不到 3 次重复，是否接受「不收口」作为合法结果（本文档默认接受，
  避免为了凑数过度抽象）。
- **③ API 契约**：确认「本束无 API 契约面」这个判断本身正确——如果你认为某个复合
  组件未来会有服务端分页/排序需求，请现在提出，以便重新评估是否要在本束里预留契约位。
- **支撑材料**：`domain.md` 的四条不变量是否有遗漏（尤其 I-2 「点遮罩与 Esc 语义等价」
  这条，如果产品上希望某些弹层只能靠按钮关闭，需要在这里明确写出例外）。
