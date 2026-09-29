# `board-authoring` — BV04/BV05 用例草案（未签核）

> ② 用例签核材料草案。依据 `requirements/02-object-authoring.md` 与 `05-collaboration-history.md`；复用 `board-fabric-surface` 的 `dispatchBoardCommand`、Yjs observer、对象身份和权限边界。这里定义 application 操作，不另造对象 HTTP CRUD。当前既不证明实现，也不授予开工许可。

## 共同输入与失败

所有写操作带 `{ boardId, actorId, clientId, gestureId }`，在权威 ACL 校验后以一个领域 command/事务写入；输出中的 `accepted` 不等于已保存，UI 的成功提示等权威确认。通用错误：`BOARD_READ_ONLY`、`BOARD_OBJECT_NOT_FOUND`、`BOARD_COMMAND_INVALID`、`BOARD_DEPENDENCY_UNAVAILABLE`，语义沿用前束。新增草案错误：`BOARD_EDIT_CONFLICT`（编辑目标已被远端删除或字段冲突）、`BOARD_BATCH_LIMIT_EXCEEDED`（超过 500 个有效条目）、`BOARD_HISTORY_UNAVAILABLE`（无可撤销语义动作或权限已改变）、`BOARD_COMMIT_REJECTED`（权威端拒绝；保留可重试草稿）。错误名需在③协议单源中确认，不能只在 UI 发明。

## UC-A1 `beginObjectAuthoring` — 创建后立即输入（BV04）

```text
in:  { boardId, actorId, clientId, gestureId, kind: sticky | text,
       trigger: canvasDoubleClick | shortcut | dock, worldPoint,
       stickyShape?: square | rectangle | circle }
out: { objectId, focusTarget, transactionId, confirmationState }
pre: Board ready、目标点在画布、actor 有编辑权
err: BOARD_READ_ONLY | BOARD_COMMAND_INVALID | BOARD_DEPENDENCY_UNAVAILABLE
```

双击空白或 `N` 默认生成 Sticky；dock 可选 Sticky/Text。对象先以合法默认尺寸/样式创建，编辑焦点落在对象内，不把用户带到独立侧栏 textarea。空白双击对非空对象无效。读者可选中/导航，不可经 dock、快捷键、直接 command 绕过 ACL。

## UC-A2 `editObjectTextAndStyle` — 行内文字与外观（BV04）

```text
in:  { boardId, actorId, clientId, gestureId, objectId,
       textDelta?, stylePatch?, textRole?, stickyShape?, sizingIntent? }
out: { objectId, objectRevision, transactionId, confirmationState }
pre: 对象未 tombstone、actor 可编辑、patch 类型符合对象 kind
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_COMMAND_INVALID |
     BOARD_EDIT_CONFLICT | BOARD_COMMIT_REJECTED
```

文字合成期间 IME 草稿留在本地输入层，composition end 之前全局 N/Tab/Delete、Enter 提交等快捷键不得抢占；提交的文字经领域/Y.Text 更新并由 observer 回投 Fabric。RTL 原文顺序不变；长文本无截断并保持插入点可见。Sticky 允许方/矩形/圆形、颜色、字号和三种 resize 意图；Text 允许标题/正文/标签层级。具体 `normal/free/auto-height` 与当前 `fixed/auto-size/auto-height` 的映射仍待③契约裁决，不允许静默近似。远端删除时关闭编辑并保留可复制草稿，不复活已删对象；提交失败显示未确认且可重试。

## UC-A3 `continueSticky` — Tab 连续创作（BV05）

```text
in:  { boardId, actorId, clientId, gestureId, sourceStickyId, directionHint? }
out: { newObjectId, worldPoint, focusTarget, transactionId, confirmationState }
pre: sourceSticky 未删除且焦点在其编辑态、IME 非 composition
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_COMMAND_INVALID |
     BOARD_DEPENDENCY_UNAVAILABLE
```

Tab 提交当前内容并创建下一张，焦点直接移入新 Sticky；与附近对象形成明确纵向趋势时向下，否则向右，间距 24px。每次 Tab 是一次语义动作，有不同 `gestureId`；同一键事件重试不重复创建。文本输入中的原生 Tab 可访问行为与连续创作的优先级须在 UI 材料确定。真实浏览器计时：空板到首张 `<5s`，首张后 10 张 `<30s`；记录起止事件、环境和原始结果。

## UC-A4 `previewAndCreateStickyBatch` — 多行粘贴（BV05）

```text
in:  { boardId, actorId, clientId, gestureId, plainText, mode: oneText | stickies | list,
       anchorWorldPoint }
out: { preview: orderedLines, acceptedObjectIds?, transactionId?, confirmationState? }
pre: 粘贴源可读取；选择 stickies 时有效行数 1–500
err: BOARD_READ_ONLY | BOARD_BATCH_LIMIT_EXCEEDED | BOARD_COMMAND_INVALID |
     BOARD_COMMIT_REJECTED
```

先在轻量预览中选择单文本、逐行 Sticky 或列表；HTML/脚本只按安全纯文本处理。确认 500 行时分配稳定 id、确定顺序与位置，并以**一个**批量 operation/Yjs transaction 原子提交；任何无效内容、上限/权限/持久化错误都不能半写。预览取消后保留剪贴板原内容。当前实现的 100 上限与此验收冲突，不能当作通过。

## UC-A5 `deleteAndUndoAuthoringAction` — 删除与基础历史（BV05）

```text
in:  { boardId, actorId, clientId, gestureId, action: delete | undo | redo,
       objectIds?, targetOperationId? }
out: { affectedObjectIds, transactionId, confirmationState }
pre: actor 有对应写权；history 动作属于该 actor 且仍可应用
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_HISTORY_UNAVAILABLE |
     BOARD_EDIT_CONFLICT | BOARD_COMMIT_REJECTED
```

Create/Edit/Move/Delete 均可基础 Undo/Redo；删除产生 tombstone 与 `ObjectDeleted`。删除后的 Undo 若可执行，恢复**原 object id 与引用**，不得复制新 id，也不得由客户端私改单调 tombstone。无历史或远端冲突时保持权威状态并说明原因；“已撤销”须等权威确认。多人字段级不覆盖他人更新、认证 tombstone restore、离线加密队列与灾备完整语义仍属于 BV22；BV05 验收不得冒领 BV22。

## 未决签核点

1. 尺寸模式：`normal/free/auto-height` 与当前 schema 枚举的唯一语义和迁移。
2. Text 层级、Sticky shape/style 字段及 `textDelta` 的③协议单源。
3. 原 id 删除恢复所需认证 restore 与基础 Undo 的可交付边界。
4. 编辑态 Tab 的连续创建与键盘可访问性优先级；500 张的容量和失败原子性。

以上未决项解决并完成 UI、③契约、阶段一致性复核及人类三件签核前，本束保持 draft。
