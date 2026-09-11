import { ChildCancellationStatus } from "./run-control";
/**
 * Signed Wave 2 runtime delta (#409 / PR #426).
 *
 * This namespace is deliberately separate from the historical `skills` bundle: the human
 * signoff says the delta does not silently amend that bundle. HTTP DTOs, configured pack
 * manifests, backend validation, and the admin client all derive from this one source.
 */
import { z } from "zod";
import { RestorableInterrupt } from "./agent-interrupts";

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

/* ────────────────── #1865 仓库/目录 URL 批量扫描：⚠ 草案，**尚未经人类签核**（ADR-023） ──────────────────
 *
 * 与上面 `importSkillFromUrl` 同一条许可（登记后先落地，签核后再改形状）。
 * 这条**只做发现，不落库**：真正的导入仍然复用既有 `importSkillFromUrl`——
 * 每个发现出来的候选带一个 `treeUrl`，前端拿它当 `sourceUrl` 再打一次既有端点，
 * ⇒ 落库路径、幂等 key、名字冲突处理、`skill_review_gate` 等既有门禁**全部原样复用**，
 * 不另开一条持久化。
 */
export const SkillDiscoveryError = z.enum([
  /* 用例层 */
  "IMPORT_NOT_ORG_ADMIN",
  /** 扫描到的内容不是一个能理解的 GitHub 仓库/目录形状（比如指向了单个文件） */
  "IMPORT_CONTENT_INVALID",
  /** 扫描完了，但一个包含 SKILL.md 的子目录都没找到 */
  "IMPORT_NO_SKILLS_FOUND",
  /** 扫描过程中候选 skill 数量或目录数量越过了保守上限（导入的是 skill 目录，不是整个大型仓库） */
  "IMPORT_TOO_MANY_SKILLS_FOUND",
  /* 取回层（`domain/skill/import-source.ts`），与单文件/单目录导入同一套 SSRF 门 */
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

export const DiscoveredSkillCandidate = z.object({
  /** 仓库内的目录路径，比如 `document-skills/pptx`。不含前导/尾随斜杠。 */
  dirPath: z.string().min(1).max(1024),
  /** 可以原样传给 `importSkillFromUrl.in.sourceUrl` 的 GitHub 目录 URL。 */
  treeUrl: z.string().min(1).max(2048),
  /** 取自 `SKILL.md` frontmatter 的 `name`；缺失时退化为目录名。 */
  name: z.string().min(1).max(255),
  /** 取自 `SKILL.md` frontmatter 的 `description`；缺失时为空字符串。 */
  description: z.string().max(2000),
  /**
   * 该 skill 目录下的文件数**近似值**（往下多看一层子目录，不再深探），
   * 供用户判断"这是不是我想要的那个"——不是精确的递归总数，见后端
   * `discover-skills-from-url.ts` 的 `approximateFileCount` 头注。
   */
  fileCount: z.number().int().min(1),
}).strict();

export const DiscoverSkillsFromUrlResult = z.object({
  skills: z.array(DiscoveredSkillCandidate),
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
  "queued", "running", "writeback_pending", "succeeded", "failed", "paused", "cancelled",
  /**
   * DA-07b（#1749，rubric D6 人在环）起家，Phase 14 F06 起并入 `plan-permissions`
   * 契约束：run 停在一个未被授权的 L2（不可逆/高风险）工具调用前，等人四选一裁决
   * （仅本次/本次run内/以后都允许/拒绝，见 `packages/contracts/src/plan-permissions.ts`
   * 的 `ToolPermissionDecisionKind`）。不是终态——批准（三档中任一）回 `running` 继续；
   * 拒绝**也**回 `running` 继续（内核据此调整后续计划，不直接判定整个 run 失败，
   * R3 步骤 6），只有内核自己判定确实走不下去时才会落 `failed`。
   * 把「等待人」记成 failed 是账本撒谎（等待 ≠ 失败），所以是一等状态。
   * 与 DB CHECK/触发器的同步同本枚举其余值：pg_constraint 集合相等测试看守。
   *
   * ⚠ 旧名 `awaiting_approval`（DA-07b 原名）已废弃且不得在代码库中以任何形式复活——
   * 见 `requirements/03-plan-mode-permissions.md` R8："避免状态机出现两个含义重叠的
   * 分支"。`tests/wave2-runtime/awaiting-tool-permission-status.test.ts` 机械看守。
   */
  "awaiting_tool_permission",
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

/**
 * #742 Gap 1（CopilotKit 对标）：`tool_call` 步骤新增 `in_progress` 中间态。
 *
 * 之前只有两个终态（`succeeded`/`failed`）——工具调用只有落进账本终态后才出现在
 * `steps` 数组里，用户在调用过程中看不到「正在调用 X」。CopilotKit 官方 Tool Call
 * Rendering / State Rendering 模式要求 status 至少支持 `inProgress`/`complete` 两态迁移。
 *
 * `in_progress` 只对 `kind: "tool_call"` 的步骤有意义：工具调用开始时落一条
 * `in_progress` 记录，调用结束时**再插入一条独立的终态记录**（`succeeded`/`failed`），
 * 不是原地 UPDATE 那一条——`agent_run_steps` 本身是 append-only 账本（DB 级强制，见
 * `no-tool-run-writeback.test.ts` 的「run steps are append-only」套件），一次调用落
 * 两条共享 `toolCallId` 的账，不是一条改两次。读端（`pg-agent-run-repository.ts`
 * `readRun`）按 `toolCallId` 把这两条折叠成一张卡片，`toolCallId` 本身不进公开契约。
 * 这正是 #742「没有留痕就没有调用」纪律要求的形状：进行中和终态各自是一次真实、
 * 独立、可追溯的留痕，不是靠原地覆写让「进行中」这个状态凭空消失。其余 `kind`
 * （`accepted`/`context_built`/`model_called`/`chat_writeback`）不产生中间态，永远
 * 直接落终态——它们本就是同步完成的单次动作。
 *
 * ⚠ 这个枚举与 `agent_run_steps_status_check`（migration
 * `20260824000000_i742_tool_call_in_progress.sql`）是同一个事实，同一份门控纪律
 * （见 `AgentRunStepKind`/`AgentRunError` 头注：zod 枚举与 SQL CHECK 用测试读
 * `pg_constraint` 断言集合相等）。
 */
export const AgentRunStepStatus = z.enum(["succeeded", "failed", "in_progress"]);

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
  /**
   * Phase 14 F01 (`kernel-gateway` 契约束，R4 A1 / I-3) —— 网关在把 run 转发给内核
   * （`apps/deep-agent-service`）之前做健康检查，检查未过时快速失败，不让请求悬挂
   * 等超时、也不发起下游调用。区别于 `MODEL_CALL_FAILED`：那是调用已经发起、内核
   * 或模型本身出错；这是调用**根本没有发起**，因为下发前的探测就已经判定内核不可用。
   */
  "KERNEL_UNAVAILABLE",
  /**
   * issue #2860 —— 执行这个 run 的 API 进程没了（部署/重启/崩溃），心跳停止后由
   * 回收器判定的终态。区别于 `MODEL_CALL_FAILED`（调用本身出错）：调用可能根本没
   * 出错，只是没有人再等它的结果。用户看到的应是"因服务重启中断，请重新发送"。
   */
  "RUN_INTERRUPTED",
]);

/**
 * issue #3211 ① —— **为什么**失败。`AgentRunError` 说的是「哪一类终态」，粒度粗到
 * `MODEL_CALL_FAILED` 一个码同时承载「模型返回空」「远端 run 报错」「远端超时」
 * 「我们自己的执行器抛异常」四件互不相同、可行动性完全不同的事。人类 2026-09-09 在
 * devapp 实测报告的那一条（8 分钟、6 次工具调用、零产出）就死在这里：界面只说
 * 「模型这次没能返回可用结果」，而那句话是客户端由枚举码译出来的，服务端算出的真实
 * `detail` 按 `execute-run.ts` 自己的注释「never reaches a response」，只进日志。
 *
 * ⚠ 这一层**只上枚举**，不上 provider 原话——原话可能含 prompt 片段或上游正文。
 * 认不出的成因一律 `unknown`：说得含糊好过编一个具体但错误的原因（形态同 #3216 的
 * `StandardWebFailureReason`）。
 *
 * ⚠ 这个枚举与 `agent_runs_failure_reason_check` 是同一件事，靠
 * `tests/agent-run/run-failure-reason.test.ts` 读 `pg_constraint` 断言集合相等来钉住。
 */
export const AgentRunFailureReason = z.enum([
  /** 调用返回了，但既没有文本也没有进度事件 / 远端 run 成功却无 assistant 消息。 */
  "provider_returned_empty",
  /** 远端 deep-agent run 自己走到了错误终态。 */
  "provider_rejected",
  /** 远端 run 没能在内核预算（`KERNEL_DEEP_AGENT_TIMEOUT_MS`）内到达终态。 */
  "provider_timeout",
  /** 与内核/模型之间的 HTTP 或传输层失败——请求发出去了，没拿回可用响应。 */
  "provider_transport_failed",
  /** 本部署自己的依赖缺失/未配置，调用根本没能正常发起。 */
  "runtime_unavailable",
  /**
   * issue #3403 ④ —— **这一轮终止时，还有工具调用没有回来**。
   *
   * 与上面五个值的判定方式不同：它们都靠 `ModelCallError.detail` 的措辞匹配，
   * 而这个值由**结构事实**判定——账本里存在已写 `tool_start`、始终没有 `tool_end`
   * 的调用。人类 2026-09-11 实测那一幕（`render-office.py` 跑不回来）在措辞上只能
   * 落进 `provider_timeout`（「智能体服务没跑完」），仍然把成因指向模型侧；而实际
   * 没回来的是一次工具调用。**把工具/脚本的失败说成模型的失败会把排查引向反方向**，
   * 这正是 #3280 / #3323 那条「失败必须说出真实成因」要防的。
   */
  "tool_call_unresolved",
  /**
   * **我们自己的缺陷**：执行器抛了未预期的异常（`execute-run.ts` 的
   * "agent run executor defect" 分支）。此前它与「模型没返回内容」共用同一个码、
   * 同一句文案——线上没人能把「我们的 bug」和「模型的问题」分开。
   */
  "executor_defect",
  /** 卡死回收器把一条久无心跳的 `running` 收成终态（issue #2860 那条路径）。 */
  "run_reaped",
  /** 认不出来。**不许**为了好看猜成上面任何一个。 */
  "unknown",
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
  recoveryDiagnostic: z.string().max(256).nullable().optional(),
  cancelRequestedAt: z.string().nullable().optional(),
  childCancellation: ChildCancellationStatus.optional(),
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
  /**
   * issue #3211 ① —— 终态失败的**成因**，与 `error`（哪一类终态）是两件事，见
   * `AgentRunFailureReason` 头注。非失败终态恒为 `null`。
   * optional：老快照/老客户端缺这个字段不炸。
   */
  failureReason: AgentRunFailureReason.nullable().optional(),
  /** Non-null only once #413's writeback transaction has committed. */
  resultMessageId: z.string().nullable(),
  steps: z.array(AgentRunStep),
  createdAt: z.string(),
  /**
   * DA-07b：status === "awaiting_tool_permission" 时，等待裁决的工具调用摘要——
   * 前端审批条靠它显示「要批的是什么」。其余状态恒为 null。
   * optional：老客户端/老快照缺字段不炸（向后兼容）。
   */
  pendingApproval: z.object({
    permissionRequestId: z.string().uuid().nullable().optional(),
    interrupt: RestorableInterrupt.nullable().optional(),
    toolName: z.string(),
    argsSummary: z.string().nullable(),
  }).strict().nullable().optional(),
  /**
   * issue #3302 —— 这条 run 上已被接受的授权裁决次数与最后一档。
   *
   * 为什么在契约里而不是前端自己数：#3212 ② 的「这是本次任务里第 N 次请求授权」此前
   * 数在审批组件的 `useState` 里，而该组件的挂载门是 `status === "awaiting_tool_permission"`。
   * 同一条 run 的两次中断之间整段是 `running`，组件被**正确地**卸载，计数随之销毁 ⇒
   * 第二次授权弹窗上那句话永远不出现。裁决历史是服务端拥有的事实（`agent_runs` 的
   * `permission_decision_count` / `last_permission_decision`，由同一条条件 UPDATE 写），
   * 由权威读下发，任何页面（刷新、新标签页、冷启动）读到的都是同一个数。
   *
   * `last` 记的是用户选的那一档**原文**（once/run/forever/deny/reject/edit），不是折叠给
   * executor 的 `pending_decision`——界面要说「你上次选的是仅本次允许」，折叠过的值说不出。
   * 纯展示，绝不参与任何授权判定。
   * optional：老快照/老客户端缺字段不炸。
   */
  permissionDecisions: z.object({
    count: z.number().int().min(0),
    last: z.enum(["once", "run", "forever", "deny", "reject", "edit"]).nullable(),
  }).strict().optional(),
  /**
   * issue #3310 ① / ② / ③ —— 这条 run 上**已被裁决**的中断请求，按裁决先后 append-only。
   *
   * 为什么必须由服务端下发：`restored-run-approval.tsx` 此前靠一个 `useState`
   * （`fallbackWasPending`）判断「这一条我亲眼见过它待决、现在没了 ⇒ 它已被裁决」，
   * 而带 fallbackInterrupt 的那个组件在裁决**之前从未挂载过**——宿主
   * （`copilotkit-v2-panel-body.tsx:1638`）在 run 停在 `awaiting_tool_permission` 时
   * 通过 `InterruptRenderContext.pendingRunId` 让内联那份直接 `return null`。于是判据
   * 恒假，裁决后第一次挂载读到 `pendingApproval === null`，界面对用户说
   * 「等待服务端确认此请求」——**服务端根本没在等**（#3244 ① 的复发路径，#3281 收窄的
   * 那条分支覆盖不到这里）。同一个丢失还让下一次授权请求（生成画布）到来时整张记录消失
   * （#3302 同族）。这里把这条事实交回拥有它的一侧：刷新、换标签页、重挂载读到的都一样。
   *
   * ⚠ 为什么是**数组**而不是「最后一条」：`pending_interrupt` 只是当下待决的那一条，同一条
   * run 的下一次中断就地覆盖它。只留最后一条时，第一张卡片会在第二次授权到来的瞬间失去
   * 它的全部事实来源——那正是 ③ 的形状。存的是 append-only 的 `agent_runs.resolved_approvals`。
   *
   * 每条的 `interrupt` 已经把当时被采纳的编辑值合进 args（`decided-interrupt.ts`），因此
   * 记录画的是**用户按下确认的那一份**，不是模型最初的提案（#3310 ②）。
   * 纯展示，绝不参与任何授权判定。老快照/老客户端缺这个字段不炸（回落到空）。
   */
  resolvedApprovals: z.array(z.object({
    permissionRequestId: z.string().nullable(),
    interrupt: RestorableInterrupt,
    toolName: z.string(),
    decision: z.enum(["once", "run", "forever", "deny", "reject", "edit"]).nullable(),
  }).strict()).optional(),
}).strict();

export const operations = {
  /**
   * Wave 2's run transport was polling-only (§5): bounded backoff, stop at a terminal
   * status, no push variant. That is no longer the whole picture.
   *
   * Phase 14 F03 (`streaming-transport` 契约束) added a real push transport --
   * `streamingTransport.operations.subscribeRunEvents`, `WS /agent-runs/:runId/events` --
   * that forwards `KernelStreamEvent`s the moment `execute-run.ts` produces them, decoupled
   * from this endpoint's own ledger reads (see that file's own header for I-1/I-3/I-4).
   * `getAgentRun` below is UNCHANGED and still valid for a one-shot read (initial load
   * before a client opens the WS connection, a server-side check, a client that has no WS
   * support) -- it is simply no longer the ONLY way to observe a run's progress, and no
   * caller has to fall back to bounded-backoff polling to get near-real-time updates
   * anymore. `apps/api/src/application/agent-run/agui-bridge.ts`'s own internal relay
   * (the CopilotKit AG-UI bridge, a DIFFERENT wire protocol than this WS endpoint) still
   * polls this contract's read path as of this comment -- migrating IT onto the new event
   * bus is tracked separately (see that file's own header), not silently implied by this
   * paragraph.
   */
  /**
   * DA-07c（#1749，rubric D6）：awaiting_tool_permission 的人裁决入口。
   * 409（AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION）= 竞态输了：run 已被别人裁决或已终态，
   * 客户端展示真实状态，不假装自己的决定生效。
   *
   * UX-9 D4：三态裁决——新增 "edit"（人在线改参数后放行）。`editedArgs` 是改后的
   * **完整**工具参数对象（不是 patch），仅 edit 时必填、其余决策禁止携带：
   * 「approve 顺手带参数」会让"放行原样"与"放行改样"两个语义共用一个词，谁都说不清
   * 引擎到底执行了什么。引擎侧（deepagents 0.7.6 HumanInTheLoopMiddleware）的
   * EditDecision 形状为 {type:"edit", edited_action:{name, args}}——工具名沿用
   * run 停住时的待批工具（pending_tool_name），本契约不允许人换工具：换工具等于
   * 发起一次没人审过的新调用，超出「修改参数后放行」的授权范围。
   */
  decideAgentRun: {
    method: "POST",
    path: "/agent-runs/:runId/decision",
    in: z.object({
      runId: z.string().min(1),
      decision: z.enum(["approve", "edit", "reject"]),
      permissionRequestId: z.string().uuid().optional(),
      editedArgs: z.record(z.unknown()).optional(),
    }).strict().superRefine((v, ctx) => {
      if (v.decision === "edit" && v.editedArgs === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editedArgs"], message: "editedArgs is required when decision is \"edit\"" });
      }
      if (v.decision !== "edit" && v.editedArgs !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editedArgs"], message: "editedArgs is only allowed when decision is \"edit\"" });
      }
    }),
    out: AgentRunView,
  },
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
   * #1865 —— 扫描一个仓库/目录 URL，找出其中所有包含 `SKILL.md` 的子目录。
   * ⚠ 草案，未签核 —— 见上方 `SkillDiscoveryError` 处的说明。
   *
   * 只读，不落库。真正的导入由调用方拿返回的某个候选的 `treeUrl` 再打一次
   * `importSkillFromUrl`——两条端点故意保持"发现"与"落库"分离，用户逐个确认。
   */
  discoverSkillsFromUrl: {
    method: "POST",
    path: "/admin/skills/url-imports/discover",
    in: z.object({
      /** 仓库根 URL 或子目录 URL；两道 SSRF 门同样作用在它派生出的每一次取回上 */
      sourceUrl: z.string().min(1).max(2048),
    }).strict(),
    out: DiscoverSkillsFromUrlResult,
    err: SkillDiscoveryError.options,
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
