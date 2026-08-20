---
phase: "10"
covers_bundles: [group-checkin, module-routing, segment-engine, stage-aggregation, viewer-role]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-08-20T09:19:24+08:00"
---

# Phase 10「现场协作编排」阶段一致性复核

覆盖磁盘上现有的全部 5 个契约束（frontmatter `covers_bundles:` 是权威，与磁盘目录核对一致）。
本文复核的是**跨束**的交叉约束——单束都签了不代表它们之间不打架。

## 一、跨束交叉约束汇总（来自各束 design-signoff.md 的「本束与哪些束有交叉约束」表）

| 交叉点 | 涉及束 | 是否打架 | 说明 |
|---|---|---|---|
| 「缺N人」状态后缀读到场数 | viewer-role ← group-checkin | ✅ 不打架 | 两束一致：到场数据模型只在 group-checkin 定义一次，viewer-role 只读不重建 |
| 角色可见性矩阵同时约束「视角能切什么」和「模块侧栏能看什么卡片」 | viewer-role ↔ module-routing | 🔴 需在签核时明确 | 两束都提到"权限判定"，但**权限判定服务本身应该只有一处实现**——viewer-role 的 `getViewerOptions` 判定"能进哪个视角"，module-routing 的模块卡片可见性判定"进了视角后能看哪些卡片"，这是同一个角色矩阵的两层应用还是两套独立判定？两束的 usecases.md 都没有显式声明依赖关系，**建议签核时补一条**：module-routing 的模块可见性判定复用 viewer-role 的角色读接口，不新建一套。 |
| 环节状态条单一数据源（F963） | segment-engine ↔ 其余所有束 | ✅ 不打架 | 五个束的 UI 材料里凡出现黑色状态条，均标注"复用 F963 已有样式/文案"，没有束打算重建这个组件。 |
| 观察者可见范围裁决（Q1） | viewer-role → module-routing、stage-aggregation | 🔴 需在签核时明确 | viewer-role 已裁定观察者只能看全场聚合、不进任何分组。但 module-routing 束（分组五模块侧栏）本身就是"分组视角"的产物——**观察者理论上不会用到 module-routing 束覆盖的界面**。stage-aggregation 束（看板/知识图谱聚合）观察者能否看，两束目前都没有显式回答"观察者进入这些视图时看到的是完整版还是脱敏版"。建议签核时把这条显式写进 stage-aggregation 的 domain.md。 |
| phase-02 依赖 | stage-aggregation | 🔴 硬阻断（非跨束冲突，是跨阶段依赖） | 已在 stage-aggregation/design-signoff.md 顶部用 🛑🛑 独立小节标出：即便本束三件签完，F09/F10 仍要等 phase-02 的知识图谱/看板契约束单独签核才能对接真实数据。这不是本次一致性复核要解决的事，只是提醒：签这一束不等于解锁开工。 |
| phase-01 议程束依赖 | segment-engine（F04） | 🔴 硬阻断（同上，跨阶段） | F04 倒计时字段是对 phase-01 议程束的契约变更请求，本轮签核只能确认"编排层想要这个字段"的设计意图，不能替 phase-01 拍板。 |
| 模块卡片统一形态字段集（Q3） | module-routing → viewer-role、stage-aggregation | ✅ 不打架，但有后续 | Q3 已裁定采纳现状 5 字段。stage-aggregation 的看板卡片与 module-routing 的模块卡片是两种不同的卡片（一个是"分组进度卡"，一个是"能力模块卡"），字段集**不需要统一**，两束在各自 ui.md 里已经分开定义，没有互相覆盖或矛盾。 |
| 免注册进场链接 | group-checkin ← phase-01 01-auth（跨 phase，非本阶段束） | ✅ 不打架 | group-checkin 明确"复用不重造"，链接生成/校验逻辑归 phase-01 所有，本束只消费。 |

## 二、缺口清单（供签核时逐条确认，是否需要在正式签核前补齐）

1. **module-routing 与 viewer-role 的权限判定服务是否共用一处实现**——目前两束的 usecases.md
   都没有显式声明依赖关系，建议在两束正式签核时各补一句交叉引用。
2. **观察者进入 stage-aggregation 的看板/知识图谱视图时看到完整版还是脱敏版**——
   stage-aggregation 的 domain.md 目前没有覆盖这条，viewer-role 的 Q1 裁决（全场只读聚合）
   理论上应该延伸到这里，但没有被显式写下来，容易在实现阶段被漏掉。

## 三、两处跨阶段硬阻断（重申，不是本次复核的产物，是各束已经标出的）

- `stage-aggregation`（F09/F10）依赖 phase-02 知识图谱/看板契约束——phase-02 目前 `not_started`，
  `contracts/` 只签了 `survey` 一个束。
- `segment-engine`（F04）依赖 phase-01 议程束新增倒计时字段——这是跨 phase 的契约变更请求。

这两处**不因为本次一致性复核通过而解除**，签核后仍然阻断，需要各自所属阶段的束分别签核。

---

## 确认动作

人类核对上面的交叉约束表 + 缺口清单后，把 frontmatter 的 `status` 改为 `confirmed`，
并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳。

⚠ 若后续新增第 6 个契约束（比如为了解决上面「缺口 1」而拆出一个新束），
必须同时把它加进 `covers_bundles` 并**重做**本文的交叉约束复核——
只改 `covers_bundles` 而不重做复核，等于把「没复核」谎报成「复核过」（同 phase-01 先例的教训）。
