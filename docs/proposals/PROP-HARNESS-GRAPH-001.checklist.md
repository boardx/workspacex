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

## Issue #637 验收证据

- [x] 真实仓库编译：1,181 nodes / 1,554 edges。
- [x] 连续两次 snapshot SHA-256 一致。
- [x] Graph validation PASS。
- [x] 每个节点/边含 source path/pointer。
- [x] 未知类型、重复 ID、悬空边、非法端点、依赖环分别注入反证。
- [x] 缓存目录由 Git 排除。
- [x] 新增文件严格类型检查通过。
- [x] `./init.sh` 完整基线通过。
