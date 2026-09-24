# 契约束 `chat-knowledge-graph` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain`。形状见 `packages/contracts/src/chat-knowledge-graph.ts`（第 ③ 件），本文件写**语义与失败**。
> 束↔feature 映射的权威在 `design-signoff.md` 的 `covers:`。

## 统一约定

- 每个 UC：`in` / `out` / `pre` / `err`。`err` 穷举。
- 调用者身份来自 `CurrentPrincipal()`，不由入参传递。
- 可见性与所有者判定**委托 `chat` 束 UC-0**，本束不重复定义角色语义。
- 所有写动作都经 `ontology_actions` 执行器落表并写 `provenance_events`；审计不可写 ⇒ 整个动作失败（fail closed）。

## 统一失败枚举 `KgErrorCode`

```
KG_THREAD_NOT_FOUND             会话不存在
KG_NOT_VISIBLE                  调用者看不到该会话 / 结论
KG_NOT_OWNER                    可见但不是会话所有者（编辑、重整、晋升都只给所有者）
KG_ACTOR_NOT_HUMAN              Agent 身份尝试执行人的动作（I-15）
KG_REVISION_CHANGED             basedOnRevision 不是当前 revision（I-16）
KG_CLAIM_NOT_FOUND              结论不存在或已被取代
KG_OBJECT_NOT_FOUND             实体不存在
KG_CONTESTED_NEEDS_RESOLUTION   对冲突结论做确认 / 晋升，要求先解决冲突
KG_SCOPE_NOT_PERSONAL           会话不是个人线程，不能晋升到个人空间
KG_SCOPE_NOT_ENABLED            本阶段未开放的作用域（I-1）
KG_PROMOTE_REQUIRES_ACCEPTED    晋升的结论不是 accepted（I-9）
KG_EVIDENCE_REVOKED             晋升的结论有已失效证据（I-9）
KG_PROMOTE_BATCH_TOO_LARGE      一次晋升超过 50 条
KG_REINDEX_ALREADY_RUNNING      该会话已有整理任务在跑
```

---

## UC-KG-1 读本会话知识 `getThreadKnowledge`
- **in**：`{ threadId }`
- **out**：`{ scope, revision, objects[], claims[], edges[], ingestion, canEdit, canPromote }`。`superseded` 结论与孤立实体不下发。
- **pre**：调用者对会话可见。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE`
- 注：空会话返回空数组（界面空态），不是错误。

## UC-KG-2 读结论来源 `getClaimSources`
- **in**：`{ claimId }`
- **out**：`{ claim, evidence[], provenance[] }`。evidence 包含 contradicting 证据（I-6），失效证据带 `revoked: true`。
- **pre**：调用者对结论所在作用域可见。
- **err**：`KG_CLAIM_NOT_FOUND | KG_NOT_VISIBLE`

## UC-KG-3 人工编辑动作 `applyHumanAction`
- **in**：`{ threadId, basedOnRevision, action: KgHumanAction }`
- **out**：`{ revision, actionId }`
- **pre**：调用者是会话所有者，且是人类会话。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_NOT_OWNER | KG_ACTOR_NOT_HUMAN | KG_REVISION_CHANGED | KG_CLAIM_NOT_FOUND | KG_OBJECT_NOT_FOUND | KG_CONTESTED_NEEDS_RESOLUTION`
- 七种动作的语义：
  - `confirmClaim`：proposed/reviewed → accepted，`reviewed_by` = 调用者；对 contested ⇒ `KG_CONTESTED_NEEDS_RESOLUTION`。
  - `reviseClaim`：新建一条 human 结论（accepted），旧结论 → superseded，`supersedes_claim_id` 连接；证据继承。
  - `revokeClaim`：→ superseded + `revoked_at` + reason；行保留；反对证据保留。
  - `markContested`：两条结论 → contested，互挂 contradicting 关系。
  - `mergeObjects`：被合并实体的全部边改挂保留实体，别名合并；被合并实体标记 merged（不物理删）。
  - `splitObject`：新建实体，把指定结论的 `about` 边移过去。
  - `renameObject`：改名，旧名进别名。

