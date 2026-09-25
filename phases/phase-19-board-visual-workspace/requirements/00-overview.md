# Board Visual Workspace V0.1 — 十轮交付总纲

> 元数据：估点 **8**（与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。

> 原始输入完整保存在 [00-source-prd.md](./00-source-prd.md)。本文件把它收敛为十轮可验收边界；各领域文件给出稳定的 R 条目，供后续 `feature_list.json` 的 `spec_ref` 引用。

## R1 目标与九分门槛

- **Actor**：Board 编辑者、查看者、组织管理员、会议室参与者、AI Agent、API 客户端。
- **目标**：用户打开 Board 后无需学习即可像摆便利贴一样完成“想法 → 组织 → 连接 → 结构化 → 协作 → AI 处理”。
- **九分硬门**：十轮全部通过各自的真实浏览器/API/存储验收；任一 P0 行为缺失、主画布仍由 DOM/SVG 模拟、协作出现数据丢失、导入不可核对、10k 性能门未过、无障碍仅靠 Canvas、恢复演练未过，都不得宣称达到 9/10。

## R2 不可替代的架构边界

1. Board 的主视觉对象和直接操作表面由 **Fabric.js** 渲染；React 负责工具栏、属性面板、评论、导入报告和无障碍替代视图。
2. `whiteboard-core` 领域模型与 **Yjs/Y.Doc 是唯一协作事实源**；Fabric 是增量投影，不拥有业务事实。
3. 不把 `canvas.toJSON()` 或任何 Fabric JSON 作为持久化、协作或公开 API 格式。
4. Fabric 事件必须转换为领域 operation，再进入一次 Yjs transaction；AI、人类、导入器和 API 使用同一 operation 契约。
5. PostgreSQL 只保存 Board 元数据、ACL、索引、版本指针和审计引用；Board 内容快照、Yjs 更新段、导入原件及媒体 blob 存放文件/对象存储，并通过内容哈希校验。

## R3 十轮交付边界与优先级

| 轮次 | 优先级 | 可独立验收的交付边界 | 主要规格 |
|---|---|---|---|
| 1 | P0 | Fabric 主画布、无限平移缩放、viewport、选择框；删除 DOM/SVG 主渲染路径 | `01-fabric-surface.md` |
| 2 | P0 | Sticky/Text/Shape 创建、编辑、复制、删除和基础 Undo/Redo；连续便利贴与剪贴板 | `02-object-authoring.md`、`05-collaboration-history.md` |
| 3 | P0 | Panel、Frame、Group、层级、Connector 与连接点 | `03-structure-connectors.md` |
| 4 | P0 | 多选、对齐、分布、网格/行列、智能吸附、锁定与层级 | `04-selection-layout.md` |
| 5 | P0 | Yjs 多人协作、presence、评论、多人 Undo/Redo、tombstone、离线重连与恢复 | `05-collaboration-history.md` |
| 6 | P0 | Chat 中 Mermaid/Fabric 的点击时布局原样插入；AI 生成/聚类/排版走同一 operation | `06-ai-chat-handoff.md` |
| 7 | P0 | 开放 API、Miro/Mural 导入、标准导出、内容文件存储和 PG 元数据 | `07-interchange-storage.md` |
| 8 | P1 | 1k/5k/10k 性能、视口裁剪、触控、键盘和屏幕阅读器对象大纲 | `08-performance-accessibility.md` |
| 9 | P1 | 会议室/工作坊、50 客户端 soak、断网/崩溃/快照恢复和灾备演练 | `05-collaboration-history.md`、`08-performance-accessibility.md` |
| 10 | 9 分门禁 | 六条 PRD 旅程、三块真实迁移板、跨浏览器 E2E、API/存储/安全审计与回归收口 | 全部规格 |

依赖必须按轮次推进；可在同一轮内并行，但不得以 mock、单元测试或静态截图替代该轮声明的真实边界。

## R4 主流程

1. 用户进入全屏 Board，首屏加载 Fabric 表面和可访问的对象大纲。
2. 用户用双击、工具栏、拖放、快捷键或粘贴创建对象，并直接编辑。
3. 用户组织对象、连接关系、放入 Panel/Frame，或用布局命令重排。
4. 多名用户和 AI Agent 通过相同 operation 契约修改同一 Y.Doc，其他客户端增量投影到 Fabric。
5. 服务端把元数据写入 PG，把内容和媒体写入对象存储；刷新、离线重连和恢复后内容一致。
6. 用户通过 Chat、Miro/Mural 导入或开放 API 带入内容，并得到可核对报告。

