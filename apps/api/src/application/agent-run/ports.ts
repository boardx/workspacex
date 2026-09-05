/**
 * Ports for the minimal no-tool AgentRun (Wave 2 delta §5, #414).
 *
 * ## There is exactly one model port, and it takes no provider choice
 *
 * `ModelCallPort.complete` receives the run's PINNED `modelProvider`/`modelId` and either
 * performs that one call or refuses. It has no "try the next one" parameter, no candidate
 * list and no default. §5 says one configured provider and no fallback; a port shaped to
 * accept alternatives would make that a discipline every future caller has to remember,
 * and the failure mode of forgetting is silent -- a run answered by a model nobody pinned.
 *
 * ## The snapshot is an INPUT to this layer, never something it resolves
 *
 * Everything the executor needs about the Agent arrives on `ClaimedAgentRun`, read from
 * the run row that #415 wrote at acceptance. Nothing here can ask for "the Agent's current
 * version": there is no method for it. That is deliberate -- §4 says an Agent's published
 * head moves while existing runs keep their stored version id, and a port that could
 * resolve a head is a port through which that invariant leaks.
 */
import { artifactsSteering as AS, errorObservability as EO, kernelGateway as KG, wave2Runtime as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** Derived from the contract's enums, never restated (ADR-020). */
export type RunFailureCode = z.infer<typeof C.AgentRunError>;
export type RunStepKind = z.infer<typeof C.AgentRunStepKind>;
export type RunLifecycleStatus = z.infer<typeof C.AgentRunStatus>;
/** #742 Gap 1 -- `"succeeded" | "failed" | "in_progress"`, derived from the contract's own
 * enum (never restated). `in_progress` is only ever produced for `kind: "tool_call"` steps. */
export type RunStepStatus = z.infer<typeof C.AgentRunStepStatus>;
/** Phase 14 F15 -- one row of `getRunTranscript`'s output, derived from the
 * `error-observability` contract bundle (never restated, ADR-020). */
export type TranscriptStep = z.infer<typeof EO.TranscriptStep>;

/**
 * Phase 14 F15 (R3'/R6) -- encrypts/decrypts the FULL (non-digest, non-truncated) content a
 * step's `inputDigest`/`outputDigest` were hashed from. Declared here (not a separate
 * `domain/agent-run/` port module) to match this bundle's existing convention: every
 * agent-run port, including the other infrastructure-implemented one (`ModelCallPort`
 * below), lives in this one file rather than a domain-layer indirection.
 *
 * Unlike `credential-vault.ts`'s `CredentialCipher`, this port MUST support `decrypt` --
 * see `transcript-content-cipher.ts`'s header for why the two are deliberately different
 * shapes despite sharing an algorithm.
 */
export interface TranscriptContentCipher {
  readonly algorithm: string;
  encrypt(plaintext: string): string;
  /**
   * `null` = cannot be recovered (missing/rotated key, tampered or malformed ciphertext) --
   * NEVER throws. I-4 requires the caller to turn this into `decryptStatus: "unreadable"`,
   * not an unhandled exception that would fail the whole transcript read over one bad row.
   */
  decrypt(ciphertext: string): string | null;
}

/**
 * The outcome of claiming one run.
 *
 * A union rather than "return only the good ones", because a claim already moved the row
 * out of `queued`: dropping the unresolvable ones on the floor would leave them `running`
 * with no step and no terminal state -- a message that is simply never answered, and the
 * one outcome an operator cannot act on. The executor fails them explicitly.
 */
export type ClaimOutcome =
  | { readonly kind: "executable"; readonly run: ClaimedAgentRun }
  | { readonly kind: "unresolvable"; readonly runId: string };

/**
 * V9-b 前置 A（#970）—— 一条消息挂着的附件**元数据**（文件名 + MIME，不含内容）。
 * V9-a 只上传+存储附件；附件**内容**进上下文是 B（F153/anydoc）。A 让模型至少*知道*
 * 有附件、能诚实说「我看到你传了 X（image/png），但还读不了它的内容」，而不是矢口否认。
 */
export interface HistoryAttachmentMeta {
  readonly filename: string;
  readonly mime: string;
  /**
   * V9-b（F153）—— 抽取状态：`pending` | `extracted` | `unsupported` | `failed`
   * （缺省视为 pending：尚未抽取/旧数据）。决定 `withAttachmentNotice` 怎么向模型交代这个附件。
   */
  readonly extractionStatus?: string;
  /**
   * V9-b（F153）—— 抽取内容的**有界摘录**（`extractionStatus==='extracted'` 时有；域
   * `boundedExcerpt` 已按 `EXTRACTED_EXCERPT_MAX_CHARS` 截断）。这就是折进模型上下文的正文。
   */
  readonly extractedExcerpt?: string;
}

/** One queued run, claimed for execution, carrying its whole acceptance snapshot. */
export interface ClaimedAgentRun {
  readonly runId: string;
  readonly threadId: string;
  /**
   * F155：改成 `string | null` 不是放宽，是**改正一处早就在说谎的类型**——`chat_threads.project_id`
   * 自 #594（个人线程）起可空，claim 的 `t.project_id` 因此一直可能是 `null`，而这里写着
   * `string`。在 L3 之前没有任何调用点读它，谎言没有代价；L3 的检索范围**恰恰以它是不是 null
   * 来选分支**（个人线程只吃本线程自有附件），继续写 `string` 会让「个人线程」这条分支在类型上
   * 永远走不到，实际却在运行时命中——最坏的一种绿。
   */
  readonly projectId: string | null;
  readonly inputMessageId: string;
  readonly inputText: string;
  /**
   * V9-b 前置 A（#970）—— 触发这次运行的那条人类消息挂的附件（元数据）。触发消息**不在**
   * `readThreadHistory` 里（它以 `inputText` 单独进模型），所以它的附件也要单独带，否则「刚
   * 传完就问」这条最常见路径恰好看不到附件。没有附件时是空数组。
   */
  readonly inputAttachments: readonly HistoryAttachmentMeta[];
  /**
   * F159 —— 谁触发了这次 run。`agent_runs` 没有这一列，值取自触发它的那条人类消息的
   * 作者（`chat_messages.author_id`，与 claim 同一次 JOIN 带出）。计量必须归属到人：
   * 配额是按人分配的，只有组织级总数的话「成员与配额」那一屏无从填。
   */
  readonly requesterUserId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly instructions: string;
  /** In the snapshot's order. The order is part of the pinned fact, not a set. */
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
  /**
   * issue #2667 -- "保留手动『每次都先计划』开关"。个人设置"每次都先给我看计划"
   * 打开时为 `true`，随本次 run 落库（`agent_runs.disable_task_auto_classify`）。
   * `executeClaimed` 建 `ModelCallInput` 时原样转发（`ModelCallInput.disableTaskAutoClassify`），
   * `deep-agent-model-provider.ts` 只在为 `true` 时才把
   * `configurable.disable_task_auto_classify` 这个键加进去（缺席 = 未覆盖，同
   * `script_protocol` 的既有透传纪律）。默认 `false`，与接入前逐字节相同。
   */
  readonly disableTaskAutoClassify: boolean;
  /**
   * DA-07b：非 null = 这是一次人裁决后的续跑——execute-run 据此让 provider 走
   * resume（command.resume）而不是把用户输入重发一遍。普通新 run 恒为 null。
   *
   * UX-9 D4：三态之 edit 带着改后参数一起来（判别联合让"edit 却没有参数"在类型上
   * 不可表示）：toolName 沿用停住时的待批工具（pending_tool_name，edit 不许换工具，
   * 见 contracts），editedArgsJson 是人改后的完整参数对象的 JSON 文本——由 provider
   * 解析并校验，坏 JSON 走 ModelCallError fail closed，不静默降级成 approve。
   *
   * Phase 14 F06：`deny` 是 `decideToolPermission` UC-6 四选一里"拒绝"的落点——
   * 与 `approve`/`edit` 走同一条 `awaiting_tool_permission → queued` 边，`execute-run.ts`
   * 据此让 provider 以 `resume:{decision:"reject"}` 续跑，内核收到拒绝结果后自己调整
   * 后续计划继续执行（R3 步骤 6），不是直接判定整个 run 失败。
   */
  readonly pendingDecision:
    | { readonly kind: "approve" }
    | { readonly kind: "edit"; readonly toolName: string; readonly editedArgsJson: string }
    | { readonly kind: "deny" }
    | null;
  /**
   * DA-07b resume 续号（HITL edit 端到端从未生效的根因修复，2026-08-24）。
   *
   * `executeClaimed` 给每一步一个固定的账本 seq（accepted=1 在 acceptance 事务里写；
   * context_built=2；tool_call/model_called 从 3 起累加）——这个假设只在"一个 run 从
   * `queued` 到终态只被 `executeClaimed` 处理一次"时成立。DA-07b 打破了它：一个停在
   * `awaiting_tool_permission` 的 run 已经写过 accepted/context_built/tool_call(in_progress)/
   * model_called(等待批准) 四行，人裁决后重新入队，`executeClaimed` 会被**第二次**调用
   * 续跑同一个 run——如果它仍从硬编码的 2/3 起步，`context_built` 那一行会撞上第一次
   * 执行时已经写在 seq=2 的行，`agent_run_steps_seq_uniq` 唯一约束直接拒绝这次 INSERT。
   *
   * 这个 INSERT 失败被 `executeQueuedRuns` 的兜底 catch 吞掉、转成通用的
   * `MODEL_CALL_FAILED`——终态卡片上看到的正是这个码，跟人到底有没有编辑参数、编辑后的
   * 值对不对**完全无关**：`approve`（不编辑）resume 会在同一处摔在同一个约束上。
   *
   * `undefined` = 这是一次全新的 run（`pendingDecision === null`），`executeClaimed`
   * 退回原来的硬编码 1（context_built=2, 首个 tool_call/model_called=3）——与本次改动
   * 之前逐字节相同。非 undefined 时是 claim 时刻这个 run 在 `agent_run_steps` 里已有的
   * 最大 seq（`PgAgentRunRepository.claimQueued` 用真实 `MAX(seq)` 查出来，不是猜的），
   * `executeClaimed` 从它之后继续编号，绝不撞已经落库的行。
   */
  readonly resumeStepSeqBase?: number;
}

export interface PinnedSkillContent {
  readonly versionId: string;
  readonly content: string;
  /**
   * The Skill's stable, tool-name-shaped identifier (#725). Matches the contract's
   * `StableName` pattern (`^[a-z0-9][a-z0-9-]*$`), a strict subset of what an OpenAI-style
   * function name allows -- used AS the tool name a run's orchestrator model sees, so a
   * skill's tool identity does not drift from the identity it already has everywhere else.
   */
  readonly stableName: string;
  /** Display name, for the tool description a human/model reads -- never the tool name itself. */
  readonly name: string;
}

/**
 * The one deep-agent provider name (#740). Declared here, not in
 * `infrastructure/agent-run/deep-agent-model-provider.ts` where it originally lived,
 * because design-delta `skill-lazy-loading` needs to compare `run.modelProvider` against
 * it from `application/agent-run/execute-run.ts` -- an `application`-layer file may only
 * import `domain`, never `infrastructure` (`lint-arch-deps.mjs`, ADR-020). Moving the ONE
 * declaration to the layer both sides can reach, rather than adding a second `const` with
 * the same string in `execute-run.ts`, keeps this a single-source fact (AGENTS.md: "同一
 * 事实不得声明在两处"). `deep-agent-model-provider.ts` re-exports it so its existing
 * importers (`kernel.module.ts`, `pg-chat-message-command-repository.ts`,
 * `pg-default-agent-repository.ts`) do not need their import paths touched.
 */
export const DEEP_AGENT_PROVIDER_NAME = "deep-agent";

/**
 * 2026-08-30 —— `AgentRunStore.reclaimStaleRunning`（该方法自己的文档有完整取证）的
 * "卡够久"默认阈值。两个调用点（`AgentRunExecutor.tick()` 的下一条消息触发、
 * `readAgentRun` 的单条只读请求触发）共享同一个值，不是两处各自定义一份"20 分钟"，
 * 同 `DEEP_AGENT_PROVIDER_NAME` 上面那条既有先例（AGENTS.md "同一事实不得声明在两处"）。
 * `AgentRunExecutor` 允许通过 `KERNEL_AGENT_RUN_STALE_RUNNING_MS` 覆盖它自己那一路的值
 * （运维需要调参时不必改代码）；`readAgentRun` 这一路读的是这个常量本身，不接 env——
 * 一个只读请求的判定不应该因为部署环境不同而答案不同。
 */
export const DEFAULT_STALE_RUNNING_THRESHOLD_MS = 20 * 60_000;

export interface AppendedRunStep {
  readonly runId: string;
  readonly seq: number;
  readonly kind: RunStepKind;
  readonly status: RunStepStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly inputDigest: string | null;
  readonly outputDigest: string | null;
  readonly failureCode: RunFailureCode | null;
  /** `tool_call` steps only (#725) -- see `AgentRunStep`'s own doc comment for why these are
   * short summaries rather than digests. `null` for every other step kind. */
  readonly toolName: string | null;
  readonly toolArgsSummary: string | null;
  readonly toolResultSummary: string | null;
  /** `tool_call` steps only (#731 follow-up) -- see `AgentRunStep.planningNote`'s own doc
   * comment. `null` when the model called the tool with no accompanying explanation. */
  readonly planningNote: string | null;
  /**
   * #742 Gap 1 -- `tool_call` steps only. A provider-supplied stable id for ONE logical
   * tool invocation, present on BOTH the `in_progress` row this invocation writes when the
   * call starts AND the terminal (`succeeded`/`failed`) row it writes when the call ends.
   *
   * `agent_run_steps` is append-only at the database level (grants + trigger, see
   * `no-tool-run-writeback.test.ts` "run steps are append-only in the database, not by
   * convention") -- there is no UPDATE path to flip one row's status in place. This id is
   * how the READ side (`pg-agent-run-repository.ts`'s `readRun`) recognizes that two rows
   * are the SAME logical call and collapses them to the most current one instead of
   * rendering a phantom duplicate. `null` for every non-`tool_call` step, and for a
   * `tool_call` step whose provider does not supply a stable id (falls back to the
   * pre-#742 behaviour: one row, one call, no correlation needed).
   */
  readonly toolCallId: string | null;
  /**
   * Phase 14 F15 (R3'/R6) -- the FULL plaintext `inputDigest`/`outputDigest` above were
   * hashed FROM, when the caller has it in hand. `undefined` (every call site this cut does
   * not thread it through -- currently `tool_call`, see `execute-run.ts`'s `record()` header
   * for why full tool-call content is deferred follow-up work) behaves identically to how
   * this interface behaved before these fields existed: no full-content column is written,
   * and `getRunTranscript` reports that step honestly as `decryptStatus: "unreadable"` (I-4)
   * rather than fabricating a value.
   *
   * A plaintext string on the wire between `application` and this port is deliberate, not an
   * oversight: onion layering forbids `execute-run.ts` (application) from importing
   * `TranscriptContentCipher`'s infrastructure implementation directly (ADR-020) --
   * encryption happens entirely inside `PgAgentRunRepository.appendStep`, which already
   * lives in `infrastructure` and may hold the cipher.
   */
  readonly inputFullContent?: string | null;
  readonly outputFullContent?: string | null;
}

/**
 * One token-level increment of a run's model output (#654 阶段2a).
 *
 * Deliberately NOT an `AppendedRunStep`/`RunStepKind` variant -- see the migration's own
 * header (`20260808120000_i654_agent_run_deltas.sql`) for why the two shapes do not share
 * a table: steps are four coarse, statused phases mirrored 1:1 with a contract enum;
 * deltas are dozens-to-hundreds of plain text fragments with no status of their own. The
 * run's `model_called` step still records success/failure exactly as before -- deltas are
 * an ADDITIONAL, purely observational trail, never a second source of truth for whether
 * the call succeeded.
 */
export interface AppendedRunDelta {
  readonly runId: string;
  readonly seq: number;
  readonly text: string;
}

/** One delta read back, in `seq` order. */
export interface RunDelta {
  readonly seq: number;
  readonly text: string;
  readonly createdAt: string;
}

/** What `GET /agent-runs/:runId` projects, once the requester has been cleared. */
export interface RunProjection {
  readonly runId: string;
  readonly threadId: string;
  readonly inputMessageId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
  readonly status: RunLifecycleStatus;
  readonly error: RunFailureCode | null;
  readonly resultMessageId: string | null;
  /**
   * #742 Gap 1: `toolCallId` is excluded here on purpose. It exists only so the
   * append-only ledger's read side (`pg-agent-run-repository.ts`'s `readRun`) can fold an
   * `in_progress` row and its later terminal row into ONE projected step; by the time a
   * step reaches this projection that folding has already happened, so every step here is
   * exactly what a client should render -- no correlation id for it to reconstruct. The
   * public contract (`AgentRunStep`, `.strict()`) has never had this field and does not
   * gain one now.
   */
  readonly steps: readonly Omit<AppendedRunStep, "runId" | "seq" | "toolCallId">[];
  readonly createdAt: string;
  /** DA-07b：等待裁决的工具摘要；非 awaiting_tool_permission 时为 null。
   * （pending_decision 列刻意**不**投影到这里：它是 executor 的内部执行细节，
   * 走 ClaimedAgentRun.pendingDecision；对外视图多一个键就会被 AgentRunView
   * 的 .strict() 拒绝——29 个既有测试当场教的。） */
  readonly pendingApproval: { readonly toolName: string; readonly argsSummary: string | null } | null;
}

/** Ids only -- enough to ASK the visibility question, never enough to answer it. */
export interface RunLocator {
  readonly threadId: string;
  readonly projectId: string;
}

/**
 * A run whose model output is stored and whose Chat writeback has not committed yet (§6).
 *
 * `text` is the output #414 stored on the run, not a fresh completion: a retry must write
 * back the answer the single model call produced, never call the provider again. That is
 * why this carries the text instead of enough context to regenerate it.
 */
/**
 * #1624 —— 一次 run 在沙箱里跑出来的文件的**引用**（字节已在对象存储里）。
 *
 * 跟着 run 从执行走到写回事务，由 `commitWriteback` 挂成助手消息的附件
 * （复用 #946 的 `chat_message_attachments` + 既有下载路由，不新造产物语义）。
 * 空数组 ⇒ 这一轮没有产物，写回与本次改动之前逐字节相同。
 */
export interface RunOutputFile {
  readonly name: string;
  readonly mime: string;
  readonly sizeBytes: number;
  /** `ObjectStore` 的键。字节本体不经过这里，也不进数据库。 */
  readonly objectKey: string;
}

export interface PendingWriteback {
  readonly runId: string;
  readonly threadId: string;
  readonly inputMessageId: string;
  readonly agentId: string;
  readonly text: string;
  /** Attempts already spent from the bounded budget. */
  readonly attempts: number;
  /**
   * #1624 —— 这一轮沙箱产出的文件引用。**可选**：缺省/空 ⇒ 写回不插任何附件行，
   * 与本次改动之前逐字节相同（既有测试替身不必都改，这是不回归的保证之一）。
   */
  readonly files?: readonly RunOutputFile[];
}

export interface AgentRunStore {
  /**
   * Atomically move up to `limit` of this tenant's `queued` runs to `running` and return
   * their snapshots. The claim IS the exactly-once guarantee: two concurrent executors
   * cannot both leave `queued`, so the single model call cannot be made twice.
   */
  claimQueued(orgId: OrgId, limit: number): Promise<readonly ClaimOutcome[]>;

  /**
   * The pinned Skill versions' root `SKILL.md`, in the order asked for.
   *
   * Returns fewer entries than requested when a pinned version is unreachable; the caller
   * fails the run. It must NOT silently substitute a newer version or drop the entry --
   * that would turn "runs never resolve a mutable latest" (§3) into a best-effort claim.
   */
  readPinnedSkills(
    orgId: OrgId,
    versionIds: readonly string[],
  ): Promise<readonly PinnedSkillContent[]>;

  appendStep(orgId: OrgId, step: AppendedRunStep): Promise<void>;

  /**
   * Append one token-level delta (#654 阶段2a). Callers pass a monotonically increasing
   * `seq` starting at 0 per run; the unique `(org_id, run_id, seq)` constraint is what
   * makes a duplicate append (e.g. a retried write) a no-op collision rather than a second
   * copy of the same fragment.
   */
  appendModelDelta(orgId: OrgId, delta: AppendedRunDelta): Promise<void>;

  /** Deltas for one run, in `seq` order, strictly after `afterSeq` (`-1` = from the start). */
  readModelDeltas(orgId: OrgId, runId: string, afterSeq: number): Promise<readonly RunDelta[]>;

  /**
   * Store the model call's output and enter `writeback_pending` (§6's first step).
   *
   * `finalStepSeq` is the `seq` the caller recorded the terminal `model_called` step under
   * (#725: no longer always `3` -- a tool-calling run's `model_called` step lands after
   * however many `tool_call` steps the loop recorded). #413's writeback step and any #519
   * retry are appended AFTER it (`finalStepSeq + 1 + retryCount`, computed in the SQL
   * layer): the alternative, a hardcoded `4`, is exactly the number a tool-calling run's
   * variable step count would silently collide with.
   */
  storeOutputAwaitingWriteback(
    orgId: OrgId,
    runId: string,
    output: {
      readonly text: string;
      readonly finalStepSeq: number;
      /** #1624：沙箱产出的文件引用。缺省 ⇒ 该列保持 `'[]'`，行为与改动前逐字节相同。 */
      readonly files?: readonly RunOutputFile[];
    },
  ): Promise<void>;

  /** Terminal failure with a stable, enumerated code. There is no free-text variant. */
  failRun(orgId: OrgId, runId: string, code: RunFailureCode): Promise<void>;

  /**
   * DA-07b：running → awaiting_tool_permission，同时落等待裁决的工具摘要。
   * 触发器只放行 running 起跳——在其他状态上调用会被 DB 拒绝，这是对的。
   */
  markAwaitingToolPermission(
    orgId: OrgId, runId: string,
    pending: { readonly toolName: string; readonly argsSummary: string | null },
  ): Promise<void>;

  /**
   * DA-07b：awaiting_tool_permission → running（人批准），并记 pending_decision='approve'
   * 供 executor 重新领 run 时让 provider 走 resume。返回 false = run 不在
   * awaiting_tool_permission（并发裁决/已终态），调用方按冲突处理，不重试。
   */
  approveAndRequeue(orgId: OrgId, runId: string): Promise<boolean>;

  /**
   * UX-9 D4：awaiting_tool_permission → queued（人改参数后放行），记 pending_decision='edit'
   * 且把改后的完整参数对象（JSON 文本）落 pending_edited_args——executor 重新领 run
   * 时 provider 据此发 EditDecision resume。返回语义与 approveAndRequeue 完全一致：
   * false = 输了竞态，调用方按冲突处理，不重试不覆盖。
   */
  editAndRequeue(orgId: OrgId, runId: string, editedArgsJson: string): Promise<boolean>;

  /**
   * Phase 14 F06（`plan-permissions` UC-6 `decideToolPermission`，decision `"deny"`）：
   * awaiting_tool_permission → queued（人拒绝，但内核据此调整计划继续跑，不是直接
   * 判定整个 run 失败，R3 步骤 6），记 pending_decision='deny'——executor 重新领 run
   * 时 provider 据此发 `resume:{decision:"reject"}`（引擎侧 HumanInTheLoopMiddleware
   * 早已支持的原生拒绝语义）。返回语义与 approveAndRequeue 一致：false = 输了竞态，
   * 调用方按冲突处理，不重试不覆盖。
   *
   * ⚠ 与旧 DA-07b 单工具审批弹层的 `decideAgentRun({decision:"reject"})` 是两条不同的
   * 出口：那条走 `failRun("HITL_REJECTED")`，服务的是尚未迁移到本契约束的
   * CopilotKit `useHumanInTheLoop` 三键弹层（F07/F08 迁移前维持原状，见该函数文件头）。
   * 本方法只服务新的四选一工具权限确认弹层。
   */
  denyAndRequeue(orgId: OrgId, runId: string): Promise<boolean>;

  /**
   * 2026-08-30（session-switch-task-state-loss 前端修复上线后，真栈实测发现的对偶
   * 后端缺口）—— `running` 是唯一一个没有任何"下一条消息自动捞回"机制的中间态。
   * `queued`（本文件头注）与 `writeback_pending`（`writeBackPendingRuns` "unconditionally"
   * 重试）都明写了"进程死在这一步，下一条消息的 kick 会捞回来"；`claimQueued` 的
   * `UPDATE ... WHERE status='queued'` 决定了这条捞回规则唯一排除的就是已经被 claim
   * 走、状态已经翻成 `running` 的行——处理这条 run 的进程如果在模型调用返回之前死掉
   * （容器重启/OOM/无超时的挂起网络调用），这一行就永久卡在 `running`，没有任何路径
   * 能再碰到它。`executeQueuedRuns` 自己的 catch 分支只挡得住"本次 tick 内、同一个
   * await 链上抛出的异常"——挡不住进程本身消失。
   *
   * `AgentRunExecutor.tick()` 每次被 kick 时先跑这个函数，再跑 `claimQueued`：把
   * "已经卡够久"的 `running` 行标记失败（复用既有 `MODEL_CALL_FAILED` 码，不新增
   * 契约枚举——`executeQueuedRuns` 自己的"执行器缺陷"分支已经在用同一个码表达"这次
   * 没能拿到可用结果"，语义对得上）。阈值必须**明显大于**任何健康部署下单个 run
   * 应该花的时间（`DeepAgentModelProvider` 自己的 `KERNEL_DEEP_AGENT_TIMEOUT_MS`
   * 默认 5 分钟）——太短会误杀正常运行中的慢 run。
   *
   * 只处理 `running`：`writeback_pending`/`awaiting_tool_permission` 已经各自有名副其实的
   * 恢复路径（前者见上、后者等的是人的裁决，本身就该长期挂起），不该被这个函数一起
   * 扫进去当"卡住"处理。
   *
   * ⚠ **2026-08-30 续（devapp 真栈复现，第一版留的洞）**——`tick()` 只在"下一条消息"
   * 触发的 kick 里跑；用户提交一条任务后**只刷新页面、不再发第二条消息**（前端
   * `useCopilotKitV2RunRestore` 轮询 `GET /agent-runs/:runId` 就是这个纯读路径）
   * 永远等不到下一次 kick，卡住的行因此永远等不到被捞回的那一刻——"刷新应该能快速
   * 恢复"这条判据在这种最常见的复现步骤下没有兑现。`readAgentRun`（`read-run.ts`）
   * 现在也在读到 `status==='running'` 时调用这个方法——单条只读请求就能让它自愈，
   * 不必等另一条消息。两处调用点共享同一份判定（`DEFAULT_STALE_RUNNING_THRESHOLD_MS`），
   * 不是两次独立发明"多久算卡住"。
   */
  reclaimStaleRunning(orgId: OrgId, olderThanMs: number): Promise<number>;

  /** Runs sitting in `writeback_pending`, including ones stranded by a process restart. */
  claimWritebackPending(orgId: OrgId, limit: number): Promise<readonly PendingWriteback[]>;

  /**
   * The §6 transaction: insert the ONE assistant message, append the `chat_writeback` step,
   * and move the run to `succeeded` -- all or nothing.
   *
   * Returns the message id, which on a retry is the EXISTING row's: the unique
   * `agent_run_id` index is what makes the second attempt a no-op rather than a second
   * reply. There is no separate "did it already exist" flag, because no caller may behave
   * differently -- an implementation that can tell the two apart is one that can be made to
   * write a second message.
   */
  commitWriteback(
    orgId: OrgId,
    input: {
      readonly runId: string;
      readonly threadId: string;
      readonly inputMessageId: string;
      readonly agentId: string;
      readonly text: string;
      readonly startedAt: string;
      readonly endedAt: string;
      readonly outputDigest: string;
      /**
       * #1624：随这条助手消息一起挂上去的附件（沙箱产出）。**同一个事务**——
       * 消息存在而附件不存在，用户就会看到一条说"文件见附件"却没有附件的回复。
       * 缺省/空 ⇒ 不插任何附件行。重试时按 `(message_id, storage_ref)` 幂等，
       * 不会因为写回重试而挂上两份同一个文件。
       */
      readonly files?: readonly RunOutputFile[];
    },
  ): Promise<{ readonly messageId: string }>;

  /**
   * Spend one attempt from the bounded budget and report the new total.
   *
   * Its own transaction: the attempt that failed rolled back, so an increment written
   * inside it would be lost and the run would retry without bound.
   */
  recordWritebackAttempt(orgId: OrgId, runId: string): Promise<number>;

  /**
   * Reopen an exhausted writeback for one more bounded budget (#519). Returns whether a run
   * was actually reopened.
   *
   * A boolean rather than a throw, and the state test lives in the SQL rather than in the
   * caller: "is this run retryable?" read in the application and acted on in a later
   * statement is a race whose loser reopens a run that just succeeded. The predicate and the
   * write are one statement, and the database's transition trigger refuses the move
   * independently -- see `20260805190000_i519_agent_run_retry.sql`.
   *
   * It reopens to `writeback_pending`, NOT to `queued`: the model was already called once
   * and its output is stored, so re-queueing would make a second provider call for one human
   * message. What ran out was the writeback budget, so the writeback is what resumes.
   */
  reopenForWritebackRetry(orgId: OrgId, runId: string): Promise<boolean>;

  /** The failed `chat_writeback` step written once, when the budget is exhausted. */
  appendWritebackFailure(
    orgId: OrgId,
    input: { readonly runId: string; readonly startedAt: string; readonly endedAt: string },
  ): Promise<void>;

  findLocator(orgId: OrgId, runId: string): Promise<RunLocator | null>;

  /**
   * Phase 14 F11（`artifacts-steering` 契约束 R5）—— `interjectAgentRun` 判定"调用者是否
   * 是该 run 的发起者"要用的那个人的 id（同 `ClaimedAgentRun.requesterUserId` 的既有事实：
   * 触发这次 run 的那条人类消息的作者）。`null` = run 不存在。
   *
   * **可选**：既有的众多 `AgentRunStore` fake 不需要跟着改（同 `readRunTranscriptSteps`
   * 之外，本接口目前唯一的可选方法）——缺省时 `interjectAgentRun` 拿到 `undefined`，
   * fail closed 视同"确认不了发起者"而拒绝，不是静默放行。
   */
  findRequesterUserId?(orgId: OrgId, runId: string): Promise<string | null>;

  /**
   * DA-19g -- the AG-UI/CopilotRuntime bridge's HITL resume entry point (`copilotkit-agui.
   * controller.ts`'s `bridge()`) receives CopilotKit's follow-up `runAgent` request as a
   * brand-new top-level POST with NO run id on it (`respond()`'s synthesized tool-result
   * message only carries `forwardedProps.chatThreadId`, see that controller's own doc) --
   * unlike `/agent-runs/:runId/decision` (DA-07b), which always has one in the URL. This is
   * the one new lookup that closes that gap: "the run this Chat thread is currently paused
   * on", so the bridge can hand it straight to the SAME `decideAgentRun` the REST route uses,
   * not a second decision-making implementation.
   *
   * A thread can have at most one `awaiting_tool_permission` run at a time (the agent loop is
   * strictly sequential -- a run halts entirely on interrupt, see `execute-run.ts`'s
   * `completion.interrupted` branch), so this never has an actual "which one" ambiguity to
   * resolve; the `ORDER BY ... LIMIT 1` is defensive tidiness, not a real tie-break. `null`
   * covers both "no run ever paused here" and "already resolved" (approved/edited/rejected
   * since the client's last observation, or simply a stale/duplicate follow-up) -- the caller
   * treats both the same way: there is nothing left to resume.
   */
  findAwaitingToolPermissionRunId(orgId: OrgId, threadId: string): Promise<string | null>;

  readRun(orgId: OrgId, runId: string): Promise<Guarded<RunProjection> | null>;

  /**
   * Prior turns in this run's thread, strictly before `beforeMessageId`, in CHRONOLOGICAL
   * order (oldest of the kept window first). Only the most recent `limit` are returned --
   * the caller (`execute-run.ts`) applies its own character budget on top of this row cap,
   * but the row cap exists so a very long thread never asks Postgres to sort/return
   * thousands of rows just to throw most of them away one layer up (#709 multi-turn context).
   *
   * `beforeMessageId` must belong to the same thread; a message id from elsewhere yields an
   * empty result rather than an error -- this is prior conversation context, not a fact the
   * run's correctness depends on, so "found nothing" is a safe, quiet answer.
   */
  readThreadHistory(
    orgId: OrgId,
    threadId: string,
    beforeMessageId: string,
    limit: number,
  ): Promise<readonly ThreadHistoryMessage[]>;

  /** F154 L2 —— 读该线程的持久滚动摘要状态（`thread_context_state`）。还没摘要过 → null。 */
  readThreadContextState(orgId: OrgId, threadId: string): Promise<ThreadContextState | null>;

  /**
   * F154 L2 —— 增量 upsert 该线程的滚动摘要。`expectedVersion` 做乐观并发：撞并发（version 已变）
   * **不静默覆盖**，跳过本次写回并回 `false`。L2 是降级安全的（摘要没写成不 fail run，见
   * execute-run 组装），所以并发冲突安全放弃即可。首次写入传 `expectedVersion: 0`。
   */
  upsertThreadContextState(
    orgId: OrgId,
    threadId: string,
    state: {
      readonly summary: string;
      readonly summarizedThroughId: string | null;
      readonly summarizedThroughAt: string | null;
      readonly expectedVersion: number;
    },
  ): Promise<boolean>;

  /**
   * Phase 14 F15 -- the audit-only read behind `getRunTranscript` (R3'/R6). `null` = the run
   * does not exist in this org (RUN_NOT_FOUND; RLS already means "another org's run" and
   * "no such run" are indistinguishable here, which is fine -- `get-run-transcript.ts`
   * checks the caller's `admin` role BEFORE calling this, so this is never an existence
   * oracle for an untrusted caller).
   *
   * Unlike `readRun`'s client-facing projection, this does NOT fold `in_progress`/terminal
   * `tool_call` pairs into one row -- the audit trail is the raw ledger, not the
   * client-friendly collapsed view. Only `model_call`/`tool_call` kinds are returned (the
   * other two `agent_run_steps` kinds -- `accepted`/`context_built`/`chat_writeback` --
   * carry no "prompt/response" content the contract's `TranscriptStepKind` has a slot for);
   * `plan_change`/`permission_decision` do not appear because no code path produces a step
   * of either kind yet (Phase 14's plan-mode/permissions bundle is not implemented).
   */
  readRunTranscriptSteps(orgId: OrgId, runId: string): Promise<readonly TranscriptStep[] | null>;
}

/**
 * One prior turn, already collapsed from `chat_messages.author_kind` ("human"/"agent") to
 * the `user`/`assistant` vocabulary every `ModelCallPort` implementation speaks -- the
 * repository does that mapping once here, so it is not re-decided at each of the three
 * provider implementations that read `ModelCallInput.history`.
 */
/**
 * F154 L2 —— 一条对话的持久滚动摘要状态（`thread_context_state` 一行）。L1（近 N 条逐字）之外的
 * 更早历史被折进 `summary`，组装时前置成一条 assistant 伪消息，打破 `HISTORY_MAX_MESSAGES` 硬上限。
 * `summarizedThrough{Id,At}` 是「已折到哪」的边界游标（(created_at,id) 单调）：下次只摘这之后的新消息。
 * `version` 是乐观并发的写回条件（读到多少就以多少为条件 upsert，撞并发不静默覆盖）。
 */
export interface ThreadContextState {
  readonly summary: string;
  readonly summarizedThroughId: string | null;
  readonly summarizedThroughAt: string | null;
  readonly version: number;
}

export interface ThreadHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  /**
   * V9-b 前置 A（#970）—— 这条历史消息挂的附件（元数据；见 `HistoryAttachmentMeta`）。
   * 空/缺省 = 没有附件。B（F153/anydoc）会在此之外再补抽取内容——A 是 B 的地基，不重做。
   */
  readonly attachments?: readonly HistoryAttachmentMeta[];
  /**
   * F154 L2 —— 这条历史消息的 `chat_messages.id`。**可选**：既有构造点（测试 fake、trial-run
   * 等不关心持久化的路径）不必填，L2 的增量摘要判定只在 id 存在时才尝试推进游标——任何一条
   * 缺 id 就保守跳过本轮 L2 增量（沿用已有摘要，不猜、不崩），与本层「降级不 fail run」的
   * 整体哲学一致。真实 Pg 读路径（`readThreadHistory`）总是填它。
   */
  readonly id?: string;
}

