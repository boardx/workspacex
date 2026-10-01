# ADR-116: Work Stack v2 需求权威与 Agent 即 DigitalHuman

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-28
- 关联：#4534 · `docs/proposals/PROP-WORK-STACK-001.md` · `requirements/work-stack-v2/`

## 背景
Work Stack 出现过三份需求：main 上的 v1（#4502，`phases/requirements/work-stack-v1/`，SK-/WF-/DH- 编号）、分支 `requirements/work-stack-320-v1`（S/W/D 编号），以及 #4523 合入的 v2（`requirements/work-stack-v2/`）。v2 的 `AUTHORING-PROTOCOL.md` 明确否决 v1 的模板化正文，并给出作者化的组合矩阵。三份并存违反「同一事实不得声明在两处」。

v1 两份都把 DigitalHuman 写成独立实体（`DigitalHumanDefinition/Version`、`DigitalHumanProfile`），而产品上现有 Agent 就是数字人。

## 决策
1. **唯一需求权威 = `requirements/work-stack-v2/`**，编号 S001–S200 / W001–W060 / D001–D060。v1 目录标 superseded，只作档案；分支 `requirements/work-stack-320-v1` 不合入。
2. **组合图的唯一事实源 = v2 的两张矩阵**（`WORKFLOW-SKILL-MATRIX.md`、`DIGITALHUMAN-COMPOSITION-MATRIX.md`），不另建 `composition.yaml`；由 `pnpm run lint:work-stack-graph` 检查引用闭合。
3. **Agent 即 DigitalHuman**：不建 DigitalHuman 表、实体或第二套版本链。角色能力（头像、角色分类、Workflow 白名单、委派/升级策略、KPI、实时交互配置）作为 `agent_versions` 的冻结字段加入，随 Agent 版本快照、发布审核、克隆规则走。
4. 每个实体先作者化并经独立评审 PASS，才能进入实现；平台底座不等作者化，可并行开工。

## 后果
- requirement-author 只读 v2；读 v1 视为输入错误。
- 任何「DigitalHuman*」实体或表的提案，默认违反本 ADR。
- 作者化产出路径与评审格式见 `requirements/work-stack-v2/AUTHORING-OUTPUT.md`。
