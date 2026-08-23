---
bundle: interaction-primitives
phase: "12"
covers: [F01, F02, F09, F10]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:
confirmed_at:
---

# 契约束 `interaction-primitives` 设计签核

> ## 🔴 本束现在不可签核。请不要把 `status` 改成 `confirmed`。
>
> 阻塞的是**一条**，其余材料已备齐：
>
> **① 🔴 UI 材料未产出。** `ui-preview/interaction-primitives/` 目录尚不存在——
> ui-prototyper 还没有跑过。`lint-ui-material.mjs` 会对本束报判定④「目录不存在 / 0 张 png」。
> 已在 `.harness/scripts/ui-material-map.json` 补上本束的映射行（见该文件本次改动）。
> **这条红是本束的正确状态，不是待修的故障**——材料确实还没产出。
>
> **② ✅ usecases.md / domain.md / coverage.md 已备齐。** 五个用例的 in/out/pre/err
> 均已写明，四条不变量均可写成断言，覆盖表两个方向的核查已列出（反向核查标注为
> 「未核查」，将在 F01 开工时补，不是假装已经查过）。
>
> **③ N/A — 本束无后端 API 契约面。** Dialog/Dropdown/Select/Tooltip/Table/Menu/
> Breadcrumb/Pagination 均为纯前端展示与交互组件，不产生服务端调用，因此
> `packages/contracts/src/interaction-primitives.ts` **不存在也不需要存在**。
> 第③件签核材料在本束里恒为「不适用」，人类签核时只需确认这个判断本身站得住——
> 如果未来某个复合组件（如带服务端分页的 Table）真的需要后端契约，
> 应作为新的 design-delta 处理，不追溯改本束。

## 人类签核时请重点确认

- **① UI**：ui-prototyper 产出 `ui-preview/interaction-primitives/` 后，回来这里核对
  截图是否覆盖四个弹层原语 + 复合组件的关键状态（默认/hover/keyboard-focus/空态）。
- **② 用例**：UC-4「收口一个复合组件模式」的 `BELOW_THRESHOLD` 分支——如果盘点后
  发现某个候选模式其实不到 3 次重复，是否接受「不收口」作为合法结果（本文档默认接受，
  避免为了凑数过度抽象）。
- **③ API 契约**：确认「本束无 API 契约面」这个判断本身正确——如果你认为某个复合
  组件未来会有服务端分页/排序需求，请现在提出，以便重新评估是否要在本束里预留契约位。
- **支撑材料**：`domain.md` 的四条不变量是否有遗漏（尤其 I-2 「点遮罩与 Esc 语义等价」
  这条，如果产品上希望某些弹层只能靠按钮关闭，需要在这里明确写出例外）。
