# PROP-HARNESS-GRAPH-001 执行清单

## Epic G1 — Graph IR

- [x] HGE-001 节点类型注册表
- [x] HGE-002 边类型与合法端点注册表
- [x] HGE-003 稳定节点 ID
- [x] HGE-004 确定性 Edge ID
- [x] HGE-005 GraphSnapshot schema 与稳定序列化
- [x] HGE-006 `graph_schema_version`

## Epic G2 — Compiler 与来源

- [x] HGE-010 Phase/Feature compiler
- [ ] HGE-011 Contract bundle compiler
- [ ] HGE-012 Verification/Evidence compiler（Verification 已完成，Evidence 待后续 source adapter）
- [ ] HGE-013 Git/Issue/PR compiler
- [ ] HGE-014 Agent/Role/Task compiler
- [ ] HGE-015 PROV-inspired provenance layer
- [ ] HGE-016 编译覆盖率报告

## Epic G3 — Constraint Engine

- [x] HGE-020 悬空边、重复 ID、未知类型门控
- [x] HGE-021 依赖环检测
- [ ] HGE-022 Requirement 到 Evidence 可达性
- [ ] HGE-023 passing 完整性 shape
- [ ] HGE-024 签核版本失效 shape
- [ ] HGE-025 review SHA shape
- [ ] HGE-026 单一事实源 shape
- [ ] HGE-027 派生物来源 shape
- [x] HGE-028 统一 validation finding 格式

## Epic G4 — Semantic Diff 与查询

- [ ] HGE-030 base/head graph diff
- [ ] HGE-031 impact cone query
- [ ] HGE-032 stale descendant query
- [ ] HGE-033 critical path query
- [ ] HGE-034 next frontier query
- [ ] HGE-035 orphan query
- [ ] HGE-036 source-health query

## Epic G5 — Views 与 Agent 协作

- [ ] HGE-040 Delivery DAG renderer
- [ ] HGE-041 Traceability renderer
- [ ] HGE-042 Impact renderer
- [ ] HGE-043 Authority renderer
- [ ] HGE-044 Provenance renderer
- [ ] HGE-045 Agent collaboration renderer
- [ ] HGE-046 TPL-EVT graph delta
- [ ] HGE-047 graph-derived context pack

## Epic G6 — 性能与迁移

- [x] HGE-050 确定性快照基准
- [ ] HGE-051 内容指纹与增量失效
- [ ] HGE-052 旧专项 lint 对照测试
- [ ] HGE-053 删除被图约束替代的扫描器
- [ ] HGE-054 图规模与查询性能仪表
- [ ] HGE-055 图数据库采用决策门

## Epic G7 — Work Graph Definition（先定义，不先上框架）

- [ ] HGE-060 单循环/工作图采用决策门与基线记录
- [ ] HGE-061 GraphDefinition schema：node/edge/state/policy refs
- [ ] HGE-062 ExecutionNode schema：kind、I/O、tools、budget、retry、idempotency
- [ ] HGE-063 Transition schema：predicate、fan-out/in、pause、retry、compensate
- [ ] HGE-064 Role Graph policy schema 与 protected transition
- [ ] HGE-065 Definition revision/hash 门控
- [ ] HGE-066 工作图静态分析：不可达节点、无终点环、无界重试、越权边
- [ ] HGE-067 向 HMV2 E1 Registry 提交运行时模板需求，不另建编号器

完成契约：Definition 完全由 Git review；运行时不得静默改图；破坏权限、预算、终止性和 revision 必须分别产生稳定 finding ID。

## Epic G8 — Durable Run State

- [ ] HGE-070 GraphRun / NodeRun / EdgeDecision / RunEvent schema
- [ ] HGE-071 append-only event store（先 SQLite/PostgreSQL，不上专用图数据库）
- [ ] HGE-072 checkpoint 与 deterministic replay
- [ ] HGE-073 pause/resume 与 human approval
- [ ] HGE-074 fork/time-travel 调试，保留 parent checkpoint
- [ ] HGE-075 pending writes：同一 super-step 成功分支不重跑
- [ ] HGE-076 副作用节点幂等键与 compensation gate
- [ ] HGE-077 crash/restart 恢复反证

完成契约：kill 任一节点后可从最后可信 checkpoint 恢复；已成功副作用不重复；旧 Definition revision 可重放。

## Epic G9 — Verification、Reality Anchors 与上下文隔离

- [ ] HGE-080 Producer/Verifier 独立上下文协议
- [ ] HGE-081 exact SHA/artifact hash verdict binding
- [ ] HGE-082 reality-anchor 分类与降级规则
- [ ] HGE-083 deterministic edge predicates 与 UNKNOWN fail-closed
- [ ] HGE-084 context selector：只传 artifact refs 和必要状态
- [ ] HGE-085 node tool allowlist 与最小权限 gate
- [ ] HGE-086 token/cost/time budget 计量与中止
- [ ] HGE-087 verifier 对抗反证：伪造产物、旧 SHA、空测试、失联数据源

完成契约：模型互相同意不能形成 PASS；所有完成结论都有现实锚点；生产者不能签发自己的最终 verdict。

## Epic G10 — 最小试点与 Go/No-Go

- [ ] HGE-090 选择一个高价值、可恢复的三到五节点 Harness 流程
- [ ] HGE-091 记录单循环质量/token/cost/latency 基线
- [ ] HGE-092 实现 Pipeline + Router + 独立 Verifier，不先引入编排框架
- [ ] HGE-093 注入节点崩溃、审批暂停、分支失败、数据源 UNKNOWN
- [ ] HGE-094 对比信息损失、恢复时间、重复 token 和误放行率
- [ ] HGE-095 人类 Go/No-Go：扩张、修订或回退单循环
- [ ] HGE-096 达到明确门槛后再评估 LangGraph/ADK 等运行时

推荐首个试点：`feature delivery` 的 claim → implement → deterministic verify → independent review → human merge。普通单 feature 编码仍由单 agent 有界循环完成，不为并行而并行。

## 执行顺序

```text
已完成 Spec Graph Kernel
  → G2/G3 补足追踪与约束
  → G7 定义 V/E/S/P 与 Role Policy
  → G8 最小持久化执行
  → G9 独立验证和现实锚点
  → G10 单一试点
  → 人类 Go/No-Go
  → 再决定是否引入框架或专用图数据库
```

禁止项：没有单循环基线就上多 agent；没有幂等/补偿就自动重试；没有 checkpoint 就长时执行；没有独立 verifier 就把模型 verdict 当门；没有 Go/No-Go 就批量迁移。

## Issue #637 验收证据

- [x] 真实仓库编译：1,181 nodes / 1,554 edges。
- [x] 连续两次 snapshot SHA-256 一致。
- [x] Graph validation PASS。
- [x] 每个节点/边含 source path/pointer。
- [x] 未知类型、重复 ID、悬空边、非法端点、依赖环分别注入反证。
- [x] 缓存目录由 Git 排除。
- [x] 新增文件严格类型检查通过。
- [x] `./init.sh` 完整基线通过。
