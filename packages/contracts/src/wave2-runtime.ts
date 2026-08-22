/**
 * Signed Wave 2 runtime delta (#409 / PR #426).
 *
 * This namespace is deliberately separate from the historical `skills` bundle: the human
 * signoff says the delta does not silently amend that bundle. HTTP DTOs, configured pack
 * manifests, backend validation, and the admin client all derive from this one source.
 */
import { z } from "zod";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const PackCoordinate = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const StableName = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/);

export const SkillStarterPackFile = z.object({
  path: z.string().min(1).max(512),
  mediaType: z.string().min(1).max(255),
  digest: Sha256,
  contentBase64: z.string().min(1),
}).strict();

export const SkillStarterPackEntry = z.object({
  stableName: StableName,
  name: z.string().min(1).max(255),
  semanticVersion: z.string().min(1).max(64),
  manifest: z.record(z.unknown()),
  files: z.array(SkillStarterPackFile).min(1),
}).strict();

export const UnsignedSkillStarterPack = z.object({
  schemaVersion: z.literal(1),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  skills: z.array(SkillStarterPackEntry).min(1),
}).strict();

export const SkillStarterPack = UnsignedSkillStarterPack.extend({
  packDigest: Sha256,
}).strict();

export const SkillStarterImportError = z.enum([
  "SKILL_STARTER_PACK_NOT_FOUND",
  "SKILL_STARTER_PACK_INVALID",
  "SKILL_STARTER_PACK_CONFLICT",
  "SKILL_STARTER_IMPORT_IDEMPOTENCY_CONFLICT",
  "SKILL_STARTER_IMPORT_ADMIN_REQUIRED",
]);

export const SkillStarterImportResult = z.object({
  importId: z.string(),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  packDigest: Sha256,
  status: z.literal("succeeded"),
  skillIds: z.array(z.string()),
  versionIds: z.array(z.string()),
  importedAt: z.string(),
}).strict();

/* ────────────────── #595 URL 导入：⚠ 草案，**尚未经人类签核**（ADR-023） ──────────────────
 *
 * 草案已登记在 issue #595 的评论里，**还没有人签**。它落在这里而不是
 * `apps/api/src/application/skill-import/url-import-draft.ts`，是被机械门控逼过来的：
 * `tests/contract-single-source.test.ts` 逐行禁止 `apps/api/src` 出现
 * `const X = z.object(`，理由是「同一个形状声明在两处」已经在本项目发生过两次。
 *
 * ⚠ 这与草案文件原本的意图（把形状关在一个文件里，好让签核改得动）**不冲突**：
 *   形状仍然只有一份，只是那一份搬到了契约里。后端一律 `z.infer` 派生，
 *   ⛔ 不重新声明任何字段名。
 *
 * ⚠ **本条目出现在 operations 里不代表它定稿了。** 签核可以改字段名、拆字段、
 *   换错误码；改这一处即可，后端会跟着编译错误走。
 */
export const SkillUrlImportError = z.enum([
  /* 用例层（`application/skill-import/url-import-draft.ts` 的 `ImportSkillFromUrlFailure`） */
  "IMPORT_CONTENT_INVALID",
  "IMPORT_NAME_CONFLICT",
  "IMPORT_IDEMPOTENCY_CONFLICT",
  "IMPORT_NOT_ORG_ADMIN",
  /* 取回层（`domain/skill/import-source.ts` 的 `ImportSourceRefusalCode`）。
   * ⚠ 这些码**必须**能从 HTTP 面看见：否则一个被 SSRF 门拦下的请求和一个内容为空的
   *   请求会长得一模一样，调用方无法分辨「我被拒了」和「我传错了」。 */
  "IMPORT_URL_MALFORMED",
  "IMPORT_URL_SCHEME_FORBIDDEN",
  "IMPORT_URL_CREDENTIALS_FORBIDDEN",
  "IMPORT_URL_HOST_NOT_PUBLIC",
  "IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG",
  "IMPORT_PAYLOAD_TOO_LARGE",
  "IMPORT_TOO_MANY_REDIRECTS",
  "IMPORT_FETCH_TIMEOUT",
  "IMPORT_FETCH_FAILED",
]);

