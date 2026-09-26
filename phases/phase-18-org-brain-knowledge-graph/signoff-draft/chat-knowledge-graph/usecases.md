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

## UC-KG-14 撤销自动记进个人空间的决定 `undoAutoPersonalCopy`（issue #4283）
- **in**：`{ threadId, claimId }`（`claimId` = 会话里的原结论，即反馈条上那一条）
- **out**：`{ personalClaimId, outcome: revoked | detached }`
- **pre**：调用者对会话可见，且是人类会话（I-15）。只在**调用者本人**的个人空间里找。
- **err**：`KG_THREAD_NOT_FOUND | KG_NOT_VISIBLE | KG_CLAIM_NOT_FOUND | KG_ACTOR_NOT_HUMAN`
- 语义：只撤系统代记、仍是「AI 记下的」那一份。副本只有这一个来源 ⇒ 失效（`user_revoked`）；同一决定在别处也说过、
  合并在一起 ⇒ 只摘掉这一个来源（`detached`）。别人的 / 不存在 / 已确认过 / 已撤过 ⇒ 同一个 `KG_CLAIM_NOT_FOUND`。
- 反馈条（`getMessageExtraction.claims[].personalCopyClaimId` 非空）显示「已记入个人记忆」；点「撤销」先走本 UC，
  调用者是会话所有者时再走 UC-KG-3 `revokeClaim` 撤会话原结论（两份都撤）；作者不是会话所有者时只撤本人空间那份。

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

- **跨会话召回范围扩大到本人全部个人线程**：为让 06-UX E1「零负担跨会话被记起」不需要先点「记到长期记忆」，新个人会话现在也召回**本人其他个人线程**里的会话记忆（L0），不再只召回已晋升的 L1。依据：S0-2=A「个人空间 = 同一用户全部个人线程」、06-UX R2 M1 / R3-1。边界不变：项目会话不召回任何个人记忆（uc-18-4 R5；**L1 部分已被 issue #4284 的人类决定改写**，见文末「已决」，F15 跨会话 L0 仍只在本人个人对话里），别的用户恒为零。影响：「晋升」从「跨会话的前提」变成「长期保存 + 在大脑页可见 + 出处稳定」。签核时请确认是否接受这一语义；若不接受，回退到仅 L1 跨会话。
- **E9「越权得 403」与不变量 I-3 冲突**：I-3（F09/F14 已落地并由 `e2e-zero-leak.test.ts` 门控）要求「看不见」与「不存在」同一个 404、同一个响应体，否则会泄露 id 的存在性。F15 保留 404，界面给出「这一条已经不在了，或你无权查看」（E9 界面侧 E9.c3 通过，E9.c2 保持红）。签核时请二选一：改 E9 措辞为「与不存在同一出口」，或接受 403（会泄露存在性）。

## 待签核确认（issue #4181 提出，2026-09-25，ad-hoc，按人类「按你的建议决定」先行实现）

用户报告：一句像「我决定关注在 211 高校」这样的约束性决定，此前只有在后续问题恰好带关键词（「211」「高校」）时才会被 F08 召回；说「开始写报告吧」不会命中，等于决定在对话变长后失效，即使它理应一直生效。先行实现见 `domain/knowledge-graph/decision-claim.ts`（保守关键词启发式，风格同 `memory-intent.ts`）与 `fuseRecall` 的集成（`domain/knowledge-graph/recall.ts`）：本会话内被判定为「决定类」的活结论，不管字面 / 图路打分，都额外强制带上（上限 3 条）。三点需要人确认：

