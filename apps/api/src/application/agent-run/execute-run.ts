/**
 * `executeAgentRun` -- the Wave 2 §5 slice, and nothing else.
 *
 * ## What this function is allowed to decide
 *
 * Almost nothing. The Agent version, the ordered Skill versions, the provider and the
 * model were all decided at acceptance and are read off the claimed run. This code picks
 * no model, resolves no head, retries no provider, and invents no reply. It builds one
 * prompt out of already-pinned inputs, makes one call, and records what happened.
 *
 * ## Failure is a recorded transition, never a thrown surprise
 *
 * Every failure path lands on `failRun` with an enumerated code AND appends the failed
 * step. A run that dies without either is indistinguishable from one nobody started, and
 * "the message just never got answered" is the single hardest report to act on.
 *
 * ## Empty content is a failure, not an empty reply
 *
 * If the provider returns no usable text, the run fails. Storing `""` and letting #413
 * write it back would put a blank assistant message in a human's thread and mark the run
 * succeeded -- a fabricated reply with extra steps.
 *
 * ## #725 shipped, then #741 retired it -- the TS in-process tool loop is gone
 *
 * #725 added `executeToolLoop`: a run whose pinned Skills produced a tool definition
 * went through a bounded in-process loop (model asks for a tool → `executeSkillTool` makes
 * a separate, focused `complete()` call → result fed back), gated behind
 * `KERNEL_TOOL_CALLING_ENABLED` (default off, so it never actually ran in production).
 * #740/#741 replace that whole mechanism with a DIFFERENT one: the general assistant's
 * `model_provider` now points at `DeepAgentModelProvider` (`deep-agent-model-provider.ts`),
 * which hands the run's pinned Skills to a REMOTE `deepagents`-based planning loop
 * (`apps/deep-agent-service`) instead of running one in this process. AGENTS.md's own
 * "same fact must not be declared in two places" discipline is why this file does not keep
 * BOTH: a second, dormant "how does the general assistant use tools" implementation sitting
 * next to the live one is exactly the drift that rule exists to prevent, flag or not.
 *
 * ## #742 -- the ONE remaining alternative branch, for a provider whose loop lives elsewhere
 *
 * `deps.model.completeWithProgress`'s mere PRESENCE is the opt-in (checked before the plain
 * `complete()`/`completeStream()` branch below), same discipline `completeStream`'s
 * presence already uses to opt a provider into streaming -- this is what
 * `DeepAgentModelProvider` implements instead of the retired #725 loop. Every `tool_call`
 * step this branch records goes through the exact same `record()` helper and the exact
 * same `AppendedRunStep` shape #725's loop used to -- the Chat UI (#730-#734) needs no
 * changes to render it. A provider with NEITHER `completeWithProgress` nor
 * `completeStream` takes the single-call shape #725's own doc comment once called "the
 * exact pre-#725 code path" -- now simply the plain path.
 */
import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type {
  AgentRunClock, AgentRunStore, ClaimedAgentRun, HistoryAttachmentMeta, ModelCallPort,
  PinnedSkillContent, RunFailureCode, RunStepKind, ThreadHistoryMessage, TokenUsageMeterPort,
} from "./ports";
import { ModelCallError } from "./ports";

/**
 * #709 -- token-budget-aware multi-turn context.
 *
 * `HISTORY_MAX_MESSAGES` bounds what `AgentRunStore.readThreadHistory` is even ASKED for
 * (a row cap enforced in SQL, see that method's own comment). `HISTORY_MAX_CHARS` is the
 * second, tighter bound applied here in application code: a deployment has no tokenizer
 * (the `tokens` field on `ModelCallPort`'s return type says so explicitly), so this project
 * has no honest way to count tokens -- inventing one would be exactly the "heuristic
 * presented as a real measurement" `ModelCallPort.complete`'s own doc comment already
 * rules out for usage reporting. A character budget is not "tokens" and is not labelled as
 * one; it is a simple, conservative proxy good enough for the one thing this MVP needs:
 * never let history grow without bound. ~4 chars/token is a common rough ratio for English
 * and CJK-mixed text (CJK runs lower, closer to ~1.5-2 chars/token, which makes this budget
 * MORE conservative for the CJK content that dominates this codebase's fixtures, not less)
 * -- `HISTORY_MAX_CHARS` at 12,000 stays comfortably under the smallest realistic context
 * window even under that denser encoding, while `HISTORY_MAX_MESSAGES` keeps a very long,
 * short-message thread (e.g. quick back-and-forth) from turning into thousands of tiny
 * history entries before the char budget even gets a chance to trim it.
 */
