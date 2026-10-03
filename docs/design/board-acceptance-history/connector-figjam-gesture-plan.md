> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector 手势集成方案

状态：设计草案，尚未签核；不代表实现、验收通过或入口恢复。本文仅规定 editor 的集成责任，不重复定义 canonical schema。

## 范围与前置

- 本轮覆盖四边拖出创建、实时路径预览和目标高亮、端点重接/解绑、路径手柄、持久化粗细、标签内容与位置、取消、权限/锁定及一次 undo/redo。path/label 不延期。
- 创建成功一次回到 Select，零距离点击不创建；Frame 入口仍隐藏。
- 前置回归：普通创建模式隐藏旧对象浮动工具栏与连接 handles，窄屏每个菜单选项中心可命中自身；editor root 不发生程序性滚动，内部 dock 可滚动。已有 R2 修复不等于新 Connector 验收。
- 验收用例及几何/像素证据以 `connector-figjam-acceptance.md` 为准；契约缺口以 `connector-figjam-contract-audit.md` 为准。issue、设计签核、files/canvas 联合接口确认前不写新业务功能。

## 必须签核的语义冲突

`03-structure-connectors.md` 的 R4/A1 允许空白释放取消或经明确 UI 新建对象后连接；新验收 C04/C21 提议有效非零拖动到空白持久化自由端点。两者不能由实现者默默择一。

提议决策：非零创建拖动在空白释放形成绑定源 + 自由终点；端点重接在空白释放解绑为绝对 world point；零距离点击、Esc、pointercancel/lost capture 不写。新建对象后连接不在本文隐式加入。该提议须设计材料明确采纳并同步旧 R4 语义后才生效。

modifier bypass 另列签核决策：A 为绝对自由端点、移除 attachment ID/offset；B 为保留 attachment ID 的局部 attached offset。两者跟随节点移动/旋转的结果不同，不能实现先选，也不能仅根据落点接近节点推断绑定。联合设计选定后才更新验收期望。

### 本轮实施选择

主协调已确认本轮实现采用 Cmd/Ctrl 避吸附为绝对自由端点，清 attachment ID/offset；这是基于官方参考与避免意外绑定的保守产品判断，不声明人类曾在 A/B 中另行选择。空白非零拖动允许自由起点/终点，零距离不创建。形状内部按最近四边 anchor 绑定，不引入局部 offset 编辑模式。本文不代改人类签核状态。

## 路由接口校对

以 `connector-figjam-contract-audit.md` 的候选规范和 files/canvas 联合接口为单源；这里不再声明字段类型或限制数值。当前拟议为 curve 使用相对各自端点的 world-axis offsets，elbow 使用有序 world waypoints，未设置时保留既有自动路由。两种坐标空间不能混用或从 Fabric bounds 反推持久数据。

- straight 只提供端点编辑；不声明中间弯曲 handle。两端均自由时允许整体平移，以一个事务平移两 free points；含 attached 端的整边拖动行为须设计明确，不隐式解绑或拖动节点。
- curve 的手柄移动通过联合转换生成端点相对向量；节点变换时引用联合路由求值，不能按整个基线旋转/伸缩猜测 controls。
- elbow 的引导点拖动生成 world waypoint；实际正交拐点是派生投影，不作为第二份存储点数组。端点移动和双自由端整体平移对 waypoints 的处理引用同一契约规则。
- label-drag 引用联合 label 位置编码/零长度规则；宽度引用 canonical world 单位。路径渲染、命中、label 和 bounds 必须使用 canvas owner 的同一求值结果。

## 接口与所有权

| 边界 | 责任 | 非责任 |
| --- | --- | --- |
| editor / 手势 helper | 唯一交互状态、Pointer Capture 生命周期、候选合法性、预览生命周期、一次提交、Select 复位和取消 | 不声明第二份 connector 字段或自行解析任意 SVG |
| Fabric / canvas owner | rendered path、四边和端点/路径/标签手柄坐标、命中与高亮、当前 viewport 转换、临时投影 | 不在 move 回调直接提交 canonical 命令 |
| contracts / files owner | path discriminant、控制点编码/上限、width 单位/默认值、label position、兼容/复制/删除规则 | 不把 renderer 私有数组当持久契约 |
| core command port | create/update 原子命令展开、有效关系和锁定验证、operation precondition/冲突、一次历史记录 | 不增加与现有 port 平行的 editor 写通道 |
| LiveBoard / provider | authoritative role/archive 状态、doc、ACK 和重连状态 | 不增加 connector 专用鉴权或写 API |

建议 editor 独占 `collaborative-thinking-editor.tsx`、新纯手势 helper 及集成 tests；canvas owner 独占 surface/projection/hit-test；契约 owner 独占 schema/core 扩展。精确回调类型等联合接口决定后引用，本文不固化一份竞争类型。

## 状态机

状态为 idle 或一个 active gesture。active 使用 discriminated kind：create、endpoint、route-handle、label、free-edge-translate；route-handle 仅针对已签核的 curve/elbow controls，不给 straight 加中间弯曲手柄。粗细属于属性提交，同样一个用户动作一个事务。共有临时信息为 pointerId、gestureId、稳定 connectorId（创建在开始分配）、canonicalBefore/关联 revision、按下位置、当前 world point、候选绑定及预览数据。pending 不进入 Y.Doc。