1. **决定类是否占用现有 `KG_RECALL_LIMIT`（8）这个预算，还是额外增加名额**：先行实现按「额外增加」做（`DECISION_RECALL_LIMIT = 3`，独立于 `KG_RECALL_LIMIT` 之外），理由同 issue 原文——决定类结论通常很短，额外 3 条对上下文长度的影响有限。若签核时改成占用同一预算，改法是把强制命中的决定类并入排序前先占位，再让剩下的名额留给字面 / 图路，是`recall.ts` 里 `decisionForced` 那段的局部改动，不影响 `decision-claim.ts` 本身。
2. **关键词表的具体范围**：见 `domain/knowledge-graph/decision-claim.ts` 的 `DECISION_VERBS`（决定 / 选定 / 聚焦 / 确定 / 改为 / 改成 / 定为 / 敲定 / 拍板）与文件头注释逐条钉住的排除规则（问句 / 假设句 / 转述 / 否定 / 过短）。宁可漏不可误，跟 F17 的哲学一致——错判的代价是一条结论从此每一轮都占着强制召回位，直到人工发现修掉，比漏判一次贵得多。签核时如果要收窄或放宽这份词表，改这一个文件即可，不影响召回集成的其余部分。
3. **是否需要一个「撤销这条决定」的手动入口**：本轮没有实现新入口——F17 已有的「忘掉卡」按内容字面匹配（`forgetMatches`，见 `memory-intent.ts`），对决定类结论同样生效（它读的是同一份候选集，不区分是不是决定类），所以「说错了 / 想撤销」可以直接说「忘掉：我决定关注 211 高校」走现有流程，这不是一个真正的缺口。如果签核认为决定类结论需要一个比忘掉卡更轻的专门入口（比如召回材料里直接带一个「不再提醒」的操作），那是本轮之外的新增面，需要单独立项。
4. **范围扩到本人个人空间（issue #4278，2026-09-26，#4271 第 3 轮真实浏览器验收发现）**：「我决定关注 211 高校」晋升到个人空间后，新会话里说「开始写报告吧」不会带上它。先行实现把强制召回的范围从「本会话」扩到「本会话 + 发起人本人个人空间（L1，`scope = personal`）」：两者**共用** `DECISION_RECALL_LIMIT = 3`，按最新证据时间取，已被打分选中的不重复；来源照实标（材料里「来自个人空间知识」、turn memory 里 `scope = personal`）。**可见面不扩大**：个人空间候选与 F12 L1 召回同一条查询、同一套判定（`scope_id` = 发起人本人、只在发起人自己的个人线程里、RLS 只放本人），别人的个人空间恒为零（`decision-recall-personal-space.test.ts` 门控）；项目会话仍不带任何个人记忆（**已被 issue #4284 的人类决定改写**，见文末「已决」）。**仍不含**本人其他个人对话里未晋升的决定（F15 跨会话，`originThreadId` 有值）——它们只走正常打分。签核时请确认：(a) 是否接受 L1 决定强制召回；(b) 未晋升的跨会话决定是否也应强制（若是，放宽 `recall.ts` 的 `forcedDecisionScope` 一处即可）；(c) **个人空间的决定目前不会跟着用户进入项目会话**：强制召回的个人空间候选沿用 F12 的 L1 条件（只在发起人自己的个人线程里取，`pg-knowledge-recall.ts` 的 `inPersonalThread`，项目会话 `project_id` 非空即不取），所以用户在自己的项目会话里说「开始写报告吧」，晋升过的「我决定关注 211 高校」**不会**被带上（真实浏览器现状见 `evidence/phase-18/r05/`）——这是 L1 条件原样复用的结果，不是本轮另做的决定。**是否应该带进项目会话，请人来定**（若要带，需一并裁决：回答贴在项目会话里会被其他成员读到、并被抽取进该会话的 L0，这正是 F12 当初只放个人线程的理由）。
   **→ 已决（人类 2026-09-26，协调者当面收到的答复）**：① **带进项目会话，仅本人可见**——个人记忆也用于项目会话中本人的回答，不向项目其他成员展示（issue #4284，第 7 轮实现，见文末「已决：个人记忆也用于项目会话里本人的回答」：「回答被抽取进项目会话 L0」的直接路径已在应用层关掉，「回答正文对成员可见」（含由此而来的两条间接路径）是唯一记下的已知取舍；项目会话里说的决定不自动进个人空间）；② **决定类结论自动进入本人个人空间**（可撤销），跨会话不再以手动晋升为前提（issue #4283，第 7 轮实现，见下一节）。
