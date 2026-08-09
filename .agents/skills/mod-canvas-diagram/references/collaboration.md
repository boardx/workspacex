# 协作 — 多人协作时 canvas 状态怎么同步

## 今天没有的东西：如实标注

调研范围内（`packages/fabric-markdown/src/`、`apps/api/src/{domain,application}/canvas/`、
`apps/web/lib/live-canvas.ts`、`apps/web/app/projects/[projectId]/canvas/`）**没有找到**：

- fabric 画布对象层面的实时多人同步（没有 WebSocket/CRDT/OT 机制把一个用户的
  拖拽/编辑实时广播给同屏的其他浏览器）；
- Yjs / socket.io / 其他常见实时协作库的引用（已 grep 确认无匹配）；
- 逐节点/逐边的操作转换（Operational Transform）或 CRDT 合并逻辑。

`apps/web/lib/live-canvas.ts` 这个文件名容易让人误以为是实时同步层，**实际是画布
模板注册表的前端薄封装**（模板的增删改查/绑定/发布/归档 REST 调用），"live" 指的
是"真实路由，非 mock"，不是"实时协作"。不要把这个文件当协作机制的入口去找。

## 今天真实存在的：服务端"并发写"层，粒度是"便签"，不是"整块画布"

真正处理多人并发编辑的是 `apps/api/src/domain/canvas/`，且**协作单位是单张便签
（sticky），不是整个画布对象图**：

- **`sticky-lww.ts`（F105）—— 便签级 Last-Write-Wins**：同一张便签的文本/颜色/
  位置/归属分区被并发改动时，按 `clientTs`（客户端改动发生的时刻，不是请求到达
  服务端的时刻）较晚者生效。较早的那次**不丢**——记成一条历史修订，
  `supersededRevisionId` 能查到被覆盖的是哪次（I-19）。**不弹冲突条**：这是刻意
  设计，只有"两侧同时改结构"才需要提示用户，便签级写从不因为它被挡（"待裁决期间
  此端口照常可用"，err 列表里故意没有 `CONFLICT_PENDING_ADJUDICATION`）。
  同一毫秒并发写时，新请求生效（不产生"随机选一个"的不确定性）。
- **`group-canvas-status.ts`（O-32）—— 组画布状态/完成度的轮询式态**：
  `GroupCanvasStatus`（"你在这组"/"只读"/"落后"/"进行中"）与完成度
  （`done`/`defined`/`missingRequiredSections`）是**读模型计算**，不是推送。
  "落后"当且仅当 `missingRequiredSections` 非空，**不与其他组横向比较**——
  函数签名里根本没有"其他组"这个参数。停滞判定（`isStalled`）用距上次编辑毫秒数
  超阈值（默认 5 分钟）判定，同样是轮询/请求时计算，不是服务端主动推送。
- **`conflict-resolution.ts`/`backflow.ts`/`change-classification.ts`** ——
  结构性冲突（相对于便签级 LWW 的"结构"变更，如分区增删）的分类与三方合并逻辑，
  存在但**范围内未深入逐行读取**（本轮调研聚焦 Fabric/Mermaid 转换链与身份/
  序列化，结构冲突合并的精确语义留给实际改动那块代码时再深入）。

## 对使用者的含义

如果要给 fabric 画布加"多人同时看到彼此的拖拽"，那是一个**全新的能力**，不是
在现有代码基础上补几行——现有的 `ConnectionManager`/`FlowNode`/`FlowEdge` 完全
是单会话本地状态；便签级 LWW 解决的是"服务端持久化层"的并发写冲突，不解决"画布
渲染层"的实时可见性。两者不要混为一谈。
