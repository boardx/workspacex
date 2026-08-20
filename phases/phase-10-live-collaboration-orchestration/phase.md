# Phase 10 — 现场协作编排

- **slug**: live-collaboration-orchestration
- **状态**: not_started
- **创建于**: 2026-08-20 00:13:29

## 目标
四组并行现场协作的编排层：主持台/分组视角切换器、议程环节引擎的现场落地（环节状态条+倒计时+介入告警+下一环节推进）、分组签到、以及把已有能力域（01-run-a-project 的对话/画布/转录、02-visible-outcomes 的知识图谱决策树与看板、06 深度研究、07 用户访谈、08 转录、09 问卷与现场投票）在同一现场协作 Tab 里按角色（引导师/组长/组员/观察者）×视角（全场/分组）组合呈现——本阶段不重造这些能力域各自的领域模型，只做编排、路由与角色可见性

## 范围与边界
- 本阶段交付:<在此列出本阶段必须达成的能力>
- 明确不做:<列出本阶段刻意排除、留到后续阶段的事项>

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
