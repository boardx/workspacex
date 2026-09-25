# ADR-114: 启用 Apache AGE 作为组织大脑本体的图投影（与 pgvector 同库）

- 状态: Accepted（人类 2026-09-24 在 issue #4022 / PR #4023 会话中裁决 D1：「现在就上 AGE，pgvector 向量查询也现在加上」）
- 适用层：项目实现（专属）
- 日期: 2026-09-24
- 关联：`docs/proposals/PROP-ORG-BRAIN-KG-001.md`（§3.3 / §4）；取代 `.harness/instructions/architecture.md`
  「图投影」行与 `docs/architecture/context-engine.md` §六、§七中「阶段一不启用 AGE」的结论

## 背景

2026-07-28 定稿的 `context-engine.md` 以「部署兼容性与托管支持风险高」为由，决定阶段一不启用 AGE，
先用 `ontology_edges + recursive CTE`，「用真实性能数据决定是否启用」。截至 2026-09-24：

- 生产代码里图通道事实上是关闭的：没有任何写入方，也没有种子实体
  （`organization-hybrid-retrieval.ts` 抛 `hybrid_graph_seeds_unavailable`）。
  所以不存在可以用来「决定是否启用」的真实性能数据，这条等待条件本身不会自然满足。
- 人类决定从 chat session 起步，把向量与知识图谱**同时**做成最小闭环，再逐级扩到个人项目、项目、组织、平台。
  路径查询（k-hop 邻域、决策沿革、「谁决定的、被什么取代」）是这条路线的核心能力，不是远期优化项。

## 决策

1. **AGE 与 pgvector 同库启用**。canonical 仍是 PG 关系表（`ontology_objects` / `claims` / `ontology_edges` /
   `ontology_actions`，RLS 强制）；**AGE 图是可重建投影，不是事实源**。
2. **镜像**：自建 PG 镜像。基于当前的 `pgvector/pgvector:pg16`，编译安装与 PG16 兼容的 AGE release，tag 锁死；
   dev compose、deploy compose、CI 服务容器统一用它。升级 PG 大版本必须同时验证 AGE。
3. **租户隔离**：AGE 的图内部表不受我们的 RLS 策略覆盖，所以**每个 org 一张图**，图名由 org id 派生。
   此外，图查询**只返回 id**，内容一律回 canonical 表按 RLS 读取。权限判定永远在 PG RLS 这一处。
4. **投影同步**：canonical 写入与 PG outbox 在同一事务。worker 幂等 upsert 到 AGE。
   提供按 org 全量重建的脚本（`graph:rebuild`）。重建后 AGE 与 recursive CTE 的结果对拍，作为测试门。
5. **不可用即显式失败**：AGE 不可用时返回「图检索不可用」，并在 Context Pack `omissions` 里记一条。
   **不静默降级**为纯向量或 CTE。recursive CTE 只保留为测试基线。
6. **检索策略不变**：仍是 `context-engine.md` §四的 query-planned hybrid，图只给固定加分，不单独决定结果。
   本 ADR 只替换「图投影用什么实现」，不恢复 graph-first。

## 后果

- 正面：路径类查询有原生 openCypher 能力；chat session → 组织的外扩不需要再换图存储。
- 代价：
  - 要维护自建镜像。
  - 托管 PG 若不支持 AGE，该部署形态需要自建 PG。
  - 投影一致性要靠 outbox + 重建脚本 + 对拍测试三件事来保证。
- 需要同步修订的文档（本 ADR 所在 PR 一并完成）：
  - `.harness/instructions/architecture.md` 的「图投影」行
  - `context-engine.md` §六、§七
  - `uc-7-4` L214
  - `uc-14-6` L179
  - 并把 `knowledge-ontology.md` 标注为只服务平台大脑 / harness 元本体（PROP-ORG-BRAIN-KG-001 D3）

## 验证（KG-M1 的门，不在本 ADR PR 内）

- `migrate:check` 在 AGE 镜像上重放通过。
- `graph:rebuild` 之后，AGE 与 CTE 的 k-hop 结果一致。
- 跨 org 图查询拿不到对方的 id。
- 带权限过滤的向量召回率测试通过。
