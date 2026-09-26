# 契约束 `board-fabric-surface` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖本束 `domain.md` 描述的概念和现有 `whiteboard` metadata 契约。
> S01 不新增公开 HTTP CRUD；它规定浏览器内 application ports、Yjs transaction 边界与
> renderer projection 行为。公开 Board API 与 AI/import operation 在后续契约束扩展，
> 但必须复用这里的 command 入口，不能直写 Fabric。

## 统一失败枚举

| 错误 | 语义 | 表面行为 |
|---|---|---|
| `BOARD_NOT_VISIBLE` | Board 不存在或调用者无读取权限；两者不泄露差异 | 不加载 Y.Doc 或对象正文，显示 denied/not-found 统一出口 |
| `BOARD_READ_ONLY` | viewer 或已撤销写权限的客户端尝试写 command | 保留当前视图，撤销瞬时 Fabric 变换并播报只读 |
| `BOARD_OBJECT_NOT_FOUND` | command 指向已删除/tombstoned 对象 | 不重建全板；清理该对象 selection 并给可恢复提示 |
| `BOARD_OBJECT_UNSUPPORTED` | 对象 kind/version 当前 adapter 不支持 | 用带 object id 的隔离占位投影；其他对象继续工作 |
| `BOARD_COMMAND_INVALID` | 几何、字段或 operation 不符合 canonical model | 不写 Yjs；Fabric 回到 canonical projection |
| `BOARD_PROJECTION_FAILED` | 单对象构建/patch 失败 | 记录 object id/revision，隔离占位，继续处理同事务其他对象 |
| `BOARD_CONTEXT_LOST` | browser canvas context 丢失或 Fabric surface 失效 | 保留 Y.Doc，销毁并重建 renderer registry 后重新 projection |
| `BOARD_DEPENDENCY_UNAVAILABLE` | collaboration/content 依赖无法取得权威文档 | 不假成功、不以 Fabric JSON 兜底；显示重试/离开/恢复包入口 |

## UC-1 `openBoardSurface` — 打开正式 Board

```text
in:  { boardId, actorId, clientId, viewportHint? }
out: { boardMeta, documentRevision, accessMode, projectionStatus }
pre: Board metadata 与读权限可验证
err: BOARD_NOT_VISIBLE | BOARD_DEPENDENCY_UNAVAILABLE
```

主流程：

1. 经现有 `whiteboard.operations.getBoard` 取得 metadata/role；不从 PG metadata 响应取得内容对象。
2. 打开该 Board 的 canonical Y.Doc/whiteboard-core document。
3. 创建 Fabric Canvas、object registry、projection guard 与本地 viewport；按 object id 增量首投影。
4. 从同一 canonical projection 建立 React DOM 对象大纲与 selection store。
5. 同时满足 Fabric、Yjs observer、DOM mirror 就绪后才进入 `board-state-ready`。

失败模式：

- Board 空：成功返回，进入 empty，不创建假便利贴。
- 单对象反序列化失败：走 `BOARD_OBJECT_UNSUPPORTED`/`BOARD_PROJECTION_FAILED` 的隔离占位，
  不让 `openBoardSurface` 整体失败。
- viewer：以 readonly 打开，保留导航/阅读/选择，禁用任何写 command。

## UC-2 `dispatchBoardCommand` — 把本地手势提交到 canonical model

```text
in:  { boardId, actorId, clientId, gestureId, expectedObjectRevision?, command }
out: { operationId, transactionId, acceptedObjectIds }
pre: actor 有写权限；command 引用合法 object id
err: BOARD_READ_ONLY | BOARD_OBJECT_NOT_FOUND | BOARD_COMMAND_INVALID
```

S01 的 `command` 只覆盖 selection 所需的几何变换与 stacking order；对象内容创建编辑由下一束
扩展同一判别联合。一次完整 pointer/keyboard gesture 最多提交一个 Yjs transaction；pointer move
过程不能连续写持久化更新。返回成功只表示 canonical transaction 已接纳，最终视觉仍由 UC-3 的
Yjs observer projection 驱动，不能直接把当前 Fabric 实例当成提交结果。

