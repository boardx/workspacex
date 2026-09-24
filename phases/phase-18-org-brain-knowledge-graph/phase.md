# Phase 18 — org-brain-knowledge-graph

- **slug**: org-brain-knowledge-graph
- **状态**: not_started
- **创建于**: 2026-09-24 06:15:24

## 目标
组织大脑 × 知识图谱：Apache AGE 图投影 + pgvector 混合检索，从 chat session 最小闭环起步（会话 → 个人项目），再外扩到项目、组织、平台（PROP-ORG-BRAIN-KG-001 / ADR-114）

## 范围与边界
- 本阶段交付:chat session（L0）与个人（L1）两级的知识入图、hybrid 召回（FTS + pgvector + AGE 图 + metadata + claim）、知识面板（查看/确认/纠错/删除）、晋升到个人并跨会话召回、删除失效级联。底座（AGE 镜像、`ontology_objects`/`ontology_actions`/`object_embeddings`、claims/ontology_edges 扩列、HNSW）在本阶段建成，供 phase-02/03 复用。
- 明确不做:项目现场图谱与决策树（phase-02 09-kg）、组织大脑五态机与晋升准入（phase-03 14-brain）、平台大脑（另立提案）。
- 要你签什么：见 `requirements/05-signoff-plan.md`。

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
