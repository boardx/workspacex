# 契约束 `board-fabric-surface` — UC 覆盖证明（支撑材料）

> 需求单一事实源：`requirements/01-fabric-surface.md`。本表把 R12 与主/异常流程逐条映射到
> application operation 和稳定前端观察点；实现后的验证命令由对应 feature 固化。

## 一、R12 → operation → API 操作 / 门控命令 → 前端消费点

本束零对外 HTTP 面（见 `domain.md` 第四节）：这里的「API 操作 / 门控命令」列填的是六个
Yjs-transaction operation 各自的**可执行验证命令**，不是 REST endpoint。

| 行键 | 验收线索 | operation / 断言面 | API 操作 / 门控命令 | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| V1 | 真实浏览器中 sticky/shape/text 都是 Fabric objects，DOM 没有对应绝对定位交互节点 | `openBoardSurface` + renderer registry introspection + DOM 反向扫描 | `pnpm --filter web test board-fabric-v01` | `board-fabric-canvas`、`board-a11y-object-list` | 契约闭合；正式路由证据待实现 |
| V2 | 双浏览器中 viewport 是用户本地状态，对象世界坐标一致 | `setBoardViewport`；两客户端读取 canonical geometry hash | ⚠ 缺口：双浏览器 viewport 断言未建，规划为 `pnpm --filter web e2e vz-fabric-shots` 的扩展用例 | `board-zoom-value`、Fabric viewport transform | 契约闭合；双浏览器证据待实现 |
| V3 | 1000 次 Yjs patch 不触发 `canvas.clear()` | `projectBoardTransaction`；spy `clear/loadFromJSON/requestRenderAll` | ⚠ 缺口：1000-patch 性能反证未建，规划为 `pnpm --filter web test board-fabric-v01` 的新增 case | `board-fabric-stage` 的稳定 object registry | 契约闭合；性能证据待实现 |
| V4 | Canvas context 丢失后保留 Y.Doc 并重建 projection | `rebuildFabricProjection`；恢复前后 document update hash 相同 | ⚠ 缺口：context-lost 失败注入未建，规划为 `pnpm --filter web test board-fabric-v01` 的新增 case | `board-state-context-recovering` | 契约闭合；失败注入证据待实现 |
| V5 | readonly 不能经控点/快捷键/adapter 绕过写权限 | `dispatchBoardCommand` 三入口反证 | ⚠ 缺口：ACL 三入口反证未建，规划为 `pnpm --filter web test board-fabric-v01` 的新增 case | `board-state-ready` readonly variant、禁用 Fabric controls | 契约闭合；ACL 证据待实现 |
| V6 | 坏对象隔离，其他对象可继续编辑 | `projectBoardTransaction` 返回 `isolated` | ⚠ 缺口：未知 kind fixture 未建，规划为 `pnpm --filter web test board-fabric-v01` 的新增 case | `board-state-invalid` 的 object-level placeholder | 契约闭合；未知 kind fixture 待实现 |
| V7 | Canvas 与 DOM mirror 共享 object id/selection | `selectBoardObject` 双向调用 | `pnpm --filter web e2e vz-fabric-shots` | `board-a11y-object-<objectId>`、`board-selection-properties` | 契约闭合；键盘/读屏证据待实现 |

V4–V7 是 R4/R5/R6 与 `08-performance-accessibility.md` R3/R7 的必要验收投影；原 R12 只有两条
复合句，若不拆出这些失败与 accessibility 断言，S01 可以在 happy path “全绿”但仍违反需求。

## 二、主流程与异常流程覆盖

| requirement | 行为 | operation | 观察点 / 反证 |
|---|---|---|---|
| R3.1 | Fabric Canvas 从 Y.Doc 增量投影 | `openBoardSurface`、`projectBoardTransaction` | registry id 集合与 Y.Map key 集合相等 |
| R3.2 | pan、5%–800% zoom、fit selection/board | `setBoardViewport` | zoom controls + transform 数值 |
| R3.3 | viewport 不改世界坐标 | `setBoardViewport` | canonical geometry hash 不变 |
| R3.4 | Fabric event → command → Yjs → projection | `dispatchBoardCommand`、`projectBoardTransaction` | 一手势一事务、0 回声、0 整板重载 |
| R4 A1/A2 | empty 与无选择边界 | `openBoardSurface`、`setBoardViewport` | `board-state-empty`；fit selection disabled |
| R4 E1 | 单坏对象隔离 | `projectBoardTransaction` | 带 object id 占位；其余对象可操作 |
| R4 E2 | context lost 恢复 | `rebuildFabricProjection` | Y.Doc hash 不变，不读取 Fabric JSON |
| R4 E3/R5 | viewer/denied 权限 | `openBoardSurface`、`dispatchBoardCommand` | 未授权不加载；viewer 只读且可导航 |
| R6/R7 | object id 单源、Fabric JSON 禁入持久化 | 全 operation + static boundary scan | metadata/Yjs/storage/API 路径无 Fabric schema |
| R9 | resize/DPR/viewport 后清晰且命中正确 | surface lifecycle + browser visual/pointer test | 1x/2x DPR 和 resize 后同对象命中 |

## 三、operation → 需求（反向检查）

| operation | 被哪条需求要求 | 是否孤儿 |
|---|---|---|
| `openBoardSurface` | R2、R3.1、R4 A1/E1、R5 | 否 |
| `dispatchBoardCommand` | R3.4、R4 E3、R5、R7 | 否 |
| `projectBoardTransaction` | R3.1/R3.4、R4 E1/E2、R6/R7、R9 | 否 |
| `setBoardViewport` | R3.2/R3.3、R4 A2、R8/R9 | 否 |
| `selectBoardObject` | R3/R8 与 accessibility R3/R7 | 否 |
| `rebuildFabricProjection` | R4 E2、R9 | 否 |

六个 operation 都能追溯到需求，没有为未来功能预造的孤儿接口。

## 四、当前证据边界

- 已有：真实 Fabric.js 7.4 浏览器预览、基础对象创建/选择/变换/pan/zoom、DOM 对象列表、截图。
- 尚无：正式路由、Yjs adapter、1000 patch 反证、双浏览器 viewport、context lost、ACL、七态与完整 a11y。
- 因此本覆盖矩阵证明“设计有出口”，不证明 feature 已完成；`design-signoff.md` 与
  `design-coherence.md` 必须继续为 `pending`。
