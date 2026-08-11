# Phase 04 — 数字专家访谈 Studio

- **slug**: digital-expert-interview-studio
- **状态**: not_started
- **创建于**: 2026-08-11 15:42:59

## 目标
独立交付历史访谈、专家快捷对话、五步批量访谈与可追溯探索性报告，不依赖组织决策晋升链

## 范围与边界
- 本阶段交付：历史访谈与专家列表首屏、全页快捷访谈、名称/标签/主题起步的五步批量访谈、恢复与局部重试、可追溯探索性报告。
- 复用边界：沿用 Phase 00 已验证的身份/RLS、Artifact、Context Pack，以及 Phase 01 interview 范围契约；不复制第二套身份、范围或错误信封。
- 明确不做：真人访谈、用户画像、模板优先创建、语音/视频数字人、强洞察/决策依据/组织晋升出口。

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
