# 契约束 `context-pack` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
已有原型（大脑「AI 读到了什么」屏）是 happy path 演示、零异常态，**别继承这个缺陷**。

---

## 统一失败枚举 `ContextPackReason`

前端据此渲染 R8 要求的七态（默认/加载/空/校验失败/依赖失败/无权限/成功）中的异常态。

| 码 | 触发 | 前端应显示 | 备注 |
|---|---|---|---|
| `EMPTY_CANDIDATE_SET` | E1 新项目无材料 | 真实空态 + 下一步建议 | ⚠ **不得生成伪上下文**；以该包发起的 AI 调用被阻断 |
| `RETRIEVAL_UNAVAILABLE` | E3/V6 检索依赖失败 | 依赖失败态 + 安全重试 | ⚠ **不得降级为「无上下文直接生成」**；保留上次成功装配并标「可能已过时」 |
| `BUDGET_EXCEEDS_MANUAL` | E2 预算装不下全部人工指定项 | 明确报错让用户取舍 | ⚠ **不静默丢弃人工指定项** |
| `PERMISSION_REVOKED_MIDWAY` | E4 装配中权限被撤 | 立即终止 + 前端清空 | ⚠ 不得残留越权内容在前端 |
| `EVIDENCE_WITHDRAWN_MIDWAY` | E5 使用期间上游证据被撤 | 上下文栏标「证据已撤回」 | 阻断以该证据为依据的**新定版** |
| `CITATION_OUT_OF_PACK` | V1 AI 引用了包外证据 | 拒绝并记录 | 引用完整性（I-6） |
| `CONFIDENTIAL_REQUIRES_LOCAL_MODEL` | V9/D-U1 含机密但无可用本地模型 | 阻断，云端整轮不可用 | **不是分流**（D-U1） |
| `MANUAL_ITEM_UNAUTHORIZED` | 手动增补越权 segment | 拒绝 | 不因「人工指定」绕过鉴权 |
| `RUN_NOT_FOUND` | 重放/固化/审计 runId 不存在 | 校验失败态 | |
| `PIN_REQUIRES_SNAPSHOT` | 固化目标非固定快照版本 | 校验失败态 | 依赖 `artifact` 束 F06 |
| `ANCHOR_MISSING` | 候选 segment 无任何锚点 | —（内部，落 omissions 或拒纳） | I-1：无锚点引用不合格 |

⚠ 拒绝响应**不得泄露资源是否存在**——`MANUAL_ITEM_UNAUTHORIZED` 与「segment 不存在」必须不可区分。

---

## 用例

### `AssembleContextPack` —— 装配（F09 + F10）

```
in:  { runId, orgId, projectId?: string|null, principalId, task,
       query, tokenBudget?, evidencePolicy, freshnessRequirement?,
       manualItemSegmentIds: string[] }        // A4 人工指定，不受阈值裁剪
out: ContextPack                                // 三段结构 items/claims/omissions
pre: · 调用者对目标项目/环节有访问权限（两层交集，identity 束）
     · projectId 为 null ⇒ 「不属于任何项目」范围，项目层为空、仅装组织层+个人层偏好（A1）
err: RETRIEVAL_UNAVAILABLE | BUDGET_EXCEEDS_MANUAL
   | PERMISSION_REVOKED_MIDWAY | CONFIDENTIAL_REQUIRES_LOCAL_MODEL
```

**装配流程（固定次序，五路并行召回是其中一步，不是五个用例）**：

1. **权限与租户过滤**——在 SQL/RLS 层，**不在应用层**（UC-0.3 R7；identity 束强制）。
2. **query 分类、时间范围识别、实体解析**（即「query-planned」：先判断这次查什么，再定各路权重，
   而**不是恒定走同一条路**）。
3. **五路并行召回**（缺任一路都会在某类查询上系统性漏召，`RetrievalChannel` 五取值）：
   - `fts` —— PostgreSQL 全文检索，**一等通道**：精确原话/编号/姓名/术语（图和向量都不擅长精确匹配）。
   - `vector` —— pgvector 语义近似，承接「换句话说」的同义召回。
   - `graph` —— `ontology_edges` 递归 CTE（**阶段一不启用 Apache AGE**）；**只给固定加成**，不单独决定结果。
   - `metadata` —— 项目/来源/时间/研究方法/受访者群体，支撑「上个月能源组做的访谈」这类过滤。
   - `claim` —— 已审核的洞察与决策（成对注入 + 组织大脑五态机）。
4. **RRF 或加权融合** → `retrievalPlan` 记录各路权重与命中数。
5. **cross-encoder / LLM rerank**。
6. **去重、来源多样性、支持/反驳平衡**（反对证据强制保留，I-12）。
7. 按 `tokenBudget` 压缩——超限按相关度截断，**被截断项进 `omissions[]`（reason=`budget`）**（O-36）。
8. 返回 `items[]`（含 `anchor` 引用锚点）+ `claims[]` + `omissions[]`（遗漏说明）。

> **为什么五路是一个用例而不是五个**：RRF 融合要求五路**同跑同融**，且 query-planner 要统一分配权重。
> 拆成五个用例会把融合与配额逻辑推给调用方，等于把本束最核心的职责漏出去。
> 五路的**可观测性**由 `items[].channels` 与 `retrievalPlan` 提供，不靠拆用例暴露。

