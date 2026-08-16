---
status: confirmed
bundle: canvas-mermaid-templates
base_bundle: canvas
scope: create-template-signoff-plus-mermaid-diagram-type-plus-two-subgaps
covers: []
confirmed_by: usamshen
confirmed_at: 2026-08-17
---

# Design delta 签核 · canvas 模板承载 mermaid 图模板（#988）

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已经确认的 `canvas` 束（`phases/phase-01-run-a-project/contracts/canvas/`），
产出材料对应 issue #988 的三件事，**均未落代码**——`packages/contracts/src/canvas.ts` 分文
不动。人类可以逐件独立勾选签核，不必三件一次性全签或全拒。

## ① UI

请评审 [contract.md](./contract.md) 第三节。因无原型截图工具，材料用文字描述交互流程，
不是截图集——这与 `guided-deep-research` 等既有 delta 的 `ui.md` + `ui-preview/` 形式不同，
如实说明，供人类判断是否需要在正式实现前补一版真实原型截图（`ui-prototyper`）。

重点确认：

- 「新建画布模板」对话框新增的分岔控件（画布分区模板 / mermaid 图模板）是否符合预期
  的信息架构，还是应该拆成两个独立入口；
- 「初始图骨架预览」是否需要交互式编辑（本材料默认只读预览，创建后才可在画布编辑）；
- 「基于此开新版」按钮的出现条件（`status !== "draft"`）与预填字段范围是否符合产品意图。

## ② 用例

请评审 [contract.md](./contract.md) 第四节的用例表，重点看**失败模式是否穷举**：

- 「创建 mermaid 图模板」是否需要新增 `INVALID_DIAGRAM_SKELETON` 错误码（骨架结构非法，
  如 edge 引用不存在的 nodeId）——材料未替产品做这个决定；
- 「基于既有模板开新版」的幂等性：同一来源版本重复点击是否应该去重（材料默认不去重）；
- team-only 归属团队的两种颗粒度二选一：**补字段但维持静默 fail-closed**，还是
  **补字段并改为创建时显式拒绝**（新增 `TEAM_REQUIRED_FOR_TEAM_ONLY`）。

## ③ API 契约

请评审 [contract.md](./contract.md) 第一、二、五节。当前只确认设计边界，不修改
`packages/contracts/src/canvas.ts`；签核后由实现 feature 把 Zod schema 落入该契约单源。

特别需要确认：

1. **#496 补签**（第一节）：`createTemplate` 按现状（`z.string().min(1)` 的
   `underlyingType`，无 `ownerTeamId`，只铸 v1）签核，还是要求连带第二、三节的扩展
   一并签——两条路径本材料都覆盖，互不冲突。
2. **`MermaidDiagramType` 是 12 类还是 13 类**（是否含 `xychart`，见 contract.md 2.1
   节）——issue 原文写 12 类，但代码现状 `DiagramKind` 里 `xychart` 的行为与其余 12 个
   同属「registered plugin」路径，材料如实标出这处不确定，需要人类明确选择。
3. **`underlyingType` 判别联合**（`canvas-section` | `MermaidDiagramType`）是否是正确的
   扩展方式，还是应该走另一种设计（例如完全独立的 `mermaid` 模板类型、不复用
   `createTemplate`）——contract.md 5.1 节标注这是本材料最大的设计取舍。
4. **`ownerTeamId` 语义**（contract.md 5.2 节）：是否采用与 `identity` 束
   `CapabilityAddPayload` 逐字同型的 `.refine` 写法，以及是否把「隐性不可见」升级为
   「显式拒绝」。
5. **新操作 `mintTemplateVersion`**（contract.md 5.3 节）：路径、`in`/`out`/`err` 形状，
   以及两个未定点（`basedOnVersion` 幂等键是否需要、是否允许跨分支开新版）。

## 支撑材料

本 delta 未新增 `domain.md` / `coverage.md`——三件事均挂靠已签核的 `canvas` 束，
未引入新的领域不变量或独立 UC 覆盖面；相关不变量讨论已并入 contract.md 各节（如
「加一段不替一段」「只铸 v1」等既有 `canvas` 束不变量的延续性检查见 contract.md 六节）。
若签核认为扩展面已经大到需要独立支撑材料，请在下方「人类决定」注明，由后续 delta 补齐。

## 人类决定

待确认。

## 人类决定

- [x] ① UI 通过 —— 「新建画布模板」对话框用分岔控件（画布分区模板 / mermaid 图模板）即可，
      不必拆两个独立入口；初始骨架先只读预览，同意（编辑放到创建后在画布里做）；
      「基于此开新版」按钮条件 `status !== "draft"` 通过。
- [x] ② 用例通过 —— 新增 `INVALID_DIAGRAM_SKELETON` 错误码；「基于既有模板开新版」
      默认不去重（同意材料现状）；team-only 归属采用「补字段并改为创建时显式拒绝」
      （新增 `TEAM_REQUIRED_FOR_TEAM_ONLY`），不要静默 fail-closed。
- [x] ③ API 契约通过，具体裁决：
  1. #496 补签：按现状签（`createTemplate` 保持 `z.string().min(1)` 的 `underlyingType`，
     无 `ownerTeamId`，只铸 v1），第二、三节的扩展作为后续独立 feature 迭代，不绑定
     在同一次实现里。
  2. `MermaidDiagramType` 定为 **12 类**，不含 `xychart`（与 issue 原文一致；`xychart`
     后续若有需求再单独提扩展，不在本次范围内）。
  3. `underlyingType` 判别联合（`canvas-section` | `MermaidDiagramType`）方式通过，
     不另起独立 `mermaid` 模板类型。
  4. `ownerTeamId` 采用与 `identity` 束 `CapabilityAddPayload` 逐字同型的 `.refine`
     写法，且升级为「显式拒绝」（呼应 ②「用例」的裁决，二者保持一致）。
  5. `mintTemplateVersion` 通过；`basedOnVersion` 不需要幂等键，不允许跨分支开新版
     （避免版本树复杂化，先做线性版本链）。
- [x] 三件全部通过，`status` 可改为 `confirmed`
