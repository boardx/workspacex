# Harness Graph Model

本目录保存 Graph Kernel 的**模型定义**，不保存人工维护的图数据库或图快照。

## 第一阶段边界

- Git 中的 `roadmap.yaml` 与 `feature_list.json` 是权威源。
- `pnpm harness graph compile` 把权威源编译为确定性的 Graph Snapshot。
- 默认快照写入 `.harness/state/.cache/graph/`，该目录被 `.gitignore` 排除。
- CI 可按 Git SHA 保存 snapshot/findings artifact；不得把缓存反写为权威事实。
- 当前只使用 TypeScript 内存索引和 JSON 快照，不依赖 Neo4j、Apache AGE 或在线服务。

## 模型文件

- `registry/node-types.yaml`：允许出现的节点类型。
- `registry/edge-types.yaml`：允许出现的边类型和端点组合。
- `schemas/graph-snapshot.schema.json`：派生快照的交换格式。

任何新增类型都必须同时有稳定 ID 规则、来源、消费查询和反证测试。
