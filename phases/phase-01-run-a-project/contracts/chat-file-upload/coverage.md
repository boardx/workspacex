# 契约束 `chat-file-upload` — ④ UC 覆盖证明（支撑材料）

> **回答**：前三件定的接口，真的够跑通 UC 吗？
> 覆盖 feature：见 `design-signoff.md` 的 `covers:`（**权威**，本文是派生视图）。
> 依据 UC：`08-chat/uc-8-6-对话文件上传.md` 的 R12 验收线索（V1–V7）。
> ⚠ 数值单一事实源是 ③ 件契约 `packages/contracts/src/chat-file-upload.ts`，本文只指针引用。

## R12 验收线索 ↔ 接口/门控（逐条不沉默）

| V | 一句话（uc-8-6 R12） | API 操作 / 门控命令 | feature | 状态 |
|---|---|---|---|---|
| V1 | 成功态：有写权上传白名单内 ≤上限文件 → id，挂消息回读、刷新仍在 | 契约 `uploadAttachment` + `chat.createMessage.attachmentIds` · `pnpm --filter api exec vitest run tests/chat/attachment-upload.test.ts` | F150/F151 | ⏳ not_started |
| V2 | 超限拒绝：26MB / 非白名单 / 第 11 个 → 三者都被服务端拒，行数不增 | 契约 `ChatAttachmentError`（FILE_TOO_LARGE/FILE_TYPE_REJECTED/ATTACHMENT_LIMIT_EXCEEDED）· 同上测试 | F150 | ⏳ not_started |
| V3 | 写权门：观察者上传被拒，无落库 | 契约 `NO_WRITE_ROLE` · 同上测试 | F150 | ⏳ not_started |
| V4 | 级联删除：删线程 → 附件行归 0（FK CASCADE） | domain 不变量 3 · `pnpm --filter api exec vitest run tests/chat/attachment-cascade-delete.test.ts` | F151 | ⏳ not_started |
| V5 | 挂载合法性：带别的线程/已挂别消息的 id → 整条发送被拒 | `chat.createMessage` 服务端校验 · 同 attachment-upload 测试的挂载用例 | F151 | ⏳ not_started |
| V6 | composer UI：`chat-attachment-input`/`-chip-<id>`/`-remove-<id>`，超限就地报错 | ① ui.md ①–⑨（9 张截图）· web 组件测试（V9-a 落地时锚 testid，现不造） | F152 | ⏳ not_started |
| V7 | V9-b（本期不做）：附件抽取进 L3 检索 | usecases UC5 + anydoc 提案 `PROP-CHAT-ANYDOC-INTEGRATION-001` | F153 | ⏳ not_started |

⚠ 命令锚的是 F150–F153 将来创建的测试（与 feature_list verification 一致）；V6 的 web 组件测试
在 V9-a UI 落地时创建，不造不存在的 testid。
③ 件门控：`node .harness/scripts/lint-third-artifact.mjs`（形态 A：契约文件存在）。
