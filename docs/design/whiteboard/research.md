# 调研与证据边界

调研日期：2026-09-23。竞品资料来自官方页面；产品取舍是本设计的建议，不是竞品对 WorkspaceX 的承诺。

## 官方实践及采用方式

| 来源 | 可核实的实践 | 本方案采用方式 |
|---|---|---|
| [Miro Sticky notes](https://help.miro.com/hc/en-us/articles/360017572054-Sticky-notes) | 批量创建、表格粘贴、标签、多选调整和快速连线 | 便利贴优先，批量输入、组织与关系表达组成核心路径 |
| [Miro Voting](https://help.miro.com/hc/en-us/articles/360017572274-Voting) | 在板上发起投票与限定候选对象 | 工作坊必须有收敛决策步骤，额度与会话由服务端裁决 |
| [Miro Export](https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board) | 图片、PDF、CSV 导出，受权限/产品条件限制 | 同时提供视觉成果和结构化可携带数据，导出复用同一授权 |
| [Miro REST API](https://developers.miro.com/reference/overview) | 提供第三方集成 API | 迁移逐项核实对象覆盖，不承诺 API 可以无损读取全部 Miro 内容 |
| [Mural Sticky Notes](https://www.mural.co/use-case/sticky-notes) | 用便利贴组织想法，私密思考和匿名投票辅助工作坊 | 独立思考→公开分组→决策；私密区采用真实隔离 |
| [GoJS Learn](https://gojs.net/latest/learn) | 模型、视图、模板、节点/连线/组、工具和命令分离 | 借鉴扩展结构与制图交互，不以视觉库序列化格式定义业务对象 |
| [GoJS License](https://gojs.net/latest/license) | 有明确的软件授权协议 | 开放核心不默认依赖 GoJS；若后续采用，须按适用条款评估 |
| [Yjs Document Updates](https://docs.yjs.dev/api/document-updates) | 更新可交换、可结合、幂等；state vector 支持差量；合并更新不自动 GC | 断线差量重连、幂等恢复；持久确认与压缩自行设计 |
| [Yjs Awareness](https://docs.yjs.dev/getting-started/adding-awareness) | Presence 独立于持久文档 | 光标/视口临时化；不当作可信身份或业务状态 |
| [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager) | 可按来源选择性撤销 | 本地撤销隔离，再补协作者依赖保护 |
| [Yjs WebSocket provider](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) | 服务端分发 updates 和 awareness | 参考传输层，另补授权、校验、durable ACK 与故障恢复 |

官方文档未证明本方案的容量指标、服务可用性、迁移保真或 WorkspaceX 部署状态；这些须以实施测试为准。

## WorkspaceX 本地代码检查

本地基线：`badee49947562fe8844d98b0a436ddb40da5a326`。未成功刷新远端，不据此声称最新 main 或生产事实。

- [既有图形转换模型](../../../packages/fabric-markdown/src/model.ts)：已有可复用图形包，仍需在渲染探针核实适配效果。
- [便签修订实现](../../../apps/api/src/domain/canvas/sticky-lww.ts)：可见客户端时间戳驱动的修订选择与历史；不能据此声称对象级实时推送已经存在。
- [live-canvas](../../../apps/web/lib/live-canvas.ts)：实际为模板操作 REST 封装，不是 Yjs 同步 provider。
- [既有 board 契约](../../../packages/contracts/src/board.ts)：任务状态和看板语义，须避免白板命名冲突。
- [既有 AI canvas 契约](../../../packages/contracts/src/standard-canvas-tools.ts)：包含 read 和带 expectedRevision/idempotencyKey 的 replace-source，不能直接替代对象命令协议。
- [AI canvas 应用层](../../../apps/api/src/application/agent-run/standard-canvas-tools.ts)：现有集成落点，后续接入应复用权限与工具基础。
- [canvas 契约](../../../packages/contracts/src/canvas.ts)、[身份契约](../../../packages/contracts/src/identity.ts)、[项目契约](../../../packages/contracts/src/project.ts)、[资产治理契约](../../../packages/contracts/src/asset-governance.ts)：后续契约束设计需逐项对齐，本轮不修改。

本轮在 `apps`、`packages` 的 `.ts`、`.tsx`、`package.json` 范围搜索 `yjs|Y.Doc` 未命中；这只是该 checkout 和搜索范围内的结果，不排除其他分支、外部服务或未纳入目录的实现。模块 skill 的旧结论仅作为线索，以上源码检查才是本轮依据。

## 未取得的信息

补充检查 Chat → Board 接入点：

- [Chat Markdown 分流](../../../apps/web/components/chat/markdown-message.tsx)：Mermaid 与 canvas/persona 分别进入图表和模板渲染路径；usecase 当前仍留在 Markdown 分支，不能仅根据包内类型推断 Chat 已支持。
- [Chat 图表编辑器](../../../apps/web/components/chat/chat-diagram-canvas-modal.tsx)：明确区分 Mermaid 源内容与无法写回源的布局调整；Board 插入必须另存当前布局。
- [模型与 Fabric 转换](../../../packages/fabric-markdown/src/canvas-io.ts)：提供模型转换和视口适应逻辑；需要逐图型验证抽取、坐标及专用属性，不能直接声称插入桥接已实现。

目标组织真实 Miro 使用清单和样板、访客政策、并发规模、会议室硬件、开源授权决策尚未提供。本次未操作任何真实组织白板，也未复制其中的数据。需求中的试点与迁移验收用于填补这些缺口。
