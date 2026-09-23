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