5. **跨会话改口（issue #4290，第 8 轮）**：同一个人在会话 A 说「我决定关注 211 高校」、之后在会话 B 说「改成关注 985 吧」，此前两条决定都活着、都被强制召回——会话 C 的模型同时拿到互相矛盾的两条（F16 只认同一组实体的数值改口，211 → 985 换了对象不出冲突卡）。
   **→ 已决（人类 2026-09-26，协调者当面收到的答复）**：① **只有明确改口才算取代**：新决定带改口信号（改成 / 换成 / 改为 / 不再 / 「不…了」/ 算了……），且与**本人**一条仍生效的旧决定主题相同，才判为取代；并列的补充（「也关注 985」）两条都保留；不同作者之间从不取代（仍走 F16）。② **自动生效，给可撤销提示**（**已被下一条「高把握自动、低把握弹卡」收窄**：只对高把握的两档自动）：旧决定转 `superseded`（`revocation_reason = decision_changed`，新决定写 `supersedes_claim_id`），从此不再召回；会话里该轮回答下显示一行「已用〈新〉取代〈旧〉 · 撤销」，撤销（`applyHumanAction{undoSupersede}`）后旧决定恢复为生效、新决定仍在，同一条新决定之后不会再被自动取代。
   **→ 再决（人类 2026-09-26，issue #4290 评论）：高把握自动、低把握弹卡。** 三轮独立评审找到的误取代几乎都出在低把握的 `frame_only` 档（只有框架动词相同），所以：
   - **高把握 ⇒ 自动取代、可撤销**（上面 ② 的行为与提示行不变）：`explicit`——新句点名旧对象（「把 Vue 换成 React」「不再用 Vue 了」）；`same_kind`——两边带同一个类别词（「211 高校」→「985 高校」）。
   - **低把握（`frame_only`）⇒ 从不自动**：会话里该轮回答下弹一张卡「用〈新〉取代〈旧〉？」，复用 F16 的冲突卡（同一张表 `kg_conflict_prompts`、同一个出口 `applyHumanAction{resolveConflict}`、同一个卡片组件），用 `KgConflictPrompt.kind = possible_change` 区分：**[取代]** = F16 `keep_new`（旧决定转 `superseded`，连同本人由它晋升出去的个人空间副本；新决定转「你确认过」——它若已被 #4283 自动记进个人空间，那一份一并转「你确认过」，不再晋升出第二份）；**[两条都保留]** = `keep_both`，**不问适用条件**，只关卡。**卡开着时两条都照常生效、都召回**：与 F16 不同，开卡**不把两条转 `contested`**——`contested` 在召回里标成「有矛盾」、还会挡住 #4283 的自动记入与 F11 的晋升，而本决定要求「选之前两条都活着」。隐私同 F16 与 R8：只比同一作者；个人空间的旧决定只在所有者本人的个人线程里比；卡的可见性跟随两条结论（RLS），别人读不到、点不动，与卡不存在是同一个 404。
   - **自动只给干净的整句（第 8 轮第四次评审，按本条「误自动取代是唯一不许出现的结果，多一张卡很便宜」收紧）**：自动 = 改口分句 + 其余分句只能是整句空话（好的 / 嗯 / 那就这样 / 定了……小的封闭表）、说同一个新对象的另一个改口、「因为 / 由于 / 毕竟」开头的原因分句（话题分句与「决定用 React，不再用 Vue 了」里同框架说出的那个新选择也算一致）+ 明说旧对象（`explicit`）或**对齐的**同类（`same_kind`：共同类别词前面两边都只是短限定语——去掉类别词后 ≤4 个字符或单个 ASCII 词、不含框架 / 动作动词，「211 / 985 高校」算，「React 做前端开发 / Rust 做后端开发」不算）。其余一律是卡或什么都没有：认不出的后续分句（「这是老板说的」「被老板否决了」「暂定」「不过要看预算」）、别的分句提到旧对象（「211 高校继续关注」「因为 211 高校太远」）、没对齐的同类 ⇒ **卡**；明确收回——后面跟一句评判（「我反对」「不可行」「不赞成」「没同意」「没意义」「不太合适」……）、自我更正（「不对 / 哦不，还是 211」）、「开玩笑的 / 说着玩的」、「把 Vue 换成 React 的事…」这种被谈论的话题 ⇒ **不取代、也不弹卡**。
   - **原因分句、附加问句、复合的旧决定（第 8 轮第五次评审，同一原则再收紧）**：① 原因分句——「因为 / 由于 / 毕竟」三个一样先剥掉再判：剥掉后是一句评判（「毕竟我反对」「由于老板不同意」）⇒ **不取代、也不弹卡**；原因的内容带否定或不确定的字 / 词（不 / 没 / 否 / 未 / 非 / 还没 / 假设 / 暂 / 可能 / 也许 / 先 / 反对……：「由于我不同意这个改动」「由于还没最终确定」「由于是假设」「毕竟不急」）⇒ **卡**；只有不带这些的原因（「因为离家近」「毕竟生态好」）还能自动。② 附加问句——「对吧 / 是吧 / 是不是 / 对不对 / 好吗 / 行吗……」是在问 ⇒ **不取代、也不弹卡**；「行吧 / 好吧 / 好的吧」是勉强的应允 ⇒ **卡**；单独的「对 / 是 / 行」不再算空话（「是的」因此也是卡）。③ 复合的旧决定——旧决定有不止一个带框架动词的分句（「后端用 Go 语言，前端用 TS 语言」），或并列主语（和 / 与 / 及 / 跟 / 都 / 、：「前端和后端都用 Vue 框架」）⇒ **永远不自动，最多弹卡**（自动会把整条连同后端的 Go 一起取代掉）；改口带主语时，主语必须出现在旧框架**自己那个分句的框架动词前面**，只在旧决定别处出现 ⇒ 卡，旧决定里根本没有 ⇒ 什么都不做（「把 X 换成…」的主语就是点名的旧对象，由整段相等核对）。
   - **自动这一档只认白名单（第 8 轮第六次评审，取代上面两条里的词表）**：六轮评审每轮都在自动路上的词表里找到一个漏掉的词，所以自动不再靠词表。一对**自动**取代当且仅当同时满足：① **旧决定是单一分句**——按新句同样的规则分句，除整句空话外只有一个分句（「用 Vue 框架，周五上线」「关注 211 高校，学计算机」「前端用 Vue 框架，后端也一样」都是复合的 ⇒ 卡）；② **新句只有改口分句 + 封闭的整句空话**（好 / 嗯 / 哦 / ok / 想了想 / 这样 / 这么定 / 定）——**原因分句不再能自动**，不管原因说什么（「改成关注 985 高校，因为离家近」**从自动改为卡**，这是有意的），原因本身是一句评判（「毕竟我反对」）仍是什么都不做；话题分句（「前端那块，…」）、同框架的陈述（「决定用 React，不再用 Vue 了」）也不是空话 ⇒ 卡；「211 高校算了，改成关注 985 高校」的「算了」属于改口句式本身，仍自动；③ **新对象干净**——细则见下一条（第七次评审起取代这里原来的「不超过 6 个汉字的名词」）；④ 档位是 `explicit` 或对齐的 `same_kind`。其余一律是**卡**，或者（已有的收回 / 问句 / 附加问句 / 转述 / 自我更正 / 玩笑 / 「…的事」）**什么都没有**。
   - **改口分句必须结束在新对象上，新对象的结构跟着旧对象走（第 8 轮第七次评审，结构规则）**：归一会去掉全部空白，「把 Vue 换成 React maybe」曾被读成一个 ASCII 词「reactmaybe」；汉字新对象曾接受任何没列出的尾巴（「把上海换成北京如何」）。现在：a. **结束在新对象上**——在**没去空白的原文**上看，带新对象的改口分句（去掉汉字与 ASCII 交界处的排版空白后）必须是「… + 新对象 + 至多一个句末语气词（吧 / 了 / 啊 / 呀 / 哦 / 嘛；「呢」是在问）」，新对象后面还有任何东西 ⇒ 卡；改口分句里有省略号 / 破折号 / 连字符（「React……」「React-maybe」）、原文里有以连接词结尾的分句（「把 Vue 换成 React 但是」「…，所以」）⇒ 卡。b. **ASCII 新对象是原文里真正的单个词**——不带空白、字母或数字开头、只含字母 / 数字 / . / #、不以「.」结尾、「+」只在字母后的词尾（c++），后面只许跟旧对象的类别词；本身就是没定或泛指的词（maybe / tbd / todo / pending / later / none / all / other / x……）⇒ 卡，这是唯一的 ASCII 小词表，只能把自动降成卡。c. **汉字新对象（explicit）**：2–4 个汉字，且要么以旧对象的类别词结尾、限定语与旧的同一类型，要么新旧对象**都正好 2 个汉字**（「把北京换成上海」仍自动；「北京如何 / 北京候补 / 北京就行」⇒ 卡）。d. **same_kind**：两边限定语同一类型——都是单个 ASCII 词（211 / 985 / C9），或都是等长的、不超过 3 个汉字的汉字限定语（北京 / 上海）；「更多 / 985 等 / 某些」对「211」⇒ 卡。汉字限定语 / 对象里的虚字、泛指字、没定下来的字（的 / 等 / 某 / 更 / 如 / 何 / 待 / 定 / 所 / 其……）同样只把自动降成卡。same_kind 没有点名旧对象，另有一组旧决定在任何一档也匹配 ⇒ 什么都不做。收回 / 问句 / 转述 / 自我更正 / 玩笑 / 「…的事」 / 「非 X」这些既有的「什么都没有」不变。
   - 同一轮评审的三处句式修正对**所有档**生效（所以不会有垃圾卡）：新对象在谓语 / 否定标记处结束，改口后面跟着对它自己的否定评判（「改成用 React 是不可能的 / 不现实 / 没必要」「改成用 React 的提议被否了」「改成用 React，我觉得不行」）⇒ 整句不算改口；句中**任何位置**的问号（「改成用 React？不行，还是用 Vue」）⇒ 不算；逗号前的话题（「关于周会，…」「单元测试那块，…」「周报，…」「有人提议，…」）带进后面的改口分句当主语，照「主语必须出现在旧决定里」的规则判。
   实现：判定是纯函数 `domain/knowledge-graph/decision-supersede.ts`（改口信号 + 框架动词 / 对象 / 类别词三档主题匹配，文件头逐条钉住；拿不准——多条旧决定同样匹配、类别词不同、问句 / 假设 / 否定的改口——一律不取代），候选与落表在迁移 `20260926140000_kg_i4290_decision_supersede.sql`（接在 F16 之后、同一个抽取任务里；候选范围同 F16：本会话 + 个人线程里所有者本人的个人空间）。契约：`KgTurnMemory.supersede`（`KgSupersedeNotice`）与 `KgHumanAction.undoSupersede`。证据：`evidence/phase-18/r08/`。
   **与 #4283 的衔接**：取代不替用户把新决定记进个人空间——新决定进不进个人空间由 #4283（决定自动进入本人个人空间，只限个人线程）负责；同一个抽取任务里顺序是 判矛盾 → 判取代 → 自动复制。r08 的测试与 e2e 写于 #4283 合入之前，仍在会话 B 手动「记到长期记忆」；手动晋升一条已被自动记下的决定是合并（转「你确认过的」），不改变取代的结论。
   **谁能撤销**：项目会话里只有会话创建者能撤销取代（与 F16 冲突卡的处理权限同一条规则：人的动作要求会话所有者）；个人线程里就是所有者本人。
   **改口句式的边界**（独立评审第 8 轮及复评，分句规则，不是词表）：新决定按标点与连接词（但 / 不过 / 然后……）切成分句，**只有改口标记直接支配同一分句里的框架动词或对象**才是改口分句——「改成 / 换成 / 改为 / 转为 + 框架动词或对象」「改用 / 换用 + 对象」「把旧换成 / 改成…」「不再 + 框架动词 + 旧」「不 + 框架动词 + 旧 + 了」「旧 + 算了」（后接改口分句或句末）；新框架只从改口分句本身读，唯一例外是「算了，还是 + 框架动词 + 对象」这一个窄口子。所以「决定关注 985 高校，不用多想了」「前端框架还是用 React，部署改成周五」「周会改成周五，重点关注招聘」都不取代：否定分句只点名「多想」，它不是旧决定的对象；改口词改的是另一个分句里的别的事（改口分句有主语时，旧决定原文必须包含这个主语）。新旧对象相等或互相包含（重说 / 重申：React 对 React 做前端）从不取代；点名旧对象按整段相等比较，ASCII 天然按词边界（Go ≠ Google）。判定细则以 `decision-supersede.ts` 文件头为准。