## R5 异常与备选流程

- **A1**：不支持 WebGL/高对象量时仍使用 Fabric Canvas 兼容路径并明确性能降级，不能退回 DOM 对象主渲染器。
- **A2**：离线时操作进入加密本地队列；重连后按 operation id 幂等提交。
- **E1**：Fabric 对象构建失败时隔离单个坏对象并显示可恢复占位，不得清空整个 Board。
- **E2**：对象存储不可用时禁止假成功，保留本地未提交状态并提供重试/导出恢复包。
- **E3**：权限撤销后立即停止写入和 presence，清除未授权缓存；不得因重连恢复权限。
- **E4**：导入存在未知对象时保留原件、报告降级项并允许重试，不得静默丢弃。

## R6 权限与可见性

- Owner/Editor：仅在 ACL 范围内创建、修改、调用 AI、导入和导出。
- Commenter：可评论和 presence，不得修改 Board 对象。
- Viewer：只读查看、导航和使用无障碍大纲。
- AI Agent：使用受作用域约束的主体身份和同一 operation；不能绕过人类权限或审计。
- 未授权主体：API、WebSocket、blob URL、导入原件和 Board UI 均不可访问。

## R7 后置条件与不包含

- 每个可见对象都能追溯到稳定 Board object id、Yjs 状态和持久化内容哈希。
- 每轮必须保存命令输出、真实浏览器证据、性能报告或恢复报告，并由独立 reviewer 按 exact SHA 复核。
- V0.1 必须包含原 PRD 的 P1 对象和入口：Reaction、Link Preview、Web Tile、Table、独立 Icon、Template；Mini Map、Bulk Sticky、Comment、Tag、AI Organize 和 AI Generate 同样纳入十轮功能清单。
- V0.1 不包含原 PRD P2 的 Diagram、Mind Map、Kanban、Timeline、Presentation Mode，也不包含无限插件市场、任意脚本执行、三维画布和完整专业矢量设计器。

## R8 用户界面线索

- `/studio/board` 顶级入口打开全屏 Board；产品 UI 不显示“交互预览”或“改动未保存”的原型提示。
- 高频一级工具：Select、Hand、Sticky、Text、Tile、Panel、Shape、Arrow、Draw、Image；低频能力放入 More。
- 参考 Mural 的低摩擦直接操作，但对象身份、AI operation 和 WorkspaceX 上下文必须可观察。

## R9 非功能约束

- 目标浏览器：当前支持的 Chromium、WebKit、Firefox；鼠标、触控板、触摸和笔输入。
- 安全：blob 使用短时授权，日志严格字段白名单，导入内容按不可信输入处理。
- 数据：所有 mutation 幂等、可审计；任何失败不能造成已确认内容丢失或跨租户泄漏。

## R10 已知依赖

- Fabric.js 7.x、`@repo/fabric-markdown`、`whiteboard-core`、Yjs provider、Board API、对象存储和 PG 元数据层。
- Chat Mermaid/Fabric、组织身份/ACL、会议室模式、AI proposal 与 artifact 能力。

## R11 切分规则

- 每项 feature 必须能在一次开发会话内实现并验证；大对象类型或跨域链路拆为多个 feature。
- 十轮是产品验收顺序，不允许把未经验证的后续能力抵作前一轮完成。

## R12 完成证明

- 可由规格推导并必须留证：Fabric 主表面、对象创作、结构连接、布局、Yjs 协作、历史恢复、AI/Chat、导入导出、文件存储、10k 性能、无障碍、会议室与 50 客户端 soak。
- 六条体验阈值不可放宽：TTFI `< 5 秒`；第一张后连续创建 10 张 Sticky `< 30 秒`；20 张散乱 Sticky 整理为 Grid `≤ 2 次操作`；两个对象建立 Arrow `≤ 2 次操作`；截图进入 Board `1 次 Paste`；30 张 Sticky 完成 AI 主题聚类 `≤ 2 次操作`。真实浏览器脚本必须同时记录时间和用户动作数。
- 所有 mutation 必须映射到稳定 Board Event Model：`ObjectCreated`、`ObjectMoved`、`ObjectResized`、`ObjectUpdated`、`ObjectDeleted`、`ObjectsGrouped`、`ObjectsArranged`、`ConnectorCreated`、`PanelCreated`、`AIOrganized`，并能用于协作、Undo、Version、Audit、Agent 与 Replay。
- 第十轮评分使用同一份固定 rubric；只有全部 P0 和九分硬门通过，才可报告 9/10。
