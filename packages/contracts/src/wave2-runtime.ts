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
]);

/**
 * The four steps the delta enumerates in §5, verbatim.
 *
 * `chat_writeback` was listed ahead of its implementation so #413 would not have to widen a
 * vocabulary while implementing against it. Since #413 it is emitted for real — once per
 * run, `succeeded` when the writeback transaction commits and `failed` with
 * `CHAT_WRITEBACK_FAILED` when the bounded retry budget runs out.
 *
 * ⚠ This enum and `agent_run_steps_kind_check` in the migration are the same fact. They
 * are kept in one place the only way a zod enum and a SQL CHECK can be: a test reads the
 * constraint out of `pg_constraint` and asserts set equality with `.options`.
 */
export const AgentRunStepKind = z.enum([
  "accepted", "context_built", "model_called", "chat_writeback",
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
   * emitting a synthetic one — so the human's message stays visible and unanswered, and the
   * retry is an explicit new run rather than a silent second attempt.
   */
  "CHAT_WRITEBACK_FAILED",
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
} as const;