幂等键是 `(boardId, clientId, gestureId)`。同键同 payload 重放复用首次 operation，改变 payload
重用同键返回 `BOARD_COMMAND_INVALID`，避免断线重试产生第二次位移。

## UC-3 `projectBoardTransaction` — Yjs 事务增量投影到 Fabric 与 DOM mirror

```text
in:  { boardId, transactionId, origin, changedObjectIds, documentRevision }
out: { added, patched, removed, reordered, isolated, renderedRevision }
pre: transaction 已由 canonical Y.Doc observer 发布
err: BOARD_OBJECT_UNSUPPORTED | BOARD_PROJECTION_FAILED
```

每个 changed id 在 registry 中决定 `add/patch/remove/reorder`。应用 patch 前进入 projection guard，
结束后退出；guard 期间由 Fabric `set()`、坐标修正或 stacking order 引发的事件不得再次生成
command。guard 必须用可嵌套计数或等价机制，不能用异步时序下会提前复位的单一布尔值。

同一批 projection 在动画帧边界合并，并最多触发一次必要 render。局部失败进入 `isolated`，
返回的其他计数仍需准确；不得 `canvas.clear()` 后全量 `loadFromJSON()`。

## UC-4 `setBoardViewport` — 本地平移、缩放与适应视图

```text
in:  { clientId, mode: pan | zoom | fitSelection | fitBoard, value?, anchor?, selectionIds? }
out: { viewportTransform, zoom }
pre: 画布已挂载；zoom 限制为 0.05–8
err: BOARD_COMMAND_INVALID
```

viewport 只存在于该用户/设备的本地 UI 偏好层，不能进入 Y.Doc object map、公开 Board content
或 Fabric object world coordinates。`fitSelection` 无选择时禁用；`fitBoard` 零对象时恢复默认 viewport。
远端客户端不得因另一个人的 pan/zoom 改变自己的视图。

## UC-5 `selectBoardObject` — Fabric 与可访问镜像共用选择

```text
in:  { source: canvas | outline | keyboard, objectIds, focusIntent? }
out: { selectedObjectIds, primaryObjectId?, accessibleAnnouncement }
pre: 所有非 tombstoned id 在当前 projection 可寻址
err: BOARD_OBJECT_NOT_FOUND
```

Fabric selection、属性面板和 DOM mirror 读取同一 selection store，不各存一份业务 selection。
远端删除 primary object 时，从当前顺序选择合理的相邻对象或 Board 根并播报；不能把键盘焦点
留在已经不存在的 DOM 节点。

## UC-6 `rebuildFabricProjection` — Canvas context 恢复

```text
in:  { boardId, reason, lastRenderedRevision }
out: { rebuiltFromDocumentRevision, objectCount, isolatedObjectIds }
pre: canonical Y.Doc 仍可读
err: BOARD_DEPENDENCY_UNAVAILABLE | BOARD_PROJECTION_FAILED
```

恢复必须从 canonical Board/Yjs 文档重建全量 registry；只在 surface 首次挂载、context 丢失或
显式灾难恢复时允许全量重建。Fabric JSON、旧 canvas 实例或截图都不能作为恢复事实源。

## 对外契约位置与边界

- 既有 metadata/ACL HTTP 单源：`packages/contracts/src/whiteboard.ts`。
- S01 不给 `whiteboard.ts` 增加对象 CRUD；内容变更走 Yjs collaboration protocol。
- `BoardCommand`、object patch 与 transaction origin 的可执行 TypeScript 单源应随
  `whiteboard-core` 基础实现落地，并由 renderer、AI、importer、public API adapter 共同 import。
- Fabric class、`canvas.toJSON()`、`FabricObject` 引用或数组下标不得出现在公开 API、Yjs schema、
  checkpoint 或存储契约中。

签核第 ③ 件需要人类确认的核心不是新增 HTTP 路由，而是以上四层边界：metadata HTTP、
canonical collaboration command、renderer-only Fabric、local-only viewport。实现若需要新增外部
operation schema，必须先走 design delta，不得在 adapter 内发明。
