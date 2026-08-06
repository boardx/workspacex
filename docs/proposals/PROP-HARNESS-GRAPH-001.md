# PROP-HARNESS-GRAPH-001 — Harness Graph Engineering

状态：执行中
Issue：#637
首阶段基线：`origin/main@48eb80c1131f255400182f413d9aa8bff0f40adb`

## 1. 决策

Harness 已经隐含了一张由 requirement、feature、contract、implementation、verification、evidence、PR、review、agent 组成的图，但关系分散在 JSON、Markdown、路径、issue 和专项脚本中。

本提案把这些权威模型**确定性编译**为统一 Graph IR，再由同一张图产生约束、语义差分、看板、Mermaid/UML 与 agent context。

第一阶段采用：

```text
Git 权威模型 → TypeScript Graph Compiler → 内存 Graph IR
                                      ├→ Validator / Findings
                                      ├→ JSON Cache（不入 Git）
                                      └→ 后续 Views / Semantic Diff
```

不引入 Neo4j、Apache AGE 或在线图服务。专用图数据库只有在真实路径查询或多进程共享性能数据证明必要后才评估。

## 2. 不变量

1. Git 保存事实，Graph Compiler 保存语义，缓存保存速度，CI artifact 保存历史证据。
2. Graph Snapshot 是派生物，禁止人工维护。
3. 所有可引用实体有稳定 ID；关系必须有类型，禁止新增无语义的通用 `refs[]`。
4. 相同权威源与 Git SHA 必须产生字节一致的 snapshot。
5. 每个节点和边必须回指 source path/pointer。
6. 约束失败必须给出稳定 finding ID、focus node、path、severity 和 message。
7. 作者继续写 Feature、Contract 等领域模型，不直接维护通用 nodes/edges。
8. 自然语言引用不得被猜成结构化实体；无法无歧义解析时保留为 ExternalReference。
9. 可视化只渲染回答具体问题的具名子图，不默认渲染全局毛线球。
10. 图内核必须替代重复脚本；不得成为再增加一套文档和数据库的理由。

## 3. 首阶段模型

节点类型：

- Project
- Phase
- Feature
- Verification
- ExternalReference

边类型：

- `contains`
- `depends_on`
- `verified_by`

稳定身份：

```text
urn:wsx:harness:project:<project>
urn:wsx:harness:phase:<phase-id>
urn:wsx:harness:feature:<phase-id>:<feature-id>
urn:wsx:harness:verification:<phase-id>:<feature-id>:<command-hash>
```

Edge ID 由 `(type, from, to, qualifier)` 的规范化内容确定性计算。

## 4. 存储边界

| 内容 | Git | 本地缓存 | CI Artifact |
|---|---:|---:|---:|
| 节点/边类型注册表 | 是 | 否 | 否 |
| snapshot schema | 是 | 否 | 否 |
| roadmap/feature 等权威模型 | 是 | 否 | 否 |
| Graph Snapshot | 否 | 是 | 是 |
| Findings | 否 | 是 | 是 |
| Semantic Diff | 否 | 可选 | 是 |
| 签核用 Mermaid/UML | 按需 | 是 | 是 |

默认缓存位置：

```text
.harness/state/.cache/graph/current.snapshot.json
.harness/state/.cache/graph/current.findings.json
```

## 5. 目标模型

后续逐步加入：Requirement、UseCase、ContractBundle、Operation、UISurface、Controller、Route、Rewrite、Evidence、Gate、Finding、Agent、Role、Task、Review、PR、Commit、Signoff 与 ADR。

目标追踪链：

```text
Requirement → Feature → UseCase/Operation → Implementation
Feature → Verification → Evidence
Feature → Issue → PR → Commit on main
Signoff → exact ContractBundle revision
Review → exact PR head SHA
```

## 6. 约束族

- HGC-IDENTITY：重复 ID、确定性身份。
- HGC-TYPE：未知节点/边类型、非法端点组合。
- HGC-REFERENCE：悬空边与不可解析引用。
- HGC-DEPENDENCY：依赖环与关键路径。
- HGC-TRACE：Requirement 到 Evidence 的可达性。
- HGC-PASSING：Evidence、Issue、PR、main commit 的完整完成链。
- HGC-SIGNOFF：签核绑定精确 bundle revision，修改自动失效。
- HGC-REVIEW：review verdict 绑定精确 SHA。
- HGC-AUTHORITY：同一属性只有一个 authoritative writer。
- HGC-DERIVATION：派生物具有来源与生成活动。

## 7. Agent 协作目标

Agent 之间传递 graph delta，而不是重复背景散文：

```yaml
graph_delta:
  added_edges: []
  removed_edges: []
  resolved_findings: []
  introduced_findings: []
next_frontier:
  node: FEATURE-466
  missing_edge: consumes
  target: OP-VOICE-STREAM
evidence: []
```

人类摘要由 renderer 从事件模型生成。

## 8. 具名视图

- VIEW-DELIVERY-001：最长串行链与下一前沿。
- VIEW-TRACE-001：需求到证据追踪链。
- VIEW-IMPACT-001：变更影响锥。
- VIEW-AUTHORITY-001：权威源与派生源冲突。
- VIEW-PROVENANCE-001：passing 结论来源链。
- VIEW-AGENT-001：Agent、Role、Task、Artifact、Review、Handoff。

## 9. 采用专用图数据库的门槛

只有满足至少一项才进入评估：

- 内存编译或查询超过已定义 CI 时间预算；
- 多进程必须持续共享图状态；
- 出现跨仓库长期在线图探索；
- SQLite/Postgres 递归查询有可复现性能瓶颈；
- 基准证明专用引擎有显著收益且不污染权威源边界。

## 10. 成功指标

- 权威实体进入图的覆盖率 ≥95%。
- 相同 revision snapshot 字节一致率 100%。
- 新增悬空结构化引用进入 main：0。
- Requirement 到 Evidence 完整路径比例持续上升。
- 被统一图约束替代的专项 lint 数量持续增加。
- Agent 状态消息自由散文比例降低 70%。
- 总体 PR flow time 不恶化并在三个周期内下降。