## 已决（人类决定，2026-09-26，issue #4283）：本人说出的决定自动记进本人个人空间，可撤销

- **决定**：抽取出一条决定类结论（`decisionLike()`，`domain/knowledge-graph/decision-claim.ts`，唯一词表），且它的**全部**支持证据
  都是同一个人类作者本人在本会话里发的消息 ⇒ 系统在**这个作者自己的**个人空间里建一份副本（与 F11 晋升同构：`derived_from` 连回原结论、
  证据原样挂上、实体在 L1 解析、同一句话归一后相同 ⇒ 合并不重复、逐条部分成功）。副本三态仍是「AI 记下的」（proposed），不冒充
  「你确认过的」；原结论状态不变。非决定类照旧要手动晋升（UC-KG-5）。反馈条显示「已记入个人记忆」，可一键撤销（UC-KG-14）。
- **只限个人线程**（#4291 评审，与 F11 手动晋升的 `KG_SCOPE_NOT_PERSONAL` 同一边界）：项目会话里说的决定**不**自动进任何人的个人空间。
  理由：项目会话的决定属于那个项目；复制进个人空间后，#4284 会把它带进本人在**别的**项目会话里的回答，给不在原项目的成员看到。
  需要时仍可在个人会话里再说一次。门控：`decision-auto-personal-copy.test.ts`「项目会话里的决定不自动进任何人的个人空间」。
