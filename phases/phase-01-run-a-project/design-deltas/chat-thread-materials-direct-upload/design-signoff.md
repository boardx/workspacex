---
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改；本次按 human-decision-packaging 规则二由 agent 转写人类选择，人类审阅合入本 PR 即签核
bundle: chat-thread-materials-direct-upload
base_bundle: chat-file-upload
scope: materials-tab-uploads-become-thread-materials-not-composer-attachments-agent-reads-them-every-run-deletable
covers: []   # ad-hoc 人类交办，非 feature_list 条目
confirmed_by: usamshen
confirmed_at: 2026-09-27
confirmed_via: >-
  人类 2026-09-27 会话原话：「在右边的材料 panel 上传的文件，不需要经过 chat 提交，这个是两个上传的入口，不同的。
  不要混在一起啦，在 chat 提交的文件会进入右边的 panel，但是在右边 panel 上传的不要进入到 composer」。
  随后的选择题：① agent 可见性 =「每轮都能读到（推荐）」；② 删除入口 =「这次一起做（推荐）」。
---

# design delta 签核 · 右栏「材料」直接上传为线程材料

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。

## ① UI
材料页签的「+」/拖拽直接落为线程材料，不进 composer；列表标来源（随消息 / 直接上传），直接上传的可删除；composer 附件入口与行为不变（`contract.md` §4）。

## ② 用例
- 用户在材料页签上传 → 立即出现在材料列表，composer 不出现。
- 用户在 composer 挂附件并发送 → 出现在材料列表（来源「随消息」）。
- 之后每一轮任务，agent 的可读文件清单都包含全部线程材料（`contract.md` §3）。
- 用户删除直接上传的材料；随消息的附件不可删。

## ③ API 契约
新增 `uploadThreadMaterial` / `deleteThreadMaterial`，`listThreadAttachments` 出参项 `messageId` 可空并加 `source`；表加 `scope` 列与 T1–T3 不变量；新增常量 `maxThreadMaterials` 与两个错误码（`contract.md` §1–§2）。
