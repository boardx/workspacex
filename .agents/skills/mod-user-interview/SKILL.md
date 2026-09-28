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

## 模块 SOP

先读本文件与 feature 验证契约，在独立 worktree 中修改；完成后运行访谈 API/UI 测试并在 PR 中写明权限、版本和报告证据影响。

## 踩坑与经验（append-only）

- 2026-09-19：专家卡片使用专业角色和能力描述，材料边界放在详情中（出处：issue #3739）。
- 2026-09-27：专家展示偏好需同时接入目录、独立详情与访谈工作台；头像键按 expertId 固定绑定，本地保存边界在编辑器明示，不能冒充服务端档案更新（出处：issue #4338 / PR #4339；对应 UI 与 Chromium 回归）。
- 2026-09-28：issue #4483 用 canonical Markdown 串联六个具名步骤；身份、权限、版本、执行状态和复核为元数据，不复制研究正文到旧 JSON 工作流。执行租约与 CAS 防止旧响应回写新修订；已确认正文只能分支新修订。
- 2026-09-28：issue #4483 将 authenticated SVG 头像偏好持久化到服务端（替代上一条 authenticated 浏览器保存边界）；目录绑定 org/actor/expert，虚拟专家绑定已保存的访谈 expert anchor，不伪造目录 agent。
- 2026-09-28：canonical 报告复核绑定 revision/document/version/hash，独立元数据表而非伪造旧 reportId；模拟报告不可批准，缺乏可信质量投影时失败关闭。导出保留证据边界；版本绑定权限内分享不等于公开发布。附件先鉴权再消费 multipart，原件与提取 Markdown 引用持久化，保存草稿不自动确认（issue #4483）。
- 2026-09-28：导入页隐藏手动保存草稿入口后，「下一步」仍先持久化 canonical Markdown、再确认并生成分析；文件上传仍独立持久化而不自动确认（issue #4539，`interview-markdown-create` / `interview-markdown-intake` 回归）。
- 2026-09-28：全栈 Chromium 默认开启假麦克风与自动授权，权限查询即使为 denied 仍可能成功采音；验收拒绝路径需在页面的 `getUserMedia` 边界注入 `NotAllowedError`，并明确标注为故障注入。真实登录、上传、canonical Markdown API/DB 存取与刷新恢复保持不模拟（issue #4557，`digital-interview-intake-failure-live.spec.ts`）。

## 知识回流规则

谁修改本模块，谁在 PR 中追加可验证经验；不删除旧条目，推翻时注明替代来源。