## UC-KG-4 重新整理 `requestReindex`
- **in**：`{ threadId, sourceRefs? }`
- **out**：`{ queued }`
- **pre**：调用者是会话所有者。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_NOT_OWNER | KG_REINDEX_ALREADY_RUNNING`
- 语义：重跑抽取。幂等（I-7）：同一 pipeline 版本的重跑不会产生重复行。

## UC-KG-5 晋升到个人空间 `promoteToPersonal`
- **in**：`{ threadId, claimIds[1..50], choices? }`
- **out**：`{ results[] }`，逐条返回 `promoted | merged_into_existing | coexisting | needs_choice | rejected(code)`。**部分成功，不整批回滚。**
- **pre**：调用者是会话所有者、人类会话，且会话是个人线程（S0-2=A）。
- **err**（整批）：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_NOT_OWNER | KG_ACTOR_NOT_HUMAN | KG_SCOPE_NOT_PERSONAL | KG_PROMOTE_BATCH_TOO_LARGE`
- **err**（逐条 `rejected.code`）：`KG_PROMOTE_REQUIRES_ACCEPTED | KG_EVIDENCE_REVOKED | KG_CONTESTED_NEEDS_RESOLUTION | KG_CLAIM_NOT_FOUND`
- 语义：
  - L1 中没有同义结论 ⇒ 复制出一条新 L1 结论，并加 `derived_from` 边（I-8）；
  - 有同义结论且调用方未给出选择 ⇒ 返回 `needs_choice`；
  - `choices` 为 `merge` ⇒ 把新证据追加到已有 L1 结论；为 `coexist` ⇒ 两条都保留。

## UC-KG-6 AI 提名 `listPromotionNominations`
- **in**：`{ threadId }`
- **out**：`{ nominations[] }`（只提名 accepted 结论；不执行任何写入）
- **pre**：调用者是会话所有者，会话是个人线程。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_NOT_OWNER | KG_SCOPE_NOT_PERSONAL`

## UC-KG-7 读个人空间 `getPersonalKnowledge`
- **in**：`{}`
- **out**：本人 L1 的 `{ scope, revision, objects, claims, edges }`
- **pre**：已登录。
- **err**：无（没有内容时返回空）。

---

## 内部用例（无 HTTP 面，application 层端口）

## UC-KG-8 失效级联 `invalidateOntologyEdges`（实现 `files` 束出站端口）
- **in**：`{ artifactId, versionIds[1..] }`（`files` 束已签形状），另加 chat 侧 `{ messageIds[] | threadId }` 入口。
- **out**：`{ invalidatedEdgeIds[] }`
- 语义：执行 I-10；5 分钟 SLA 引用 uc-22-4，不另写数字。
- 失败：canonical 已提交即视为已失效（I-11）；AGE 与向量清理失败走 outbox 重试，不回滚。

## UC-KG-9 入图 `ingestSource`（抽取任务，系统身份）
- 触发：消息落库 / 附件 INDEXED / UC-KG-4。
- 失败：`model_unavailable`（重试 3 次）、`rejected_by_executor`（记原因）、`source_restricted`、`retries_exhausted`。这些进入 `KgIngestionSummary.failures`，不是 HTTP 错误码。

## UC-KG-10 召回（扩 `chat-context-engine` L3）
- 在 `ContextAssemblyPort` 内侧，给 L3 召回加 `graph` 与 `vector` 两路，产出仍是 `context-pack` 束的 `ContextPack`。
- 图或向量一路不可用时如何让用户看见：**待人类裁决 D-KG-1**（见 `design-signoff.md` 〇节）。原因是 `context-pack` 束已签，这个信号无论放在哪里都要改它。