export const SkillUrlImportResult = z.object({
  skillId: z.string(),
  versionId: z.string(),
  /** 落库的文件路径清单（已过 `normalizedPath`） */
  filePaths: z.array(z.string()),
  contentDigest: Sha256,
  /** 该 `idempotencyKey` 之前已经导入过，本次未重复落库 */
  replayed: z.boolean(),
}).strict();

/**
 * #1415 —— agent 版的 `SkillUrlImportError`/`SkillUrlImportResult`。同一条草案许可
 * （见上方 `SkillUrlImportError` 处的头注），同一份机械门控理由
 * （`tests/contract-single-source.test.ts` 禁止 `apps/api/src` 里出现第二份形状声明）。
 */
export const AgentUrlImportError = z.enum([
  /* 用例层（`application/agent-import/import-agent-from-url.ts`） */
  "IMPORT_CONTENT_INVALID",
  "IMPORT_NAME_CONFLICT",
  "IMPORT_IDEMPOTENCY_CONFLICT",
  "IMPORT_NOT_ORG_ADMIN",
  /* 取回层（`domain/skill/import-source.ts` 的 `ImportSourceRefusalCode`）——
   * agent 导入复用同一套 SSRF 门，不重开第二套判定，错误码因此逐字相同。 */
  "IMPORT_URL_MALFORMED",
  "IMPORT_URL_SCHEME_FORBIDDEN",
  "IMPORT_URL_CREDENTIALS_FORBIDDEN",
  "IMPORT_URL_HOST_NOT_PUBLIC",
  "IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG",
  "IMPORT_PAYLOAD_TOO_LARGE",
  "IMPORT_TOO_MANY_REDIRECTS",
  "IMPORT_FETCH_TIMEOUT",
  "IMPORT_FETCH_FAILED",
]);

export const AgentUrlImportResult = z.object({
  agentId: z.string(),
  /** 落库的 agent 显示名（同一个 idempotencyKey 回放时可能与本次请求的 name 不同）。 */
  name: z.string(),
  /** 恒为 `"草稿"`——导入不自动发布，见 `importAgentFromUrl` 头注。 */
  publishState: z.string(),
  /**
   * 回显落库的指令全文。**不是新的读路径**——这一阶段的 Agent 没有单独的
   * `GET /agents/:id` 定义读接口，回显是让界面在导入成功的这一刻就能显示"到底导入了
   * 什么"，不需要用户凭空对着一个空文本框决定要不要覆盖它。
   */
  instructions: z.string(),
  contentDigest: Sha256,
  /** 该 `idempotencyKey` 之前已经导入过，本次未重复落库 */
  replayed: z.boolean(),
}).strict();

/* ────────────────── #595 后台编辑 skill 内容：⚠ 草案，**尚未经人类签核**（ADR-023） ──────────────────
 *
 * coord-main 对 #595 的派工逐字写着「不要等签核，先落地导入+编辑+后台测试最小集合」，
 * 与上面 `importSkillFromUrl` 草案同一条许可。目录浏览（列出多文件树）与文件上传本轮
 * 不做——最小闭环只需要「编辑已导入 skill 唯一的根文件 `SKILL.md`」就能验证「编辑
 * 落库 → pin 到 agent → 试跑真的读到新内容」这条链路，其余留给后续 issue（见 PR 正文）。
 *
 * ⚠ 同上一条草案：形状只在这一处声明，`apps/api/src` 一律 `z.infer` 派生，
 *   不重新声明字段名（`tests/contract-single-source.test.ts` 机械禁止第二份副本）。
 */
export const SkillVersionEditError = z.enum([
  "EDIT_NOT_ORG_ADMIN",
  "EDIT_SKILL_NOT_FOUND",
  /** 内容为空或全是空白字符——发布前必须有真实内容。 */
  "EDIT_CONTENT_INVALID",
]);

export const SkillVersionEditResult = z.object({
  skillId: z.string(),
  /** 新产出的版本 id——编辑=不可变版本链再追加一环，从不原地改旧版本。 */
  versionId: z.string(),
  semanticLabel: z.string(),
  contentDigest: Sha256,
  createdAt: z.string(),
}).strict();

export const AgentSkillVersionReference = z.object({
  versionId: z.string().min(1).max(255),
  digest: Sha256,
}).strict();

