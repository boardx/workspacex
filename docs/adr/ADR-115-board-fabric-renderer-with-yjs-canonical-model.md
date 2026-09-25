# ADR-115: Board Fabric renderer with Yjs canonical model

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-25
- 关联：ADR-100（`fabric-markdown` 引入与版本锁定）· Phase 19 Board Visual Workspace

## 背景

Board 当前可运行的交互预览用绝对定位的 React DOM 元素渲染节点、用 SVG 渲染连线，
再以 CSS transform 实现视口。这个表面可以验证基本对象操作，却不是用户要求的正式
视觉编辑器：它和 Chat/工作坊已有的 Fabric.js 图形使用两套对象、命中、变换与连线
模型，也无法承载面向无限画布的对象缓存、批量变换和稳定的图形导入。

Board 同时已经把多人协作语义放在 `whiteboard-core` 与 Yjs：对象身份、字段级变更、
事务、撤销与远端合并都必须在协作模型中成立。渲染器替换不能制造第二份事实源，
也不能用一次完整画布序列化覆盖另一位参与者的并发修改。

仓库已经按 ADR-100 锁定 Fabric.js 7.4，并有
`Markdown ⇄ Mermaid ⇄ DiagramModel ⇄ Fabric` 转换链。`DiagramModel` 适合把 Chat
或模板的图形导入 Board，但其语义和 Board 的长期协作对象模型不同。因此需要明确
渲染、协作、持久化、导入及无障碍各自的边界。

## 决策

### 1. Fabric.js 7.4 是 Board 主画布的视觉与命中投影

Board 正式编辑表面使用仓库锁定的 Fabric.js 7.4 渲染便签、文本、基本图形、图片、
Frame、连接线以及从 Chat 导入的图形。平移、缩放、选择、命中、移动、缩放、旋转和
层级投影都在同一个 Fabric canvas 中完成。React 继续负责应用外壳、工具栏、属性面板、
评论、投票、导入结果、会议室控制和错误反馈，不把这些产品 UI 塞进 canvas。

对象身份贯穿所有层且不另发 Fabric 专用 ID：

```text
whiteboard object id = Y.Map key = Fabric object metadata objectId
```

连接线端点、父子关系和跨模块引用均使用该身份，不用 Fabric 对象引用或数组下标充当
业务身份。

### 2. Yjs 与 `whiteboard-core` 是唯一权威事实源

对象内容、几何、样式、父子关系、连接端点、顺序和 tombstone 由 Board 领域模型定义，
经领域命令写入 Yjs。Fabric 事件不能直接成为持久化事实；移动、编辑和变换事件先转换
成字段粒度的 Board command，再由一个 Yjs transaction 提交。远端与本地结果都由同一
Yjs observer 投影回 Fabric。

Fabric `canvas.toJSON()`、Fabric class 名称和对象内部结构**不得**成为 Board 服务端或
文件存储格式，也不得用于协作更新、检查点或恢复的权威快照。持久化的是可版本化的
Board/Yjs 文档；Fabric JSON 只允许作为进程内调试材料或非权威的可丢弃缓存。ADR-100
所述 Diagram 编辑器的 Fabric 快照能力不扩展为 Board 的 canonical storage。

### 3. 采用按 ID 增量 projection，并明确抑制回声

Yjs observer 将一次事务归并为对象级 patch：新增对象 `add`，字段变化更新对应 Fabric
对象，删除对象 `remove`，顺序变化调整 stacking order。普通更新不得清空并重建整张
canvas；同一批 patch 只在帧边界合并触发必要的 render。

Fabric 交互适配器在应用远端 projection 时进入明确的 projection guard；该 guard 阻止
由 `set()`、坐标同步或重排触发的 Fabric 事件再次生成 command。用户输入生成的 command
携带 operation/transaction identity，供 adapter 合并连续手势并识别自身已确认更新。
抑制只阻止回声，不能跳过 Yjs 校验、权限或最终投影。

### 4. `DiagramModel` 只位于导入边界

Chat Mermaid、工作坊模板或其他 diagram 来源在用户执行“插入 Board”时，用
`DiagramModel`（或其版本化布局载荷）描述当刻可见的图形和布局。导入适配器将其一次性
转换为一组 Board create/connect commands，分配或映射 Board 身份，并通过 Yjs 原子写入。
导入结束后，这些对象只属于 Board/Yjs 模型；Board 的后续编辑不双写 DiagramModel，
也不以重新运行 Mermaid 自动布局来覆盖用户已经看到的坐标。