**pgvector 召回率约束（V12，交付物门槛）**：近似索引（HNSW/IVF）在叠加权限/租户/项目过滤时，
典型行为是**先近似召回 top-k 再过滤**，过滤掉大半后返回不足，表现为「明明有这份材料 AI 却说没看到」
——**静默失败**，比报错更危险。对策：过滤列索引/分区/iterative scans + **带权限过滤的 recall 测试集**
（同一 query 在「无过滤」与「叠加权限过滤」下比较召回率）。该测试集**是本通道上线门槛，不可用「人工看着还行」代替**。

### `ReplayContextPack` —— 重放 / 审计还原（F13）

```
in:  { runId }
out: ContextPack                 // 同 runId ⇒ 同 items[]（I-5，纯函数断言）
pre: —
err: RUN_NOT_FOUND
```

任取一条已定版结论，用其 `runId` 还原「这条结论当时看了什么」（V8 审计态，对应 UC-17.1 AC1）。

### `ListOmissions` —— 丢弃清单可审查（F11）

```
in:  { runId, reasonFilter?: OmissionReason }
out: { omissions, droppedCount, thresholdUsed, tokenBudget,
       complianceAlwaysShown }       // 合规性丢弃**全量返回**，永不折叠
pre: —
err: RUN_NOT_FOUND
```

⚠ 无论 `reasonFilter` 或分页如何，`complianceAlwaysShown`（withdrawn/expired/unauthorized）
**必被完整返回**（I-4）。`thresholdUsed` 为本次相关度阈值（原型 0.45；按任务类型可配，O-36）。

### `GateAiCall` —— AI 调用前置闸门（F12）

```
in:  { runId }
out: { allowed, blockReason?: ContextPackReason }
pre: —
err: RUN_NOT_FOUND
```

空态（`EMPTY_CANDIDATE_SET`）、依赖失败（`RETRIEVAL_UNAVAILABLE`）、机密无本地模型
（`CONFIDENTIAL_REQUIRES_LOCAL_MODEL`）时 `allowed=false`，**阻断而非「无上下文直接生成」**（V5/V6）。

### `VerifyCitation` —— 引用完整性校验（F12）

```
in:  { runId, citedSegmentIds: string[] }
out: { allowed, offendingSegmentIds }        // 越界引用清单，空数组=全部在包内
pre: —
err: RUN_NOT_FOUND | CITATION_OUT_OF_PACK
```

AI 产出引用的每条证据都必须在本次 `items[]` 中，否则拒绝并记录（V1 / AC1 / I-6 /
context-engine 首批门槛 ①「100% 引用可定位」）。

### `PinContextPack` —— 随定版固化（F13）

```
in:  { runId, artifactVersionId }
out: { snapshotId, contentHash, frozenItemCount }
pre: artifactVersionId 是**固定快照**版本（artifact 束 F06）
err: RUN_NOT_FOUND | PIN_REQUIRES_SNAPSHOT
```

产出定版为固定快照时把本次 Pack 引用清单随快照固化，此后**上游变化不改写它**（I-7）。

### `ResolvePackModelConstraint` —— 机密材料本地模型路由（F13，跨束）

```
in:  { runId }
out: { localOnly, source: "promise"|"policy"|"none", reason, confidentialItemCount }
pre: —
err: RUN_NOT_FOUND
```

**D-U1（全程本地，不分流）**：本 Pack `items[]` 含**任何**机密条目 ⇒ `localOnly=true` ⇒
本轮**所有**模型调用走本地，云端整轮不可用。语义**委托 `identity.ResolveModelConstraint`**
（`source` 三取值与其一致），此处按本 Pack 的 items 机密性求值——**跨束**，一致性复核须确认判定一致。

### `AddManualItem` —— 手动增补（A4）

```
in:  { runId, segmentId, actorId }
out: ContextPack                          // 重新装配，人工指定项标「人工指定」、不受阈值裁剪
pre: actor 对该 segment 在可见性范围内
err: RUN_NOT_FOUND | BUDGET_EXCEEDS_MANUAL | MANUAL_ITEM_UNAUTHORIZED
```

### `AdjustRetrievalWeights` —— 调权重新装配（A3）

```
in:  { runId, weights: Record<RetrievalChannel, number> }
out: ContextPack                          // 新 packId，同 runId 沿革
pre: —
err: RUN_NOT_FOUND | RETRIEVAL_UNAVAILABLE
```

⚠ **每次调整留痕，不可静默生效**（R3 第 6 步）。

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `SegmentRetriever` | 五路召回（fts/vector/graph/metadata/claim）与 RRF 融合 | PostgreSQL FTS + pgvector + `ontology_edges` 递归 CTE + `claims` |
| `RerankPort` | cross-encoder / LLM rerank | 模型网关 |
| `PermissionGate` | 消费 `identity` 束的 `authorize`，把 `PermissionDecision` 传播到 item | 调用 identity（跨束） |
| `ContextPackStore` | Pack 持久化与按 runId 重放 | PostgreSQL `context_packs` |
| `SnapshotFreezer` | 固化引用清单到固定快照（不可变） | PostgreSQL + `artifact` 束 F06 |
| `ModelConstraintPort` | 机密路由判定 | 调用 `identity.ResolveModelConstraint`（跨束） |

⚠ `PermissionGate` **不能各查各的**：六条数据链路（原文/Segment/embedding/图节点/缓存/Context Pack）
必须共用 `identity` 的**同一个判定**（UC-0.3 R7）。这是 `coverage.md` 缺口 2 的实现要害。
