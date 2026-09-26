# 契约束 `board-object-authoring` — 领域模型与不变量（支撑材料）

> 本束定义 BV04–BV06 的 Sticky/Text、快速创作、基础历史、Reaction 与 Link Preview 语义。
> 它扩展 S01 的 `BoardObject` 与 command，不改变 Yjs/whiteboard-core 唯一事实源、稳定 object id、
> Fabric 仅为 projection 的已签核边界。

## 一、领域概念

### `StickyObject`

```text
{
  id, kind: sticky, revision,
  text: CollaborativeText,
  geometry,
  shape: square | rectangle | circle,
  resizeMode: normal | free | autoHeight,
  textStyle, fill, tags[], link?, reactions,
  parentId?, orderKey, tombstone?
}
```

`text`、shape、style、link、reaction 和 tombstone 都是 canonical 字段；Fabric Group/Textbox/scale
只是投影。circle 是 Sticky 的视觉形态，不改变 `kind` 或 object id。

### `TextObject`

独立对象 `{ id, kind: text, revision, text, level, textStyle, geometry, link?, tombstone? }`。
`level` 是 `title | heading | subheading | body | caption` 的语义层级；视觉 preset 从它派生，
手工覆盖仍保存为 canonical textStyle，而非 Fabric font cache。

### `CollaborativeText`

由 Y.Text 或 whiteboard-core 等价 CRDT 表示，以 `TextSplice` 操作修改。全文字符串可以作为读取投影，
不能作为并发写入时的 last-write-wins 替代品。每次 splice 带 object id、session、base revision、
actor 与 operation identity。

### `InlineEditSession`

进程内交互状态 `{ sessionId, objectId, baseTextRevision, selectionRange, composition?, draftDelta }`。
它不进入 Board snapshot。composition 结束后生成 canonical splice；对象被 tombstone 或权限撤销后 session
终止，draft 只可供用户复制，不能重新创建对象。

### `StickySeries`

一次连续创作的本地意图 `{ sourceObjectId, direction, spacing: 24, continuedCount, startedAt }`。
方向只影响下一张 world geometry；对象之间没有隐式持久父子关系。体验 trace 与产品内容分离。

### `ObjectPresentation`

允许的 Sticky/Text 视觉字段值对象。geometry 存最终 world-space width/height/rotation，不存 Fabric scale。
`autoHeight` 依据版本化测量策略从 canonical text 与 style 派生高度；不同客户端必须得出相同提交值，
或由 command 端统一规范化。

### `ObjectReaction`

canonical entry `{ objectId, actorId, emoji, createdAt, operationId }`。同 actor/object/emoji 至多一条；
汇总 `{ emoji, count, reactedByCurrentActor }` 是派生投影。任意 HTML、头像 DOM 与显示顺序不是事实。

### `ObjectLink`

`{ normalizedUrl, revision, previewState, previewMetadata? }`。preview metadata 只允许安全的 title、description、
siteName、imageAssetRef 与 fetchedAt；原始 HTML、脚本、cookies、认证 header 和响应体不进入 Board。
previewState 是 `none | loading | ready | failed | blocked`，异步结果必须匹配 link revision。

### `AuthoringHistoryItem`

`{ historyItemId, actorId, clientId, transactionId, semanticKind, forward, inverse, causalObjectRevisions }`。
基础范围只含本束声明的 create/text/style/move/delete。它记录领域 inverse，不序列化 Fabric object。
BV22 将扩展跨客户端、离线和认证 tombstone restore，不得回写改变已确认 history item 的语义。

## 二、不变量