- **绝不替别人记**：你的话不会进别人的个人空间，别人的话也不会进你的——写进谁的空间只由证据消息的作者决定，
  由数据库判（迁移 `20260926131000_kg_i4283_auto_personal_decision.sql`），调用方给不出也改不了；模型 / agent 消息、转写原文、
  可见范围更窄的消息、带附件证据的结论、冲突态结论一律不复制。
- **不变量例外（仅此一条，迁移头注同文）**：
  - **I-9**：原要求「非 accepted 的 L0 产生 L1 副本前，同一事务里先以晋升人身份转 accepted」。本决定下没有晋升人、副本也要保持
    「AI 记下的」，所以「作者本人的话 → 作者本人空间」这一条放宽为：L0 与 L1 都保持 proposed，L1 `created_by = model`、`reviewed_by` 为空。
  - **I-14（写侧）**：系统身份写入某人的个人空间，目标 = 证据消息作者；调用方若声明了登录用户，必须就是作者。读侧不变（只有本人）。
  - I-3 / I-4 / I-5 / I-8 / I-1 照旧：只经 SECURITY DEFINER 函数写、模型产出最高 proposed、证据必达、复制加 `derived_from`、只写 personal。
- **随之的两处调整**：
  - F11 手动晋升一条已经被自动记下的决定：去重判为 duplicate、合并进那份副本，并在同一动作里把副本转成「你确认过的」（U-3：点晋升即确认）。
  - 本文件「待签核确认（issue #4181）」第 4 条 (b)「未晋升的跨会话决定是否也应强制召回」：对**本人说出的决定**，由本决定回答为「是」——
    它们现在就在本人 L1 里，按 L1 决定强制召回（标「AI 记下的」）；`recall.ts` 的 `forcedDecisionScope` 不变。
