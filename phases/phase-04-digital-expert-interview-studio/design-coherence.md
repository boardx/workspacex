---
phase: "04"
covers_bundles: [digital-expert-interview]
status: confirmed
confirmed_by: shenyangjun
confirmed_at: 2026-08-11T23:53:35+08:00
---

# Phase 04 阶段一致性复核

本阶段只有 `digital-expert-interview` 一个契约束；复核重点是它与既有共享契约的边界，而不是重复束内检查。

## XC-01 · interview 契约单源

- [ ] 只扩展 `packages/contracts/src/interview.ts`，不创建第二个 interview schema 或前端状态枚举。
- [ ] 复用 Phase 01 的 `InterviewId`、范围、错误信封和真人授权/录制边界，不改变真人访谈行为。

## XC-02 · 数字专家目录为快照，不是第二身份

- [ ] 首批专家候选由模型根据访谈输入直接生成并保存为访谈内 `DigitalExpertSnapshot`；现有 Agent Definition 与 Context Pack 只用于用户在第二步从专家库人工追加的专家。
- [ ] 材料正文只经 Context API 按当前权限读取，应用层不直读 segment、embedding、向量库或对象存储。

## XC-03 · 探索性结果边界

- [ ] 每条发现引用专家、问题、回答与材料来源，且 `exploratory=true`。
- [ ] Phase 04 不提供强洞察、决策依据或组织晋升写入口；未来接入必须经过 Phase 03 治理能力。

## XC-04 · UI 与路由所有权

- [ ] 用户已授权 `coord-user-research` 串行修改 `/itv` 共享热点；F02–F06 按依赖顺序执行。
- [ ] 只保留历史访谈/专家列表两个首页标签，快捷访谈、创建、详情和报告均为完整页面。
- [ ] 返回历史使用显式路由，操作按钮不在按钮内部换行。

## 人类确认动作

先确认 `contracts/digital-expert-interview/design-signoff.md`，再逐项确认 XC-01～XC-04；由人类修改本文件 frontmatter 的签核字段。Agent 不得代签。