| # | 不变量 | 可执行断言 |
|---|---|---|
| I-1 | Sticky/Text 的 `id` 在 Board object、Y.Map key、Fabric metadata、DOM mirror、history target 中完全一致 | 创建、编辑、删除、undo 全链逐项比对 id |
| I-2 | 文本只由 canonical collaborative text/splice 修改，Fabric Textbox 与 React input 不拥有第二份持久文本 | 移除 editor/Fabric 实例后从 Y.Doc 重投影，内容 hash 不变 |
| I-3 | IME composition 未结束时产生 0 条 text splice、0 张连续 Sticky、0 个 history item | 中文/日文 composition 事件序列逐事件计数 |
| I-4 | 一次已结束 composition 最多生成 1 个语义 text history item | 输入法候选确认后 transaction/history 计数均为 1 |
| I-5 | 创建成功结束于 canonical object 已投影且 caret-ready；临时 Fabric 对象不算成功 | 断开 command adapter 时画布不出现假成功对象 |
| I-6 | TTFI 从 `board-state-ready` 到第一张 Sticky caret-ready 固定 `<5s`，trace 不含预置对象 | E2E 校验时间戳顺序、空板初始计数和一次双击 |
| I-7 | 连续指标是第一张之后新增 10 张、总数至少 11，首张完成到第 11 张 caret-ready `<30s` | trace 含 10 次 Tab、10 个新 id 与严格时长 |
| I-8 | 连续 Sticky world-space 间距固定 24px，明确纵向序列外默认横向，viewport zoom 不改变结果 | 0.05/1/8 zoom 下 geometry 差值相同 |
| I-9 | 500 张批量创建是一个原子 transaction 和一个 history item；失败时 0 张落地 | transaction/update/history 计数与失败注入 |
| I-10 | normal/free/autoHeight 是封闭 resizeMode；提交 geometry 不含 Fabric scale | schema 拒绝未知 mode，projection round-trip 后 scale 可重建 |
| I-11 | Link Preview 异步结果只可更新相同 object id 与 link revision | 快速更换 URL 后旧响应被幂等忽略 |
| I-12 | blocked/failed preview 永远保留已确认的安全链接，且不包含原始 HTML/凭据/内网信息 | 失败 fixture 检查 link 与安全字段白名单 |
| I-13 | 相同 actor/object/emoji 的 Reaction 幂等且至多一条，summary 等于 canonical entries 聚合 | 重放 add/remove 后 entry 唯一且计数一致 |
| I-14 | Delete 只有 canonical tombstone 确认后才从 Fabric/DOM mirror 消失 | 拒绝/延迟 delete 时对象仍可见且无成功播报 |
| I-15 | Delete Undo 在安全时恢复同一 object id；不得创建替代对象 | 删除/撤销前后 id、引用与 selection target 相同 |
| I-16 | 基础 Undo 不覆盖他人后续字段写入，冲突时 canonical state 与 history cursor 均不变 | 注入 foreign revision 后 undo 返回 conflict、hash 不变 |
| I-17 | Undo/Redo 成功必须晚于 canonical transaction 接纳和 observer projection | 延迟 observer，成功播报不可先出现 |
| I-18 | Viewer/Commenter 在本束默认权限下产生 0 条对象 mutation；键盘与 DOM editor 不能绕过 | 对工具、快捷键、command adapter 三入口反证 |
| I-19 | 任何 authoring command 都不包含 Fabric JSON/class/instance、DOM draft 或 preview HTML | command/Yjs/checkpoint payload 静态与运行时扫描 |
| I-20 | 远端 tombstone 或撤权会终止 inline session，未提交 draft 不复活对象 | 编辑中删除/撤权后 update 数为 0，focus 安全迁移 |

## 三、状态迁移

### Sticky/Text 创建与编辑

```text
idle → create-intent → canonical-accepted → projected → editing(caret-ready)
                                                ├→ composing → editing
                                                ├→ committing → projected → editing
                                                └→ tombstoned/revoked → ended-with-draft-copy
```

`canonical-accepted` 之前不显示成功对象；`composing` 不产生 splice。任何失败回到 canonical projection，
不能把 editor draft 整段覆盖远端文本。

### Link Preview

```text
none → loading(linkRevision=N) → ready(N)
                           ├→ failed(N) → loading(N)
                           └→ blocked(N)
link changed → loading(N+1); 所有 N 的迟到结果失效
```

### 基础历史

```text
forward accepted → undoable → undo requested → inverse accepted → redoable
                                  └→ conflict/denied → undoable（cursor 不动）
redo requested → forward semantic command accepted → undoable
```

## 四、本束无对外 HTTP 面

BV04–BV06 只扩展浏览器/application 与 `whiteboard-core` 共用的 canonical command 和 Yjs schema，
不新增公开对象 REST CRUD。metadata/ACL 继续复用 `packages/contracts/src/whiteboard.ts`；因此没有
`packages/contracts/src/board-object-authoring.ts`。本束 coverage 的“门控命令”列必须填可执行验证，
用于区分“明确没有 HTTP 面”与“忘记写契约”。若实现出现跨进程 Link Preview 或公开 operation DTO，
必须先通过 design delta 物化 zod 单一事实源，不能把 infrastructure 返回 shape 当作隐式契约。

## 五、权限与边界

- Owner/Editor：执行本束对象 mutation。
- Viewer：只读、可选择和使用对象大纲，不可打开可写 inline editor。
- Commenter：本束默认不允许对象 mutation 或 Reaction；若产品决定允许 reaction，必须在签核时明确为 ACL delta，
  并补 API/服务端校验，不能只放开前端按钮。
- Link Preview resolver 是受限服务端能力，遵守租户、allow/deny policy、DNS/IP/redirect/size/type/timeout 边界。
- 评论、多人 presence、完整协作 Undo、离线 outbox、checkpoint 恢复属于 BV20–BV22；Tile/Image/Draw 属于 BV07–BV10。
