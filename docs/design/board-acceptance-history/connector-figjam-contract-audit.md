> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector 契约与用例审计

审计日期：2026-10-01。本文是设计输入，不是 feature 权威、签核记录或完成证据。
遵循本阶段 AGENTS.md：Fabric 仅投影，Yjs/whiteboard-core 是对象事实源。
参考交互目标为 FigJam 风格的可发现连接点、吸附及简洁属性操作；本文没有声称已核验 FigJam 当前产品行为。

## 基础版：不增加持久化字段

契约单源是 `packages/contracts/src/whiteboard-document.ts`：

| 能力 | 现有契约/实现 | 基础版边界 |
| --- | --- | --- |
| 独立连线身份 | `WhiteboardObject.kind='connector'`、`WhiteboardConnector` | 不把边嵌入节点，不另造 Fabric 身份 |
| 绑定端点 | `from/to`、`fromAnchor/toAnchor` | 锚点为 top/right/bottom/left/center，目标必须是同文档存活对象 |
| 自由端点 | `fromPoint/toPoint` | 每端 attached id 与 freePoint 必须二选一 |
| 附着偏移 | `fromOffset/toOffset` | 已有本地像素偏移，随对象旋转；仅 attached 端可设置 |
| 路由类型 | `type=straight/elbow/curve` | 采用已有派生路由，不提供持久化手动折点 |
| 起止符号/线型 | `startStyle/endStyle`、`lineStyle` | 使用已有封闭枚举，不把任意 SVG/path 写入对象 |
| 颜色 | `WhiteboardStyle.stroke` | 沿用既有样式；不能声称粗细已有契约 |
| 标签 | `label`、`semanticRelation` | 沿用有界字符串，位置由投影派生 |
| 更新 | `WhiteboardCommand` 的 create/connector/style/delete | 复用现有命令批与响应；不增加专用连接 API |

schema 是 strict；点坐标有限且有界，label/semanticRelation 有长度限制。字段约束以源码为准，本文不再复制数值作为第二份权威。
因此基础创建、吸附、重新绑定、自由端、类型/符号/线型/颜色/label 编辑不需要数据库迁移或 schema 增量。
字段不变不代表免 UI/用例签核：新的可见交互仍需纳入对应契约束的三件签核材料。

## 用例与失败边界

| 用例 | 输入/操作 | 成功与失败验收 |
| --- | --- | --- |
| UC-C1 创建关系 | 从源连接点拖向目标；生成独立 create 命令 | 有效关系最多两次操作；取消不提交；重试不重复身份 |
| UC-C2 修改端点 | connector 命令更新整个关系值 | attached/free 互斥；非法或跨文档引用拒绝整批，不保存半条边 |
| UC-C3 修改表现 | connector/style 命令 | 标签/线型/箭头在第二浏览器与重载后一致；锁定对象拒绝改动 |
| UC-C4 移动节点 | geometry 命令，端点由 id/anchor/offset 重算 | 平移、缩放、旋转、多选、取消及远端移动都不写旧投影像素端点 |
| UC-C5 删除节点 | 明确选择 cascade 或 preserve-free | cascade 删除关联边；preserve-free 先解绑定端点再删节点，同一批原子执行 |
| UC-C6 复制与交换 | 现有 copy/clipboard/portable 流程 | 新对象 id 映射完整；offset/样式/label 保留；禁止副本仍指向原板身份 |
| UC-C7 多人和撤销 | 既有协作写与各自 Undo 入口 | 独立测试下述两种 Undo，不能以单浏览器成功代替协作证明 |

删除策略已有 `packages/whiteboard-core/src/spatial-relationships.ts` 的 selection 删除规划：
preserve-free 将 attached 端按对象 rotation、anchor、offset 转为 world freePoint 并清除该端 offset，再提交 delete。
直接底层 delete 的默认行为在 `packages/whiteboard-core/src/document.ts`：关联连线一起 tombstone；关联锁定边可阻止节点删除。
UI 必须明确当前动作的策略，不能静默改变底层默认，更不能让已删除节点留下 dangling endpoint。

## 持久化、权限与 Undo

- `document.ts` 验证引用完整性、parent 及 tombstone；命令在 candidate 文档验证后应用。公网不应开放任意二进制 Yjs 写来绕过 host-validated commands。
- `apps/api/src/infrastructure/whiteboard/pg-collaboration-store.ts` 在 tenant transaction 中锁定 Board，检查最新成员权限与 archive 状态，并持久化带 hash/bytes 的 snapshot/update。request identity 重放与 epoch 校验沿用现有规则。
- Owner/Editor 可写，Viewer/Commenter 不因拥有连接点而获得写权限；锁定不是 ACL。跨租户、同租户不可访问 Board、已撤销成员及 archive 写都要反证。
- 浏览器 `packages/whiteboard-core/src/undo.ts` 使用局部结构补偿，目标是不抹掉后来由其他编辑者添加的关系。需两个真实浏览器测试 concurrent move/rebind/delete、Undo/Redo 和重载。
- 公共 API `apps/api/src/application/whiteboard/operation-service.ts` 的 Undo 是另一契约：仅原操作用户可撤销，且当前 head 必须匹配原 receipt revision；后来存在其他提交时返回 stale，而不是承诺任意并发撤销。
- 公共操作的协作写、审计 receipt、Undo before reference 在同一 tenant transaction；不能把 HTTP 接收成功、pending ACK 或内存变化当成 durable 完成。