export const HISTORY_MAX_MESSAGES = 20;
export const HISTORY_MAX_CHARS = 12_000;

/**
 * V8 —— 滚动摘要开关。**默认关**：不设或非 "1" 时 `assembleHistory` 不接 summarize，
 * 历史组装与 #709 逐字节相同。设为 "1"（受控环境）才开启对被丢弃旧轮的摘要。
 * 读一次（组装期），运行中途改环境变量不改已在跑的进程行为——同本文件其余配置的做法。
 */
export const HISTORY_SUMMARY_ENABLED = process.env.KERNEL_HISTORY_SUMMARY_ENABLED === "1";

/**
 * Drop the OLDEST messages first until the remaining, still-chronologically-ordered suffix
 * fits `maxChars` of combined `content` length. `messages` is already oldest-first (what
 * `readThreadHistory` returns); the result stays oldest-first so callers never have to
 * re-sort before splicing it into a `role`-ordered messages array.
 *
 * A single message longer than `maxChars` on its own is kept whole rather than truncated
 * mid-sentence -- cutting a stored message's text would make the model see words that were
 * never actually said in that message, which is a subtly different failure from "this turn
 * wasn't included at all". The budget is enforced by DROPPING turns, never by editing one.
 */
export function trimHistoryToBudget(
  messages: readonly ThreadHistoryMessage[],
  maxChars: number,
): readonly ThreadHistoryMessage[] {
  if (maxChars <= 0) return [];
  let total = 0;
  let firstKeptIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const next = total + messages[i]!.content.length;
    // The oldest kept message is allowed to push the running total over budget by itself
    // (see the doc comment: a single long message is kept whole, not truncated) -- but a
    // SECOND message would not be added once the budget is already spent.
    if (next > maxChars && total > 0) break;
    total = next;
    firstKeptIndex = i;
  }
  return messages.slice(firstKeptIndex);
}

/**
 * V8（PROP-CHAT-CONTEXT-ENGINE-001 §3）—— 上下文引擎第一步：**滚动摘要**，端口内侧、
 * `ModelCallPort` 契约一字节不动（coord-main 裁决 A 条件）。
 *
 * 现状缺口 G1：`trimHistoryToBudget` 把超预算的旧轮**整条丢弃**，长对话超 12k 字符后
 * 「记得前几轮」必然掉线。本函数在丢弃之前，可选地把被丢掉的旧轮压成一段摘要，作为一条
 * `assistant` 伪历史消息前置——这样近几轮原文保留、更旧的要点也不至于完全消失。
 *
 * ## 为什么默认关、opt-in
 * `summarize` 为 `undefined` 时，本函数返回值与直接调 `trimHistoryToBudget` **逐字节相同**
 * ——生产默认路径零行为变化、零风险（同 loopback 流式 / ASR turn_detection 的 opt-in 纪律）。
 * 打开摘要要多一次模型调用（成本/时延变化），因此由部署显式开启、先在受控环境验证再上生产。
 *
 * ## 失败与预算
 * - 摘要调用失败或返回空 ⇒ 静默退回 `trimHistoryToBudget` 的结果（不 fail run，与 #709
 *   历史读取失败降级为单轮同一种保守失败模式）。绝不因为「摘要没成」把一次本可完成的
 *   run 变失败。
 * - 摘要 + 保留后缀仍受 `maxChars` 约束：拿到摘要后按「摘要长度」重新给后缀留预算，
 *   保证总量不超预算，且**近几轮优先**（摘要挤不下时缩的是更旧的保留轮，不是最近的）。
 * - 摘要只是 `role/content` 伪消息，`ModelCallInput` 与 `ModelCallPort` 形状不变。
 */
