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
KG_EVIDENCE_REVOKED             晋升的结论有已失效证据（I-9）
KG_PROMOTE_BATCH_TOO_LARGE      一次晋升超过 50 条
KG_REINDEX_ALREADY_RUNNING      该会话已有整理任务在跑
KG_CARD_NOT_FOUND               确认卡不存在
KG_CARD_STALE                   确认卡上的条目在卡片生成后已被改动
KG_PROMPT_NOT_FOUND             矛盾提醒不存在或已处理
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
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_NOT_OWNER | KG_ACTOR_NOT_HUMAN | KG_REVISION_CHANGED | KG_CLAIM_NOT_FOUND | KG_OBJECT_NOT_FOUND | KG_CONTESTED_NEEDS_RESOLUTION | KG_PROMPT_NOT_FOUND`
- 九种动作的语义：
  - `confirmClaim`：proposed/reviewed → accepted，`reviewed_by` = 调用者；对 contested ⇒ `KG_CONTESTED_NEEDS_RESOLUTION`。
  - `reviseClaim`：新建一条 human 结论（accepted），旧结论 → superseded，`supersedes_claim_id` 连接；证据继承。
  - `confirmClaims`（U-2「全部确认」）：批量确认；只要有一条是冲突态，整批拒绝 `KG_CONTESTED_NEEDS_RESOLUTION`，不做部分确认。
  - `resolveConflict`（U-5）：`keep_new` 旧条 superseded、新条 accepted；`keep_both` 两条都 accepted，各记适用条件，结束冲突；`ignore` 保持 contested，I-19 生效。
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
- **err**（逐条 `rejected.code`）：`KG_EVIDENCE_REVOKED | KG_CONTESTED_NEEDS_RESOLUTION | KG_CLAIM_NOT_FOUND`
- U-3：未确认（proposed / reviewed）的条目可以晋升，同一事务里先以调用者身份转 accepted（I-9）。
- 语义：
  - L1 中没有同义结论 ⇒ 复制出一条新 L1 结论，并加 `derived_from` 边（I-8）；
  - 有同义结论且调用方未给出选择 ⇒ 返回 `needs_choice`；
  - `choices` 为 `merge` ⇒ 把新证据追加到已有 L1 结论；为 `coexist` ⇒ 两条都保留。

## UC-KG-6 AI 提名 `listPromotionNominations`
- **in**：`{ threadId }`
- **out**：`{ nominations[] }`（只提名 accepted 结论；不执行任何写入）
- **pre**：调用者是会话所有者，会话是个人线程。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_NOT_OWNER | KG_SCOPE_NOT_PERSONAL`

