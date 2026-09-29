# `board-authoring` — 领域模型与不变量（待签核）

本束扩展 `board-fabric-surface/domain.md` 的 canonical `BoardObject`；不重新定义 Board metadata、ACL、renderer identity 或存储格式。对象内容以 `whiteboard-core`/Y.Doc 为事实源，Fabric 和行内输入层均为投影/临时状态。

## 概念

- `AuthorableObject`：稳定 `objectId`、`kind`、世界坐标、revision、文字内容、类型化 style、tombstone。BV04 的 kind 为 Sticky/Text。
- `StickyStyle`：shape、颜色、字号、resize 意图。正式枚举以③协议单源为准；当前需求与实现枚举不一致，不能在两处各保留不同语义。
- `TextStyle`：标题/正文/标签层级与可编辑文字格式，合法值须由命令校验而非 Fabric 私有属性决定。
- `LocalEditDraft`：IME composition、插入点和未确认内容；不写 Y.Doc，不从失效对象自动恢复。
- `StickySequence`：基于对象世界坐标/邻近方向确定下一张的位置；每张 Sticky 有独立身份，批量有确定的 `orderedObjectIds`。
- `AuthoringOperation`：一次用户语义动作的 `(boardId, clientId, gestureId)`、actor、对象集、事务和确认状态。重试应幂等。
- `AuthoringHistoryEntry`：仅关联本人可撤销语义动作和逆向操作；不是 Fabric snapshot。跨人冲突/恢复授权由 BV22 扩展。

## 可断言不变量

| # | 不变量 | 反证/验收断言 |
|---|---|---|
| A-1 | `Y.Map key == objectId == Fabric boardObjectId == DOM mirror key` | 创建/删除/Undo 后逐项比对；恢复原 id，不出现复制 id |
| A-2 | 用户一次语义动作最多一个领域 operation/Yjs transaction | 单次创建、Tab、编辑提交或 500 行批量各记录一次事务；pointer/IME 中途零持久事务 |
| A-3 | 同一 `(boardId, clientId, gestureId)` 和 payload 重试仅生效一次；异 payload 拒绝 | 重放 10 次后对象数、历史数、事务效果不变 |
| A-4 | IME 草稿只在本地，composition 中不触发全局快捷键或确认 | 中文/日文合成中 N/Tab/Delete/Enter 不生成对象、不删对象、不提交半字 |
| A-5 | 文本往返保留 Unicode、RTL 顺序和长文本；渲染不截断事实值 | 组合字符、RTL 和长段落刷新/第二客户端逐字比较 |
| A-6 | Sticky shape/style/sizing 与 Text role 都是类型化领域字段 | 改 Fabric 实例但不提交 command 后，重新投影恢复 canonical 值 |
| A-7 | 只读角色的任意入口不能写，包括快捷键、dock、直接 command | Viewer/Commenter 的 Y.Doc update/operation 数均为 0 |
| A-8 | 500 张批量要么全成、要么零写，id、顺序、世界位置确定 | 失败注入每个边界后无部分对象；刷新和第二客户端顺序一致 |
| A-9 | 删除先 tombstone；Undo 保留 id 和引用且不越权复活 | 删除/撤销后连接/评论等引用仍指原 id；未认证 restore 被拒 |
| A-10 | 保存/撤销成功提示不得先于权威确认 | 延迟/拒绝服务端 ACK 时 UI 保持 pending/error，不显示成功 |
| A-11 | 远端删除中的编辑不能覆盖 tombstone | 双端并发删除/提交，最终对象不复活，草稿可取回 |
| A-12 | 世界坐标/对象内容不随本地 viewport 与 selection 改变 | 两端 pan/zoom/选择后领域 hash 一致 |

## 状态与边界

```text
authoring: idle → local-draft → commit-pending → confirmed
                              ├→ rejected (草稿可恢复)
                              └→ conflict (不复活远端删除)
history:   available → undo-pending → confirmed / rejected
```

IME composition 是 `local-draft` 的子态。`confirmed` 的判据来自权威持久化/协作 ACK，不是 Fabric render 完成。BV05 只承诺基础 Create/Edit/Move/Delete 历史；BV22 的多人字段隔离、离线队列、损坏恢复不得据此宣布完成。

## 需要③契约裁决

当前代码 `StickySizingMode` 为 `fixed/auto-size/auto-height`，而需求 BV04 同时提到 normal/free 拖拽与 auto-height 内容增长。[③ 协议草案](api.md)建议将 normal/free 作为交互约束，保留现有持久尺寸枚举；还需由签核确定圆形/方形在自动高度及拖动后的优先级。批量上限当前为 100，需求为 500，需统一 parser、command envelope、预览和容量测试。删除同 id Undo 与单调 tombstone 之间需要认证恢复协议；此草案不擅自允许客户端清 tombstone。