- **撤销后**：副本失效后，同一决定不会被抽取任务重试复制回来；F15 跨会话召回也按「长期记忆里有过它」的既有规则不再带出本人其他会话里那条原结论。

## 待签核确认（组织级抽取开关默认值，2026-09-26，ad-hoc，人类两次直接指令「默认是打开的」）

- **组织级记忆抽取开关（`orgEnabled`）默认改成开**：issue #4178 先行实现时「没有行 = 默认关」，人类随后两次明确要求默认打开。迁移 `20260926100000_kg_org_extraction_default_on.sql` 把列默认值改成 `true`，并把触发器闸门二改成「只有显式关掉的行才拦」；已存在的 `enabled = false` 行是管理员明确的选择，**不回填、继续关着**。默认值的唯一说明处是 `application/knowledge-graph/ports.ts` 的 `KgOrgExtractionSettingsPort.getEnabled` 注释。
- **隐私取舍**：新组织的对话内容会被抽取进组织知识图谱，除非组织管理员主动关闭（组织后台「对话记忆」开关）。单条消息比会话更窄的可见范围（member-private 等）仍不抽取，这条闸门不变。签核时请确认接受这一取舍；若不接受，回退只需一条新迁移把列默认值与闸门二改回去（应用层 `?? true` 同步改回），不影响任何已落库的显式选择。

