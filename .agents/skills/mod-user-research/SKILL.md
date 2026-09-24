---
name: mod-user-research
description: 用户研究计划、资料检索、来源证据和研究报告；修改研究五步流程时使用。
---

# 用户研究模块

负责研究主题、研究方向、大纲、资料检索、来源证据和报告生成。

## 代码地图

- 前端：`apps/web/app/research`、`apps/web/app/studio/research`
- API：`apps/api/src/application/research`、`apps/api/src/domain/research`、`apps/api/src/infrastructure/research`
- 契约：`packages/contracts/src/research.ts`

## 迭代约束

- 每个启用的大纲章节尽量补足三个相关来源；不足时保留缺口，不用无关来源凑数。
- 搜索摘要只用于发现和筛选。报告引用前必须读取真实网页或文档，并验证逐字证据。
- 来源删除意图、失败任务和报告检查点必须持久化，重试不能把排除来源重新加入。
- 报告按已确认大纲逐章生成；来源 ID由服务端绑定，模型不得自行编造链接。

改动检索或报告前先读 `guided-runtime-service.ts`、`guided-report-evidence.ts`、`guided-report-chapters.ts` 及对应测试。

## 模块 SOP

先读本文件与 feature 验证契约，在独立 worktree 中修改；报告或检索变更必须跑 API、来源证据和受影响 UI 测试。

## 踩坑与经验（append-only）

- 2026-09-07：来源数量不等于报告深度，缺少匹配证据的章节必须明确缺口，不能塞入无关来源（出处：issue #2904）。
- 2026-09-24：首页状态总数必须能直接筛出对应研究，并与标签和搜索条件组合；只展示数字会让“需要处理”无法转化为下一步动作（出处：issue #4066）。
- 2026-09-24：研究首页不能用孤立百分比代替真实阶段与证据健康；进入报告阶段但零来源时必须明确标出证据缺口，下一动作应由服务端恢复阶段派生（出处：issue #4026）。

## 知识回流规则

谁修改本模块，谁在 PR 中追加可验证经验；不删除旧条目，推翻时注明替代来源。
