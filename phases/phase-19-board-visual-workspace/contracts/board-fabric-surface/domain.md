# 契约束 `board-fabric-surface` — 领域模型与不变量（支撑材料）

> 本束只定义 Board canonical model 与 Fabric projection 的边界。完整对象属性、连接语义、
> comments/presence、AI、导入与文件持久化由后续束扩展；这些扩展必须保持本束身份与 command 边界。

## 一、领域概念

### `BoardDocument`（canonical aggregate）

由 `whiteboard-core` 领域模型投影到一个 Y.Doc。至少持有：

- `boardId` 与单调可比较的 document revision/sequence；
- 以 `objectId` 为 key 的对象集合；
- tombstone/删除语义与 stacking order；
- transaction origin、operation identity 和 schema version。

Board 内容对象、几何、样式、父子关系、连接端点和顺序只在这里成为事实。PG 中的 Board row
是 metadata/ACL/version pointer，不是对象内容副本。

### `BoardObject`

概念字段为 `{ id, kind, revision, geometry, style, parentId?, orderKey, tombstone? }`。
S01 至少能投影 `sticky | text | rectangle | ellipse`，后续对象类型扩展同一判别联合。

`id` 是业务身份；`kind`/geometry/style 是 canonical 字段。Fabric class 名称、Fabric 实例引用、
canvas 数组下标、DOM id 都不是业务身份。

### `BoardGeometry`

世界坐标中的 `{ x, y, width, height, rotation }`。viewport 缩放和平移不写回 geometry。
手势中的瞬时坐标可以只在 Fabric 内存在；手势结束时归一化成一次 command。

### `FabricProjectionEntry`

进程内映射 `{ objectId, fabricObject, renderedRevision, adapterKind }`。它可丢弃、可重建，
不进入 Yjs、数据库、对象存储、checkpoint、公开 API 或导出文件。

Fabric 对象 metadata 只写 `boardObjectId`（及调试所需但不具权威性的 adapter 信息）；
它必须等于 Board object id 和 Y.Map key。

### `BoardViewport`

本地 UI 值对象 `{ clientId, transform, zoom, mode }`。可以作为用户偏好另存，但不属于 Board
document revision，也不能触发远端对象更新。

### `BoardSelection`

该客户端的交互状态 `{ objectIds, primaryObjectId?, source, focusTarget? }`。Fabric、属性面板与
DOM accessibility mirror 共享一个 selection store。协作 presence 可在后续束投影选择摘要，
但不能把 presence 当作对象内容。

### `ProjectionGuard`

renderer adapter 的进程内临界区，至少能表达嵌套的 projection depth 与当前 transaction origin。
它只抑制“Yjs patch → Fabric event → 相同 command”的回声；不能绕过 command validation、ACL、
Yjs transaction 或最终 projection。

### `ProjectionFault`

`{ boardId, objectId?, documentRevision, adapterKind?, reasonCode, recoverable }`。单对象 fault 生成
可识别占位并保留诊断定位；全 surface fault 触发从 Y.Doc 重建，不保存 Fabric JSON 作为恢复包。

## 二、不变量

| # | 不变量 | 可执行断言 |
|---|---|---|
| I-1 | Yjs/whiteboard-core 是对象内容、几何、样式、父子、连接、顺序和 tombstone 的唯一事实源 | 修改 Fabric 实例而不提交 command 后，下一次 projection 恢复 canonical 值 |
| I-2 | `Y.Map key == BoardObject.id == Fabric data.boardObjectId == DOM mirror key` | 对全量 registry 与 DOM 列表逐项比对；任一不等立即隔离 |
| I-3 | Fabric JSON 永不成为存储、协作、checkpoint、恢复或公开 API payload | 静态扫描 persistence/API/Yjs 路径不出现 `toJSON/loadFromJSON` 或 Fabric class schema |
| I-4 | 一次完整用户手势最多产生一个领域 operation/Yjs transaction | 采样 100 次拖动，pointer move 期间 0 个持久 transaction，结束后每次恰好 1 个 |
| I-5 | 本地与远端 canonical 更新都经同一个 Yjs observer 投影 | 本地 command 后删除直接 Fabric 写捷径，最终仍由对应 transaction 更新画面 |
| I-6 | projection guard 阻止回声，但不吞掉下一次真实用户 command | 应用远端 patch 产生 0 个新 command；随后一次用户移动产生恰好 1 个 |
| I-7 | 普通 transaction 只更新 changed ids，不能清空/重载全 canvas | 注入 1000 次 patch，`canvas.clear/loadFromJSON` 调用数均为 0，未变对象引用保持稳定 |
| I-8 | viewport 是本地状态，pan/zoom 不改变世界坐标或其他客户端视图 | 双浏览器一端连续导航，另一端 transform 与双方对象 geometry hash 均不变 |
| I-9 | viewer 不能通过 Fabric controls、快捷键或直接 command adapter 写入 | 三条入口均拒绝，Y.Doc update 数为 0；viewer 仍可 pan/zoom/阅读选择 |
| I-10 | 单对象 projection fault 不拖垮 Board | 注入一个未知 kind，仅该 id 变占位，其余对象仍可选择与修改 |
| I-11 | Fabric 与 DOM mirror 的 selection、顺序、可访问名称基于同一 canonical projection | 两个表面交替选择后 primary id 一致；远端删除后焦点迁移并播报 |
| I-12 | context 丢失只销毁 renderer projection，不销毁/覆盖 Y.Doc | 模拟 context lost，重建前后 canonical update hash 相同，重建对象 id 集合一致 |
| I-13 | 一次 transaction 的多个对象 patch 在帧边界合并 render | 事务含 N 个对象变化时 `requestRenderAll` 不超过一次（错误占位诊断除外） |
| I-14 | renderer 升级不改变 canonical schema | Fabric 版本变更回归中，同一 Yjs fixture 的领域 hash 不变，只有视觉 snapshot 可变化 |

## 三、状态迁移

### Surface lifecycle

```text
idle → loading-document → projecting → ready
                     └→ dependency-failed
ready → context-recovering → projecting → ready
ready → permission-revoked → readonly/denied
```

`ready` 只在 Yjs observer、Fabric registry 和 DOM mirror 都完成同一 document revision 后进入。
单对象 fault 不改变 surface 为 failed；它只改变该 entry 为 isolated placeholder。

### Gesture lifecycle

```text
idle → manipulating(ephemeral Fabric state) → commit-command
     → Yjs transaction accepted → observer projection → idle
```

拒绝 command 时从 canonical projection 恢复目标对象，不把被拒的瞬时位置留成看似已保存的状态。

## 四、边界与复用

- 复用 `packages/contracts/src/whiteboard.ts` 的 Board metadata、role 和 member 语义；本束不重列第二份 role enum。
- Mermaid/Chat 的 `DiagramModel` 只在导入边界转换成 create/connect commands；导入结束后不双写 DiagramModel。
- `packages/fabric-markdown` 的 Fabric snapshot 能力不扩展为 Board canonical storage；ADR-100 的坐标不写回
  Mermaid 与本束的 viewport/geometry 边界同时成立。
- React toolbar、property panel、comments、import report 和 meeting-room controls 不是 Fabric objects。
- S01 不决定内容 blob/file storage 物理实现，但禁止以 PG JSON 或 Fabric JSON 绕过后续文件存储契约。