## 已决：个人记忆也用于项目会话里本人的回答（issue #4284，人类决定 2026-09-26）

- **决定**：个人记忆应该在**项目会话**里也生效，但只用于提问者本人这一轮的回答，不展示给项目里的其他人。取代上文 F15 / #4278 两处「项目会话不带任何个人记忆」（原依据 uc-18-4 R5）。
- **召回**：项目会话里，提问者本人的个人空间（L1）结论与实体进入**本人这一轮**的候选集（含决定类强制召回，与 #4278 共用 `DECISION_RECALL_LIMIT`）。所有权判定与 F12 相同：`scope_kind = 'personal' AND scope_id = 提问者`，读时设 `app.current_user_id`，RLS 只放本人。**不变**：本人其他个人对话里未晋升的 L0（F15，`originThreadId` 有值）仍只在本人的个人对话里召回；别人的个人对话里什么个人记忆都不取；别人的个人空间恒为零。实现：`pg-knowledge-recall.ts` `candidates()`。
- **结构化读路径逐条核查（其他成员拿不到原文、id、标签）**：
  - `kg_turn_recalls`：照实记录这一轮用到的个人条目（提问者本人回看要用）；这张表没有别的读出口，只经 `getTurnMemory`。
  - `getTurnMemory.recalled`（回答下方的引用 chip、「为什么用到它」）：**读侧按查看者过滤**——个人空间条目只给这一轮的提问者本人（`readTurnRecall` 的 `requester_user_id = 查看者` 且 `scope_id = 查看者`；RLS 再挡一道）。图路径端点有一个看不到就整条不给。选读侧而非写侧：对已落库的旧行、被污染的行同样成立。
  - `getTurnMemory` 的冲突卡 / 记住·忘掉卡：已按查看者过滤（个人空间条目只给卡主 / 本人；`kg_memory_cards` 有个人条目时 RLS 只放卡主）；项目会话里开卡函数本来就不收个人空间条目。
  - 来源抽屉（`getClaimSources` / `claimRoute`）：个人空间结论只对本人开放，别人与「不存在」同一个 404 出口。
  - 会话知识面板（`getThreadKnowledge`）与抽取反馈（`messageExtraction`）：只读 `scope_kind = 'chat_session'`，不含任何个人空间条目。
  - 前端：只渲染上述接口按查看者返回的数据，不另存、不跨用户缓存。
  - 门控：`tests/knowledge-graph/personal-memory-project-thread.test.ts`（两个用户一个项目会话），`e2e-zero-leak.test.ts`。