export const AgentStarterPackEntry = z.object({
  stableName: StableName,
  name: z.string().min(1).max(255),
  semanticVersion: z.string().min(1).max(64),
  instructions: z.string().min(1),
  instructionDigest: Sha256,
  skillVersions: z.array(AgentSkillVersionReference),
  modelProvider: z.string().min(1).max(128),
  modelId: z.string().min(1).max(255),
  toolPolicy: z.array(z.never()).max(0),
}).strict();

export const UnsignedAgentStarterPack = z.object({
  schemaVersion: z.literal(1),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  agents: z.array(AgentStarterPackEntry).min(1),
}).strict();

export const AgentStarterPack = UnsignedAgentStarterPack.extend({
  packDigest: Sha256,
}).strict();

export const AgentStarterImportError = z.enum([
  "AGENT_STARTER_PACK_NOT_FOUND",
  "AGENT_STARTER_PACK_INVALID",
  "AGENT_STARTER_PACK_CONFLICT",
  "AGENT_STARTER_IMPORT_IDEMPOTENCY_CONFLICT",
  "AGENT_STARTER_IMPORT_ADMIN_REQUIRED",
  "AGENT_STARTER_SKILL_VERSION_MISSING",
  "AGENT_STARTER_SKILL_VERSION_MISMATCH",
]);

export const AgentStarterImportResult = z.object({
  importId: z.string(),
  packId: PackCoordinate,
  packVersion: PackCoordinate,
  packDigest: Sha256,
  status: z.literal("succeeded"),
  agentIds: z.array(z.string()),
  versionIds: z.array(z.string()),
  importedAt: z.string(),
}).strict();

/* ═══════════════ §5 · minimal no-tool AgentRun (#414) ═══════════════ */

export const AgentRunStatus = z.enum([
  "queued", "running", "writeback_pending", "succeeded", "failed",
  /**
   * DA-07b（#1749，rubric D6 人在环）：run 停在敏感工具调用前，等人裁决。
   * 不是终态——approve 回 running 继续，reject 落 failed("HITL_REJECTED")。
   * 把「等待人」记成 failed 是账本撒谎（等待 ≠ 失败），所以是一等状态。
   * 与 DB CHECK/触发器的同步同本枚举其余值：pg_constraint 集合相等测试看守。
   */
  "awaiting_approval",
]);

/**
 * The four steps the delta enumerates in §5, verbatim, plus `tool_call` (#725 tool-calling
 * loop).
 *
 * `chat_writeback` was listed ahead of its implementation so #413 would not have to widen a
 * vocabulary while implementing against it. Since #413 it is emitted for real — once per
 * run, `succeeded` when the writeback transaction commits and `failed` with
 * `CHAT_WRITEBACK_FAILED` when the bounded retry budget runs out.
 *
 * `tool_call` is new: one per skill-as-tool invocation the orchestrator model requested,
 * recorded BEFORE the loop's next round so a client polling mid-run sees each real
 * invocation as it happens, not a summary reconstructed after the fact.
 *
 * ⚠ This enum and `agent_run_steps_kind_check` in the migration are the same fact. They
 * are kept in one place the only way a zod enum and a SQL CHECK can be: a test reads the
 * constraint out of `pg_constraint` and asserts set equality with `.options`.
 */
export const AgentRunStepKind = z.enum([
  "accepted", "context_built", "model_called", "tool_call", "chat_writeback",
]);

export const AgentRunStepStatus = z.enum(["succeeded", "failed"]);

/**
 * Stable, redacted terminal codes (§5: "a stable, redacted error code").
 *
 * Every code listed is one something can actually emit — declaring an error nothing can
 * produce would make the enum a wish list rather than the set of things a client has to
 * handle. `CHAT_WRITEBACK_FAILED` arrived with #413, the slice that can emit it.
 *
 * ⚠ This enum and `agent_runs_error_code_check` / `agent_run_steps_failure_code_check` in
 * the migrations are the same fact, kept in one place the only way a zod enum and a SQL
 * CHECK can be: `no-tool-run-writeback.test.ts` reads the constraint out of `pg_constraint`
 * and asserts set equality with `.options`.
 */
