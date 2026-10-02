# 架构与身份

## 当前产品路径

[文档契约](../../../../packages/contracts/src/whiteboard-document.ts) 定义对象/命令；
[canonical document](../../../../packages/whiteboard-core/src/document.ts) 保存 Yjs objects/deletedObjects，读 alive 对象并验证。
[command port](../../../../packages/whiteboard-core/src/command-port.ts) 与 `operation-kernel.ts` 是命令边界。
`apps/web/components/whiteboard/collaborative-thinking-editor.tsx` 编排工具和编辑状态，
[projection adapter](../../../../apps/web/components/whiteboard/whiteboard-fabric-projection.ts) 的 `toBoardFabricObjects` 纯派生渲染输入，
[Fabric surface](../../../../apps/web/components/whiteboard/fabric/board-fabric-surface.tsx) 的 registry 按 canonical id 管理 Fabric 对象。
上述组件缩写均相对 `apps/web/components/whiteboard/`。

- `boardObjectId` 对应 canonical id；revision 是投影失效信号，不是服务端 sequence/文档版本。
- 未支持对象渲染 placeholder 且 locked，保留 canonical 内容；不要静默删除。
- Group/ActiveSelection 的 renderer ownership 不等于 canonical parentId。
- registry 增量更新，不在每个模型变化后 `canvas.clear()` 重建；否则破坏选择/图片加载/性能。
- canonical 投影批次与用户事件要隔离，避免更新导致 selection/transform 回写环。
- image onload、旧异步 transform acceptance、dispose 后回调要检查当前对象/生命周期。

## 读源码时的导航

检索 `registryRef`、`canonicalRef`、`withCanonicalProjectionBatch`、`applyCanonicalObject`、
`onObjectsTransform`；数据进入时读 adapter，pointer 中间态读 Surface，提交读 editor/core。
不通过 Fabric `toJSON()`/`loadFromJSON()` 绕开契约。

## 边界

`apps/web/components/whiteboard/fabric-preview/` 与 preview route 不是 LiveBoard 的完整持久化链。
`packages/fabric-markdown/` 是另一条 Mermaid IR 转换链，遵循其 VENDOR/旧 domain skill。
产品实时同步读 `apps/web/lib/whiteboard-provider.ts` 与 core collaboration，不能照抄旧 skill
「没有对象层 CRDT」的历史快照。

## 对应回归

`apps/web/tests/ui/board-fabric-projection-adapter.test.ts`、`board-fabric-projection-registry.test.ts`、
`board-fabric-event-command-bridge.test.ts` 和 `apps/web/tests/performance/`。
这里的短测试文件名相对 `apps/web/tests/ui/`；具体命令先核当前 test config。
