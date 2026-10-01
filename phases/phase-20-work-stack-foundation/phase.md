# Phase 20 — work-stack-foundation

- **slug**: work-stack-foundation
- **状态**: not_started
- **创建于**: 2026-09-28 11:43:35

## 目标
Work Stack 第一阶段落地：D002/D003/D005/D011 四个角色 Agent 及其 19 个 Workflow、58 个 Skill 在系统中可用

## 范围与边界
- 本阶段交付：
  - Skill 元数据与目录：`WorkSkillManifest`、`skill_catalog_entries`、目录/搜索 API 与目录页（ADR-117）。
  - 通用 Workflow Runtime：定义/版本/实例、统一 receipt/lease/SSE、副作用网关与权限重查、人工审批、pg-boss/webhook 触发；迁移引导式研究作为通用性证明（ADR-118）。
  - Agent 即数字人：`agent_versions` 的头像/分类/Workflow 白名单/委派/升级字段、官方角色包、Agent 目录（ADR-116/120）。
  - Eval 与发布门：`evals/work-stack/`、`pnpm harness eval`、G0–G5（ADR-119）。
  - 内容落地：第一阶段 81 个实体（`requirements/work-stack-v2` 中已 PASS 的 D002/D003/D005/D011 闭包）——58 个 Skill 包、19 个 Workflow 定义、4 个官方角色 Agent；三条真实链路（研究 / 产品 / 销售）端到端。
  - Board 投影：Agent 参与者与 Workflow 运行对象（只读投影，写入仍走 Board operation）。
- 明确不做：实时语音数字人（ADR-121 独立轨道）；第二至四阶段实体；修改组合矩阵；Workflow DSL；两套 Skill 模型的收敛。
- 迭代：10 轮（`docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md`），每轮自动验收、人类抽查。
- 人类授权（2026-09-28，对话）：设计签核稍后补签，先行开发；签核状态字段仅由人类修改。开发阶段不建 GitHub issue（人类指示），因此完成定义第 5 条在本阶段需人类另行裁决。

## 需求 → 功能清单 流水线
1. **原始需求**写进同目录的 `requirements/` 文件夹（可按领域放多份 `*.md`，人类语言、可模糊）。
2. 调 **requirement-author** 智能体：读 `requirements/` 全部 `*.md` → 生成/更新 `feature_list.json`
   （每个 feature 带可执行 `verification`）。
3. `requirements/` 是输入/上下文,**不是权威**;权威永远是 `feature_list.json`。

## 权威功能清单
本阶段的唯一权威功能来源是同目录的 `feature_list.json`。
sprint 通过 `feature.sprint` 字段领取功能;`active-features.json` 是脚本派生的只读视图。

## 退出条件(Definition of Done for this Phase)
- `feature_list.json` 中本阶段所有 feature 均为 `passing`。
- `runtime-readiness.json` 经 `pnpm harness phase-readiness` 的独立门禁转为 `ready`；
  feature passing 数量本身不能推出 runtime/E2E ready。
- `.harness/state/quality-document.md` 相关领域评级未下降。
- 阶段 `progress.md` 已收尾,无未记录的半成品。
