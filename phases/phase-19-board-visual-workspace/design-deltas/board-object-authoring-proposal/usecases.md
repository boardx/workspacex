# 契约束 `board-object-authoring` — ② 用例接口与失败模式（签核面第 ② 件）

> 本束扩展 S01 的 canonical `dispatchBoardCommand`，不新增公开 HTTP Object CRUD。
> Fabric event、inline editor、DOM 大纲、AI 或未来 API 都只能调用相同 Board command；
> 文本事实属于 Y.Text/领域 text operation，React input 与 Fabric Textbox 都不是第二份文本存储。

## 统一失败枚举

| 错误 | 语义 | 表面行为 |
|---|---|---|
| `BOARD_READ_ONLY` | Viewer/Commenter 或撤权后的主体尝试创建、编辑、删除、reaction 或 undo | 保留当前 projection，禁用写入口并播报只读 |
| `BOARD_OBJECT_NOT_FOUND` | 对象不存在或已 tombstoned | 结束编辑、清理 selection/focus；不得复活旧 Fabric 实例 |
| `BOARD_OBJECT_KIND_UNSUPPORTED` | 命令类型与目标 kind/version 不兼容 | 不写 Yjs；对象保持 canonical projection |
| `BOARD_TEXT_EDIT_CONFLICT` | 编辑基准已删除、revision 不可合并或 composition 目标失效 | 保留可复制的本地草稿，停止提交并给出冲突说明 |
| `BOARD_COMMAND_INVALID` | 空/超限文本、非法几何、未知样式或命令 shape 非法 | 保持编辑上下文，指出可修复字段，不生成历史项 |
| `BOARD_IME_INCOMPLETE` | composition 尚未结束却触发提交、Tab 或 destructive command | 输入法优先；不提交半个字符、不创建下一张 |
| `BOARD_HISTORY_EMPTY` | 当前主体没有可撤销/重做的基础动作 | Undo/Redo disabled，不显示成功 toast |
| `BOARD_HISTORY_CONFLICT` | undo 会覆盖他人后续写入、权限已变或 causal target 不再可恢复 | 拒绝回滚并解释；不强制覆盖远端事实 |
| `BOARD_LINK_INVALID` | URL scheme、长度或规范化失败 | 不发预览请求；可保留为纯文本或重新编辑 |
| `BOARD_LINK_PREVIEW_BLOCKED` | SSRF/组织策略/恶意内容/不允许 host | 保留安全链接，显示 blocked，不泄露内网探测细节 |
| `BOARD_LINK_PREVIEW_UNAVAILABLE` | 预览超时、依赖失败或无 metadata | 保留链接，显示可重试 failed；对象编辑不失败 |
| `BOARD_BULK_LIMIT_EXCEEDED` | 批量文本超过 500 条或 payload 上限 | 在提交前拒绝并显示计数；不产生部分对象 |

## UC-1 `createSticky` — 最低摩擦创建并立即输入

```text
in:  { boardId, actorId, clientId, gestureId, worldPoint, shape?, source: doubleClick | tool | shortcut | drag }
out: { operationId, transactionId, objectId, caretIntent, acceptedAt }
pre: Board ready；actor 可写；worldPoint 可归一化
err: BOARD_READ_ONLY | BOARD_COMMAND_INVALID
```

主流程：

1. 生成稳定 object id 和默认可用的 square/yellow/normal Sticky。
2. 以一次 `CreateSticky` command/Yjs transaction 写 canonical object；不能先向 Fabric 塞临时业务对象后再补 id。
3. observer 投影后，以同一 object id 进入 inline editor，caret-ready 才结束创建旅程。
4. trace 记录 `boardReadyAt/createIntentAt/canonicalAcceptedAt/projectedAt/caretReadyAt`，用于 TTFI `<5s` 反证。

同一 `(boardId, clientId, gestureId)` 重试只返回首次 object id。未投影成功不得显示“创建成功”。