## UC-KG-11 一轮回答的记忆摘要 `getTurnMemory`（U-1 / U-4 / U-5）
- **in**：`{ threadId, messageId }`
- **out**：`KgTurnMemory`：本轮新记下的条目、是否还在整理、至多一张主动卡片（冲突优先，I-18）。
- **pre**：调用者对会话可见。非所有者也能看到「已记下」，但卡片上的操作按钮只对所有者渲染。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE`

## UC-KG-12 对确认卡做决定 `actOnMemoryCard`（U-4）
- **in**：`{ cardId, decision: accept|dismiss, claimIds?, editedStatement? }`
- **out**：`{ card, actionIds[] }`
- **pre**：调用者是会话所有者，且是人类会话（I-17）。
- **err**：`KG_CARD_NOT_FOUND | KG_CARD_STALE | KG_NOT_OWNER | KG_ACTOR_NOT_HUMAN | KG_CONTESTED_NEEDS_RESOLUTION`
- 语义：
  - remember 卡 accept：对 `claimId` 为空的条目，以调用者身份新建一条 human 结论（accepted）；再晋升到个人空间，等同 UC-KG-5。
  - forget 卡 accept：对选中条目逐条 `revokeClaim`。
  - dismiss：卡片关闭，不写本体。
- **待签核确认（F17 实现提出，人类签核时决定）**：
  - 已点「记住」的卡在 `getTurnMemory` 里按现在的事实读回：长期记忆里那一条后来不在了（撤销过 / 之后被忘掉），
    卡读作 `state = dismissed`，界面显示「好的，这条没有记在长期记忆里」。契约里 `dismissed` 的本意是「不用了」（用户点了不记），
    这里借它表达「现在没有记着」。备选：给 `KgMemoryCard.state` 加一个值（例如 `undone`），或维持 `done` 另加字段——都要改契约。
  - 「已记住 · 撤销」只在这次记住**新建**了会话里那一条和长期记忆里那一条、且长期记忆那条没有别的来源时出现
    （done 卡的 `claimId` 非空即可撤销）；用的是早就有的那条、或并进了长期记忆里早就有的那条时 `claimId` 为 null、不给撤销。

## UC-KG-7 读个人空间 `getPersonalKnowledge`
- **in**：`{}`
- **out**：本人 L1 的 `{ scope, revision, objects, claims, edges }`（孤立实体不下发，同 UC-KG-1）
- **pre**：已登录，且是当前组织成员。
- **err**：`KG_NOT_VISIBLE`（不是 / 已不是当前组织成员，HTTP 403）。没有内容不是错误，返回空。
- 消费方：`/brain`「我的长期记忆」（见 UC-KG-13）。

## UC-KG-13 大脑页概况 `getBrainOverview`（`/brain`）
- **in**：`{}`
- **out**：`{ threads[], personalOrigins[] }`
  - `threads`：调用者**本人创建**、且有活结论的会话，每个一行计数 `{ threadId, projectId, title, lastActivityAt, claims, pending, confirmed, conflict, objects }`，按最近活动倒序，至多 `KG_BRAIN_THREADS_LIMIT`（50）个；只有计数与标题，不带结论正文。
  - `personalOrigins`：本人 L1 每条结论经 `derived_from` 指回的 L0 原结论与其所在会话 `{ personalClaimId, sourceClaimId, threadId, projectId, threadTitle }`；一条 L1 合并过多个会话时有多行。
- **pre**：已登录。
- **err**：无。每个会话逐个经 `chat` 束 UC-0 可见性判定（与打开会话同一个判定），看不见的会话整行不出现、也不暴露标题；不是组织成员 ⇒ 两个数组都为空。上限作用在**判定之后**：看不见的会话不会把看得见的挤出这一页。
- 语义：只读聚合，不写任何东西。项目 / 组织两级本阶段不开放（I-1），`/brain` 上显示「尚未开放」，不调用任何接口。
- 来由：`/brain` 此前整屏是 `lib/mock/brain.ts` 的示例数字；2026-09-24 人类指令「取消所有的 mockup 的数据」，改为只读 UC-KG-7 + 本 UC 的真实数据。
- ⚠ **待人类签核时一并确认**：`design-signoff.md` §二.3 问「`getPersonalKnowledge` 保留还是删掉」——`/brain`「我的长期记忆」现在就在用它（本 UC 与 UC-KG-7 一起），删掉则大脑页失去长期记忆这一栏。本文件不改 `design-signoff.md`，请签核人在那里裁决。

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
- 图或向量一路不可用：`RetrievalChannelPlan.available = false`（D-KG-1 = A，人类 2026-09-24）。回答下方的一行说明由它驱动，文案见 06 R5。
- 图路径：`ContextItem.graphPath`，可选字段，由召回实际走过的边组成（D-KG-2 = A）。
- 两项都是对已签 `context-pack` 束的增量，见 `../context-pack-delta/`，随本束一起签。
- 召回范围里，「AI 记下的」条目也参与召回，并标「未确认」（06 R3 原则 1：价值不以确认为前提）。

## 待签核确认（F15 体验评测提出，2026-09-24，按人类「按你的建议决定」先行实现）

- **跨会话召回范围扩大到本人全部个人线程**：为让 06-UX E1「零负担跨会话被记起」不需要先点「记到长期记忆」，新个人会话现在也召回**本人其他个人线程**里的会话记忆（L0），不再只召回已晋升的 L1。依据：S0-2=A「个人空间 = 同一用户全部个人线程」、06-UX R2 M1 / R3-1。边界不变：项目会话不召回任何个人记忆（uc-18-4 R5），别的用户恒为零。影响：「晋升」从「跨会话的前提」变成「长期保存 + 在大脑页可见 + 出处稳定」。签核时请确认是否接受这一语义；若不接受，回退到仅 L1 跨会话。
- **E9「越权得 403」与不变量 I-3 冲突**：I-3（F09/F14 已落地并由 `e2e-zero-leak.test.ts` 门控）要求「看不见」与「不存在」同一个 404、同一个响应体，否则会泄露 id 的存在性。F15 保留 404，界面给出「这一条已经不在了，或你无权查看」（E9 界面侧 E9.c3 通过，E9.c2 保持红）。签核时请二选一：改 E9 措辞为「与不存在同一出口」，或接受 403（会泄露存在性）。
