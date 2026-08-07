# Harness Graph Model

本目录保存 Graph Kernel 的**模型定义**，不保存人工维护的图数据库或图快照。

## 第一阶段边界

- Git 中的 `roadmap.yaml` 与 `feature_list.json` 是权威源。
- `pnpm harness graph compile` 把权威源编译为确定性的 Graph Snapshot。
- 默认快照写入 `.harness/state/.cache/graph/`，该目录被 `.gitignore` 排除。
- CI 可按 Git SHA 保存 snapshot/findings artifact；不得把缓存反写为权威事实。
- 当前只使用 TypeScript 内存索引和 JSON 快照，不依赖 Neo4j、Apache AGE 或在线服务。

当前 `GraphSnapshot` 明确是 **Spec Graph**：描述仓库事实及其关系，不是工作流运行状态。后续不得把 `run status`、审批、预算、重试次数或 checkpoint 塞进该快照。

未来执行层按三图分离：

- Spec Graph：Git 事实的确定性派生图；
- Role Graph：慢变、可审计、运行时不可扩权的策略图；
- Work Graph：绑定 exact definition revision 的一次运行实例。

Work Graph 使用独立 schema/version，并以 append-only events + checkpoint 持久化。图数据库即使以后引入也只是查询投影，不成为规格、权限、签核或运行状态的唯一权威。

## 模型文件

- `registry/node-types.yaml`：允许出现的节点类型。
- `registry/edge-types.yaml`：允许出现的边类型和端点组合。
- `schemas/graph-snapshot.schema.json`：派生快照的交换格式。

任何新增类型都必须同时有稳定 ID 规则、来源、消费查询和反证测试。

任何新增执行节点还必须声明输入/输出 schema、工具和写权限、预算、超时、重试上限、幂等/补偿策略及现实证据要求。能用确定性代码完成的步骤不得升级为 agent 节点。
