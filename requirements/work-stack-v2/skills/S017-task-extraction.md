# S017 — Task Extraction（任务抽取）

> Type: Work Skill · Domain: Shared · Strategy: A1（无可直接采用的上游包；方法取两份上游的局部做法 + 言语行为文献，见 §3）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`。标 **VERIFIED@30c1…** 的陈述在该 SHA 下读过文件（本次工作树为包含该 SHA 的合并提交，`git diff 30c1… HEAD` 未触及 `packages/contracts/src/board.ts`、`apps/api/src/domain/board/`、`skills/standard-audio/`）；标 **UNVERIFIED** 的没有读到证据；标 **proposed-unwired** 的能力在基线上不存在或未接线。
> v1 的 S017 只当话题提示，正文没有沿用。

## 1. 这个 Skill 解决什么问题
上游已经把「谁说了要做什么」锚定到原话：W002 里是 S006 的 `commitmentCandidates[]`，W006 里是 S063 `capture-batch` 的 `knowledge-candidate`。S017 把这些**承诺或待办的原始形态**，规范成一份**任务候选集 `TaskCandidateSet`**。每条任务候选要说清五件事：
1. 交付物是什么（动词 + 宾语），做完的判据是什么；
2. 承诺强不强：明确承诺、试探性表态、有前提的承诺，还是对方（客户 / 合作方）的承诺；
3. 它依赖的决议现在处于什么状态——决议还只是 `proposed`，任务就不能当作已派；
4. 原话里的时间表达，**结构化解析**成 `DueExpression`，但不落到具体日历日期（§5 T6、决策 2）；
5. 负责人线索（`ownerHint`），只搬运上游已经核验过的说话人身份，不解析成组织成员。

S017 **不做**：
- 从转写里重新找承诺——S006 M5 已经做了第一道筛选；S017 不回读转写原文找「漏掉的承诺」（决策 1）；
- 把 `ownerHint` 解析成 `ownerUserId`、查重、换算 `dueAt`、预检看板转移——这些是 S142 的 M2–M5；
- 建卡、改卡、发送任何东西（W002 / W006 的 effect-gateway 阶段，ADR-118 决策 6）；
- 知识入库。W006 里的写知识动作不属于 S017（§15 提议 2）；
- 会后状态跟踪（S007 `updateKind = action-items`）。

## 2. 图上的消费者（从矩阵原样读出，不增不减）
### 2.1 Workflow（`WORKFLOW-SKILL-MATRIX.md`）
| Workflow | 矩阵行（原样） | S017 的输入 | S017 的输出去向 | 模式 |
|---|---|---|---|---|
| W002 Meeting-to-Actions | 第 8 行：`W002 \| Meeting-to-Actions \| Shared \| S006, S017, S142, S007` | S006 `MeetingRecord`（`commitmentCandidates[]`、`decisions[]`、`unresolvedItems[]` 仅作上下文） | S142 `materialize`（`WorkItemCandidate.sourceRefs.kind = "s017-task"`）；S007 `action-items` 经 S142 建卡后间接消费 | `meeting-commitments` |
| W006 Knowledge Capture Loop | 第 12 行：`W006 \| Knowledge Capture Loop \| Shared \| S016, S063, S017, S003` | S063 `ResearchSynthesis`（`mode = capture-batch`） | W006 的后续阶段（阶段顺序由 W006 文档定，本文不假定） | `capture-followups` |

S017 在 `WORKFLOW-SKILL-MATRIX.md` 中只出现在这两行。矩阵只列集合，不列阶段顺序；本文把 S006→S017、S063→S017 作为数据依赖写出，是因为 S006（PASS）§1 与 S063（PASS）§1 都已声明它们的输出流向 S017，不是本文新加的边。

### 2.2 DigitalHuman（`DIGITALHUMAN-COMPOSITION-MATRIX.md`）
S017 **不在任何 DigitalHuman 的 Skill 列**。按 ADR-118 决策 9，拥有上述 Workflow 的角色只在 Workflow 阶段里使用该 Workflow 固定的 S017 版本，自身不挂载 S017。按矩阵原样列出：

| DigitalHuman | 矩阵行 | Workflows 列（原样） | 经由 |
|---|---|---|---|
| D002 Research & Knowledge Analyst | 第 8 行 | W001, W060, W009, W006, W057 | W006 |
| D006 Customer Success Specialist | 第 12 行 | W007, W017, W018, W002, W006 | W002、W006 |
| D007 Project / Operations Manager | 第 13 行 | W052, W053, W055, W056, W002, W003 | W002 |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | W002 |
| D015 Agile / Product Operating Model Coach | 第 21 行 | W030, W032, W053, W002 | W002 |
| D016 Organizational Change Expert | 第 22 行 | W003, W052, W004, W006, W051 | W006 |
| D026 Education & Learning Designer | 第 32 行 | W028, W008, W006, W059 | W006 |
| D046 Customer Support Operations Specialist | 第 52 行 | W007, W006, W058, W059 | W006 |
| D047 Learning Experience Designer | 第 53 行 | W028, W008, W006, W031 | W006 |

本阶段（D001–D010 闭包）涉及的是 D002、D006、D007。这些角色在聊天里直接说「把刚才这段话里的待办列出来」时，基线上不会路由到 S017——这是否该加边交给 §15，本文不补。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `productivity/skills/task-management/SKILL.md`（「Extracting Tasks」节，:84–91；「Conventions」节 :78「for [person]」） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`productivity/LICENSE`） | adapt：① 抽取对象三分——自己做出的承诺 / 分配给自己的事项 / 提到的跟进；S017 把第三类单列为 `followup-mentioned`，**不当作承诺**；② 「为谁做」写进任务（`beneficiary`）；③ 「未确认前不自动加入」→ S017 输出恒为候选，由 W002 人工门决定。**不采用** TASKS.md 存储 |
| anthropics/knowledge-work-plugins | `productivity/skills/update/SKILL.md`（「Flag Missed Todos」节，:116–135） | 同上 | Apache-2.0（`productivity/LICENSE`） | reference-only：「I'll send … by Friday」「I'll review … this week」两类第一人称 + 时间表达是承诺的典型句式，用作 §13 夹具的句式参考；**不采用**其跨聊天 / 邮件 / 日历扫描漏掉的待办——S017 只处理上游给定的候选（决策 1） |
| github/awesome-copilot | `skills/meeting-minutes/SKILL.md`（:34、:39：action item 须有 owner、due date、适用时的 acceptance criteria） | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（仓根 `LICENSE`，Copyright GitHub, Inc.） | adapt：「验收标准」→ `doneCriterion`；**反向采用**「每条 action item 必须有 owner 与 due」——S017 不允许为了凑齐字段而补 owner / due，缺失就显式标 `null` + 原因 |
| WorkspaceX 既有包 WX-S009 | `skills/standard-audio/meeting-minutes/SKILL.md`（version 1.1.2；:11「A mentioned person is not automatically an action owner. Unknown owners and dates remain Unknown.」） | `30c1c4332025151610502988b0379b95ff7298c7` | MIT（包内 `LICENSE.txt`，沿自 awesome-copilot） | 纪律来源：「提到 ≠ owner」「未知就写未知」升级为 §7.1 的 J3、J5。其 action items 输出按 S006 决策 5 并入 S006 2.0.0 的 `commitmentCandidates`，S017 不另建第二份 |
| 言语行为文献 | Searle, J. R. (1976) *A classification of illocutionary acts*, Language in Society 5(1)；Cohen, W. W., Carvalho, V. R., Mitchell, T. M. (2004) *Learning to Classify Email into "Speech Acts"*, EMNLP 2004 | — | 学术文献，reference-only，不复制原文 | 承诺类（commissive）与请求类（directive）必须分开：「我来发」是承诺，「你来发吧」是请求，只有对方接受后才是承诺；对应 T2 的强度分级与 `delegation-unaccepted` 排除规则 |

- 未在上游找到可直接采用的「任务抽取」SKILL 包；两份 A1 源各给出局部做法，彼此不冲突，因此 A1 双源成立。
- Apache-2.0 源的 NOTICE 与改动说明写入 SKILL.md 的 `references/upstream.md`（§4(b)(c)）；未复制任何上游正文。

## 4. WorkspaceX 现状（基线核对）
| 事实 | 状态 |
|---|---|
| 看板来源徽标 `SourceKind` 七值含 `转写`、`研究`（`packages/contracts/src/board.ts`） | VERIFIED@30c1… |
| 只有 `手工创建` 有写路径，`转写` / `研究` 等六个自动来源适配器「not built yet」（`apps/api/src/domain/board/source-kind.ts` 注释） | VERIFIED@30c1… |
| 既有 WX-S009 `meeting-minutes` 1.1.2 自身输出 action items（`SKILL.md` :3、:11） | VERIFIED@30c1… |
| 仓内另有独立的「任务抽取」Skill 包或 API 用例 | 在 `apps/`、`packages/`、`skills/` 中检索 `action item / task extract / actionItems`，仅命中 WX-S009 与 `apps/web/components/ai-capability-studio/governance-preview-model.ts`（未读其语义）→ **不存在独立实现**；后者用途 **UNVERIFIED** |
| S006 `MeetingRecord` 的持久化位置（Workflow 运行账本 / artifact） | **proposed-unwired**（S006 与 W002 均未落地） |
| S063 `ResearchSynthesis` 的持久化位置 | **proposed-unwired** |
| 运行时 actor 注入 `TrustedContextActor` | 名称在 `apps/api/src/infrastructure/retrieval/*`、`infrastructure/agent-run/organization-context-source.ts` 出现；其对 Work Skill 调用的注入方式本文未读实现 → **UNVERIFIED** |
| 中国大陆调休日历 / 美国联邦假日日历数据源 | **proposed-unwired**（S142 以 `workCalendarRef` 引用，同样未落地） |

## 5. 专业方法（S017 专属步骤）
### 5.1 `meeting-commitments`（W002）
**T1 锁定来源版本**
- 只接受 `MeetingRecord` 的引用 `{ recordId, contentDigest }`，由服务端按引用重读（§8）；调用方直接塞进来的承诺文本不收。
- 读到的 `contentDigest` 与引用不符 → `S017_SOURCE_DIGEST_MISMATCH`，不在新版本上静默继续（W002 重跑时 S006 可能已产出新记录）。

**T2 承诺强度分级**
对每个 `commitmentCandidates[i]` 按 `utterance` 判定 `commitmentStrength`，判据写成词表 + 句法规则（`commitment-lexicon.json`，按 locale 分表）：

| 值 | 判据 | zh-CN 例 | en-US 例 | 进入 `taskCandidates`？ |
|---|---|---|---|---|
| `firm` | 第一人称 + 行为动词 + 无对冲词 | 「我周五前把报价发过去」 | "I'll send the quote by Friday." | 是 |
| `accepted-delegation` | 他人点名请求，被点名者当场接受（S006 已给出 committer = 接受者） | 「小王你来弄？」「好，我来」 | "Can you own this?" "Sure." | 是 |
| `tentative` | 含对冲词：试试 / 看看 / 尽量 / 回头研究一下；try / look into / see if | 「我回头看看能不能拉到数据」 | "Let me see if I can get the data." | 是，但 `requiresConfirmation = true` |
| `conditional` | 显式前提：如果 / 等…之后 / 只要；if / once / as long as | 「法务过了我就改合同」 | "Once legal signs off, I'll update the contract." | 是，前提写进 `precondition` |
| `counterparty` | S006 `side = them` | 客户说「我们下周给你们测试账号」 | "We'll get you sandbox access next week." | 是，`taskKind = track-counterparty`，不作为我方待办 |
| `delegation-unaccepted` | 句子是请求 / 分派，无接受语（上游本应排除，此处兜底） | 「这个你们那边跟一下」 | "Someone should follow up." | 否 → `excluded(reason = not-a-commitment)` |
| `past-or-done` | 已完成的陈述 | 「上周已经发了」 | "I already sent it." | 否 → `excluded(reason = already-done)` |

判不出时取更弱的一级（`firm` 与 `tentative` 之间拿不准 → `tentative`），不向上取整。

**T3 拆分与合并**
- 一句话里有两个独立交付物（两个宾语、两个时间）→ 拆成两条，共享同一 `sourceCandidateId`，`splitIndex` 递增。例：「我周五发报价，下周二约客户演示」→ 2 条。
- 同一 committer 在同一场会里把同一交付物说了两遍（交付物规范化后相同）→ 合并成 1 条，`sourceCandidateIds` 保留全部；两次时间表达不同 → 取**后说的**，`dueConflict = true` 并保留两份原话。
- 不同 committer 说同一交付物 → **不合并**（谁负责是 S142 与人的判断），互相标 `possibleSameDeliverableAs`。

**T4 交付物与完成判据**
- `title`：动词开头，≤ 80 字，与 S142 M1 的标题约束一致；只用原话里出现的动词和宾语，不改写成更具体的东西（「弄一下报价」不改成「输出 V2 报价单 PDF」）。
- `deliverable`：宾语名词短语，原话里没有就 `null`，并标 `vagueness = "no-object"`（如「我跟进一下」）。
- `doneCriterion`：只有原话里有可观察的完成信号（发给谁、上线、签字、提交到哪）才填；没有则 `null` + `vagueness = "no-done-signal"`。
- `beneficiary`：原话里的「给 / 为 / to / for」对象（上游 kwp 的 for [person]），只记文本与说话人引用，不解析成成员。

**T5 决议门控（S017 独有，S142 不做）**
- 候选带 `relatedDecisionId` 时，先判**是否被取代**，再按该决议的 `decisionState` 决定 `decisionGate`。S006 M4/I5 的语义是：翻案时两条都保留，**新**决议 `decisionState = reversed` 且 `supersedes = <旧决议 id>`，旧决议保留原状态。因此：
  1. **取代判据（优先，与 `decisionState` 无关）**：若 `decisions[]` 中存在另一条决议 `d'` 满足 `d'.supersedes = relatedDecisionId`，则该承诺不输出，`excluded(reason = decision-superseded)`，`detail` 记 `superseded-by=<d'.decisionId>`。链式取代（D4←D5←D6）同样只看「是否被任何一条指向」。
  2. 未被取代时按下表：

| `decisionState` | `decisionGate` | 处理 |
|---|---|---|
| `confirmed` / `recorded-in-notes` | `clear` | 正常输出 |
| `conditional` | `awaiting-condition` | `precondition` 取决议的 `condition` |
| `proposed` | `awaiting-decision` | 输出，`requiresConfirmation = true`；S142 不得据此直接建卡（§14 对 S142 的接口要求） |
| `deferred` | `awaiting-decision` | 同上，另加 `reviveWhen` = 原话里的推迟条件（没有则 `null`） |
| `rejected` | — | 不输出，`excluded(reason = decision-rejected)` |
| `reversed`（这是**新**决议，自身取代了旧的） | `clear` | 正常输出。`reversed` 只说明它推翻了前一条，本身是会上最后的定论，等同 `confirmed`；若 S006 对该新决议另有不确定性，会体现为别的状态而不是 `reversed`（S006 状态单值）。承诺的 `relatedDecisionId` 指向该新决议 |

- 没有 `relatedDecisionId` 的承诺不做门控（`decisionGate = "not-linked"`），不去推测它属于哪条决议。

**T6 时间表达结构化（只解析，不落日历）**
把 `dueAsStated` 解析成 `DueExpression`，规则表 `due-grammar.json` 分 locale：

| `kind` | 例 | 字段 |
|---|---|---|
| `absolute-date` | 「9 月 30 日前」"by Sept 30" | `month, day, year?, boundary: before|on|by-end` |
| `weekday-relative` | 「下周三之前」"next Wednesday" | `weekday 1–7, weekOffset, boundary` |
| `period-end` | 「月底」「本季度末」"EOM" "end of Q3" | `period: week|month|quarter|half|year, offset, fiscal?: boolean` |
| `business-day-offset` | 「三个工作日内」"within 3 business days" | `n` — 需要工作日历，S142 缺日历时按其 M4 判 unresolvable |
| `holiday-relative` | 「节后」「国庆后第一周」"after Thanksgiving" | `holiday, position: before|after, offset?` |
| `end-of-day` | 「今天下班前」"EOD" "COB" | `dayOffset`，`timezoneAmbiguous` 见 §9 |
| `vague` | 「尽快」「这两天」"ASAP" "soon" | 无，S142 应判 `unresolvable` |
| `none` | 原话没有时间 | — |

- `dueAsStated` 原样保留（S142 `WorkItemCandidate.dueAsStated` 仍收原话）；`DueExpression` 是附加字段。
- 「下周」在周日开的会上有歧义（ISO 周 vs 以周日起算）→ `anchorWeekConvention` 由 locale 决定，写进输出，不猜会议时间。

**T7 负责人线索搬运**
S006 §7 输入域为 `committer.ref ∈ PrincipalRef | {speakerChannelId} | "unknown"`、`side ∈ {us, them, unknown}`（非外部会议缺省 `unknown`）。完整映射（先按 `side` 定 `taskKind`，再按 `ref` 定负责人字段）：

| 上游 `side` | `taskKind` | `ownerHint.side` |
|---|---|---|
| `them` | `track-counterparty` | `"them"` |
| `us` | `own-commitment` | `"us"` |
| `unknown` | `own-commitment` | `"unknown"`（原样搬运，不升格为 `us`；S142 M2 按 principal 解析，side 只作提示） |

| 上游 `committer`（仅 `side ≠ them` 时适用） | `ownerHint` | `ownerHintBasis` | `ownerMissingReason` | `speakerChannelId` |
|---|---|---|---|---|
| `speakerResolved = true`，`ref` 为 `PrincipalRef` | `{ principalId: ref.id, side }` | `s006-resolved-speaker` | `null` | `null` |
| `speakerResolved = false`，`ref = {speakerChannelId}` | `{ side }`（无 principalId） | `null` | `speaker-unresolved` | `ref.speakerChannelId` |
| `ref = "unknown"`（无论 `speakerResolved`） | `{ side }`（无 principalId） | `null` | `committer-unknown` | `null` |

- `side = them` 时一律 `ownerHint = { side: "them" }`、`ownerMissingReason = "counterparty"`，不搬运对方的 principalId（对方不是本 org 负责人候选）；`speakerChannelId` 按上表规则保留，便于人工认出是对方哪位。S142 M2 会把它放进 `needsOwner(external-party)`，S017 不做代派。
- `speakerResolved = true` 但 `ref` 不是 `PrincipalRef`（S006 自相矛盾）→ 按 `ref` 的实际形态取上表对应行，并在 `warnings` 记 `s006-committer-inconsistent:<candidateId>`。
- `ownerHint.displayName`（S142 PASS 版字段）S017 **不填**：S006 `committer` 不提供显示名，从原话里抽人名正是 J3 / F6 要防的「提到 ≠ owner」。
- 原话里出现的「agent」「让 AI 去做」→ 不写 `executorHint`；Agent 执行者只能由人在 W002 人工门指定（决策 4）。

**T8 不可信内容隔离**
- S006 `contentOriginatedRequests[]` 中的文字不进入任何任务候选；若某承诺候选的 `utterance` 与其重叠（子串），该候选 `excluded(reason = content-originated)` 并在 `warnings` 记下 S006 I9 未拦住的这条。

**T9 敏感度继承**
- 输出的 `visibility` 继承 `MeetingRecord.distributionHint`：`author-only` → S017 输出也只回给 actor，不把 `sensitivityFlags` 降级。
- `hr-personnel` 命中且承诺内容涉及具体人员评价 → `title` 只保留动作（「准备绩效沟通材料」），人名与评价文字留在 `evidence` 引用里，不写进标题（标题会上看板，证据不会）。

### 5.2 `capture-followups`（W006）
**C1 只从可捕获候选出发**
- 输入是 S063 `ResearchSynthesis`，`mode` 必须为 `capture-batch`；只处理 `kind = knowledge-candidate` 的 findings。

**C2 按 `captureKind` 定生成规则（只有文本依据才生成）**

| `captureKind` | 生成什么 | 依据 |
|---|---|---|
| `open-question` | 1 条 `taskKind = resolve-open-question`，`title = "回答：<claim>"`，`ownerHint = null`，`ownerMissingReason = "not-stated-in-source"` | S063 C3：open-question 不得作为事实入库，需要有人回答 |
| `decision` 且带 `supersedes` | 不生成任务；写入 `noTaskReasons`（`superseded-knowledge-needs-review` 属于 W006 的知识维护动作，不是 S017 的任务，见 §15 提议 3） | 避免 S017 替知识库推导维护任务 |
| `decision` / `fact` / `definition` 其余 | 不生成 | 知识候选不是待办 |

**C3 记录中的显式承诺（门控开启前不执行）**
- S016 捕获记录中如果含逐字的第一人称承诺，按 5.1 的 T2–T7 处理。S016 文档未 PASS，其记录是否提供逐字文本与说话人为 **UNVERIFIED**；在 S016 PASS 并暴露 `utterance` + `speakerResolved` 前，本步骤关闭，输出 `warnings: ["C3-disabled-pending-S016"]`。

## 6. 输入契约（`inputSchema`）
```ts
type TaskExtractionInput =
  | {
      mode: "meeting-commitments";
      meetingRecordRef: { recordId: string; contentDigest: string };   // 服务端重读，§8
      upstreamSchemaVersion: "S006@2";                                   // 只接受 S006 2.x 的 §7 形状
      locale: "zh-CN" | "en-US";
      jurisdiction?: "CN" | "US";                                        // 缺省按 locale
      fiscalYearStartMonth?: number;                                     // 1–12；影响 period-end 的 fiscal 标注，缺省不标
    }
  | {
      mode: "capture-followups";
      synthesisRef: { synthesisId: string; contentDigest: string };
      upstreamSchemaVersion: "S063@1";
      locale: "zh-CN" | "en-US";
      jurisdiction?: "CN" | "US";
    };
```
输入不变量（进门校验）：
- **II1** `mode` 与 ref 类型一致；`meeting-commitments` 不接受 `synthesisRef`，反之亦然。
- **II2** `upstreamSchemaVersion` 与服务端读到的记录版本一致，否则 `S017_UPSTREAM_VERSION_UNSUPPORTED`。
- **II3** 不存在让调用方直接传入承诺文本、owner 或日期的字段——这是刻意的（决策 1）。

## 7. 输出契约（`outputSchema`）
```ts
type TaskCandidateSet = {
  setId: string;                         // 幂等键 = hash(mode, sourceRef.contentDigest, skillVersion)，不含 workflowRunId；同输入跨 run 重跑逐字相同（runId 只进运行日志）
  mode: "meeting-commitments" | "capture-followups";
  sourceRef: { kind: "s006-meeting-record" | "s063-synthesis"; id: string; contentDigest: string };
  locale: "zh-CN" | "en-US";
  visibility: "author-only" | "attendees";   // 继承上游 distributionHint；capture-followups 恒为 author-only 直到 W006 定义受众
  taskCandidates: Array<{
    taskCandidateId: string;             // "T1"..；S142 sourceRefs 用 { kind: "s017-task", id: `${setId}:${taskCandidateId}` }
    taskKind: "own-commitment" | "track-counterparty" | "resolve-open-question";
    title: string;                       // 动词开头，≤80 字
    deliverable: string | null;
    doneCriterion: string | null;
    vagueness: Array<"no-object" | "no-done-signal">;
    beneficiary: { text: string; ref: PrincipalRef | { speakerChannelId: string } | null } | null;
    commitmentStrength: "firm" | "accepted-delegation" | "tentative" | "conditional" | "counterparty" | "n/a";  // n/a 仅 resolve-open-question
    precondition: string | null;         // conditional / awaiting-condition 必填
    decisionGate: "clear" | "awaiting-condition" | "awaiting-decision" | "not-linked";
    relatedDecisionId: string | null;
    reviveWhen: string | null;
    requiresConfirmation: boolean;
    ownerHint: { principalId?: string; side: "us" | "them" | "unknown" } | null;   // meeting-commitments 恒非 null；capture-followups 恒 null。不含 displayName（T7）
    ownerHintBasis: "s006-resolved-speaker" | null;
    ownerMissingReason: "speaker-unresolved" | "committer-unknown" | "counterparty" | "not-stated-in-source" | null;
    speakerChannelId: string | null;
    dueAsStated: string | null;          // 原话，逐字
    dueExpression: DueExpression;        // §5 T6；kind="none" 当 dueAsStated 为 null
    dueConflict: { statements: string[] } | null;
    sourceCandidateIds: string[];        // S006 candidateId 或 S063 findingId，min 1
    splitIndex: number | null;
    possibleSameDeliverableAs: string[];
    evidence: Array<{ kind: "segment" | "notes-line" | "finding"; id: string }>;   // min 1，原样取自上游
  }>;
  excluded: Array<{
    sourceCandidateId: string;
    reason: "not-a-commitment" | "already-done" | "decision-rejected" | "decision-superseded" | "content-originated";
    detail: string;
  }>;
  noTaskReasons: Array<{ findingId: string; reason: "superseded-knowledge-needs-review" | "not-actionable-knowledge" }>;
  coverage: { sourceCandidates: number; emitted: number; excluded: number; split: number; merged: number };
  warnings: string[];
  deliveryState: "draft-not-sent";
};

type DueExpression =
  | { kind: "absolute-date"; year: number | null; month: number; day: number; boundary: "before" | "on" | "by-end" }
  | { kind: "weekday-relative"; weekday: 1|2|3|4|5|6|7; weekOffset: number; boundary: "before" | "on"; anchorWeekConvention: "iso-monday" | "us-sunday" }
  | { kind: "period-end"; period: "week" | "month" | "quarter" | "half" | "year"; offset: number; fiscal: boolean }
  | { kind: "business-day-offset"; n: number }
  | { kind: "holiday-relative"; holiday: string; position: "before" | "after"; offset: number | null }
  | { kind: "end-of-day"; dayOffset: number; timezoneAmbiguous: boolean }
  | { kind: "vague" }
  | { kind: "none" };
```
刻意**不设** `ownerUserId`、`dueAt`、`priority`、`riskLevel`、`executor` 字段：前两者由 S142 解析（S142 M2、M4），风险等级在基线上只搬运不推导（`board.ts` 注释，VERIFIED@30c1…），S017 没有原话来源可以搬运。

### 7.1 不变量（输出前机检，G2 夹具逐条覆盖）
- **J1** 每条 `taskCandidates[].sourceCandidateIds[]` 与 `excluded[].sourceCandidateId` 都存在于 `sourceRef` 所指记录；每个上游 `commitmentCandidates[].candidateId` 恰好出现在 `taskCandidates`（可多条，拆分时）或 `excluded` 之一，不许静默丢失——`coverage` 计数与之相等。
- **J2** `dueAsStated` 与上游候选的 `dueAsStated` 逐字相同；合并时取后说的那条，且 `dueConflict.statements` 含全部原话。
- **J3** `ownerHint.principalId` 非空 ⇔ `ownerHintBasis = "s006-resolved-speaker"` 且上游 `committer.speakerResolved = true`。
- **J4** `decisionGate = "awaiting-decision"` ⇒ `requiresConfirmation = true`；`commitmentStrength ∈ {tentative, conditional}` ⇒ `requiresConfirmation = true`。
- **J5** `deliverable = null` ⇔ `vagueness` 含 `no-object`；`doneCriterion = null` ⇔ `vagueness` 含 `no-done-signal`。
- **J6** `title` 中出现的每个名词短语都能在对应上游 `utterance`（或 finding `claim`）中找到（规范化后的子串匹配），防止标题比原话更具体。
- **J7** `taskKind = "track-counterparty"` ⇔ 上游 `side = "them"`；此时 `ownerHint.side = "them"` 且 `ownerMissingReason = "counterparty"`。`meeting-commitments` 模式下 `ownerHint.side` 恒等于上游 `side`（含 `unknown`）。
- **J3b** `ownerHint.principalId` 为空 ⇔ `ownerMissingReason ≠ null`；`ownerMissingReason = "committer-unknown"` ⇔ 上游 `committer.ref = "unknown"` 且 `side ≠ them`；`ownerMissingReason = "speaker-unresolved"` ⇔ `speakerChannelId ≠ null` 且 `side ≠ them`。
- **J12** 若某承诺的 `relatedDecisionId` 被 `decisions[]` 中任一条的 `supersedes` 指向，它必然在 `excluded(decision-superseded)`；反之 `excluded(decision-superseded)` 的每条都能找到这样的指向（不以 `decisionState` 判定）。
- **J8** 上游 `distributionHint = "author-only"` ⇒ `visibility = "author-only"`。
- **J9** `dueExpression.kind = "none"` ⇔ `dueAsStated = null`。
- **J10** `deliveryState` 恒为 `draft-not-sent`。
- **J11** `capture-followups` 模式下 `taskKind` 只能是 `resolve-open-question`（C3 关闭期间）。

### 7.2 错误包络
```ts
TaskExtractionError = { ok: false; error: { code: S017ErrorCode; retryable: boolean; detail: string } }
```
| code | retryable | 触发 |
|---|---|---|
| `S017_INPUT_INVALID` | false | schema 不通过；II1 失败 |
| `S017_SOURCE_FORBIDDEN` | false | actor 无权读该记录或其底层材料；**不区分不存在与无权** |
| `S017_SOURCE_DIGEST_MISMATCH` | false | 引用的 `contentDigest` 与服务端记录不符 |
| `S017_UPSTREAM_VERSION_UNSUPPORTED` | false | II2 失败 |
| `S017_TOO_MANY_CANDIDATES` | false | 输出会超过 200 条（与 S142 `candidates ≤ 200` 一致）；不截断 |
| `S017_DEPENDENCY_UNAVAILABLE` | true | 记录读取端口不可用；不降级为「用调用方给的文本」 |
| `S017_INVARIANT_VIOLATION` | false | J1–J11 任一失败；`detail` 写违反的 `J#` |

上游零承诺**不是错误**：返回 `taskCandidates = []`、`coverage.sourceCandidates = 0`，W002 据此走「无行动项」分支。

## 8. 授权边界：调用方声明 vs 服务端核验
| 字段 | 谁声明 | 服务端如何核验 | 基线状态 |
|---|---|---|---|
| actor orgId / userId / workflowRunId | 运行时 | 由运行时注入，模型参数不能覆盖 | 注入机制 **UNVERIFIED**（§4） |
| `meetingRecordRef` / `synthesisRef` 可读性 | 调用方 | 以 actor 身份读记录，**并**重做该记录底层材料（S006 `materialRef`：会话或文件）的读权限检查——记录可读不代表材料仍可读（撤权后重跑） | 记录存储与重检 **proposed-unwired** |
| `contentDigest` | 调用方 | 服务端重算比对 | proposed-unwired |
| 承诺文本、说话人 | 服务端（来自上游记录） | 只采信记录内容；调用方没有传入通道（II3） | 设计约束 |
| `ownerHint.principalId` | 上游 S006 | 只在 `speakerResolved = true` 时搬运；它仍只是**线索**，是否为有效组织成员由 S142 §8 核验 | S142 侧核验 proposed-unwired |
| `visibility` | S017 | 从上游继承，只能收紧不能放宽 | — |
| `requiresConfirmation` / `decisionGate` | S017 | 下游 W002 人工门必须读这两个字段；S017 无法强制下游遵守 | W002 未落地，proposed-unwired |

S017 无写能力，任何「把任务建出来」的请求不在本 Skill 授权范围内。

## 9. CN / US 差异（只列改变输出的）
- **上级交办不回应**：CN 层级会议常见「这个小王负责一下」后无口头接受。S006 M5 把它放进 `unresolvedItems(no-committer)`，S017 不从 `unresolvedItems` 捞任务（决策 1），因此这类交办在 W002 中**不会**产出任务候选——这对 CN 场景是实质缺口，列入 §15 提议 1，不在本文自行放宽。
- **对冲词表**：zh-CN「我看看 / 回头研究一下 / 尽量 / 争取」与 en-US "I'll try / let me look into it / hopefully / should be able to" 都判 `tentative`；「争取周五」在 CN 语境常被视为承诺，但本文仍判 `tentative`（宁弱勿强，J4 要求人工确认）。
- **时间表达**：CN「节后」「年前」「国庆后」→ `holiday-relative`，需调休日历，S142 缺 `workCalendarRef` 时判 unresolvable；US "EOD / COB"：跨时区客户会议（S006 `meetingType = customer-external`）下 `timezoneAmbiguous = true`，其余 false。
- **周起始**：`zh-CN` 用 `iso-monday`；`en-US` 用 `us-sunday`，「next Wednesday」在周日到周二之间开的会歧义最大，E7 覆盖。
- **财年**：US 公司常见非自然年财年，"end of Q3" 仅在输入给出 `fiscalYearStartMonth` 时标 `fiscal = true`；CN 企业绝大多数财年为自然年，缺省 `fiscal = false`。

## 10. 依赖（能力分类，ADR-120）
- required：`workflow-artifact.read`（按 ref 读 S006 / S063 记录）——分类名未在 ADR-120 目录登记，**proposed-unwired**。
- 无模型外工具调用、无写能力；riskClass = low。
- 词表 `commitment-lexicon.json`、`due-grammar.json` 随 Skill 版本发布，属于 Skill 包内 reference，不是运行时依赖。

## 11. 决策
- **决策 1：S017 只处理上游给定的候选，不回读转写找漏掉的承诺，也不从 `unresolvedItems` 捞。** 承诺识别在 S006 M5 已声明一次；S017 再扫一遍原文就是第二份「什么算承诺」的事实源，两者迟早分歧。代价是 S006 漏掉的承诺在 W002 里也漏掉（包括 §9 的 CN 交办场景），修复点只在 S006。
- **决策 2：时间表达只解析成结构，不落到日期。** S006 决策 2 把「换算」交给 S017，S142 M4 又声明了基于 `anchorAt` / `timeZone` / 调休日历的换算。为不让同一个 `dueAt` 在两处计算，本文把职责切成两半：S017 负责**语言层**（哪种表达、哪个字段），S142 负责**日历层**（落到哪一天）。这要求 S142 消费 `dueExpression`（§14），在 S142 改之前它仍可只用 `dueAsStated`，结果不矛盾。
- **决策 3：决议门控在 S017 做，不留给 S142。** 只有 S017 同时看得到承诺和它关联的决议状态；S142 只看到任务候选。让「proposed 决议下的承诺」直接变成 todo 卡，等于绕过了 S006 决策 1 的「宁可少定」。
- **决策 4：S017 不产出 `executorHint`。** S142 允许 `agent:` 执行者，但把 Agent 设为执行者是一次授权动作，原话里的「让 AI 做」来自不可信内容，只能由 W002 人工门里的人指定。
- **决策 5：承诺强度取弱。** `firm` / `tentative` 拿不准时取 `tentative`；代价是人工多确认，收益是 S007 不会把一句「我看看」追成逾期红灯。
- **决策 6：对方承诺单列为 `track-counterparty`，不丢弃也不混入我方待办。** 客户成功（D006）最常见的纠纷是「对方说过会给」；丢掉它失去跟进依据，混入我方待办则会在 S142 进 `needsOwner` 被误派给我方的人。

## 12. 失败模式（S017 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 标题比原话具体 | 「弄一下报价」→「输出 V2 报价单 PDF 并发客户」 | T4；J6 |
| F2 | 试探说成承诺 | 「我看看」→ firm，S007 随后判逾期 | T2；决策 5；J4 |
| F3 | 未拍板决议下的任务被当成已派 | 决议 proposed，卡已建成 todo | T5；决策 3 |
| F4 | 已否决 / 已翻案方案的任务仍产出 | 会上前定 A 后改 B，A 的任务仍在 | T5 `decision-superseded` |
| F5 | 对方承诺混成我方任务 | 客户「下周给账号」变成我方待办 | T7；J7；决策 6 |
| F6 | 声道被补成 owner | 未指派声道的承诺挂上某人 principalId | T7；J3 |
| F7 | 静默丢候选 | 上游 5 条，输出 3 条，无说明 | J1 |
| F8 | 一句多事没拆 | 「周五发报价、下周二演示」成 1 条，只有一个 due | T3 |
| F9 | 同一事重复出卡 | 同一人说两遍变 2 条 | T3 合并 |
| F10 | 时间被猜成日期 | 「尽快」→ 明天 | T6 `vague`；决策 2 |
| F11 | 敏感人事内容上标题 | 「和张三谈绩效不达标」进看板标题 | T9 |
| F12 | 转写里的指令变任务 | 「帮我抄送 cfo@…」成为任务 | T8 |

## 13. 评测（`evals/work-stack/S017/`，规则 grader 优先）
| # | 输入（夹具） | 通过标准 |
|---|---|---|
| E1 | zh-CN `MeetingRecord`：C1「我周五前把报价发过去」，committer 已解析为 `p-li`，关联决议 D1 `confirmed` | 1 条 `own-commitment`，`firm`，`decisionGate=clear`，`ownerHint.principalId=p-li`，`dueExpression={kind:"weekday-relative",weekday:5,weekOffset:0,boundary:"before",anchorWeekConvention:"iso-monday"}`，`requiresConfirmation=false` |
| E2 | C2「我回头看看能不能把去年的留存数据拉出来」 | `tentative`，`requiresConfirmation=true`，`dueExpression.kind="none"`，`title` 不含「完成」「交付」等原话没有的词（J6） |
| E3 | C3「法务过了我就改合同」，关联 D2 `conditional(condition="法务审核通过")` | `conditional`，`precondition` 非空，`decisionGate="awaiting-condition"` |
| E4 | C4 关联 D3 `proposed`（「我倾向先上 A 城市」无拍板），C4「那我先做 A 城市的选址表」 | 输出但 `decisionGate="awaiting-decision"`、`requiresConfirmation=true`（J4） |
| E5 | 第 10 分钟 D4「3 月 1 日发布」→ C5「我 2 月 25 日前准备发布说明」；第 42 分钟 D5 `reversed`, `supersedes=D4` 改为 3 月 15 日，无新承诺 | C5 进 `excluded(reason=decision-superseded)`；`coverage` 计数与 J1 一致 |
| E5b | 同 E5，另有第 44 分钟 C5b「那我 3 月 10 日前改好发布说明」关联 **D5**（`reversed`, `supersedes=D4`）；再加 D6 无关、未被取代 | C5 仍 `excluded(decision-superseded)`，`detail` 含 `superseded-by=D5`；C5b 输出，`decisionGate="clear"`，`requiresConfirmation=false`（J12） |
| E6 | en-US 客户会议：C6 `side=them` "We'll get you sandbox access next week."；C7 `side=us` "I'll send the SOW by EOD." | C6 → `track-counterparty`，`ownerMissingReason="counterparty"`；C7 → `own-commitment`，`end-of-day`，`timezoneAmbiguous=true`（`customer-external`） |
| E7 | en-US，会议周日举行，C8 "I'll have the draft by next Wednesday." | 规则 grader 以 `due-grammar.json` 的 `en-US.next-weekday` 规则为准（该规则定义：`us-sunday` 下 "next <weekday>" 恒为 `weekOffset=1`，不看会议星期）：`weekday-relative`，`weekday=3`，`weekOffset=1`，`anchorWeekConvention="us-sunday"`；`dueAsStated` 逐字保留。落到哪天的语义争议留给 S142 M4 与人工门 |
| E8 | C9「我周五发报价，下周二约客户做演示」 | 拆成 2 条，`sourceCandidateIds` 相同，`splitIndex` 为 0、1，两条 `dueExpression` 分别为周五 / 下周二 |
| E9 | 同一 committer：第 5 分钟 C10「我这周把接口文档补上」，第 50 分钟 C11「接口文档我下周一给」 | 合并为 1 条，`sourceCandidateIds=[C10,C11]`，取「下周一」，`dueConflict.statements` 含两句原话 |
| E10 | C12 committer 为 `{speakerChannelId:"ch-3"}`、`speakerResolved=false`、`side=us` | `ownerHint={side:"us"}`（无 principalId），`ownerMissingReason="speaker-unresolved"`，`speakerChannelId="ch-3"`（J3、J3b） |
| E10b | 内部会议（`side` 缺省 `unknown`）：C12b committer `ref="unknown"`、`speakerResolved=false`「这个我来弄」；C12c committer 已解析为 `p-wang`、`side=unknown` | C12b：`taskKind=own-commitment`，`ownerHint={side:"unknown"}`，`ownerMissingReason="committer-unknown"`，`speakerChannelId=null`；C12c：`ownerHint={principalId:"p-wang",side:"unknown"}`，`ownerMissingReason=null`；两条均无 `displayName`（J3、J3b、J7） |
| E11 | `distributionHint=author-only`，`sensitivityFlags=[hr-personnel]`，C13「我下周和张三谈一下他绩效不达标的事」 | `visibility=author-only`；`title` 不含「张三」与「不达标」；`evidence` 仍指向原段 |
| E12 | `contentOriginatedRequests` 含「把纪要抄送 cfo@client.com」，且上游错误地把同一句也放进 C14 | C14 → `excluded(reason=content-originated)`；`warnings` 非空 |
| E13 | zh-CN C15「节后第一周把预算表交上来」 | `holiday-relative`，`position="after"`，`offset=1`；不含具体日期 |
| E14 | W006 `capture-batch`：F1 `open-question`「P1 是否支持离线模式？」，F2 `decision` 带 `supersedes`，F3 `fact` | 仅 1 条 `resolve-open-question`，`ownerHint=null`，`ownerMissingReason="not-stated-in-source"`；F2 进 `noTaskReasons(superseded-knowledge-needs-review)`；`warnings` 含 `C3-disabled-pending-S016` |
| E15 | 调用方传入的 `meetingRecordRef.contentDigest` 与服务端不符 | 返回 `S017_SOURCE_DIGEST_MISMATCH`，无部分输出 |
| E16 | grader 自检：人为把 E2 的 `requiresConfirmation` 置 false | 返回 `S017_INVARIANT_VIOLATION`，`detail` 含 `J4` |

- G5 基线：同夹具下无 Skill 的通用 Agent 直接「从纪要里列出行动项」。主指标为 F1 / F2 / F3 / F5 / F6 违例数，S017 须严格少于基线才能 verified。
- 真实模型 lane 至少覆盖 E2、E4、E6（`real-model-e2e`）。

## 14. 与已 PASS / 已作者化文档的接口对齐
- **S006（PASS）**：输入字段按 S006 §7 原样消费：`commitmentCandidates[].{candidateId, utterance, committer, side, dueAsStated, relatedDecisionId, evidence}`、`decisions[].{decisionId, decisionState, condition, supersedes}`、`contentOriginatedRequests[]`、`distributionHint`、`sensitivityFlags`、`metadata.meetingType`。S006 决策 2 说「换算交给 S017」，本文按决策 2 只承担语言层解析；这不改变 S006 的输出。
- **S063（PASS）**：只消费 `findings[]` 中 `kind = knowledge-candidate` 的 `captureKind`、`claim`、`supersedes`、`findingId`。S063 §4.5 C3 的措辞「交给 S017 入库」与本文 §1「S017 不做知识入库」不一致，见 §15 提议 2。
- **S142（`reviews/S142.review.md` 为 Verdict: PASS，按其 PASS 版对齐）**：投影规则
  - `candidateId ← taskCandidateId`（W002 内唯一）；`title`、`dueAsStated` 同名直搬。
  - `ownerHint ← { principalId?, side }`；S142 的 `displayName?` 留空（理由见 T7）。S142 M2 只按 `ownerCandidates` 精确匹配 principal，无 principalId 时进 `needsOwner(missing / external-party)`，与 S017 的 `ownerMissingReason` 语义相容。
  - `sourceRefs = [{ kind: "s017-task", id: `${setId}:${taskCandidateId}` }]`——`s017-task` 已在 S142 PASS 版 `sourceRefs.kind` 枚举中。
  - `executorHint` 不填（决策 4）。若上游 S006 的 `committer.ref` 恰是 `agent:` 前缀的 principal，S017 原样搬运为 `ownerHint.principalId`，不自行改写；S142 M2 会把它挪到 `executor` 并令 owner 进 `needsOwner(agent-as-owner)`（S142 EC3）。S017 从不**新增** Agent 执行者，因此与 S142 M2 相容。
  - 数量：S017 与 S142 同为 ≤ 200；S017 超限时报 `S017_TOO_MANY_CANDIDATES` 而不截断，保证 W002 不会触发 S142 `S142_CANDIDATE_LIMIT`；分批由 W002 负责。
  - `track-counterparty` 是否投影给 S142 由 W002 决定；若投影，S142 会进 `needsOwner(external-party)`（S142 EC11），不会误派我方人员。
  - 接口请求（针对 S142 PASS 版，不是图变更）：PASS 版 `WorkItemCandidate` 没有 `requiresConfirmation`、`decisionGate`、`dueExpression`、`taskKind` 字段。在 S142 修订前，W002 必须在 S017 与 S142 之间的人工门先处理 `requiresConfirmation = true` 的条目，只把人工确认过的投影给 S142；`dueExpression` 暂不投影，S142 仍按 `dueAsStated` 走其 M4。
- **S007（PASS 状态以其评审为准）**：S007 §13 把 S017 输出列为 UNVERIFIED；S007 在 W002 中经 S142 建卡后的 `workItemId` 追踪，不直接读 `TaskCandidateSet`。`track-counterparty` 条目若未建卡，S007 看不到——W002 作者需决定对方承诺是否以卡或其他载体跟踪。
- **S003（PASS）**：W006 中 S003 `dedupe` 与 S017 无数据接口。

## 15. Graph change proposals（仅提议，不在本文生效）
1. **CN 交办场景**：建议 S006 作者评估把「有决策权者点名分派、无口头异议」作为独立承诺候选类型（带 `acceptance = "unacknowledged"`）输出，而不是进 `unresolvedItems`。这是 S006 输出形状变更，不是矩阵边变更；若采纳，S017 T2 增加 `assigned-unacknowledged` 一级（恒 `requiresConfirmation`）。
2. **W006 中「入库」职责**：S063 把 S017 描述为知识入库的下游，但 S017 是任务抽取。W006 的知识写入由谁承担（S016？effect-gateway？）应由 W006 作者裁定；如果需要一个专门的「知识写入」Skill，是矩阵 owner 的决定。
3. **被取代知识的维护**：`superseded-knowledge-needs-review`（旧知识被新决定取代后，引用旧知识的文档要复核）目前没有 Skill 承担。若 W006 需要它作为任务产出，应作为 skillGap 或扩展 S017 的显式决定写入矩阵，本文不自行生成。
4. **D006 / D007 直接调用**：两者都拥有 W002，聊天中「把这段话的待办列出来」是高频场景；是否在其 Skill 列加 S017，交矩阵 owner 裁定。