## 本轮扩展：待人类签核的最小契约增量

用户最新范围确认包含路径手柄、粗细、标签位置。这是范围授权，不等于 UI/用例/API 三件材料已签核。
以下为提交评审的候选，未修改业务 schema；路径数学模型与 canvas worker 协调后须收敛为 `packages/contracts/src/whiteboard-document.ts` 的单源和 whiteboard-core 的单一求值器。

候选均放在 `WhiteboardConnector`，不扩张所有对象的共享 style：

```ts
strokeWidth?: number; // finite world px, [1, 24]; absent renders existing 2
route?:
  | { kind: 'curve'; startOffset: { x: number; y: number }; endOffset: { x: number; y: number } }
  | { kind: 'elbow'; waypoints: Array<{ x: number; y: number }> };
labelPosition?: { t: number; normalOffset: number };
```

- 推荐 route 是按路由类型区分的有界数据，kind 必须匹配 connector.type；straight 不得携带 route，未指定 type 视为既有 straight 默认。缺省不写入对象，沿用当前自动路由。
- curve 保存两个相对端点的 world-axis 向量：C1=S+startOffset、C2=E+endOffset；S/E 为含 anchor/offset 的 world 端点。不使用 Fabric 包围盒坐标、viewport 或需要除基线长度的 normalized 坐标。
- elbow 保存 1..8 个有序 world 引导点；共享路由器按水平/垂直段连接引导点，不将它们当允许斜段的原始 polyline。起止方向依据端点边，歧义采用确定性 x-first，去掉重复/零长度段；生成实际拐点仅为派生值。
- offset 每分量有限且限制 [-1000000,1000000]；waypoint复用现有有界WhiteboardPoint，label normalOffset同范围。不接受未知字段、NaN/Infinity、无限数组或任意 SVG path。求值后的控制点与最终bounds仍须通过现有坐标上限校验。
- 重合端点的curve可由非零向量构成loop，无基线除零；所有零长度段从求值路径移除，完全零长度时label采用固定法线(0,1)，不得产生NaN。完全零长手动路径是否允许提交应在人类用例确认，不静默转成自动路由。
- labelPosition.t 为 [0,1] 的实际路径弧长比例，normalOffset 为有界 world px。标签点由共享路由器求值，法线取该处路径切线；折点使用出段、最后端用入段，零长度路径用固定法线。标签保持屏幕可读、不随路径旋转文字。缺省保留当前投影 bbox center，不能把旧文档无字段解释为新的弧长中点；第一次拖动才显式写入位置。新显式居中操作可写 {t:0.5,normalOffset:0}，不是旧unset的替代。
- strokeWidth 是 world 单位，zoom 只影响投影；路径、hit-test padding、箭头尺寸与 bounds 一起从同一 canonical route 求值。旧 absent 继续按当前 Fabric 的 2 渲染，不将默认值批量回写旧文档。

单端移动或旋转先重算S/E；curve只有该端所属控制点随之移动，向量保持world方向、不随对象旋转；elbow引导点保持world位置。
整条自由连线平移时一次性平移两个freePoint及elbow waypoints，curve向量不变；共同选中两个attached节点时，若两端获得相同translation，也在同batch平移该边waypoints一次，不能重复移动。非共同平移不自动移动world引导点。
反转方向交换curve的startOffset/endOffset，反转elbow waypoint顺序，交换start/endStyle，label映射t→1-t、normalOffset→-normalOffset；普通重绑保留参数；重置删除route。
preserve-free 删除节点后端点 world 位置不变，route/label参数仍保留；cascade 则与整条边一起 tombstone。

### 模型取舍（只推荐上面一份候选）

| 场景 | 推荐端点向量/world引导点 | 未采用baseline比例/法向模型 |
| --- | --- | --- |
| 单端移动 | curve所属控制点自然跟随；elbow手动路由不意外漂移 | 所有controls随基线旋转/伸缩，手动形状较难预测 |
| 零长/self-loop | 无除零，curve两向量可表达loop | baseline方向不唯一，需禁止近零或额外frame事实 |
| 节点旋转 | endpoint anchor跟随，手动world控制方向明确保持 | 端点距变动会旋转整套控制法向 |
| 整线平移 | 向量不变，world waypoints一次平移 | 参数不变即可平移，但仍需解决近零frame |