/**
 * V9-b 前置 A（#970）—— 把一轮的附件元数据渲染成模型能读到的一行提示，拼到该轮文本末尾。
 *
 * 为什么落进 content 字符串：`ModelCallPort`/各 provider 只认 `{ role, content }`，不读
 * `ThreadHistoryMessage.attachments`。要让模型*知道*有附件，附件必须进 content。
 *
 * 渲染成**中性、诚实**的一行：模型据此可以说「你传了 X（image/png），但我还读不了它的内容」，
 * 而不是矢口否认有附件。附件**内容**进上下文是 B（F153/anydoc），不在这里。
 *
 * 无附件 → 原样返回，不加任何噪声（保持既有 run 的 prompt 逐字节不变，不惊动既有断言）。
 */
export function withAttachmentNotice(
  content: string,
  attachments: readonly HistoryAttachmentMeta[] | undefined,
): string {
  if (!attachments || attachments.length === 0) return content;
  const list = attachments.map((a) => `${a.filename}（${a.mime}）`).join("、");
  const notice = `［附件：${list}。这些文件已随该消息上传，但其内容尚未进入你的上下文——`
    + `你只知道它们存在，暂时还无法读取里面的内容。］`;
  return content.length > 0 ? `${content}\n\n${notice}` : notice;
}

export async function assembleHistory(
  recent: readonly ThreadHistoryMessage[],
  maxChars: number,
  summarize?: (dropped: readonly ThreadHistoryMessage[]) => Promise<string>,
  /**
   * 摘要调用失败时的观测回调（coord-main #913 review 提出）。摘要失败被静默吞、退回丢弃
   * 行为**不 fail run** 是刻意的，但「静默」会让运行者以为摘要在工作而其实一直在退化——
   * 受控环境开启摘要前必须能在日志里看到它失败。这里只观测、不改控制流：回调自身抛错也
   * 不影响「退回 kept」的结果（下方 try/catch 兜住回调的意外）。
   */
  onSummarizeError?: (error: unknown) => void,
): Promise<readonly ThreadHistoryMessage[]> {
  const kept = trimHistoryToBudget(recent, maxChars);
  if (!summarize) return kept; // 默认路径：与既有行为逐字节相同
  const droppedCount = recent.length - kept.length;
  if (droppedCount <= 0) return kept; // 没丢任何轮 ⇒ 无需摘要
  let summaryText: string;
  try {
    summaryText = (await summarize(recent.slice(0, droppedCount))).trim();
  } catch (error) {
    // 退化前先留一行日志（观测），再退回丢弃行为、不 fail run。
    try { onSummarizeError?.(error); } catch { /* 日志回调不该反过来拖垮组装 */ }
    return kept; // 摘要失败 ⇒ 退回丢弃行为，不 fail run
  }
  if (summaryText === "") return kept;
  const summaryMessage: ThreadHistoryMessage = {
    role: "assistant",
    content: `[前 ${droppedCount} 轮对话摘要] ${summaryText}`,
  };
  // 近几轮**永远优先**：摘要是「有余量才加」的锦上添花，绝不为它挤掉任何最近保留的轮。
  // 保留后缀已经贴着 `maxChars`，只有剩余预算容得下整条摘要时才前置；容不下就跳过摘要，
  // 返回原样的近几轮（不截断摘要——截一半的摘要是没验证过的半句话，宁可不要）。
  const keptChars = kept.reduce((sum, m) => sum + m.content.length, 0);
  if (keptChars + summaryMessage.content.length > maxChars) return kept;
  return [summaryMessage, ...kept];
}