/**
 * #741 -- `ToolDefinition`/`ToolCallRequest`/`ToolExchangeTurn` (#725) retired along with
 * the TS in-process tool loop they only existed to serve (see `execute-run.ts`'s own
 * header for the replacement). They are gone from this file, not merely unused: nothing
 * produces a `ToolDefinition` or reads a `ToolCallRequest` anymore, and AGENTS.md's own
 * "same fact must not be declared in two places" discipline treats a type nobody
 * populates as exactly the kind of look-alive-but-dead surface that rule exists to catch.
 * `AppendedRunStep`'s `toolName`/`toolArgsSummary`/`toolResultSummary`/`planningNote`
 * fields (and the `tool_call` `RunStepKind`) are NOT part of this retirement -- those
 * belong to the run-step persistence schema and the Chat UI that renders it (#730-#734),
 * a broader, still-live surface this PR does not touch.
 */
/**
 * #742 -- one structured progress signal surfaced WHILE a run is still in flight, for a
 * provider whose "how does it get smarter" mechanism is a REMOTE, multi-step planning loop
 * rather than the in-process TS tool loop (#725) `execute-run.ts` otherwise runs. Today's
 * only intended implementer is `DeepAgentModelProvider` (issue #740/#747, talking to
 * `apps/deep-agent-service`'s `deepagents` graph, #739) -- see that file's own header
 * (once it lands) for how a real LangGraph run's intermediate state maps to this shape.
 *
 * Deliberately reuses the EXACT fields `AppendedRunStep`'s `tool_call` kind already
 * carries (`toolName`/`toolArgsSummary`/`toolResultSummary`/`planningNote`, see that
 * type's own doc comment) rather than inventing a second "what did a step look like"
 * vocabulary -- the Chat UI (#730-#734) already knows how to render exactly this shape,
 * so a provider that emits these needs ZERO frontend work to become visible.
 *
 * ⚠ #742 (investigation: issue #742's own comment thread) -- the mapping from a REAL
 * `deepagents`/LangGraph run's actual wire shape to this event has not been verified
 * end-to-end (no environment in this session could run Python ≥3.11, which `deepagents`
 * requires). What IS verified: `execute-run.ts`'s handling of a stream of these events
 * (recording each as a real `tool_call` step, in order, before the run's terminal state)
 * against a fake `ModelCallPort` -- see `completeWithProgress`'s own doc comment and
 * `execute-run-progress.test.ts`. This type and the plumbing around it are the "connect
 * once the real service can be observed" layer the human asked for; they are not, on
 * their own, proof `DeepAgentModelProvider` will populate them correctly.
 */