canvas与契约实现最终只导出一份computed path，供渲染、箭头切线、label弧长、bounds、hit-test共用；不在文档与前端分别维护互斥路径模型。
路径求值与精度设计见 `connector-figjam-geometry-plan.md`；elbow端点方向优先、歧义x-first是同一待人类签核候选，不是已获批准的业务规则。

旧文档仍合法，无数据库迁移优先。新字段以普通 connector 命令整体更新，先沿用现有同字段并发覆盖语义，不引入未签核的逐控制点合并协议。
拖动手柄仅本地预览，pointer-up 单批持久化，cancel 不提交；粗细/标签拖动各自形成一条可撤销操作。
copy、clipboard、portable、备份序列化必须保留参数；无位移备份往返不改坐标，仅在需要创建新身份时映射端点id。
带位移的duplicate/paste/import除映射id外，必须将freePoint及elbow waypoints按操作translation移动一次；curve相对向量保持不变。导入旧schema的降级必须显式报告，不能静默丢失新路径。
浏览器局部 Undo 对三字段逐值恢复并保留他人无关操作；公共 API Undo 仍保持严格版本保护，不扩张承诺。
新客户端产生字段后旧 strict schema 会拒绝，因此发布顺序必须 server validator/contracts 先于 web；所谓向后兼容只指新版本可读旧数据，不是假称旧版本可读新字段。

| 请求 | 当前缺口 | 待签决策与验证 |
| --- | --- | --- |
| 可调线宽 | `WhiteboardStyle` 没有 strokeWidth | 决定 connector 专用还是共享 style 字段、单位/上下限/缺省值；旧文档兼容、锁定、Undo、复制/交换全链覆盖 |
| 手动 path/waypoints | Connector 仅有路由类型，没有用户折点/控制点 | 明确 world/local 坐标、数组上限、移动端点后的规则及冲突粒度；只持久化结构化有界数据，不接任意执行性 SVG |
| 自定义 label 位置 | 有 label 字符串，无 label offset/沿线参数 | 明确沿路径比例还是局部偏移、旋转和路径变化语义、零长度边处理；第二浏览器/重载/Undo及导入降级测试 |

这些属于本轮候选设计，不在基础版中偷偷使用 extensionData 绕过契约审查。
新增字段、默认行为、错误码或并发 Undo 语义必须经对应束的 UI/用例/API design-delta 与人类签核；不预设需要 SQL 迁移，Yjs 字段兼容也要验证。

## Offset 修复证据与模型收敛

此前只读发现 `document.ts` 节点 geometry 重算遗漏 fromOffset/toOffset，与投影传入offset不同。
该问题已由 canvas worker 修复，主会话报告定向14文件160测试通过；此处不继续标为未核，不将这组测试当作新增路径字段或真实双浏览器验收。
2026-10-01 canvas worker确认本文唯一候选为 `route` 的curve端点向量/elbow world引导点；baseline模型仅是未采用的tradeoff。
本文是新增字段数值约束的单一 proposal 来源；其他设计材料引用本节，不复制另一份不同上限，签核后仍应以contracts schema为权威。

## 依赖与 Issue 来源状态

- 权威 `feature_list.json` 中 BV13 为「独立 Connector、锚点、路由与 label」，依赖 BV11；2026-10-01 只读快照为 not_started、无 sprint/owner。本文不修改或另建重复 feature。
- 需求来源是 `03-structure-connectors.md` R3/R4/R5/R12；粗细在需求中存在但当前 schema 未覆盖，最新范围已将其与路径手柄/标签位置纳入本轮待签增量，不再当延期P1，也不把已写需求当实现事实。
- `board-input-ux-round1-backlog.md` B04 已描述带偏移连接线的旋转、多选与取消一致性；offset bounds修复与该现有范围对齐，不另立重复功能。
- 2026-10-01 执行 `gh issue list --state all --search connector --limit 15 --json number,title,state,url`，实际失败为无法连接 api.github.com。未取得实时 issue/PR 状态，未确认 live 查重，未猜 issue 编号。
- 主协调者需恢复 GitHub 查询后关联既有 BV13/B04 issue，确认契约束签核与 UI 审查，再派实施；本文不改变 feature_list、design-signoff 或 passing 状态。

## 最小验证矩阵

基础版需已有 domain/routing 单测加附着 offset、非法端点、锁定边、两种删除策略及原子拒绝反证；
API 需 viewer/archive/撤权、合法另板引用拒绝、重复 request、持久化回读及公共 Undo stale 反证；
浏览器需两用户两会话真实拖动/吸附/改 label/重绑/删除/Undo与 reload。
同时核验复制、portable/import 与备份往返；不以截图、模拟事件或已有测试文件名代替命令真实执行证据。
