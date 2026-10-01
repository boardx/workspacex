# WorkspaceX Work Stack v1 — 320 Entity Requirements

> ⚠ **已被取代（superseded，2026-09-28，ADR-116 / #4534）**：Work Stack 的唯一需求权威是 `requirements/work-stack-v2/`（S/W/D 编号）。v2 `AUTHORING-PROTOCOL.md` 否决了本目录的模板化实体正文；本目录只作历史档案，**不得**作为 requirement-author 或实现的输入。


Issue: #4501

## 交付
- 200 个 Skill requirement：`skills/`
- 60 个 Workflow requirement：`workflows/`
- 60 个 Digital Human requirement：`digital-humans/`
- 5 份跨实体架构/策略/实施/验收文档

实体文件合计 **320**；支持文档另计。

## 设计原则
1. WorkspaceX canonical entity 与开源 evidence 分离。
2. 每个实体显式选择 A0/A1/A2/A3/A4 中一个 source strategy。
3. 复用当前 Phase 14/15/18/19 架构，不建立第二事实源。
4. Skill = 专业工作方法；Workflow = 状态化编排；Digital Human = 角色组合。
5. 所有写操作经 Tool Registry + Permission/HITL。
6. Digital Human 正式产品必须有统一 avatar asset。
7. 工程师按 requirement 实现，不在实现阶段重新定义范围。

## 阅读顺序
1. 00-ARCHITECTURE-FIT.md
2. 01-SOURCE-STRATEGY-A0-A4.md
3. 02-IMPLEMENTATION-PLAN-3-STAGES.md
4. 03-ENTITY-CONTRACTS.md
5. 04-ACCEPTANCE-AND-EVAL.md
6. 对应实体 requirement 文件

## 从 requirements 到实施
本目录是需求输入，不是 feature 状态权威。按仓库规则，正式开发前由 requirement-author 把三阶段拆进对应 phase/feature_list.json；每个 feature 单 issue / 单 PR / harness verify。
