# ⛔ 已停用模板 — phase 级 UI 先行确认（ADR-003）

> **本模板自 2026-07-30 起不再被任何脚本渲染**（ADR-023 决策一）。
> `new-phase --ui` 不再 scaffold `phases/<phase>/ui-signoff.md`。
> 保留本文件仅为留痕，让「为什么仓库里有三份停用的 `ui-signoff.md`」有出处。
>
> **不要复制它去建新的 phase 级签核文件。** 建了也不会有任何门控读它。

## UI 签核现在在哪

UI 是**束级 `design-signoff.md` 三节中的第 ① 节**，材料写在同目录 `ui.md`：

```
phases/<phase>/contracts/<束>/
  ui.md              签核① 界面落点：路由、关键组件、稳定 data-testid，逐条引用 ui-preview/ 截图
  usecases.md        签核② 用例接口与失败模式穷举
  domain.md          支撑：实体与不变量
  coverage.md        支撑：UC 的 R12 → API 操作 → 前端消费点
  design-signoff.md  ①②③ 三节一次签；frontmatter 带 covers: [F01, …]
phases/<phase>/design-coherence.md   阶段一致性复核，frontmatter 带 covers_bundles: [...]
```

签核③ API 契约住在 `packages/contracts/src/<bundle>.ts`（zod 单一事实源）。

## 从 ADR-003 保留下来、现在由束级门执行的两条

1. **UI 由 ui-prototyper 用 `apps/web` 真实组件 + mock 先做出来，截图存 `phases/<phase>/ui-preview/`。**
   ADR-003 的理由未变：让界面方向在便宜的阶段被人类拍板。
2. **即便 `status: confirmed`，该阶段 `requirements/` 没有真实 story 覆盖就仍然拒绝**
   （`hasRequirementsCoverage`，人类拍板 2026-07-19）。这条已搬进 `auditSignoff`，
   且适用面扩到**任何采用契约束流程的阶段**，不再限于 `has_ui`。

## 怎么做

`.harness/instructions/contract-design.md`（执行书）· `docs/adr/ADR-023-unified-signoff.md`（权威）
· `docs/adr/ADR-003-ui-first-signoff-gate.md`（原始理由，仍有效）