### 5. React 提供同步的无障碍镜像

Canvas 不是完整的可访问语义树。Board 必须保留与 Yjs selection 和对象身份同步的
React DOM 镜像，包括对象列表、Frame 大纲、可访问名称、选择状态及键盘操作入口。
镜像是另一种交互表面而非另一份数据：读取相同的领域 projection，操作仍发送相同的
Board commands。焦点从工具栏、DOM 镜像和 canvas 之间移动时必须保持唯一 selection。

### 6. 迁移采用可比较的双渲染门禁，最终移除 DOM/SVG 主表面

迁移期间允许用显式开发开关在旧 DOM/SVG 预览和 Fabric projection 间切换，以逐类验证
对象语义、导入结果、协作、撤销、无障碍与性能。开关不允许形成两套可独立写入的数据
模型；两边只能消费并操作同一个 `whiteboard-core`/Yjs 文档。Fabric 达到迁移验收后，
正式 Board 路由只加载 Fabric 主表面，旧渲染器删除而不是长期并存。

## 后果

### 正面

- Board 与 Chat/工作坊图形共享 Fabric 运行时和对象适配能力，图形可以按用户点击时看到
  的布局进入同一画布，不再退化成绝对定位 DOM 按钮。
- Yjs 的字段级并发、权限、撤销、恢复和对象身份不会被渲染器私有序列化绕开。
- 按 ID 增量 projection 避免每次协作更新重建画布，为大量对象、多人光标和会议室投影
  提供可度量的性能边界。
- React DOM 镜像让屏幕阅读器与纯键盘路径有真实语义，同时复用同一套 command 与权限。

### 负面与成本

- 需要维护 Board object 与 Fabric object 的双向 adapter、事件回声抑制和对象注册表；
  Fabric 升级时这层是明确的回归面。
- Fabric canvas 与无障碍 DOM 镜像必须持续同步，选择、焦点和对象顺序的双表面测试会
  增加实现及 CI 成本。
- Fabric.js 本身不保证大画布性能；对象缓存、视口裁剪、空间索引、连接线更新和 render
  批处理仍需单独实现并以真实对象规模验证。
- Fabric 的文字测量、浏览器字体和 GPU/浏览器差异会带来视觉回归，单元测试不能替代
  真实浏览器截图与交互测试。
- 迁移期存在两种 renderer，任何只在一侧通过的行为都不能算功能完成；这会暂时增加
  测试矩阵和排错成本。
- Fabric JSON 不可作为灾备捷径。恢复路径必须从版本化 Board/Yjs 文档重新 projection，
  adapter 出错时诊断会比直接反序列化 canvas 更费力。

## 备选方案

### 继续 DOM/SVG 渲染

否决。它可以继续支撑低保真预览，但会让 Board 与现有 Fabric 图形形成永久双栈，选择、
变换、连接线和 Chat 导入都要重复实现，无法满足本次明确的 Fabric 主渲染器要求。

### 把 Fabric JSON 作为 canonical model

否决。Fabric JSON 是渲染库的实现格式，整体快照不提供 Board 所需的字段级并发语义，
容易让一次保存覆盖其他参与者的更新，并把持久化兼容性绑定到 Fabric class/schema。

### 为 Fabric 重写 `whiteboard-core`

否决。协作、身份、命令、权限、撤销与 tombstone 是产品领域语义，不属于渲染器。
重写会丢失已建立的 Yjs 契约并产生一次高风险数据迁移；adapter 足以隔离两者。

### 改用 Konva 或 tldraw

否决于本阶段。两者都有成熟的画布能力，但仓库已锁定并拥有 Fabric 7.4 转换链，Chat、
Mermaid 和工作坊资产也已围绕 Fabric 建立。切换会同时引入新的对象模型、转换器和依赖
治理，且不能消除 Yjs canonical model 与无障碍镜像的需求。未来若真实性能或可维护性
证据证明 Fabric 无法达到验收目标，应以新 ADR 取代本决策，而不是在 adapter 内暗换。
