---
name: mod-user-interview
description: 用户访谈流程与数字访谈能力；修改访谈主题、专家、问题、访谈执行或报告时使用。
---

# 用户访谈模块

负责用户访谈从主题确认、专家角色、问题生成、访谈执行到报告的业务边界。

## 代码地图

- 前端：`apps/web/app/itv`、`apps/web/app/itv/live`、`apps/web/app/itv/[interviewId]`
- API：`apps/api/src/application/interview`、`apps/api/src/domain/interview`、`apps/api/src/interface/controllers/interview-*`
- 契约：`packages/contracts/src/interview.ts` 及相关研究契约

## 迭代约束

- 专家卡片优先展示专业角色和能力描述；材料边界放在详情中。
- 专家、问题和回答发送模型前必须经过 actor 可见性与版本校验。
- 重新生成会影响下游步骤时，必须保留旧版本并明确确认，不覆盖用户已确认内容。
- 访谈报告的引用只能来自已保存的访谈事实、转录或来源，不能让模型编造 URL。

修改前先读对应 application/domain/controller 和现有测试；涉及实时录音时转用 `mod-realtime-transcription`。