1. Down：仅 primary 合法写用户、非锁定源/边、非布局预览才进入；先判定 connector 手柄，再判定普通对象拖动。非 primary/既有手势保持 pan 优先；不能抢第二指针或覆盖进行中手势。
2. Capture：DOM handle capture 同一 pointer；保存初始关系与关联对象身份，不保存作为绑定事实的旧屏幕像素。
3. Move：由当前 host origin/viewport 将 client 转 world；候选以最新 canonical 对象及旋转后锚点重算，排除非法/锁定对象。只变本地临时预览/目标高亮，canonical/head 不变。snap 半径及 modifier 行为引用已签核规则，不从测试结果放宽。
4. Up：匹配 active pointer；重读当前 doc/role/锁定/对象存活，检查 operation precondition；合法有效变化只 dispatch 一次对应 create/update envelope。关系、geometry、path、label 更新属于同一命令事务。
5. Success：清 capture/候选/预览，创建成功清 creationTool 并回 Select；编辑既有 connector 保持原 id/另一端/未修改字段。
6. Cancel：Esc、pointercancel、lost capture、unmount、权限变只读/archive、相关对象删除/锁定立即清预览，不提交；忽略之后到达的旧 pointerup。

路径手柄/标签 move 的 world/local 换算和端点移动后的 route 重排必须使用契约 owner + canvas owner 确认的单源函数。远端对象 transform 时附着端重新计算；自由端/标签位置的相对或绝对语义严格按签核契约，不自行猜测。

## 事务与失败

- 一次 gestureId 对应一个 port dispatch；move 不产生历史项。path/label/style 不拆成多个互不关联 transaction。重复 up/capture release 不重复创建或提交。
- create-connector 已验证绑定目标锁定；当前 update-connector 只保证边本身未锁定，目标锁定语义须 core owner 对齐，editor 释放重验不是服务器验证的替代。
- 当前 executeSpatial 仅防 readOnly；新手势必须额外防 layoutPreview，并由 core/authoritative 权限维持最终拒绝。
- dispatch false/抛错：不宣告保存，不自动补写 geometry；清临时投影并显示可理解错误。重试先验证最新 canonical 状态，复用稳定操作身份遵循 port 去重契约，不盲目重放旧 snapshot。
- 本地接受但 ACK 未确认使用现有 sync 状态，不把预览消失或路径可见称为持久化成功。拒绝/冲突按现有 operation 回执处理，不添加第二套同步状态。
- remote transform 可更新预览；remote delete/lock/revocation 取消。对同边并发改 path/label 的冲突策略由联合契约明确，不能将旧整条关系覆盖最新另一端或标签。

## 事件竞争与可执行验证目标

以下为待实现测试清单，不是已运行证据；测试名称/命令待联合接口落定后写入实际验证清单。

| 层 | 事件序列 | 必须断言 |
| --- | --- | --- |
| 纯状态机 | down/move/move/up/up | move 零写，up 仅一次提交，重复 up 无新增 |
| 纯状态机 | down/move/Esc/up | canonical 和历史不变，capture/候选/预览全部清理 |
| 纯状态机 | pointercancel/lost capture/unmount 后迟到 up | 零提交，旧 pointer 不复活手势 |
| 集成 | 各四边 create、endpoint 附着 C/改 C 另一侧/空白解绑 | 准确身份/锚点、另一端保留、解绑字段互斥、单次 Select；语义签核前空白 case 标 blocked |
| 集成 | route-handle 或 label 拖动、粗细修改，各一次 undo/redo | 边 id 与未改字段保留，原子恢复/重做 path/style/label/geometry |
| 集成 | straight 端点编辑、双自由端整体平移 | 不出现中间弯曲 handle；两 free points 同 delta 且同事务；一次 undo/redo 精确恢复 |
| 集成 | modifier 在候选节点上释放 | 按已签核 A/B 验证绑定字段与节点移动/旋转结果；签核前 blocked，不先实现选择 |
| 集成 | down 后 source/target/edge 远端删除或锁定，权限转 viewer/archive | 清 preview，up 不接受非法写，API head 不推进 |
| 集成 | pointer A active 时 pointer B、右键/中键/Space pan、从 editable input Esc | 不混用 pointer，pan 不提交连接；输入 Esc 分层消费不误清其他编辑 |
| 集成 | down 后远端移动/resize/rotation、同边另一端/label 并发更新 | 按最新绑定重算；不得覆盖未修改字段；冲突受控报错 |
| 集成 | dispatch false/throw、延迟 ACK/拒绝、重试 | 不报已保存，不遗留临时路径，不重复 id，不产生半事务 |
| 真浏览器 | zoom/pan/390px，held-pointer screenshot，全部菜单 hit-test | 独立 world oracle、path ROI、canonical move 前不变，root 坐标不漂移 |
| 真浏览器 | 保存→API readback→reload，真实第二浏览器、viewer/commenter | path/width/label/bindings 持久，双端收敛；有效拒绝不能推进 head |

下一步只做联合接口/签核材料，不自动恢复 Connector 入口或开始新功能代码。
