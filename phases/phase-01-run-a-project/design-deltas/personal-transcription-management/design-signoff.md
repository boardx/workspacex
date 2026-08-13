---
status: confirmed
bundle: personal-transcription-management
base_bundle: personal-realtime-transcription
scope: personal-transcription-real-tags-edit-delete
covers: [F177]
confirmed_by: "qq13613030605"
confirmed_at: "2026-08-14T08:30:00+08:00"
---

# Design delta 签核 · 个人转录历史管理

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已确认的 `personal-realtime-transcription` 束，只增加历史标签读取、元数据修改与永久删除。实时 ASR、正文复制/编辑与 owner/org 隔离契约保持不变。

## ① UI

- 历史页筛选栏显示真实标签集合，不再写死“客户 / 内部 / 高优先级 / 已归档 / 市场研究”。
- 每张卡片右下角菜单包含“修改”和“删除”。
- “修改”复用创建弹窗的名称/标签规则并预填当前值。
- “删除”必须二次确认，明确名称、永久删除与不可恢复；成功后卡片与无引用标签同步消失。

## ② 用例

请评审 [`uc-5-7-个人转录历史管理.md`](../../requirements/05-rec/uc-5-7-个人转录历史管理.md)。

核心取舍：删除正文与 capture，但保留不含正文的用量审计；正在录音或收尾时拒绝修改/删除；跨用户访问仍按不存在处理。

## ③ API 契约

请评审 [contract.md](./contract.md)。新增 owner-scoped 标签查询、元数据修改与删除操作；删除事务必须先锁定个人文档并检查活动 capture，再删除内容，避免停止转录与删除竞态。

重点确认：

1. 标签来自当前用户所有转录的真实去重集合；
2. 修改只允许名称与标签，不修改正文或 owner；
3. 永久删除个人文档、capture、正文与 ticket；
4. 用量事件保留但与已删除内容解除外键，不包含正文；
5. 活动 capture 返回 `CAPTURE_ALREADY_ACTIVE`，UI 保留原卡片。

## 人类决定

待确认以上 UI、用例与 API 契约设计。确认后请由人类亲自把 frontmatter 改为 `status: confirmed`，填写 `confirmed_by` 与可解析 ISO 8601 `confirmed_at`，并把本段改为已确认。