## UC-2 `createText` — 创建独立 Text 并直接编辑

```text
in:  { boardId, actorId, clientId, gestureId, worldPoint, textLevel?: title | heading | subheading | body | caption }
out: { operationId, transactionId, objectId, caretIntent }
pre: actor 可写；画布 ready
err: BOARD_READ_ONLY | BOARD_COMMAND_INVALID
```

默认 body 仅在调用者没有选择级别时使用。Text 视觉 style 由 textLevel 的 canonical preset 派生，
用户后续可覆盖允许字段；preset 名称与实际字号不得分别成为两份权威。

## UC-3 `commitTextEdit` — 提交文字与 IME composition

```text
in:  { boardId, actorId, objectId, sessionId, baseTextRevision, splices[], compositionId? }
out: { operationId, transactionId, textRevision, appliedRange }
pre: 目标是可编辑 Sticky/Text；composition 已结束；actor 可写
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_TEXT_EDIT_CONFLICT | BOARD_IME_INCOMPLETE | BOARD_COMMAND_INVALID
```

- inline editor 维护的是短生命周期 input state；最终只提交 text splice，不覆盖整段 Y.Text。
- `compositionstart` 到 `compositionend` 期间不得发半成品 splice；`Enter/Tab/blur` 只有在 composition 结束后生效。
- 可并发的远端 splice 由 canonical text model 合并；远端 tombstone 立即结束 session，本地未提交草稿可复制但不能复活对象。
- 每个 composition commit 形成一个语义 history item；浏览器按键事件数量不决定 undo 粒度。

## UC-4 `continueStickySeries` — Tab 连续创建

```text
in:  { boardId, actorId, clientId, gestureId, currentObjectId, currentTextRevision, nearbyGeometry }
out: { operationId, transactionId, nextObjectId, worldPoint, direction, caretIntent, continuedCount }
pre: 当前 Sticky 的 composition 已结束且对象可写
err: BOARD_IME_INCOMPLETE | BOARD_OBJECT_NOT_FOUND | BOARD_READ_ONLY | BOARD_COMMAND_INVALID
```

先提交当前文本，再以一次 transaction 创建下一张；失败不能产生空白孤儿。方向算法是确定性的：
明确纵向邻居序列则纵向，否则横向；world-space 间距固定 24px，不受 viewport zoom 影响。

体验门固定为：第一张完成信号到“其后第 10 张”的 caret-ready `<30 秒`，最终序列共有至少 11 张。
自动化必须记录十次用户 Tab 与每张 canonical id，不能用批量预置替代。

## UC-5 `bulkCreateStickies` — 多行文本原子批量创建

```text
in:  { boardId, actorId, clientId, gestureId, lines[1..500], origin, direction, spacing: 24 }
out: { operationId, transactionId, objectIds[], count }
pre: lines 已按用户确认的 Paste as Text / Create Stickies / Create List 选择规范化
err: BOARD_READ_ONLY | BOARD_COMMAND_INVALID | BOARD_BULK_LIMIT_EXCEEDED
```

全部对象在一个有界 transaction 中创建，保持输入顺序和确定性位置；任一行非法时整批拒绝，
不留下部分对象，也不能形成 500 个网络往返或 history item。

## UC-6 `updateObjectPresentation` — 形状、尺寸模式与文字样式

```text
in:  { boardId, actorId, objectId, gestureId, patch: StickyPresentationPatch | TextPresentationPatch }
out: { operationId, transactionId, objectRevision, normalizedPatch }
pre: kind 与 patch 匹配；actor 可写
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_OBJECT_KIND_UNSUPPORTED | BOARD_COMMAND_INVALID
```

Sticky shape 只允许 square/rectangle/circle；resizeMode 只允许 normal/free/autoHeight。
normal 保持形态规则，free 接受显式 width/height，autoHeight 的高度由 canonical text measurement policy
派生。一次 toolbar 操作只产生一个 style history item，不能直接持久化 Fabric scale。