export interface ModelCallProgressEvent {
  readonly toolName: string;
  readonly toolArgsSummary: string | null;
  readonly toolResultSummary: string | null;
  readonly planningNote: string | null;
  /**
   * #742 Gap 1（CopilotKit 对标：进行中态）—— 两个新增的可选字段，S1=B 双轨纪律：
   * 不传时行为与加这两个字段之前逐字相同（`phase` 缺席按 `"complete"` 处置，一个
   * 事件=一条终态记录，与今天完全一样）。
   *
   * `phase`：这次事件是「工具刚被宣布调用、还没拿到结果」（`"in_progress"`）还是
   * 「已经拿到结果」（`"complete"`，缺省值）。只有前者会在账本里落一条 `in_progress`
   * 记录；`execute-run.ts` 不替 provider 猜测，provider 不传就永远走终态路径。
   *
   * `toolCallId`：provider 自己对这次工具调用的稳定标识（`DeepAgentModelProvider` 用的
   * 是 LangChain `tool_call_id`）。`phase: "in_progress"` 与随后那次 `phase: "complete"`
   * / 缺省事件如果是**同一次调用**，必须带同一个 `toolCallId`——读端靠它把 append-only
   * 账本里的两行折叠成用户看到的一张卡片（见 `AppendedRunStep.toolCallId` 头注）。
   * 不传（`null`/缺席）等价于「这个 provider 不报进行中态，也不需要折叠」。
   */
  readonly phase?: "in_progress" | "complete";
  readonly toolCallId?: string | null;
  /**
   * Phase 14 F03 (`streaming-transport` 契约束, R6 后置条件) -- `ToolCallStartEvent.args`/
   * `ToolCallEndEvent.result` on the new WS event bus must carry the **完整**入参/结果，
   * 不是截断摘要 -- `toolArgsSummary`/`toolResultSummary` above are already truncated
   * (`summarizeProgressText`'s 500-char default, or 4000 for a short allow-list) for
   * on-ledger VISIBILITY, so they cannot serve that requirement. These two optional fields
   * carry the untruncated values a provider already has in hand before it summarizes --
   * `DeepAgentModelProvider` populates them from the real `tool_calls[].args` object and the
   * raw `ToolMessage.content` (see `extractToolCallEvents`'s own doc). Optional and
   * additive: a provider that doesn't populate them (every provider that predates this
   * feature, and any future one that doesn't bother) simply produces a WS event whose
   * `args`/`result` fall back to `{}`/`null` at the `execute-run.ts` call site -- never a
   * thrown error, never a behaviour change to the LEDGER (`toolArgsSummary`/
   * `toolResultSummary` are untouched by this addition).
   */
  readonly toolArgsFull?: unknown;
  readonly toolResultFull?: unknown;
}