- **已知取舍（唯一一条，产品层面，未解决）**：模型写出来的**回答正文**贴在项目会话里、对项目成员可见，**可能复述提问者的个人记忆**；其他成员后续几轮的对话历史里也带着这条回答。这是回答本身可见的直接后果，本轮不做任何遮挡或改写。由此而来、同属这条取舍的两条**间接**抽取路径（#4291 评审指出，本轮不关）：① 之后某条**人说的话**被抽取时，抽取模型读的上文（`KG_EXTRACTION_CONTEXT_TURNS`）里带着这条回答；② 其他成员之后的回答若复述了它，那一轮的召回里没有个人条目，闸门放行。两条都只能搬运成员已经看得到的正文。
- **已关闭：回答被抽取成共享项目知识（round 7，2026-09-26）**：回答本身也是一条聊天消息，`kg_enqueue_extraction` 触发器不按 `author_kind` 过滤，A 的回答里复述的个人决定原本会被抽成该项目会话的 `chat_session` 结论（每个成员的知识面板可见、被他们后续提问召回）。现在在**应用层**关掉（不改触发器，避开 #4283 同时 `CREATE OR REPLACE` 的那一处）：
  - 抽取 tick（`extract-message-knowledge.ts` `extractJob`）处理 agent 回答前先问 `KgExtractionSourcePort.projectAnswerOutsideRecallCount`：回答在项目会话里、产出它的 run（`chat_messages.agent_run_id` = `kg_turn_recalls.run_id`）那一轮召回里有**任何一条不能证明属于本会话**的条目（不是本会话 `chat_session` 结论——个人空间条目恒算，worker 不设 `app.current_user_id`，RLS 本来就不放 personal 行）⇒ 这条回答**不抽**，任务照常完成（不重试），记一条 `kg extraction skipped: project-thread answer used personal memory` 日志（带条数）。
  - fail closed 的另一半：闸门靠 `kg_turn_recalls` 那一行判断。执行器那一行写失败时（原来只记日志、照常带全部记忆），这一轮**不再使用个人空间条目**（`recall-knowledge.ts` `knowledgeMemoryFor`），会话记忆照用——没有记录的个人记忆不会进回答。
  - 不变：个人会话里的回答照常抽取；项目会话里没用到任何个人记忆的回答照常抽取。代价：用过个人记忆的那条回答里本来可以进项目记忆的其他内容也一并不抽（人说的原话照常抽，不受影响）。**实际范围**（#4291 评审）：项目会话的召回只含本会话结论与提问者本人的个人条目，而决定类强制召回每轮都会带上本人个人空间里的决定——所以一个人的个人空间里一旦有决定，他在项目会话里得到的 agent 回答**几乎都不抽**。先 fail closed，签核时请确认接受。
  - 门控：`personal-memory-project-thread.test.ts` 末两条（去掉闸门 ⇒ 第一条红：A 的回答抽出了 S 的结论；闸门放宽成「项目会话 agent 回答一律不抽 / 一律不抽」⇒ 第二条红），`kg-turn-recall-citations.test.ts`「记录写失败」一条，`extraction-repo-guard.test.ts` (h)。
