---
status: pending
bundle: guided-deep-research
base_bundle: research
scope: guided-brief-directions-outline-web-search-report
covers: []
confirmed_by:
confirmed_at:
---

# Design delta 签核 · 引导式 Deep Research

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已经确认的 `research` 束，只新增 UC-24.6 的六屏引导流程，不静默修改
既有 UC-24.1…24.5 的研究配置、候选洞察、冲突判定或结论出口。

## ① UI

请评审 [ui.md](./ui.md) 与 `ui-preview/` 下六张真实组件截图。重点确认：

- 首页把未完成的「继续研究」和已完成的「查看研究」明确分开；
- 主题、研究方向、报告大纲都在搜索开始前可编辑；
- Web Search 展示当前查询、章节进度和真实来源形态；
- 最终报告同时有正文、目录和引用，不是一块聊天消息。

## ② 用例

请评审 `requirements/24-research/uc-24-6-引导式深度研究与完整报告.md`。

核心取舍：人类确认点是三个独立检查点（brief / directions / outline）；搜索开始后，恢复依据是
服务端会话阶段，前端不得靠历史卡片文字猜测。

## ③ API 契约

请评审 [contract.md](./contract.md)。当前只确认操作边界和状态机，不修改
`packages/contracts/src/research.ts`；签核后由实现 feature 把 Zod schema 落入该契约单源。

特别需要确认：

1. 复用 `Research` 作为拥有者/项目/配置基座，新增一个 guided session 聚合；
2. `directions` 与 `outline` 分开保存，避免一次更新静默覆盖两个人类确认点；
3. 搜索进度读模型是 snapshot，可由后台运行更新，前端刷新可恢复；
4. 完整报告返回结构化章节与 citation 身份，不只返回一段不可追溯 markdown。

## 人类决定

待确认。