export interface ExecuteAgentRunDeps {
  readonly runs: AgentRunStore;
  readonly model: ModelCallPort;
  /**
   * F159 计量。**可选**：只有真正产生计费事实的执行路径接它（`trial-run-agent` 一类
   * 不接，试跑不算进任何人的月度额度）。写失败不 fail run，理由见 `meter()` 的注释。
   */
  readonly usage?: TokenUsageMeterPort;
  readonly clock: AgentRunClock;
  /** Server-side only. Provider detail goes here and nowhere near a response. */
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * The prompt.
 *
 * The Skill bodies are joined in the SNAPSHOT'S order. Sorting them, deduplicating them or
 * reading them back in database order would each silently discard part of what was pinned
 * -- ordering is a property of `skillVersionIds`, which is why it is an array in both the
 * `agent_versions` column and the run row.
 *
 * Exported so `trial-run-agent.ts` (#595 Line A) builds the identical prompt shape for a
 * trial run instead of re-deriving "instructions then skills, joined by blank lines" a
 * second time -- that phrase is the one place this project's answer to "what does an Agent
 * actually see" lives, and a second copy is exactly the drift AGENTS.md calls out by name.
 */
export function buildSystemPrompt(
  instructions: string,
  skills: readonly { readonly versionId: string; readonly content: string }[],
): string {
  return [instructions, ...skills.map((s) => s.content)].join("\n\n");
}

/**
 * F159 —— 计量落库的唯一调用处（成功一次、失败一次，两条分支各调一次）。
 *
 * ## 为什么写失败不 fail run
 *
 * 用量是**账**，不是授权判定。账写失败是运维问题；把它变成用户的聊天失败，等于让一个
 * 记账缺陷去阻断产品主路径——与 `agent_run_steps` 那条「没有留痕就没有调用」不同，
 * 那一条护的是审计与授权，这一条护的是计费口径。
 *
 * ⚠ 但**不静默**：失败走 `deps.log` 大声留痕，且日志里带 `runId` 与 token 数，
 * 使「用量少记了」这件事可查。静默吞掉才是那个会让人以为计量在工作的错法。
 * 具名缺口 `GAP-USAGE-WRITE-RETRY`：本轮不做重试队列，写失败即永久少记一行。
 */
async function meter(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
  tokensTotal: number,
  outcome: "succeeded" | "failed",
): Promise<void> {
  if (!deps.usage) return;
  try {
    await deps.usage.record(orgId, {
      userId: run.requesterUserId,
      runId: run.runId,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      tokensTotal,
      outcome,
    });
  } catch (e) {
    deps.log("token usage metering write failed; usage under-counted for this run", {
      runId: run.runId, tokensTotal, outcome,
      detail: e instanceof Error ? e.message : "unexpected metering failure",
    });
  }
}

/** The one place a step becomes durable, so no path can record half of one. */
async function record(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  input: {
    runId: string; seq: number; kind: RunStepKind; startedAt: string;
    inputDigest: string | null; outputDigest: string | null; failureCode: RunFailureCode | null;
    toolName?: string | null; toolArgsSummary?: string | null; toolResultSummary?: string | null;
    planningNote?: string | null;
  },
): Promise<void> {
  await deps.runs.appendStep(orgId, {
    runId: input.runId,
    seq: input.seq,
    kind: input.kind,
    status: input.failureCode === null ? "succeeded" : "failed",
    startedAt: input.startedAt,
    endedAt: deps.clock.now(),
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    failureCode: input.failureCode,
    toolName: input.toolName ?? null,
    toolArgsSummary: input.toolArgsSummary ?? null,
    toolResultSummary: input.toolResultSummary ?? null,
    planningNote: input.planningNote ?? null,
  });
}

async function executeClaimed(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<void> {
  /* ── step: context_built ── */
  const contextStartedAt = deps.clock.now();
  const contextInput = sha256(
    JSON.stringify([run.agentVersionId, run.skillVersionIds, run.inputMessageId]),
  );
  let system: string;
  // #740: hoisted out of the try block below so the model-call section can forward it as
  // `ModelCallInput.skills` -- see that field's own doc comment for why `DeepAgentModelProvider`
  // needs the structured list, not just the flattened text already baked into `system`.
  let toolSkills: readonly PinnedSkillContent[] = [];
  try {
    const skills = await deps.runs.readPinnedSkills(orgId, run.skillVersionIds);
    if (skills.length !== run.skillVersionIds.length) {
      // Fail closed. A run that quietly proceeds with two of its three pinned Skills has
      // produced an answer from a configuration nobody ever approved.
      throw new ModelCallError(
        "SKILL_VERSION_UNAVAILABLE",
        `pinned ${run.skillVersionIds.length}, retrieved ${skills.length}`,
      );
    }
    // #741: the TS tool-calling loop is retired -- every run now takes this ONE shape,
    // regardless of how many Skills are pinned (see this file's own header). The general
    // assistant's own Skill-execution behaviour lives in `DeepAgentModelProvider`'s remote
    // service now (#740), not as a second branch here.
    toolSkills = skills;
    system = buildSystemPrompt(run.instructions, skills);
  } catch (e) {
    // Every way of not getting the pinned context is the same fact for a client: the run
    // could not be assembled from what was pinned. The distinguishing detail is logged.
    const code: RunFailureCode = "SKILL_VERSION_UNAVAILABLE";
    deps.log("agent run context build failed", {
      runId: run.runId,
      code,
      detail: e instanceof ModelCallError ? e.detail : "pinned context source unavailable",
    });
    await record(deps, orgId, {
      runId: run.runId, seq: 2, kind: "context_built", startedAt: contextStartedAt,
      inputDigest: contextInput, outputDigest: null, failureCode: code,
    });
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  const systemDigest = sha256(system);
  await record(deps, orgId, {
    runId: run.runId, seq: 2, kind: "context_built", startedAt: contextStartedAt,
    inputDigest: contextInput, outputDigest: systemDigest, failureCode: null,
  });

  /*
   * #709 -- prior turns of this thread, trimmed to the token-budget policy above.
   *
   * Deliberately OUTSIDE the `context_built` try/catch and never fails the run: unlike the
   * pinned Skill content above (a fact the run's approved configuration depends on), thread
   * history is dynamic conversation context, an enhancement over the pre-#709 single-turn
   * behaviour, not a correctness requirement the acceptance snapshot pinned. A history-read
   * failure degrading to "answer without prior context" (i.e. exactly today's behaviour) is
   * a strictly safer failure mode than turning a working single-turn run into a failed one
   * because of it -- especially since #709 ships behind no flag and must not be able to
   * regress runs that never needed history in the first place.
   */
  let history: readonly ThreadHistoryMessage[] = [];
  try {
    const recent = await deps.runs.readThreadHistory(
      orgId, run.threadId, run.inputMessageId, HISTORY_MAX_MESSAGES,
    );
    // V8 —— 开启摘要时，把被预算丢弃的旧轮压成一段摘要前置；关闭时（默认）
    // `assembleHistory` 不接 summarize，返回值与 `trimHistoryToBudget` 逐字节相同。
    // summarize 复用 `deps.model.complete`（ModelCallPort 契约不动），失败在
    // `assembleHistory` 内部被吞并退回丢弃行为，不会把这次 run 拖失败。
    const summarize = HISTORY_SUMMARY_ENABLED
      ? async (dropped: readonly ThreadHistoryMessage[]): Promise<string> => {
          const transcript = dropped.map((m) => `${m.role}: ${m.content}`).join("\n");
          const completion = await deps.model.complete({
            modelProvider: run.modelProvider,
            modelId: run.modelId,
            system: "你是对话历史摘要器。把下面这段较早的多轮对话压成简短要点，只保留后续对话可能需要回指的事实与结论，不要复述客套。用中文，尽量短。",
            user: transcript,
          });
          return completion.text;
        }
      : undefined;
    history = await assembleHistory(recent, HISTORY_MAX_CHARS, summarize, (error) => {
      // 摘要静默退化前留一行服务端日志（观测，不改行为）——受控环境开启
      // KERNEL_HISTORY_SUMMARY_ENABLED 前靠它判断摘要是真在工作还是一直在悄悄退回丢弃。
      deps.log("agent run history summarization failed, continuing with trimmed history", {
        runId: run.runId,
        detail: error instanceof Error ? error.message : "unexpected summarization failure",
      });
    });
  } catch (e) {
    deps.log("agent run thread history read failed, continuing without it", {
      runId: run.runId,
      detail: e instanceof Error ? e.message : "unexpected thread history read failure",
    });
  }

  // V9-b 前置 A（#970）：把附件元数据折进模型可见的 content——历史每轮 + 当前触发消息。
  // 触发消息（run.inputText）的附件走 run.inputAttachments（它不在 history 里，单独带，
  // 见 ClaimedAgentRun 注释），否则「刚传完就问」这条最常见路径恰好看不到附件。
  history = history.map((m) => ({ role: m.role, content: withAttachmentNotice(m.content, m.attachments) }));
  const userText = withAttachmentNotice(run.inputText, run.inputAttachments);

  /* ── step: model_called -- exactly one FINAL answer, whatever it took to reach it ── */
  const modelStartedAt = deps.clock.now();
  let text: string;
  /**
   * F159 —— provider 报回来的 token 数。三条分支（completeWithProgress / completeStream /
   * complete）都可能给，也都可能不给（`tokens` 是可选字段）；没给就是 `undefined`，
   * 落库时记 0 而不是估一个数——估出来的数会被当成账。
   */
  let reportedTokens: number | undefined;
  // #741: this used to be advanced by `executeToolLoop` as it recorded `tool_call` steps;
  // with that loop retired, `model_called` is always the third step (context_built is 2,
  // the two preceding are the run's own acceptance steps), so this is a constant again.
  const seqCursor = { value: 3 };
  try {
    // #798: `completeWithProgress`'s presence alone used to be the gate, but a router-shaped
    // port (`RoutingModelCallPort`) exposes that method as soon as ANY registered provider
    // needs it -- not only for runs pinned to THAT provider. `supportsProgress`, when the
    // port implements it, narrows the gate to this run's own pinned provider; a port that
    // doesn't implement `supportsProgress` (every single-provider port and test fake) keeps
    // the old behaviour exactly, since presence alone was always accurate for those.
    // Bound so calling it below (unattached from `deps.model.completeWithProgress`'s own
    // property access) still runs with the right `this` -- `RoutingModelCallPort`'s
    // implementation calls `this.resolve(...)` internally.
    const completeWithProgress = deps.model.completeWithProgress?.bind(deps.model);
    const wantsProgress = completeWithProgress !== undefined
      && (deps.model.supportsProgress ? deps.model.supportsProgress(run.modelProvider) : true);
    if (wantsProgress && completeWithProgress) {
      // #742: a provider whose run is a remote, multi-step planning loop (today:
      // `DeepAgentModelProvider`) reports intermediate steps as they happen -- the ONE
      // remaining alternative branch now that #741 retired the TS tool loop (see this
      // file's own header). See `ModelCallPort.completeWithProgress`'s own doc comment
      // for the contract.
      const completion = await completeWithProgress(
        {
          modelProvider: run.modelProvider, modelId: run.modelId, system, user: userText,
          history,
        },
        async (event) => {
          const stepStartedAt = deps.clock.now();
          await record(deps, orgId, {
            runId: run.runId, seq: seqCursor.value, kind: "tool_call", startedAt: stepStartedAt,
            inputDigest: event.toolArgsSummary === null ? null : sha256(event.toolArgsSummary),
            outputDigest: event.toolResultSummary === null ? null : sha256(event.toolResultSummary),
            failureCode: null,
            toolName: event.toolName,
            toolArgsSummary: event.toolArgsSummary,
            toolResultSummary: event.toolResultSummary,
            planningNote: event.planningNote,
          });
          seqCursor.value += 1;
        },
      );
      if (completion.text.trim() === "") {
        throw new ModelCallError("MODEL_CALL_FAILED", "provider returned neither content nor a progress event");
      }
      text = completion.text;
      reportedTokens = completion.tokens;
    } else {
      // #654 阶段2a: when the configured port supports streaming, use it and persist each
      // fragment as it arrives -- purely observational (see `AppendedRunDelta`'s own doc):
      // the run's success/failure is still decided by the SAME accumulated-text checks
      // below, exactly as the non-streaming path decides it. A port without `completeStream`
      // falls back to the one-shot `complete()`, unchanged from before this delta.
      let deltaSeq = 0;
      const completion = deps.model.completeStream
        ? await deps.model.completeStream(
          {
            modelProvider: run.modelProvider, modelId: run.modelId, system, user: userText,
            history, skills: toolSkills,
          },
          async (delta) => {
            if (delta === "") return; // Nothing to persist; not every provider fragment carries text.
            const seq = deltaSeq;
            deltaSeq += 1;
            await deps.runs.appendModelDelta(orgId, { runId: run.runId, seq, text: delta });
          },
        )
        : await deps.model.complete({
          modelProvider: run.modelProvider,
          modelId: run.modelId,
          system,
          user: userText,
          history,
          // #740: forwarded so `DeepAgentModelProvider` can hand the run's pinned Skills to
          // its remote `call_skill` tool -- see `ModelCallInput.skills`'s own doc comment.
          skills: toolSkills,
        });
      if (completion.text.trim() === "") {
        throw new ModelCallError("MODEL_CALL_FAILED", "provider returned empty content");
      }
      text = completion.text;
      reportedTokens = completion.tokens;
    }
  } catch (e) {
    const code: RunFailureCode = e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED";
    // The provider's own words live here and stop here. `detail` never reaches a response;
    // the run's terminal `error` is the enumerated code above.
    deps.log("agent run model call failed", {
      runId: run.runId,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      code,
      detail: e instanceof ModelCallError ? e.detail : "unexpected model call failure",
    });
    await record(deps, orgId, {
      runId: run.runId, seq: seqCursor.value, kind: "model_called", startedAt: modelStartedAt,
      inputDigest: systemDigest, outputDigest: null, failureCode: code,
    });
    // F159：失败的调用**也记一行**（tokens=0）。「失败就没有用量」会让计量流水与
    // `agent_runs` 的行数对不上，而对不上时没人分得清是漏记还是真没调用。
    await meter(deps, orgId, run, 0, "failed");
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  await record(deps, orgId, {
    runId: run.runId, seq: seqCursor.value, kind: "model_called", startedAt: modelStartedAt,
    inputDigest: systemDigest, outputDigest: sha256(text), failureCode: null,
  });
  await meter(deps, orgId, run, reportedTokens ?? 0, "succeeded");

  /* ── hand off to #413 ── */
  // `writeback_pending`, not `succeeded`. §6: the run may only become succeeded after the
  // Chat writeback transaction commits, and that transaction is not in this slice.
  await deps.runs.storeOutputAwaitingWriteback(
    orgId, run.runId, { text, finalStepSeq: seqCursor.value },
  );
}

/**
 * Claim and execute one bounded batch of this tenant's queued runs.
 *
 * Returns how many runs were executed (successfully or not) -- the caller uses it only for
 * observability. Nothing here throws for a run-level failure; a batch is not abandoned
 * because one run's provider was down.
 */
export async function executeQueuedRuns(
  deps: ExecuteAgentRunDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const claimed = await deps.runs.claimQueued(input.orgId, Math.min(20, input.limit ?? 10));
  for (const outcome of claimed) {
    if (outcome.kind === "unresolvable") {
      // The claim already moved it out of `queued`, so it cannot be left as-is.
      deps.log("agent run snapshot no longer resolvable", {
        runId: outcome.runId, code: "AGENT_VERSION_UNAVAILABLE",
      });
      await deps.runs.failRun(input.orgId, outcome.runId, "AGENT_VERSION_UNAVAILABLE");
      continue;
    }
    try {
      await executeClaimed(deps, input.orgId, outcome.run);
    } catch (e) {
      // A defect in this file, not a provider failure. Still recorded, still terminal:
      // leaving the run stuck in `running` forever is the one outcome nobody can act on.
      deps.log("agent run executor defect", {
        runId: outcome.run.runId,
        detail: e instanceof Error ? e.name : "unknown",
      });
      await deps.runs.failRun(input.orgId, outcome.run.runId, "MODEL_CALL_FAILED");
    }
  }
  return claimed.length;
}