export const AgentRunError = z.enum([
  /** DA-07b：人在环裁决为拒绝。run 的终态错误码——用户明确说了不。 */
  "HITL_REJECTED",
  /** The run's snapshot names a provider this deployment has not configured. No fallback. */
  "MODEL_PROVIDER_NOT_CONFIGURED",
  /** A pinned Skill version's content is not retrievable. Fail closed, never drop it. */
  "SKILL_VERSION_UNAVAILABLE",
  /**
   * The run's pinned Agent version, thread or input message is no longer readable.
   *
   * Not a theoretical branch: the run row's `agent_version_id` has no foreign key (§4
   * keeps versions immutable, not referentially pinned to the run), so a run CAN outlive
   * what it points at. The alternative to this code is a run that stays `running` with no
   * step and no terminal state, which is the one outcome nobody can act on.
   */
  "AGENT_VERSION_UNAVAILABLE",
  /** The one model call did not return usable content. Never a fabricated reply. */
  "MODEL_CALL_FAILED",
  /**
   * The bounded retry budget for the Chat writeback ran out (§6).
   *
   * The model output existed and may well have been good; what failed was making it
   * durable in the thread. The run is terminal and NO assistant message exists — §6 forbids
   * emitting a synthetic one — so the human's message stays visible and unanswered.
   *
   * ⚠ The sentence that used to end this comment — "the retry is an explicit new run rather
   * than a silent second attempt" — was TRUE when #413 wrote it and became FALSE the moment
   * #519 landed. Retry is `retryAgentRun`, which reopens THIS run; a second run for the same
   * input message cannot exist (`UNIQUE (org_id, input_message_id)`, #415). Terminal here
   * means "no further progress without an explicit human retry", not "unreachable forever".
   */
  "CHAT_WRITEBACK_FAILED",
  /**
   * The tool-calling loop (#725) ran `TOOL_LOOP_MAX_ROUNDS` rounds of "model asks for a
   * tool → tool runs → result fed back" without the model ever returning a final answer.
   * A bounded loop that stops is the honest outcome here — the alternative is a run that
   * never terminates, which is the one thing §5's "no fallback, no retry" discipline is
   * built to prevent from happening silently. No fabricated "here is my best guess" text
   * is produced; the run fails, visibly, with this code.
   */
  "TOOL_LOOP_LIMIT_EXCEEDED",
]);

export const AgentRunStep = z.object({
  kind: AgentRunStepKind,
  status: AgentRunStepStatus,
  startedAt: z.string(),
  endedAt: z.string(),
  /** Digests, not content: §5 keeps prompt/response retention under the privacy policy. */
  inputDigest: z.string().nullable(),
  outputDigest: z.string().nullable(),
  failureCode: AgentRunError.nullable(),
  /**
   * `tool_call` steps only (#725). NOT a digest: the whole point of a `tool_call` step is
   * that a human watching the run can see WHICH skill it called, WITH WHAT, and WHAT CAME
   * BACK — chat-ux-acceptance-criteria.md item 3 — so a hash is useless here. Truncated to
   * a short summary (never the full skill body, which stays digest-only via
   * `inputDigest`/`outputDigest` exactly as before). Always `null` for every other kind.
   */
  toolName: z.string().max(128).nullable(),
  toolArgsSummary: z.string().max(1000).nullable(),
  toolResultSummary: z.string().max(1000).nullable(),
  /**
   * `tool_call` steps only (#731 follow-up -- chat-ux-acceptance-criteria.md item 2:
   * "可见的规划步骤"). The orchestrator model's own plain-language turn from the SAME
   * response that requested this tool call, when the provider returned one alongside
   * `tool_calls` (OpenAI-compatible providers may return `content` and `tool_calls`
   * together on one message). `null` when the model called the tool without saying
   * anything first -- this field is NEVER synthesized; an agent that skipped the
   * explanation shows no explanation, rather than a fabricated one.
   */
  planningNote: z.string().max(1000).nullable(),
}).strict();

export const AgentRunView = z.object({
  runId: z.string(),
  threadId: z.string(),
  inputMessageId: z.string(),
  agentId: z.string(),
  /** The immutable version resolved at ACCEPTANCE, never the Agent's current head. */
  agentVersionId: z.string(),
  skillVersionIds: z.array(z.string()),
  modelProvider: z.string(),
  modelId: z.string(),
  status: AgentRunStatus,
  error: AgentRunError.nullable(),
  /** Non-null only once #413's writeback transaction has committed. */
  resultMessageId: z.string().nullable(),
  steps: z.array(AgentRunStep),
  createdAt: z.string(),
  /**
   * DA-07b：status === "awaiting_approval" 时，等待裁决的工具调用摘要——
   * 前端审批条靠它显示「要批的是什么」。其余状态恒为 null。
   * optional：老客户端/老快照缺字段不炸（向后兼容）。
   */
  pendingApproval: z.object({
    toolName: z.string(),
    argsSummary: z.string().nullable(),
  }).strict().nullable().optional(),
}).strict();