## UC-7 `setObjectReaction` — 添加或撤销自己的 Reaction

```text
in:  { boardId, actorId, objectId, gestureId, emoji, mode: add | remove }
out: { operationId, transactionId, objectRevision, summary }
pre: actor 具有本束约定的 reaction 权限；emoji 在允许集
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_COMMAND_INVALID
```

相同 actor/object/emoji 幂等；summary 从 canonical reaction entries 派生，不能只保存在 DOM badge。
Iteration 2 的 Commenter 是否可 reaction 必须由人类在签核时明确；未确认前按只读处理，不扩大 ACL。

## UC-8 `setObjectLink` / `resolveLinkPreview` — 链接与安全预览

```text
setObjectLink in:  { boardId, actorId, objectId, gestureId, rawUrl? }
              out: { operationId, transactionId, normalizedUrl?, previewState }
              err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_LINK_INVALID

resolveLinkPreview in:  { boardId, objectId, linkRevision, normalizedUrl }
                   out: { linkRevision, state: ready | failed | blocked, safeMetadata? }
                   err: BOARD_LINK_PREVIEW_BLOCKED | BOARD_LINK_PREVIEW_UNAVAILABLE
```

只允许 `http/https`；凭据、fragment 和危险 scheme 不进入请求。预览由受限服务端端口处理 DNS/IP、
重定向、大小、类型、超时和内容清理，浏览器不直接抓任意 URL。异步结果必须匹配当前 linkRevision；
旧预览不能覆盖用户的新链接。失败不撤销已保存的安全链接。

## UC-9 `deleteBoardObjects` — 删除并写 tombstone

```text
in:  { boardId, actorId, clientId, gestureId, objectIds[1..N], expectedRevisions }
out: { operationId, transactionId, tombstonedIds, historyItemId }
pre: actor 可写；不在未结束 composition 中；目标可删除
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_IME_INCOMPLETE | BOARD_COMMAND_INVALID
```

一次选择删除对应一个 transaction 和 history item。确认后 Fabric/DOM mirror 才移除对象，焦点迁移到
合理邻近对象或 Board 根。Iteration 2 不定义级联 Panel/Connector 删除；遇到尚未支持的依赖结构必须
拒绝并提示，不能静默孤立引用。

## UC-10 `undoBoardAuthoring` / `redoBoardAuthoring` — 基础语义历史

```text
in:  { boardId, actorId, clientId, requestedHistoryItemId? }
out: { operationId, transactionId, affectedObjectIds, historyCursor, action: undo | redo }
pre: actor 当前仍有相应写权限；目标 history item 属于当前 actor/session 的基础创作域
err: BOARD_READ_ONLY | BOARD_HISTORY_EMPTY | BOARD_HISTORY_CONFLICT | BOARD_OBJECT_NOT_FOUND
```

支持 create、text splice、presentation patch、move 与 delete 的基础语义逆操作。Delete Undo 恢复相同
object id，且仅当 tombstone 仍是目标对象的最新 causal action、没有他人后续写入、actor 仍有权限。
任何拒绝都不移动 history cursor，也不显示“已撤销”。多人归属、离线、认证 restore token、
跨 session checkpoint 由 BV22 扩展；本束不提前声称完整协作 Undo。

## 对外契约位置与边界

- metadata/ACL HTTP 单源继续是 `packages/contracts/src/whiteboard.ts`。
- 本束不新增公开对象 REST CRUD；`CreateSticky/CreateText/TextSplice/UpdatePresentation/Reaction/Link/Delete/Undo/Redo`
  是 `whiteboard-core` command 判别联合的扩展，所有适配器共同 import。
- Link Preview 需要 application port，但网络/DNS/内容清理属于 infrastructure；返回值只含安全 metadata，
  不把 HTML、响应头、内网地址或抓取凭据写入 Board。
- Fabric class、Textbox state、React editor draft、DOM reaction badge 与 preview HTML 都不得进入 canonical schema。