/**
 * P2（#1561）—— 推理侧图像输入的三个封闭事实：允许的 mime、单张体积上限、单轮张数上限。
 *
 * ## 为什么上限在这里，而不在 provider 里
 *
 * 它是**端口的**约束，不是某一个 provider 的实现细节：`execute-run.ts` 要在调用之前就
 * 决定哪几张图送、哪几张不送、并把不送的原因如实写给模型（#1561 硬性纪律「超限时如实
 * 报错，不静默截断」）。把上限藏在 provider 里，调用点就只能事后从一个失败里猜发生了
 * 什么，而那时候用户已经拿到一个看起来正常、其实少看了两张图的回答。
 *
 * 数值取舍：单张 8 MiB 与上传侧既有的附件体积门（`chat-file-upload` 契约）同量级但更严，
 * 因为这里的字节还要 base64 展开进一个 JSON 请求体（约 4/3 膨胀）；张数 4 是保守起步值——
 * 它不是任何上游文档里的硬限制，是本部署为「一次请求体不至于失控」定的自有边界。
 */
export const MODEL_CALL_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ModelCallImageMime = (typeof MODEL_CALL_IMAGE_MIMES)[number];

export function isModelCallImageMime(mime: string): mime is ModelCallImageMime {
  return (MODEL_CALL_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** 单张图送进模型的原始字节上限（base64 之前）。 */
export const MODEL_CALL_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 单轮送进模型的图片张数上限。 */
export const MODEL_CALL_MAX_IMAGES = 4;

/**
 * 一张真的要交给模型去看的图。
 *
 * `bytes` 是**原始字节**，不是 data URL 也不是 base64 字符串——编码是线上协议形态，
 * 属于各 provider 自己的事（DashScope 的 OpenAI 兼容端点吃 `data:<mime>;base64,`，
 * 别家可能吃别的）。在端口这一层就固化成某一种编码，等于把一个 provider 的线上形态
 * 写进了所有 provider 共用的类型。
 */
export interface ModelCallImage {
  readonly filename: string;
  readonly mime: ModelCallImageMime;
  readonly bytes: Uint8Array;
}

export interface ModelCallInput {
  readonly modelProvider: string;
  readonly modelId: string;
  /**
   * Phase 14 后续 A（#2755，`artifacts-steering` R3'/R12）：上一次内核调用的检查点
   * （`checkPendingInterjection`）消费到、尚未投递给内核的那条插话——随**这一次**
   * 调用回灌内核，让它据此真正重规划，而不是只在账本 `planningNote` 里留痕。
   *
   * OPTIONAL，且只有 deep-agent provider 读它（投影到 LangGraph
   * `config.configurable[KERNEL_INTERJECTION_CONFIGURABLE_KEY]`，`harness.py` 的
   * `InterjectionMiddleware` 接住）；其余 provider 与 `resume`/`scriptProtocol` 一样
   * 忽略。缺席 = 没有待投递的插话，请求逐字节不变（T2 锁）。
   *
   * 同一条插话只投递一次：`execute-run.ts` 构造这个字段时原子取出
   * （`InterjectionStore.takeStagedForKernel`），第二次 resume 不会再带。
   */
  readonly interjection?: z.infer<typeof AS.KernelInterjection>;
  /**
   * DA-04（#1749，rubric D4）：本次调用所属的 Chat thread id。OPTIONAL——绝大多数
   * provider 不关心它；`DeepAgentModelProvider` 用它把远端 LangGraph thread 与
   * Chat thread **决定性对齐**（uuid5 派生 + 幂等创建），同一会话的第 N 轮落进
   * 同一个远端 thread，checkpointer 里的上下文才真正跨轮生效。
   * 不传时 provider 保持每轮新建 thread 的旧行为——同 onDelta 的双轨纪律。
   */
  readonly threadId?: string;
  /**
   * DA-07b（rubric D6）：本次调用是对一个停在 interrupt 的远端 run 的**恢复**，
   * 不是新消息。provider 见到它时向既有 thread 提交 resume 命令
   * （command.resume.decisions），绝不重发用户输入——重发会让引擎把同一条
   * 消息处理两遍。只有 deep-agent provider 关心它。
   *
   * UX-9 D4：edit 变体携带改后的动作——name 沿用待批工具（不许换工具），argsJson
   * 是人改后完整参数对象的 JSON 文本。由 provider 在构造 resume body 时解析校验：
   * 非对象/坏 JSON 抛 ModelCallError（fail closed），绝不静默降级为 approve。
   * 引擎侧实测形状（deepagents 0.7.6 / langchain HumanInTheLoopMiddleware）：
   * {type:"edit", edited_action:{name:str, args:dict}}。
   *
   * Phase 14 F06（`plan-permissions` 契约束 UC-6 `decideToolPermission`，R3 步骤 6）：
   * `reject` 变体——四选一中的"拒绝"不是把 run 判死（那是旧 DA-07b 单工具审批弹层
   * 的行为，仍由 `decideAgentRun` 的 `decision: "reject"` 走 `failRun`，本变体不碰
   * 那条路径），而是把拒绝结果喂回内核，让它据此调整后续计划继续跑。引擎侧同一份
   * `HumanInTheLoopMiddleware._process_decision` 早就支持 `{type:"reject"}`——见
   * `apps/deep-agent-service/tests/test_harness.py`
   * `test_hitl_resume_reject_tool_not_executed`：拒绝的工具绝不真实执行，且 run
   * 优雅收尾到下一轮回答，不是挂死或裸异常。`decideToolPermission` 的 `deny` 决策
   * 就落在这个变体上（见 `decide-tool-permission.ts`）。
   */
  readonly resume?:
    | { readonly decision: "approve" }
    | { readonly decision: "reject" }
    | { readonly decision: "edit"; readonly editedAction: { readonly name: string; readonly argsJson: string } };
  /**
   * F976 (`plan-control` 契约束, UC-9 `pausePlanRun`) —— P-2 探针的落点。OPTIONAL,
   * 与 `threadId`/`resume` 同一条既有先例：只有 `DeepAgentModelProvider` 关心它,
   * 别的 provider 完全忽略。远端 run 创建成功后立即回调一次，携带远端 `run_id`——
   * 那个 id 此前只活在 `createRun` 方法内的局部变量里，从未有任何调用方能读到,
   * `pausePlanRun` 需要它来调用 `POST /threads/:id/runs/:run_id/cancel`。
   * 不注入 ⇒ 行为逐字节不变（回调不存在，不调用）。
   */
  readonly onRemoteRunStarted?: (remoteRunId: string) => void;
  /**
   * issue #2664 -- 本次调用所属的 org id 与已 claim 的 `agent_runs` 行 id。OPTIONAL，
   * 同 `threadId` 一条既有先例：只有 `DeepAgentModelProvider` 关心它，别的 provider
   * 完全忽略。远端 `spawn_async_task` 工具用它把子任务 run 关联回父 run（写进
   * `configurable.parent_run_id`/`configurable.org_id`，供子任务入队时随
   * `EnqueueSubtaskRunInput.parentRunId` 一并转发给
   * `POST /internal/subtask-runs`）。不传时该工具收不到父 run 上下文，效果与
   * `DEEP_AGENT_SUBAGENTS_ENABLED` 未开启时的旧行为一致（工具即使被注册也没有可用的
   * 派发目标——见 `deep_agent_service/tools.py::spawn_async_task` 自己的降级说明）。
   */
  readonly orgId?: string;
  readonly runId?: string;
  readonly system: string;
  readonly user: string;
  /**
   * Prior turns of the SAME thread, oldest first, already trimmed to this deployment's
   * token-budget policy (`execute-run.ts`'s `trimHistoryToBudget`) -- never the raw,
   * unbounded thread. OPTIONAL and not `readonly []` by default: absent means "the caller
   * has no notion of thread history for this call" (`trialRunAgent`'s scenario has no
   * thread at all), and every `ModelCallPort` implementation that cares reads it as
   * `input.history ?? []`, exactly the discipline `tokens` on the return type already
   * uses for "not reported" vs "confirmed zero" (see that field's own comment below).
   * A provider that has no notion of multi-turn context (`BailianImageProvider`'s single
   * text-to-image prompt) is free to ignore the field entirely -- accepting-but-ignoring
   * an unused input is not the same failure as silently dropping one it was asked to use.
   */
  readonly history?: readonly ThreadHistoryMessage[];
  /**
   * The run's pinned Skills, structured (#740) -- the SAME list `readPinnedSkills` already
   * resolved, passed through as-is. Exists for `DeepAgentModelProvider`: a `deepagents` run
   * executes Skills INSIDE the remote LangGraph service (its `call_skill` tool, see
   * `apps/deep-agent-service/src/deep_agent_service/tools.py`) -- that service has no
   * access to this deployment's database, so the Skill content has to arrive as data on the
   * request instead. `DeepAgentModelProvider` forwards this verbatim into the LangGraph
   * run's `config.configurable.org_skills`; every provider that does not care simply never
   * reads this field, same "absent/unused is not a regression" discipline `history` uses.
   */
  readonly skills?: readonly PinnedSkillContent[];
  /**
   * P2（#1561）—— 本轮真的要让模型**看到像素**的图片。
   *
   * **必须是可选的**，理由与上面 `history` / `skills` 逐字同一条，不是新纪律：缺席表示
   * 「调用方这次没有提供图像」，一个没有视觉能力的实现（`BailianImageProvider` 的单条
   * 文生图 prompt、`DeepResearchModelProvider` 的远端研究流程）完全忽略这个字段是**允许
   * 的形态**——接受但忽略一个用不上的输入，与静默丢掉一个被要求使用的输入，是两件不同
   * 的事。所以本字段落地时**没有一个既有 provider 实现被迫修改**。
   *
   * ⚠ 但「调用方到底该不该填」这件事本身有一道门：`execute-run.ts` 只在
   * `supportsVision` 明确报 true 时才填它。一个看不到图的 provider 因此永远收不到
   * `images`，也就不存在「它忽略了一批调用方以为它看过的图」这种含糊状态——那正是
   * #1558 的 bug 形态（产品允许传图、全链路没人告诉用户模型看不到）。降级要被**说出来**，
   * 由调用点写进模型可读的文本，不是靠这个字段的沉默来表达。
   *
   * 数量与单张体积的上界见 `MODEL_CALL_MAX_IMAGES` / `MODEL_CALL_MAX_IMAGE_BYTES`；
   * 定界与「没送的那几张为什么没送」的渲染在 `run-image-input.ts`。
   */
  readonly images?: readonly ModelCallImage[];
  /**
   * #1747 —— 脚本执行协议的正文（`RUN_SCRIPT_PROTOCOL_PROMPT`），给那些把 skill 的执行
   * 委托给一个远端子模型调用的 provider 用（今天只有 `DeepAgentModelProvider`）。
   *
   * 为什么要单独立一个字段，而不是让远端自己写一份：这段文字是「脚本长什么样才会被
   * 解析出来执行」的唯一事实源，解析它的正则在 `run-script-with-retries.ts`。让
   * `apps/deep-agent-service` 的 Python 侧再写一份中文/英文对照，就是把同一个事实声明
   * 在两处——本仓已经因此漂移过五次。所以协议正文从 TS 这一侧发过去，Python 只负责
   * 原样转发给它发起的那次子模型调用。
   *
   * ⚠ 可选，且**缺席即关闭**：`execute-run.ts` 只在「沙箱与对象存储都注入了 ∧ 这轮真的
   *   挂了 skill」这道**已有的**门里填它——与它给 `system` 追加同一段协议文本用的是同一
   *   个条件，不是第二道门。不填 ⇒ 远端行为与本次改动之前逐字节相同。
   * ⚠ 一个不理解这个字段的 provider 忽略它是允许的形态，与 `history` / `skills` /
   *   `images` 逐字同一条纪律：接受但忽略一个用不上的输入，不是静默丢弃。
   */
  readonly scriptProtocol?: string;
  /**
   * issue #2667 -- "保留手动『每次都先计划』开关"。原样转发
   * `ClaimedAgentRun.disableTaskAutoClassify`，只有 `DeepAgentModelProvider` 关心它：
   * 为 `true` 时把 `configurable.disable_task_auto_classify` 加进发给
   * `deep-agent-service` 的请求，覆盖全局灰度打开时 `TaskClassifierMiddleware`
   * 对**这一次** run 的自动判类（`harness.py` `_run_disables_auto_classify`）。
   * ⚠ 可选，且**缺席/`false` 都视为未覆盖**——与 `scriptProtocol` 同一条透传纪律：
   *   不填 ⇒ 远端行为与接入前逐字节相同。一个不理解这个字段的 provider 忽略它是
   *   允许的形态。
   */
  readonly disableTaskAutoClassify?: boolean;
}

/**
 * A refusal or failure from the one configured provider.
 *
 * It carries a `code` from the contract's enumeration and a `detail` that is for the
 * SERVER LOG only. Keeping the two on one object rather than putting the provider's text
 * into `message` is what makes the interface layer's job unmistakable: there is nothing
 * on this error a handler could pass through to a client by accident.
 */
export class ModelCallError extends Error {
  constructor(
    readonly code: RunFailureCode,
    readonly detail: string,
    /**
     * F159（coord-main 2026-08-12 裁决②的修正）—— 失败响应里上游报回来的用量。
     *
     * 部分 4xx 上游照样计费 prompt tokens 并在错误体里回 `usage`；把失败一律记 0
     * 会让那部分钱在账上凭空消失。⚠ 只取 `usage` 里的**数字**，错误体的文本一个字
     * 都不进来——`detail` 那条「provider 的话到此为止」的纪律不因为这个字段松动。
     */
    readonly usage?: ReportedUsage,
  ) {
    super(code);
    this.name = "ModelCallError";
  }
}

/**
 * 一次模型调用的返回。原本是三处逐字重复的内联字面量（`complete` / `completeStream` /
 * `completeWithProgress`），#1747 收敛成一个具名类型——否则新增一个字段要改三处，
 * 漏一处就是一条只在某一条分支上存在的契约。
 */
export interface ModelCallCompletion {
  /**
   * DA-07b：非 undefined = 远端 run 停在敏感工具调用前等人裁决（interrupt_on）。
   * 此时没有终稿，text 为空串；调用方必须先查本字段再判空文本——顺序反了会把
   * 「等待批准」误判成「provider 没回内容」。
   */
  readonly interrupted?: { readonly toolName: string; readonly argsSummary: string | null };
  readonly text: string;
  readonly tokens?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  /**
   * #1747 —— 除最终回复之外，这次调用途中产生的、**可能含可执行脚本块**的文本。
   *
   * 只有把 skill 的执行委托给远端 agent 循环的 provider 会填它（今天只有
   * `DeepAgentModelProvider`：它填的是那轮 `call_skill` 的 `ToolMessage` 正文）。
   *
   * 为什么需要它：deep-agent 的最终 AI 消息是编排模型对工具结果的**转述**，脚本块留在
   * 工具结果里，从来没有进入过 `text`。`maybeRunSkillScript` 的判据只看 `text`，于是
   * 挂了 skill 的 deep-agent run 一路 `succeeded` 却 0 文件——这就是 #1747 的真实形态。
   *
   * ⚠ 这里**不是**第二个「本轮是否成功」的事实源。成功与否仍然只由 `text` 决定
   *   （`execute-run.ts` 对空 `text` 的检查一行没动），这个字段只多提供几段候选文本供
   *   脚本解析。缺席/空数组 ⇒ 与本次改动之前逐字节相同，既有实现与测试替身都不必改。
   */
  readonly scriptCandidates?: readonly string[];
}

export interface ModelCallPort {
  /**
   * Perform the single model call for a pinned provider/model.
   *
   * Throws `ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED")` when `modelProvider` is not
   * the one provider this deployment configured. It does not substitute the configured
   * one: answering with a model the Agent version does not name is the failure §5 forbids.
   *
   * `tokens` is OPTIONAL and reports whatever usage figure the provider's own response
   * included (e.g. an OpenAI-compatible `usage.total_tokens`), never a locally computed
   * estimate -- this codebase has no tokenizer, and a heuristic word/char count presented
   * as "tokens" would be a fabricated measurement wearing a real one's name. Wave 2's own
   * `AgentRunStep` never stored it and still doesn't; the field exists for callers that DO
   * need a usage figure (`trialRunAgent`, #595 Line A) and treat its absence as `0`, which
   * reads as "not reported", not "confirmed zero".
   */
  complete(input: ModelCallInput): Promise<ModelCallCompletion>;

  /**
   * OPTIONAL streaming variant of `complete` (#654 阶段2a).
   *
   * A port that does not support token-level streaming simply does not implement this
   * method -- `execute-run.ts` checks for its presence and falls back to `complete()`,
   * so `RoutingModelCallPort`/`DeepResearchModelProvider`/`BailianImageProvider` need
   * change nothing to keep working exactly as before. This is still "the single model
   * call" §5 requires: `onDelta` is an observational side-channel for what streamed
   * across the wire, and the returned `{ text, tokens }` is the SAME final answer
   * `complete()` would have returned -- no fallback, no retry, no second call.
   *
   * `onDelta` fires once per provider-reported fragment, in order, BEFORE this promise
   * resolves. A rejection from `onDelta` (e.g. the store append failed) propagates and
   * fails the call exactly like a transport error would -- deltas are not "best effort".
   */
  completeStream?(
    input: ModelCallInput,
    onDelta: (delta: string) => Promise<void>,
  ): Promise<ModelCallCompletion>;

  /**
   * #742 -- OPTIONAL, and MUTUALLY EXCLUSIVE with `completeStream` in practice (a provider
   * implements one or the other, never both): for a provider whose run is a remote,
   * multi-step planning loop rather than a single token stream, this is how it reports
   * "something real happened" before the final answer is known. See
   * `ModelCallProgressEvent`'s own doc comment for the shape and its unverified mapping to
   * any real service.
   *
   * `execute-run.ts` checks for this method's presence BEFORE the TS tool loop / plain
   * `complete()` branches -- a provider that implements it opts fully out of both of those,
   * the same way implementing `completeStream` opts a provider into streaming instead of
   * the plain call. `onProgress` fires once per event, in order, strictly BEFORE this
   * promise resolves; a rejection propagates and fails the call, same discipline
   * `completeStream`'s `onDelta` already established -- an event that failed to persist is
   * not "best effort", it is a run whose recorded steps would otherwise silently
   * under-report what happened.
   *
   * The returned `{ text, tokens }` is still the ONE final answer, same contract
   * `completeStream` already keeps: `onProgress` is an observational side-channel for the
   * steps taken to reach it, never a second source of truth for whether the call
   * succeeded.
   */
  completeWithProgress?(
    input: ModelCallInput,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
    /**
     * DA-03（#1749，rubric D3）：token 级增量的观察通道，契约与 `completeStream` 的
     * `onDelta` 逐字相同——按序、resolve 前逐个 fire、拒绝即失败（不是 best effort）。
     * 可选参数而非新方法：一个 provider 的「多步进度」与「token 流」是同一次远程
     * 执行的两种观察，拆成两个方法会诱导两次调用。不传时 provider 行为必须与
     * 加此参数之前逐字一致（S1=B 双轨纪律在端口层的镜像）。
     */
    onDelta?: (delta: string) => Promise<void>,
    /* ⚠ 返回 `ModelCallCompletion`（#1747）：它在原来的 `{text,tokens,...}` 之上多带
       `files`——deep-agent 走 `call_skill` 产出的脚本，其执行产物要经这里回到
       `execute-run.ts` 落 ObjectStore。与上面的 `onDelta` 是两件独立的事，同时保留。 */
  ): Promise<ModelCallCompletion>;

  /**
   * 2026-08-09 hotfix (#798) -- OPTIONAL per-run capability query, only meaningful for a
   * port that fronts MORE THAN ONE underlying provider (today: `RoutingModelCallPort`). A
   * single-provider port's own `completeWithProgress` presence is already the accurate
   * answer for every run it serves, so it has no reason to implement this -- `execute-run.ts`
   * treats an absent `supportsProgress` as "presence of `completeWithProgress` alone
   * decides it", the exact behaviour every existing single-provider port and test fake
   * already has. A router-shaped port DOES need this: its own `completeWithProgress`
   * method is present as soon as ANY registered provider needs it, but that presence says
   * nothing about the specific provider a given run is pinned to -- see
   * `RoutingModelCallPort.completeWithProgress`'s own doc comment for why conflating the
   * two would silently break token streaming for providers that don't support progress.
   */
  supportsProgress?(modelProvider: string): boolean;

  /**
   * P2（#1561）—— OPTIONAL 能力查询：这个 provider 用**这个 modelId** 调用时，能不能真的
   * 看到 `ModelCallInput.images` 的像素。
   *
   * ⚠ **缺席 ⇒ false（看不到）**，与上面 `supportsProgress` 的「缺席 ⇒ 由方法是否存在
   * 决定」刻意相反。原因是这两个能力的默认方向不同：progress 有一个 `completeWithProgress`
   * 方法可以作为「它自己就是答案」的存在性证据，vision 没有对应方法——视觉输入复用的是
   * 同一个 `complete`，一个 provider 收到 `images` 却什么都不做，在类型上与真的看到了
   * 完全一样。所以这里必须 fail closed：没有人明确声称能看见，就当作看不见，`execute-run.ts`
   * 走诚实降级（把图留在原地 + 明确告诉模型它这轮没有收到图像），而不是把字节丢出去
   * 赌一个没人验证过的能力。这条默认值是 #1558「静默丢弃让用户以为模型看过了」那个
   * 缺口在类型层面的反面。
   *
   * `modelId` 是参数而不只是 `modelProvider`：同一个 provider（DashScope）下只有 VL 系列
   * 模型有视觉输入，一次 run 绑定的是**具体模型**，能力是模型的属性不是厂商的属性。
   */
  supportsVision?(modelProvider: string, modelId: string): boolean;

  /**
   * Phase 14 F01 (`kernel-gateway` 契约束 UC-3 `checkKernelHealth`，R4 A1 / I-3) --
   * OPTIONAL 下发前健康检查：一个 port 若把 run 转发给一个真正独立、可能不可用的远端
   * 执行内核（今天只有 `DeepAgentModelProvider` → `apps/deep-agent-service`），实现这个
   * 方法；单次请求/响应式的 provider（`ConfiguredModelProvider`/`DeepResearchModelProvider`/
   * `BailianImageProvider`）没有独立于"这次调用本身会不会失败"的健康状态，不实现它。
   *
   * ⚠ 缺席 ⇒ execute-run.ts 不做这次检查，直接转发（与本次改动之前逐字节相同）——
   * 与 `supportsProgress`"存在即代表能力"同一条纪律，不是 `supportsVision` 那种
   * fail-closed：没有"内核"概念的 provider 本来就不该被这道门拦住。
   *
   * `modelProvider` 参数让 `RoutingModelCallPort` 能按 run 实际 pin 的 provider 转发到
   * 正确的下游 port，同 `supportsProgress(modelProvider)`/`supportsVision(modelProvider,
   * modelId)` 的既有形状——一个只服务单一 provider 的叶子 port 可以忽略这个参数。
   */
  checkKernelHealth?(modelProvider: string): Promise<KG.KernelHealthStatus>;
}

export interface AgentRunClock {
  now(): string;
  newStepId(): string;
}

/**
 * The executor as the composition root wires it.
 *
 * `tick` runs one bounded batch for one tenant and RESOLVES when the batch is done, so
 * tests can order "publish a new head" against "execute" instead of racing it. `kick` is
 * the fire-and-forget acceptance trigger; it is a no-op when this process is not the one
 * executing runs (`KERNEL_AGENT_RUN_AUTOSTART=0`).
 */
export interface AgentRunExecutorPort {
  tick(orgId: OrgId): Promise<number>;
  kick(orgId: OrgId): void;
}

/**
 * F159 —— 一次模型调用产生的用量事实。
 *
 * ⚠ `promptTokens` / `completionTokens` 是 `null` 时表示**上游没报这一维**，不是 0。
 * OpenAI 兼容的 `usage` 对象本来就带 `prompt_tokens` / `completion_tokens`
 * （coord-main 2026-08-12 裁决③要求先实测再定，实测结果：给得到），但自研包装的
 * provider 未必报。填 0 会让「没报」在报表上等于「一个 prompt token 都没用过」。
 */
export interface TokenUsageRecord {
  readonly userId: string;
  readonly runId: string;
  readonly modelProvider: string;
  readonly modelId: string;
  /** 上游没报总数时是 0——总数是必填维度，缺失按 0 记而不是猜一个估值。 */
  readonly tokensTotal: number;
  /** null = 上游没报。 */
  readonly promptTokens: number | null;
  /** null = 上游没报。 */
  readonly completionTokens: number | null;
  readonly outcome: "succeeded" | "failed";
}

/**
 * 一次调用的用量报告，provider 从上游响应里如实解出来的那份。
 * 三个字段各自可缺——缺失一律是 `undefined`（没报），不是 0。
 */
export interface ReportedUsage {
  readonly total?: number;
  readonly prompt?: number;
  readonly completion?: number;
}

/**
 * F159 —— 计量的写入口。**产品里只有这一个**：`token_usage_events` 是成员配额、
 * 用量监控、限额事件三块的共同上游，允许第二个写入点就等于允许两处对「这次算多少
 * token」给出不同答案（AGENTS.md 顶部那条「同一事实不得声明在两处」已经栽过五次）。
 * 反证测试 `tests/auth/token-usage-single-write-path.test.ts` 扫描 `apps/api/src`，
 * 断言往那张表插行的 SQL 语句只出现在这个 port 的唯一实现里
 * （`pg-token-usage-repository.ts`）。⚠ 这里刻意不写出那条 SQL 的字面量——写出来
 * 本文件就会被自己的扫描算成第二个写入点，而放宽扫描去容忍注释，等于让反证漏掉
 * 「有人在注释旁边真的写了一条 INSERT」这种最像真的情形。
 */
export interface TokenUsageMeterPort {
  record(orgId: OrgId, usage: TokenUsageRecord): Promise<void>;
}

export const AGENT_RUN_STORE = Symbol("AgentRunStore");
export const MODEL_CALL_PORT = Symbol("ModelCallPort");
export const AGENT_RUN_EXECUTOR = Symbol("AgentRunExecutor");
export const TOKEN_USAGE_METER = Symbol("TokenUsageMeter");
/** Phase 14 F03 -- DI token for the singleton `RunEventBusPort` (`run-event-bus.ts`). One
 * instance shared by `AGENT_RUN_EXECUTOR` (publish side) and the WS gateway
 * (`interface/ws/agent-run-events.gateway.ts`, subscribe side) -- see that port's own doc
 * for why they must be the SAME in-process instance. */
export const RUN_EVENT_BUS = Symbol("RunEventBusPort");