export const operations = {
  /**
   * Wave 2's run transport is polling (§5). Clients use bounded backoff and stop at a
   * terminal status. There is no SSE variant in this slice.
   */
  getAgentRun: {
    method: "GET",
    path: "/agent-runs/:runId",
    in: z.object({ runId: z.string().min(1) }).strict(),
    out: AgentRunView,
    /**
     * One exit for "no such run" and "not yours". Chat's I-3 rule applies to this read
     * too: a distinguishable 403 turns the endpoint into a run-id existence oracle.
     */
    err: ["AGENT_RUN_NOT_VISIBLE"] as const,
  },
  /**
   * context-engine 可用性补口（`AgentRunController.contextSnapshot`）—— F157 落地时只接了
   * 写（`execute-run.ts` 组装完成后无条件写一条快照），从未接读端点。判权与 `getAgentRun`
   * 同一条决策（`readAgentRunContextSnapshot` 内部复用 `resolveVisibility`）。
   *
   * `out` 可空：`null` = 这个 run 你能看，只是还没有快照（早于 F157 上线，或组装从未走到
   * 写快照那一步）——与"看不到这个 run"是两码事，后者走 `err`，不混进一个可空字段。
   */
  getAgentRunContextSnapshot: {
    method: "GET",
    path: "/agent-runs/:runId/context-snapshot",
    in: z.object({ runId: z.string().min(1) }).strict(),
    out: z.object({
      l1MessageCount: z.number().int().min(0),
      l2Status: z.enum(["ok", "degraded"]),
      l2CoveredThroughId: z.string().nullable(),
      l3Status: z.enum(["ok", "degraded", "not_configured"]),
      l3HitCount: z.number().int().min(0),
      l3Sources: z.array(z.string()),
      l3RetrievalScope: z.enum(["own-attachment", "project-retrieval"]).nullable(),
      toolTraceStatus: z.enum(["ok", "degraded", "not_configured"]),
      toolTraceRunCount: z.number().int().min(0),
      toolTraceStepCount: z.number().int().min(0),
      estimatedTokens: z.number().int().min(0),
      createdAt: z.string(),
    }).strict().nullable(),
    /** 同 `getAgentRun`：不存在 / 不是你的租户 / 不是你能看的 thread，共用一个出口。 */
    err: ["AGENT_RUN_CONTEXT_SNAPSHOT_NOT_VISIBLE"] as const,
  },
  /**
   * 🟡 `retryAgentRun` 于 #519 补上，**该契约面待人类补签**（照 #496 `createTemplate` 先例）。
   *
   * ## 为什么这个操作在契约里原本不存在
   *
   * §6 只写了「写回耗尽后给人类**一个关联同一条输入消息的新 run**」，没有写任何操作。
   * 而 `agent_runs` 上 `UNIQUE (org_id, input_message_id)`（#415）让「第二个 run」结构上
   * 不可能存在。coord-main 在 #519 上裁决：**约束赢，规格文本让步** —— 重试 = 把既有 run
   * 重置回可写回状态，不是新建 run。本操作是这条裁决的契约面。
   *
   * ## 补签时必须一并裁的三件（不裁就会再漂一次）
   *
   * ① **§6 的措辞「新 run」要改**。签了本操作却不改 §6，规格与实现长期不一致。
   * ② **重置目标是 `writeback_pending` 而不是 `queued`** —— 这是实现者对 #519 书面方向的
   *    有意偏离。理由：`queued` 是执行器的认领态，重置到那里会让同一条人类消息触发**第二次
   *    模型调用**，与 §5「恰好一次调用」以及 #413「重试写回的是那唯一一次调用已产出并存下的
   *    答案」直接冲突。数据库触发器把这条钉死：重开时 `model_output` 必须与原值逐字相同。
   * ③ **谁可以重试**。当前判据 = 能看见该 thread（与 `getAgentRun` 同一个决策）**且**在该
   *    项目里不是 observer **且** thread 未归档 —— 即「能在这个 thread 里发言的人」。没有
   *    单独的「重试」角色/权限位；如果人类认为重试应当收窄到消息作者或管理员，要在补签时说。
   *
   * `out` 是重开后的 `AgentRunView`（`status: "writeback_pending"`, `error: null`），
   * 客户端照 §5 继续轮询到终态，不需要第二种传输。
   */
  retryAgentRun: {
    method: "POST",
    path: "/agent-runs/:runId/retries",
    in: z.object({ runId: z.string().min(1) }).strict(),
    out: AgentRunView,
    err: [
      /** 同 `getAgentRun`：不存在 / 不是你的租户 / 不是你能看的 thread，共用一个出口。 */
      "AGENT_RUN_NOT_VISIBLE",
      /** 能看见，但没有发言权（observer）或 thread 已归档。 */
      "AGENT_RUN_RETRY_FORBIDDEN",
      /**
       * 这个 run 的状态不是「写回预算耗尽」。
       *
       * 只有 `failed` + `CHAT_WRITEBACK_FAILED` 可重开：`succeeded` 已经有回复在 thread 里，
       * 重开等于制造第二条回复；其它失败码没有可写回的既存答案。
       */
      "AGENT_RUN_NOT_RETRYABLE",
    ] as const,
  },
  importSkillStarterPack: {
    method: "POST",
    path: "/admin/skills/starter-pack-imports",
    in: z.object({
      packId: PackCoordinate,
      packVersion: PackCoordinate,
      idempotencyKey: z.string().min(1).max(255),
    }).strict(),
    out: SkillStarterImportResult,
    err: SkillStarterImportError.options,
  },
  /** ⚠ 草案，未签核 —— 见上方 `SkillUrlImportResult` 处的说明。 */
  importSkillFromUrl: {
    method: "POST",
    path: "/admin/skills/url-imports",
    in: z.object({
      /** 要导入的 https 地址；两道 SSRF 门都作用在它上面 */
      sourceUrl: z.string().min(1).max(2048),
      /** 导入后 skill 的显示名 */
      name: z.string().min(1).max(255),
      idempotencyKey: z.string().min(1).max(255),
    }).strict(),
    out: SkillUrlImportResult,
    err: SkillUrlImportError.options,
  },
  /**
   * #1415 —— agent 版的 `importSkillFromUrl`，与它同一心智：URL 内容取回后不落一整棵
   * 目录（agent 不是文件树，`agents`/`agent_versions` 唯一的"内容"字段是
   * `instructions`，单个文本 blob），落的是一个**草稿态** agent + 它的 `instructions`。
   * ⚠ 草案，未签核 —— 见上方 `importSkillFromUrl` 处的同一条许可。
   *
   * 导入后**不**自动发布（`selfPublishToollessAgent` 是独立的既有端点）：留一步
   * 让用户能在发布前先看一眼/改一改导入回来的指令，这正是"导入完还要能编辑"
   * 这条要求的落点——发布把 `agent_versions` 铸成不可变快照，铸之前才是能改的窗口。
   */
  importAgentFromUrl: {
    method: "POST",
    path: "/admin/agents/url-imports",
    in: z.object({
      /** 要导入的 https 地址；两道 SSRF 门都作用在它上面 */
      sourceUrl: z.string().min(1).max(2048),
      /** 导入后 agent 的显示名（同时派生缩写角标与职责一句话） */
      name: z.string().min(1).max(255),
      idempotencyKey: z.string().min(1).max(255),
    }).strict(),
    out: AgentUrlImportResult,
    err: AgentUrlImportError.options,
  },
  importAgentStarterPack: {
    method: "POST",
    path: "/admin/agents/starter-pack-imports",
    in: z.object({
      packId: PackCoordinate,
      packVersion: PackCoordinate,
      idempotencyKey: z.string().min(1).max(255),
    }).strict(),
    out: AgentStarterImportResult,
    err: AgentStarterImportError.options,
  },
  /** ⚠ 草案，未签核 —— 见上方 `SkillVersionEditResult` 处的说明。 */
  editSkillVersionContent: {
    method: "POST",
    path: "/admin/skills/:skillId/versions",
    in: z.object({
      /** 新的 `SKILL.md` 全文；发布后旧版本原样留存，不做 diff/patch。 */
      content: z.string().min(1).max(1_000_000),
    }).strict(),
    out: SkillVersionEditResult,
    err: SkillVersionEditError.options,
  },
} as const;
