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
  PinnedSkillContent, ReportedUsage, RunFailureCode, RunStepKind, RunStepStatus,
  ThreadHistoryMessage, TokenUsageMeterPort,
} from "./ports";
import { DEEP_AGENT_PROVIDER_NAME, ModelCallError, isModelCallImageMime } from "./ports";
import type { ModelCallImage } from "./ports";
import {
  buildFileContextMessage, FILE_RETRIEVAL_MAX_HITS, type FileRetrievalPort,
} from "./file-retrieval";
import type { AgentRunContextSnapshotPort, ContextLayerStatus } from "./context-snapshot";
import {
  buildToolTraceMessage, TOOL_TRACE_RUN_LIMIT, type ToolTraceContextPort,
} from "./tool-trace-context";
import { buildCanvasTemplateGuidance, type CanvasTemplateGuidancePort } from "./canvas-template-guidance";
import type { SkillSandboxPort } from "../skill/skill-sandbox-port";
import type { ObjectStore } from "../artifact/ports";
import { maybeRunSkillScript, type ProducedFile } from "./run-skill-script";
import { RUN_SCRIPT_PROTOCOL_PROMPT, tryExtractScript } from "../skill/run-script-with-retries";
import {
  appendSkillFullContent, appendSkillNotMountedNotice, buildSkillCatalogBlock,
  MAX_READ_SKILL_ROUNDS, tryExtractReadSkillRequest, buildDeepAgentSkillCatalogBlock,
} from "./skill-catalog";
import type { OmittedRunImage, RunImagePort, VisionDegradation } from "./run-image-input";
import { renderVisionNotice, selectImagesWithinBounds } from "./run-image-input";
import type { VisionInputStatus } from "./context-snapshot";
import { serializePlanForDelivery } from "../plan-control/plan-delivery-text";
import type { PlanLedgerRepository, PlanRunStatusReader } from "../plan-control/ports";

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
 * F154 L2（08-chat/uc-8-7 R7，人类 2026-08-11 逐字签核「`HISTORY_MAX_MESSAGES` 不撑大」）——
 * `HISTORY_MAX_MESSAGES` 本身**不变**，它仍是 L1 概念上的行数上限；这个新常量只用来给 L2 的
 * 「有没有新增区间要折进持久摘要」判断一个更宽的候选窗口。L1 最终喂给模型的内容仍然只由
 * `HISTORY_MAX_CHARS` 的字符预算裁出（`trimHistoryToBudget` 逐字节不变）——宽窗口只是让
 * 「被裁掉的那部分」里，更旧的轮次也进入候选集，好让 L2 摘要真的能覆盖到它们，而不是让 L1
 * 本身变大。有界（不是无限翻查全史）：一次 run 最多为这个目的多读这么多行。
 */
export const L2_CATCHUP_FETCH_LIMIT = 200;

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
 * ## F154 L2 已接管调用侧（本函数本身、其 opt-in 形状、其纯单测不变）
 * `executeClaimed` 不再直接调用本函数做「摘要」——那份职责已被 F154 L2（持久化、增量、
 * `planLayeredHistoryIncrement` + `thread_context_state`）接管，L2 的摘要**跨 run 持久**，
 * 不是本函数这种「每次调用临时摘要一次、summarize 未传就什么都不做」的 ephemeral 形状。
 * `executeClaimed` 现在只用本文件同一个 `trimHistoryToBudget`（L1 的字符预算裁剪）。
 * 本函数与其 opt-in `summarize` 参数原样保留——仍是一个通用、纯粹、经过测试的「裁剪 + 可选
 * 摘要前置」工具，供未来其他调用点复用；`assemble-history.test.ts` 覆盖的正是这份能力本身，
 * 与 L2 是否接管了 `executeClaimed` 的调用无关。
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
  // 逐个附件按抽取状态渲染——一条消息里不同附件状态可能不同（有的抽好了、有的是图片、有的还在抽）。
  const notice = attachments.map(renderAttachmentForModel).join("\n\n");
  return content.length > 0 ? `${content}\n\n${notice}` : notice;
}

/**
 * V9-b（F153）—— 按抽取状态把单个附件渲染成模型能读到的一段：
 *   - extracted   → 折进**抽取内容摘录**（模型真能读文件了）。
 *   - unsupported → 明说抽不出文本（图片无文字层）。
 *   - failed      → 明说提取失败。
 *   - pending/缺省 → 明说内容正在提取、暂不可读（A 阶段的诚实兜底，也覆盖旧数据）。
 */
function renderAttachmentForModel(a: HistoryAttachmentMeta): string {
  const head = `${a.filename}（${a.mime}）`;
  switch (a.extractionStatus) {
    case "extracted":
      return a.extractedExcerpt && a.extractedExcerpt.length > 0
        ? `［附件 ${head} 的内容如下：\n${a.extractedExcerpt}\n］`
        : `［附件 ${head}：已解析，但未提取到文本内容。］`;
    case "unsupported":
      return `［附件 ${head}：无法提取文本内容（例如图片没有文字层）。你知道用户上传了它，但读不到里面的文字。］`;
    case "failed":
      return `［附件 ${head}：内容提取失败，无法读取其内容。］`;
    default:
      return `［附件 ${head}：内容正在提取中，暂时还读不到——你只知道用户上传了这个文件。］`;
  }
}

/**
 * P2（#1561）—— 本轮图像输入的全部决策，一处做完：**送不送、送几张、没送的怎么如实交代**。
 *
 * ## 这个函数的存在理由，就是不要复刻 #1558
 *
 * #1558 里用户上传了一张有内容的 PNG、看到了附件卡片、合理预期模型能看到，问了才发现
 * 看不到——「产品允许传图，却在任何地方都没告诉用户『图我看不了』」。所以这里**每一条
 * 不送的路径都必须留下一句模型能读到的话**，没有任何一条分支是"悄悄地什么都不做"。
 *
 * ## 分支与它们对应的快照态（唯一事实源在 `VisionInputStatus` 的文档）
 *
 *   本轮没挂图                        → `none`，不加任何文本（保持既有 run 逐字节不变）。
 *   挂了图但没接 `deps.runImages`      → `not_configured`，也不额外加文本：F153 的附件提示
 *                                       已经如实说过「这个附件读不到内容」。
 *   挂了图但模型没有视觉能力           → `not_supported` + 明确告知（#1561 交付契约第 4 条）。
 *   有能力、但取字节这一步没成         → `degraded` + 明确告知（"这次没取到"，不是"本来没图"）。
 *   送成了至少一张                     → `ok`；被上界挡下的那几张逐条写清原因（不静默截断）。
 */
async function gatherVisionImages(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<{
  readonly images: readonly ModelCallImage[];
  readonly notice: string | null;
  readonly status: VisionInputStatus;
  readonly omittedCount: number;
}> {
  const attachedImageCount = run.inputAttachments.filter((a) => isModelCallImageMime(a.mime)).length;
  const nothing = { images: [] as readonly ModelCallImage[], notice: null } as const;
  if (attachedImageCount === 0) return { ...nothing, status: "none", omittedCount: 0 };
  if (!deps.runImages) {
    return { ...nothing, status: "not_configured", omittedCount: attachedImageCount };
  }

  const degraded = (reason: string, status: VisionInputStatus) => ({
    ...nothing,
    status,
    omittedCount: attachedImageCount,
    notice: renderVisionNotice(0, [], { imageCount: attachedImageCount, reason } satisfies VisionDegradation),
  });

  // 能力查询缺席 ⇒ false（fail closed），理由逐字见 `ModelCallPort.supportsVision` 的文档。
  const canSee = deps.model.supportsVision?.(run.modelProvider, run.modelId) ?? false;
  if (!canSee) {
    // ⚠ 这条分支就是 #1561 交付契约第 4 条：诚实降级，绝不静默丢弃。图**没有**被送出去，
    // 而模型被明确告知它这轮看不到图——用户问起时它答得出真话，不会假装看过。
    return degraded(
      `本次运行绑定的模型（${run.modelProvider} / ${run.modelId}）不具备视觉输入能力`,
      "not_supported",
    );
  }

  let refs;
  try {
    refs = await deps.runImages.list(orgId, {
      threadId: run.threadId,
      messageId: run.inputMessageId,
      actorUserId: run.requesterUserId,
    });
  } catch (e) {
    deps.log("agent run vision image listing failed, continuing without images", {
      runId: run.runId, detail: e instanceof Error ? e.message : "unexpected vision list failure",
    });
    return degraded("读取这些图片时出错（本轮未能取到图像内容）", "degraded");
  }

  const { accepted, omitted } = selectImagesWithinBounds(refs);
  const images: ModelCallImage[] = [];
  const allOmitted: OmittedRunImage[] = [...omitted];
  for (const ref of accepted) {
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.runImages.read(orgId, {
        threadId: run.threadId,
        messageId: run.inputMessageId,
        actorUserId: run.requesterUserId,
      }, ref.attachmentId);
    } catch (e) {
      deps.log("agent run vision image read failed", {
        runId: run.runId, detail: e instanceof Error ? e.message : "unexpected vision read failure",
      });
      allOmitted.push({ filename: ref.filename, reason: "读取图像字节时出错" });
      continue;
    }
    if (bytes === null) {
      // 元数据在、字节没了——一个确定的「这张取不到」，与上面的抛错在日志里分得开。
      allOmitted.push({ filename: ref.filename, reason: "图像内容在存储中不存在" });
      continue;
    }
    if (!isModelCallImageMime(ref.mime)) continue; // `selectImagesWithinBounds` 已挡；类型收窄用。
    images.push({ filename: ref.filename, mime: ref.mime, bytes });
  }

  if (images.length === 0) {
    // 有能力、也确实有图，但一张都没送成。这不是 `ok` 的零张——如实记 `degraded`。
    const detail = allOmitted.length > 0
      ? `这些图都未能送入模型（${allOmitted.map((o) => `${o.filename}：${o.reason}`).join("；")}）`
      : "本轮未能取到任何图像内容";
    return degraded(detail, "degraded");
  }
  return {
    images,
    notice: renderVisionNotice(images.length, allOmitted, null),
    status: "ok",
    // 「用户传了几张 vs 模型看到了几张」的差额——审计链上 #1561 要求快照必须能回答的那件事。
    omittedCount: Math.max(0, attachedImageCount - images.length),
  };
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

/**
 * F154 L2（08-chat/uc-8-7 R3②/R7/R12 V1-V2）—— 纯函数，零 IO：给定「较宽窗口内按时间正序取回
 * 的候选消息」「L1 已经裁出、原样保留的最新那段」「上次持久摘要覆盖到哪条消息 id」，算出
 * 「L1 边界之前、尚未纳入持久摘要的新增轮」——即本轮真正需要做的增量摘要工作。
 *
 * ## 为什么用长度切片而不是内容比对
 * `l1` 是 `candidates` 经 `trimHistoryToBudget` 裁出的**连续最新后缀**（该函数只按预算丢最旧的，
 * 不重排、不抽样、不去重）——因此 `candidates` 去掉最后 `l1.length` 条，剩下的前缀就精确是
 * 「L1 边界之前的一切」，用长度切片是唯一不会被重复文本内容误判的做法。
 *
 * ## 缺 id 时保守跳过（不猜测顺序）
 * `ThreadHistoryMessage.id` 是可选字段（多数不关心持久化的构造点不填）。候选集里只要有一条
 * 缺 id，本函数直接返回「无新增」——精确定位「摘要覆盖到哪」离不开 id，猜测顺序换来的是可能
 * 重复摘要或漏摘，两者都比「这轮不推进摘要、复用已有的」更糟。
 *
 * ## 游标定位
 * `summarizedThroughId` 为 `null`（从未摘要过）或找不到匹配（比宽窗口本身覆盖的还旧——
 * `L2_CATCHUP_FETCH_LIMIT` 本就有界，这是刻意的降级，不是 bug）时，从候选集里「L1 边界之前」
 * 最旧的一条开始；否则只取游标之后（不含）到 L1 边界之前的部分——这正是 V2 要求的
 * 「摘要调用输入只含新增区间，不重读全史」。
 */
export interface LayeredHistoryIncrement {
  /** 需要折进持久摘要的新增轮，oldest-first；空数组 = 无新增（游标已经覆盖到 L1 边界）。 */
  readonly toSummarize: readonly ThreadHistoryMessage[];
  /** `toSummarize` 非空时，其最新一条的 id——摘要成功后 `summarizedThroughId` 应前推到这里。 */
  readonly advanceCursorTo: string | null;
}

export function planLayeredHistoryIncrement(
  candidates: readonly ThreadHistoryMessage[],
  l1: readonly ThreadHistoryMessage[],
  summarizedThroughId: string | null,
): LayeredHistoryIncrement {
  if (candidates.some((m) => m.id === undefined)) return { toSummarize: [], advanceCursorTo: null };
  const olderThanL1 = l1.length > 0 ? candidates.slice(0, candidates.length - l1.length) : candidates;
  let startIndex = 0;
  if (summarizedThroughId !== null) {
    const cursorIndex = olderThanL1.findIndex((m) => m.id === summarizedThroughId);
    startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
  }
  const toSummarize = olderThanL1.slice(startIndex);
  if (toSummarize.length === 0) return { toSummarize: [], advanceCursorTo: null };
  return { toSummarize, advanceCursorTo: toSummarize[toSummarize.length - 1]!.id! };
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
  /**
   * F155 L3 —— 文件式检索（design delta `context-engine-l3-file-based`，人类 2026-08-14 签核）。
   *
   * **可选**，与 `usage` 同一条既有理由：既有测试与不需要 L3 的执行路径（`trial-run-agent`
   * 一类）构造这个对象时不必都改，而生产合成（`kernel.module.ts` → `AgentRunExecutor`）必定
   * 注入——「这次 run 有没有 L3」因此是**合成期的一个明确选择**，不是运行期的一个偶然。
   * 缺省不注入 ⇒ 行为与 F155 之前逐字节相同（history 不多一条伪消息）。
   */
  readonly files?: FileRetrievalPort;
  /**
   * F157 —— 可审计上下文快照写入口。**可选**，与 `usage`/`files` 同一条既有理由：既有测试
   * 与不需要被审计的执行路径（`trial-run-agent` 一类）不必都改，生产合成
   * （`kernel.module.ts` → `AgentRunExecutor`）必定注入。缺省不注入 ⇒ 不写快照，行为与
   * F157 之前逐字节相同（不影响 history/model 调用本身）。
   */
  readonly contextSnapshots?: AgentRunContextSnapshotPort;
  /**
   * F190 —— 工具调用轨迹跨 run 回喂上下文（design-delta `tool-trace-cross-run-context`，
   * 已签核）。**可选**，与 `files`/`contextSnapshots` 同一条既有理由：既有测试与不需要
   * 这一层的执行路径（`trial-run-agent` 一类）不必都改，生产合成（`kernel.module.ts` →
   * `AgentRunExecutor`）必定注入。缺省不注入 ⇒ 行为与 F190 之前逐字节相同（history 不多
   * 一条伪消息）。
   */
  readonly toolTrace?: ToolTraceContextPort;
  /**
   * issue #1493（「chat 用上后台画布模板」后端块）—— 本组织已发布的画布模板清单，读出来拼进
   * system prompt（`canvas-template-guidance.ts`）。**可选**，与 `files`/`toolTrace` 同一条
   * 既有理由：既有测试与不需要这段指引的执行路径（`trial-run-agent`/`quick-digital-interview`
   * 一类）不必都改，生产合成（`kernel.module.ts` → `AgentRunExecutor`）必定注入。缺省不注入
   * ⇒ system prompt 与本次改动之前逐字节相同（不多出 canvas 指引这一段）。
   */
  readonly canvasTemplates?: CanvasTemplateGuidancePort;
  /**
   * #1624 —— chat 里挂了 skill 之后，模型写出来的脚本**真的被执行**的那条路径。
   *
   * **两者都可选，且必须一起注入才生效**（见 `run-skill-script.ts` 的触发判据表）：
   * 与 `files`/`usage`/`canvasTemplates` 同一条既有先例——缺省不注入 ⇒ 这条路径整段
   * 不存在，`text` 就是模型原文、不产出任何文件、沙箱一次都不被调用，行为与本次改动
   * 之前**逐字节相同**。`trial-run-agent` 一类不接它的执行路径因此一行都不用改。
   */
  readonly sandbox?: SkillSandboxPort;
  /** 同上：产物字节落这里（`putOnce`），没有它就没有地方放文件，于是根本不执行。 */
  readonly objects?: ObjectStore;
  /**
   * P2（#1561）—— 推理侧图像通道的取字节端口。**可选**，与 `files`/`contextSnapshots`/
   * `toolTrace` 同一条既有理由：既有测试与不需要这一层的执行路径（`trial-run-agent` 一类）
   * 不必都改，生产合成（`kernel.module.ts` → `AgentRunExecutor`）必定注入。
   *
   * ⚠ 缺省不注入 ⇒ 与 P2 之前**逐字节相同**：不取图、不改 userText、快照记 `"none"`。
   * 这是刻意的——「这次部署有没有图像通道」是合成期的一个明确选择，不是运行期的偶然。
   */
  readonly runImages?: RunImagePort;
  /**
   * F975 (`plan-control` 契约束, UC-12 `deliverPlanToRun`) —— I-10 的唯一注入点。
   * **可选**，与本接口其余字段同一条既有先例：既有测试与不需要计划送达的执行路径
   * （`trial-run-agent` 一类）不必都改，生产合成（`kernel.module.ts` → `AgentRunExecutor`）
   * 必定注入。缺省不注入，或该线程还没有任何账本（`getLatest` 返回 `null`）/账本为空
   * （`serializePlanForDelivery` 返回 `null`）⇒ `system` 与 F975 之前**逐字节相同**——
   * 同一纪律，`canvasTemplates`/`sandbox` 等字段的头注已经把这条讲过很多遍。
   *
   * ⚠ 读失败是 log + 继续（不 fail 这个已经被 claim 的 run）——I-10 的 fail-closed
   * 语义应用在 `confirmPlan`（F975 自己的 UC-7）**创建这轮 run 之前**的那次读，不是这里：
   * 这个 run 的 `agent_runs` 行已经存在（`executeClaimed` 处理的是已 claim 的行），
   * 读计划失败并不能"不创建"一个已经创建的东西，把它变成整轮 run 失败会让一次账本读
   * 抖动变成用户可见的失败，这不是 I-10 要保护的性质。
   */
  readonly planLedger?: PlanLedgerRepository & PlanRunStatusReader;
  /**
   * design-delta `skill-lazy-loading` —— 这个部署有没有真的把 `KERNEL_MODEL_STREAM_ENABLED`
   * 打开（`configured-model-provider.ts` 在合成期读一次的**同一个**旗标，这里只是把它的值
   * 带过来，不重新读环境变量、不第二次声明这件事——单一事实源仍是那个文件）。
   *
   * ⚠ **为什么不能用 `deps.model.completeStream` 是否存在来判断**——这是本 delta 真栈测试
   * （T6，`chat-skill-mount-produces-pptx-real-stack.test.ts`）踩过的一个真实坑:生产接线里
   * `deps.model` 是 `RoutingModelCallPort`，它的 `completeStream` **恒存在**（对不支持流式
   * 的叶子 provider 内部退回 `complete()`，见 `routing-model-call-port.ts` 头注），按方法
   * 存在性判断在真实接线下永远拿到"有"，会让"只在非流式部署生效"这条排除条件形同虚设。
   *
   * 缺省 `undefined`（当 `false` 处理）⇒ 与 `KERNEL_MODEL_STREAM_ENABLED` 默认关的行为
   * 逐字节相同——渐进式加载正常生效。只有显式传 `true`（生产合成
   * `kernel.module.ts` → `AgentRunExecutor` 按环境变量注入）时，`useLazySkillLoading` 才会
   * 因为"这个部署真的会流式"而排除渐进式加载——流式 + 渐进式加载如何共存是明确的后续工作
   * （`contract.md` 附加说明），不是这里假装处理了。
   */
  readonly streamingEnabled?: boolean;
  /** Server-side only. Provider detail goes here and nowhere near a response. */
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

/**
 * F157 —— 与 `HISTORY_MAX_CHARS` 头注同一条换算（~4 字符/token 的保守代理，这个部署没有真实
 * tokenizer）。单独具名，不复述那段注释——唯一事实源仍是 `HISTORY_MAX_CHARS` 自己的头注，
 * 这里只是给「怎么把字符数换算成一个估值」一个可复用的数字。
 */
const ESTIMATED_TOKENS_CHAR_RATIO = 4;

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
/**
 * VZ-02 —— 可视化输出指引。附加到**每个** agent 的 system prompt。零契约变更、`ModelCallPort`
 * 不动——纯提示词。渲染契约（12 类白名单、严格模式、诚实错误盒）在前端，本段不碰。
 *
 * ⚠ 语法规则聚焦「能渲染」：devapp 实测（2026-08-12）模型爱在节点标签里塞裸 `|` 和 `<br/>`，
 *   前端白名单闸门下 mermaid 严格模式解析直接失败、落诚实错误盒。图类型白名单单源是
 *   `@repo/contracts` 的 `MermaidDiagramType`（12 种）——这里为 prompt 可读性列出同一份，
 *   前端校验仍以枚举为准。
 *
 * ## 为什么 2026-08-26（issue #2099）把它从「鼓励出图」翻成「默认不画」
 *
 * 人类 devapp 实测：问「最好的教育是怎么样的」（未挂任何 skill）被塞了一张思维导图。
 * 旧版**已经**有一句抑制——「只在图真的帮助理解时才画，纯问答不必配图」——它没拦住。
 * 所以本次改动的前提是：**光把措辞写得更严厉没有用**，得改掉它失效的那几个机制：
 *
 * 1. **顺序**：旧版主句是祈使的「输出一个 ```mermaid 围栏代码块」，抑制只是同一句尾巴上的
 *    从属状语。现在默认态是本节标题和第一句，例外态才往后排。
 * 2. **消除图型点名的启发**：旧版在**触发句里**就点了「流程/时序/…/思维导图/…」九种，正文再列
 *    12 种——模型在读到抑制句之前，已经被点名两轮。「教育」这种概念题匹配上「思维导图」几乎
 *    是必然。现在触发句里**不出现任何图型名**，12 类白名单挪到「已判定要画」之后。
 * 3. **把不可证伪的判据换成可核对的判据**：「图真的帮助理解」是模型永远能说服自己的论证。
 *    换成两条可核对的事实——① 用户本轮**是否用了**要图的词；② 内容**是不是**有向结构
 *    （步骤/状态转移/连线关系/时间顺序）而非并列要点。
 * 4. **给反例，而且逐字包含翻车的那一句**：把失败样本写进模型看得见的地方，并点破
 *    「配思维导图只是把段落标题搬进方框」这个具体的无效性。
 * 5. **模糊地带的默认值翻面**：明写「拿不准就不画」——旧版模糊时默认画。
 *
 * ⚠ **这仍然是软约束，没有硬门控**：模型仍可能不听。人类在四个方案里明确选了这条并知情。
 *    对照证据（真实 dashscope 模型，非 loopback，每臂多次采样，含留出集问句）见 issue #2099 / 其 PR。
 */
export const VISUALIZATION_GUIDANCE = [
  "## 可视化（mermaid 图）——默认不画",
  "**默认不画图，用文字回答。** 只有满足下面任意一条时才画：",
  "1. 用户在本轮消息里明确要图——出现「画 / 图 / 流程图 / 时序图 / 结构图 / 示意图 / 可视化 / mermaid / 脑图 / 思维导图 / 甘特」这类词，或明说要「用图说明」。",
  "2. 要表达的内容本身是**有向结构**：步骤有先后、状态之间会转移、实体之间有连线关系、事件有时间顺序；"
    + "并且纯文字讲清楚需要反复回指「上面第几步 / 前面那个状态」。",
  "两条都不满足就不画。**拿不准就不画。**",
  "反例（一律不画）：「最好的教育是怎么样的」「你怎么看 X」「解释一下 Y」「A 和 B 有什么区别」「有哪些注意事项」——"
    + "这类回答的要点是**并列的观点**，不是有向关系；给它配思维导图只是把段落标题搬进方框，不增加任何信息，反而打断阅读。"
    + "内容深刻、结构清晰、要点很多，都**不是**画图的理由。",
  "正例（该画）：「把 OAuth 授权码流程画出来」「这几个状态之间是怎么转的」「帮我画一下模块依赖关系」「这个项目的排期画成甘特图」。",
  "",
  "**以下规则只在你已经按上面判定「要画」之后才适用；判定为不画时，整节忽略。**",
  "输出一个 ```mermaid 围栏代码块，前端会把它渲染成图。只用这 12 种图类型（其它类型渲染不了）：flowchart、"
    + "sequenceDiagram、classDiagram、stateDiagram、erDiagram、journey、gantt、pie、quadrantChart、mindmap、timeline、gitGraph。",
  "必须产出**能被 mermaid 解析**的语法，否则会渲染失败：",
  "- 节点标签里含空格以外的特殊字符（例如 | : ; ( ) [ ] { } < > \" #）时，把整个标签用双引号包起来："
    + "写 A[\"pbpaste | fabric\"]，不要写 A[pbpaste | fabric]——裸的 | 会被当成边标签分隔符，直接解析失败。",
  "- 不要在标签里用 <br/> 之类 HTML 标签（严格模式下不生效且容易解析失败）；要分行就拆成多个节点，别往标签里塞 HTML。",
  "- 先给一个**能渲染**的简洁图，更多细节放到图后面的文字里补充。",
].join("\n");

/**
 * `canvasGuidance` 是**可选、追加**参数（issue #1493）—— `trial-run-agent.ts` 与
 * `quick-digital-interview.ts` 两个既有调用点不传它，行为与本次改动之前逐字节相同；只有
 * `execute-run.ts` 自己的生产路径会算出这段动态指引再传进来。拼接顺序与 `VISUALIZATION_GUIDANCE`
 * 同级、紧随其后：两者都是「除了纯文字，你还可以用某种围栏产出结构化内容」这一类附加指引，
 * canvas 指引依赖 mermaid 指引已经建立的「围栏语法」认知，放在它后面顺理成章。
 *
 * `mode`（design-delta `skill-lazy-loading`，默认 `"full"`）—— `"full"` 是本次改动
 * 之前唯一的行为：每个挂载 skill 的全文直接拼进去，`trial-run-agent.ts`/
 * `quick-digital-interview.ts`（不传这个参数）与 `execute-run.ts` 对 deep-agent
 * provider 的 run，行为与本次改动之前逐字节相同（verification.md V5）。`"catalog"`
 * 只由 `execute-run.ts` 对非 deep-agent 的 run 传入：把每个 skill 的全文换成目录里
 * 一行摘要 + 按需请求协议说明（`skill-catalog.ts`），`skills.length === 0` 时两种
 * 模式的输出完全相同（没有目录可拼）。
 */
export function buildSystemPrompt(
  instructions: string,
  skills: readonly { readonly versionId: string; readonly stableName: string; readonly content: string }[],
  canvasGuidance?: string | null,
  mode: "full" | "catalog" | "deep-agent-catalog" = "full",
): string {
  // #2534：`"deep-agent-catalog"` 只由 `execute-run.ts` 对 deep-agent 的 run 传入——
  // 目录条目同 `"catalog"`，但取全文的说明指向远端真实工具 `call_skill`，不是
  // `read_skill` 围栏（见 `buildDeepAgentSkillCatalogBlock` 头注）。0 个 skill 时三种
  // 模式输出逐字相同。
  const skillParts = skills.length === 0 ? []
    : mode === "catalog" ? [buildSkillCatalogBlock(skills)]
    : mode === "deep-agent-catalog" ? [buildDeepAgentSkillCatalogBlock(skills)]
    : skills.map((s) => s.content);
  const parts = [instructions, ...skillParts, VISUALIZATION_GUIDANCE];
  if (canvasGuidance) parts.push(canvasGuidance);
  return parts.join("\n\n");
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
  usage: ReportedUsage,
  outcome: "succeeded" | "failed",
): Promise<void> {
  if (!deps.usage) return;
  try {
    await deps.usage.record(orgId, {
      userId: run.requesterUserId,
      runId: run.runId,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      // 总数缺失记 0（必填维度）；拆分维度缺失记 null（「上游没报」≠「用了 0」）。
      tokensTotal: usage.total ?? 0,
      promptTokens: usage.prompt ?? null,
      completionTokens: usage.completion ?? null,
      outcome,
    });
  } catch (e) {
    deps.log("token usage metering write failed; usage under-counted for this run", {
      runId: run.runId, tokensTotal: usage.total ?? 0, outcome,
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
    /** #742 Gap 1 -- explicit status override for the ONE case `failureCode` can't express:
     * an `in_progress` `tool_call` row. Every other caller omits this and keeps the old
     * derivation (`failureCode === null ? "succeeded" : "failed"`). */
    status?: RunStepStatus;
    /** #742 Gap 1 -- `tool_call` steps only, see `AppendedRunStep.toolCallId`'s own doc. */
    toolCallId?: string | null;
  },
): Promise<void> {
  await deps.runs.appendStep(orgId, {
    runId: input.runId,
    seq: input.seq,
    kind: input.kind,
    status: input.status ?? (input.failureCode === null ? "succeeded" : "failed"),
    startedAt: input.startedAt,
    endedAt: deps.clock.now(),
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    failureCode: input.failureCode,
    toolName: input.toolName ?? null,
    toolArgsSummary: input.toolArgsSummary ?? null,
    toolResultSummary: input.toolResultSummary ?? null,
    planningNote: input.planningNote ?? null,
    toolCallId: input.toolCallId ?? null,
  });
}

async function executeClaimed(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<void> {
  // DA-07b resume 续号（见 `ClaimedAgentRun.resumeStepSeqBase` 的文档）：一个被 HITL
  // 中断过的 run 第二次被 `executeClaimed` 处理时，`agent_run_steps` 里已经有它第一次
  // 执行留下的行——继续从硬编码的 1 起步会让下面的 context_built（seq=2）撞上第一次
  // 执行时已经写在 seq=2 的那一行，`agent_run_steps_seq_uniq` 直接拒绝。缺席（全新 run）
  // 时退回 1，与本次改动之前逐字节相同。
  const stepSeqBase = run.resumeStepSeqBase ?? 1;
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
  /**
   * #1747 —— 这轮要不要把脚本执行协议作为结构化输入送给 provider。`undefined` = 不送。
   * 由下面那道**已有的**门赋值，与它给 `system` 追加协议文本用的是同一个条件。
   */
  let scriptProtocol: string | undefined;
  /*
   * design-delta `skill-lazy-loading` §1 —— 只对非 deep-agent、非流式部署的 run 走
   * 目录 + 按需展开:
   *
   * ① deep-agent provider 已经有自己的按需执行机制（`call_skill` 真实工具调用，见
   *   `deep-agent-model-provider.ts` 头注"input.system is still sent... not a
   *   mistake"那段，`contract.md` §1 明确不碰）。
   *
   * ② 流式部署（`deps.streamingEnabled`）排除在外：渐进式加载的中间轮（read_skill
   *   请求/展开）不该被当作真实增量推给用户，本 delta 不处理这个交互，见
   *   `deps.streamingEnabled` 自己的头注。
   *
   * ⚠ **不**按 `deps.model.completeStream === undefined` 判断②——最初这么写过，被
   * 这个文件自己的真栈测试（T6，`chat-skill-mount-produces-pptx-real-stack.test.ts`）
   * 当场证伪:生产接线里 `deps.model` 是 `RoutingModelCallPort`，它的 `completeStream`
   * **恒存在**（`routing-model-call-port.ts` 自己的头注:"ALWAYS defined on the
   * router itself... dispatch always succeeds"，对不支持流式的叶子 provider 内部退回
   * `complete()`)。按存在性判断在真实接线下永远拿到"有"，这条排除条件形同虚设——
   * 本优化在生产里**从未真正按预期排除过流式部署**，也**从未真正对非流式部署生效
   * 过**（两处判断用的是同一个坏条件），只在内存 fake 单测里（`deps.model` 直接就是
   * 叶子 port，没有路由包装）看起来对。改成显式的 `deps.streamingEnabled`——由合成
   * 期（`kernel.module.ts`）按**同一个** `KERNEL_MODEL_STREAM_ENABLED` 环境变量注入,
   * 不重新探测运行时对象形状。
   */
  const isDeepAgentRun = run.modelProvider === DEEP_AGENT_PROVIDER_NAME;
  const useLazySkillLoading = !isDeepAgentRun && !deps.streamingEnabled
    && run.skillVersionIds.length > 0;
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
    // #2534：此前这里还有一段 `readPlatformSkills`（#2515）把平台 skill 在执行期
    // 并进 `toolSkills`——与 #2519 的快照默认加载是同一件事的第二份实现，且绕过了
    // "agent 钉了 skill 就只用钉的"。现在"这次 run 用哪些 skill"只由快照
    // （`message-roundtrip.ts` `resolveRunSkillVersionIds`）决定，这里不再另读任何目录。
    // issue #1493 -- own try/catch, INSIDE the outer one but never rethrown: a canvas
    // template read failure is not "the pinned context couldn't be assembled" (that is what
    // `SKILL_VERSION_UNAVAILABLE` above means), it is the same "this layer degraded to
    // absent" story L2/L3/tool-trace already tell elsewhere in this file. Read every run --
    // there is no honest cache here, see the port's own doc comment for why not: a template
    // republished a moment ago must show up in the very next run, not after some TTL.
    let canvasGuidance: string | null = null;
    if (deps.canvasTemplates) {
      try {
        const templates = await deps.canvasTemplates.listPublished(orgId, run.requesterUserId);
        canvasGuidance = buildCanvasTemplateGuidance(templates);
      } catch (e) {
        deps.log("agent run canvas template guidance read failed, continuing without it", {
          runId: run.runId,
          detail: e instanceof Error ? e.message : "unexpected canvas template read failure",
        });
      }
    }
    // #2534：deep-agent run 的 system prompt 只放目录，全文经 `toolSkills` → 远端
    // `org_skills` 由 `call_skill` 按需取（`buildDeepAgentSkillCatalogBlock` 头注）。
    // #2519 之后默认加载的是组织全部已启用 skill，再按 #725 的老办法把全文都贴进
    // system prompt，每轮提示词随 skill 数线性膨胀——#2515 实测要削的正是这个延迟。
    const systemPromptMode = isDeepAgentRun ? "deep-agent-catalog"
      : useLazySkillLoading ? "catalog" : "full";
    system = buildSystemPrompt(run.instructions, skills, canvasGuidance, systemPromptMode);
    /*
     * #1624 —— 告诉模型它**真的能执行代码**。
     *
     * 没有这一段，挂着 pptx skill 的模型只会把 pptxgenjs 代码讲出来给人看，永远不会
     * 主动产出一个可被解析的 `run_script` 块，于是下面的执行判据永远不成立——「接了
     * 沙箱却拿不到文件」正是这条路径最容易出现的空转形态。
     *
     * ⚠ 门与执行判据**共用同一个前提**（沙箱+对象存储都注入 ∧ 挂了 skill）：不注入
     *   沙箱时 system prompt **一个字都不变**，这是 T2「逐字节相同」覆盖到提示词这一格。
     * ⚠ 拼在**最后**：skill 自己的指令优先，这里只追加一层能力说明——与
     *   `execute-trial-run.ts` 逐字同一条纪律，不写第二套拼法。
     */
    if (deps.sandbox && deps.objects && toolSkills.length > 0) {
      system = `${system}\n\n---\n\n${RUN_SCRIPT_PROTOCOL_PROMPT}`;
      /*
       * #1747 —— 同一道门，同一段文本，多一个出口。
       *
       * 对普通 provider，协议写在 system prompt 里就够了：模型的回复就是被解析的那段
       * 文本。对 `DeepAgentModelProvider` 不够——它把 skill 的执行委托给远端 graph 里
       * 一次**独立的**子模型调用（`call_skill`），那次调用的 system prompt 是 skill 正文，
       * 收不到这里的 `system`。协议得作为结构化输入随请求过去，远端原样转发。
       *
       * ⚠ 刻意复用同一个常量而不是在 Python 侧再写一份：解析脚本块的正则在
       *   `run-script-with-retries.ts`，协议文本必须与它同源。
       */
      scriptProtocol = RUN_SCRIPT_PROTOCOL_PROMPT;
    }

    // F975 UC-12 `deliverPlanToRun` -- the one real injection point (`domain.md` 三·①:
    // "A system 注入"). Appended AFTER the sandbox/script-protocol block, same "own
    // instructions first, capability/plan context after" ordering the comment two blocks
    // up already documents for that block. See `ExecuteAgentRunDeps.planLedger`'s own doc
    // for why a read failure here is log-and-continue, not a run failure.
    if (deps.planLedger) {
      try {
        const ledger = await deps.planLedger.getLatest(orgId, run.threadId);
        const planText = ledger ? serializePlanForDelivery(ledger) : null;
        if (planText !== null) system = `${system}\n\n---\n\n${planText}`;
      } catch (e) {
        deps.log("plan-control: reading the plan ledger for delivery failed, continuing without it", {
          runId: run.runId,
          detail: e instanceof Error ? e.message : "unexpected plan ledger read failure",
        });
      }
    }
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
      runId: run.runId, seq: stepSeqBase + 1, kind: "context_built", startedAt: contextStartedAt,
      inputDigest: contextInput, outputDigest: null, failureCode: code,
    });
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  const systemDigest = sha256(system);
  await record(deps, orgId, {
    runId: run.runId, seq: stepSeqBase + 1, kind: "context_built", startedAt: contextStartedAt,
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
  // F157 —— L1/L2 快照字段。悲观初始化：`l1MessageCount` 只在真正算出 `l1` 之后才前推；
  // `l2Status` 默认 `"degraded"`、只在两条正常收尾路径（复用已有摘要 / 新摘要写回或竞态丢失）
  // 上才翻成 `"ok"`——这样"外层 try 整体失败"与"内层 L2 try 自己抛错"两条路径**不必各写一次
  // 赋值**，天然都停在悲观默认值上，不会有遗漏某条 catch 分支忘记标记降级的风险。
  let l1MessageCount = 0;
  // F190 §1②：L1 已保留消息的 id 集合，供工具轨迹去重判定用（该 run 的写回消息若仍在这个
  // 集合里，说明 L1 原文已经覆盖了它，工具轨迹伪消息要跳过这一轮，见下方 L3 之前那段）。
  // 读取失败时保持空集——空集下 `buildToolTraceMessage` 里"找不到证据说它已被 L1 覆盖"这条
  // 保守规则不会误伤：宁可多算一轮（不跳过），不猜一个可能是错的"已覆盖"结论。
  let l1MessageIds: ReadonlySet<string> = new Set();
  let l2Status: Exclude<ContextLayerStatus, "not_configured"> = "degraded";
  let l2CoveredThroughId: string | null = null;
  try {
    // F154 L2——宽窗口取回（见 `L2_CATCHUP_FETCH_LIMIT` 注释：不撑大 L1，只给 L2 增量判断更多
    // 候选）。L1 仍是纯字符预算裁剪（`trimHistoryToBudget`，与 #709/V8 逐字节相同的函数）。
    const candidates = await deps.runs.readThreadHistory(
      orgId, run.threadId, run.inputMessageId, L2_CATCHUP_FETCH_LIMIT,
    );
    const l1 = trimHistoryToBudget(candidates, HISTORY_MAX_CHARS);
    l1MessageCount = l1.length; // F157：这是本轮真正进模型的 L1 条数，读取失败时保持默认 0。
    l1MessageIds = new Set(l1.map((m) => m.id).filter((id): id is string => id !== undefined));

    // L2：直读已有持久摘要，只对「L1 边界之前、尚未纳入摘要」的新增轮增量摘要并写回。
    // 这一段整体不 fail run（E1，见 spec R4）——任何一步失败都退回「只有 L1，没有 L2 摘要」，
    // 与 #709 原本「没历史也能单轮作答」的保守失败模式一致。
    let l2Summary: string | null = null;
    try {
      const persisted = await deps.runs.readThreadContextState(orgId, run.threadId);
      const increment = planLayeredHistoryIncrement(candidates, l1, persisted?.summarizedThroughId ?? null);
      if (increment.toSummarize.length === 0) {
        // 没有新增区间——直接复用已有摘要，本轮零模型调用（V2：不重读全史重算）。
        l2Summary = persisted && persisted.summary.length > 0 ? persisted.summary : null;
        // F157：这次没有新增摘要工作，生效边界就是持久状态里已有的那个（从未摘要过则 null）。
        l2CoveredThroughId = persisted?.summarizedThroughId ?? null;
        l2Status = "ok";
      } else {
        const transcript = increment.toSummarize.map((m) => `${m.role}: ${m.content}`).join("\n");
        const priorSummary = persisted?.summary ?? "";
        const completion = await deps.model.complete({
          modelProvider: run.modelProvider,
          modelId: run.modelId,
          system: "你是对话历史摘要器。下面可能包含「已有摘要」（更早对话已经压缩过的要点）和"
            + "「新增对话」（自上次摘要之后的新轮次）。把两者合并压成一段更新后的完整摘要，只保留"
            + "后续对话可能需要回指的事实与结论，不要复述客套，不要分点罗列「已有/新增」这个结构"
            + "本身。用中文，尽量短。",
          user: priorSummary === "" ? transcript : `已有摘要：\n${priorSummary}\n\n新增对话：\n${transcript}`,
        });
        const updated = completion.text.trim();
        if (updated === "") {
          // 模型给了空文本——当作这次没有可用的新摘要，退回已有的（若有）。
          l2Summary = persisted && persisted.summary.length > 0 ? persisted.summary : null;
          l2CoveredThroughId = persisted?.summarizedThroughId ?? null; // F157：边界未推进。
          l2Status = "ok";
        } else {
          l2Summary = updated;
          const wrote = await deps.runs.upsertThreadContextState(orgId, run.threadId, {
            summary: updated,
            summarizedThroughId: increment.advanceCursorTo,
            summarizedThroughAt: deps.clock.now(),
            expectedVersion: persisted?.version ?? 0,
          });
          // 乐观并发撞车（另一个并发 run 抢先写回）不影响本轮——本轮仍用刚算出的 `updated` 作答，
          // 只是没能把游标继续往前推；下一次某个赢家会推进它。这是「安全放弃写」，不是数据丢失。
          if (!wrote) {
            deps.log("agent run L2 context state upsert lost optimistic-concurrency race, continuing with locally computed summary", {
              runId: run.runId,
            });
          }
          // F157：快照记录「这次实际生效的边界」——写成功就是新游标，撞并发丢失就是旧游标
          // （本轮仍在用刚算出的 `updated` 文本作答，但没能把边界前推，如实记旧值）。
          l2CoveredThroughId = wrote ? increment.advanceCursorTo : (persisted?.summarizedThroughId ?? null);
          l2Status = "ok";
        }
      }
    } catch (error) {
      deps.log("agent run L2 context state read/summarize/write failed, continuing with L1 only", {
        runId: run.runId,
        detail: error instanceof Error ? error.message : "unexpected L2 error",
      });
      // F157：l2Status 保持悲观默认 "degraded"，l2CoveredThroughId 保持 null——
      // 降级之后不敢再声称一个可能已经过时/不可信的边界。
    }

    history = l2Summary === null
      ? l1
      : [{ role: "assistant", content: `[早前对话摘要] ${l2Summary}` }, ...l1];
  } catch (e) {
    deps.log("agent run thread history read failed, continuing without it", {
      runId: run.runId,
      detail: e instanceof Error ? e.message : "unexpected thread history read failure",
    });
  }

  /*
   * ── 工具调用轨迹跨 run 回喂上下文（F190，design-delta `tool-trace-cross-run-context`）──
   *
   * L1/L2/L3 之外的第四类来源：本线程最近 `TOOL_TRACE_RUN_LIMIT` 轮**记录过 tool_call 的**
   * 历史 run，作为一条伪消息回喂——多轮 agentic 任务里，下一轮不再对上一轮做过的工具调用
   * 完全失明。失败**降级**，不 fail run（同 L2/L3 既有纪律）。
   *
   * 预算优先级 L1 > L2 > 工具轨迹 > L3（delta §1②）体现在下面的**注入位置**：先插入工具轨迹
   * （离当前轮更远），随后 L3 的既有代码把文件上下文插到最前面（离当前轮最远）——
   * 最终顺序 [L3, 工具轨迹, L2摘要, ...L1]，越靠后越贴近当前轮、这份代码库里"近几轮永远优先"
   * 的同一条取舍。
   */
  // F190 —— 三态默认值，同 L3 的既有写法：没配 `deps.toolTrace` 就是 "not_configured"；
  // 配了就悲观从 "degraded" 起步，只有真正查询成功才翻 "ok"。
  let toolTraceStatus: ContextLayerStatus = deps.toolTrace ? "degraded" : "not_configured";
  let toolTraceRunCount = 0;
  let toolTraceStepCount = 0;
  if (deps.toolTrace) {
    try {
      const traceRuns = await deps.toolTrace.recent(
        orgId, run.threadId, run.runId, TOOL_TRACE_RUN_LIMIT,
      );
      const traceMessage = buildToolTraceMessage(traceRuns, l1MessageIds);
      toolTraceStatus = "ok"; // 查询本身成功——零候选/全部被去重也是 "ok"，同 L3 端口纪律。
      if (traceMessage !== null) {
        history = [traceMessage, ...history];
        // F190 §④ 可审计：记录"这次实际回喂了几轮、几条 step"——只统计真正被
        // `buildToolTraceMessage` 采纳进伪消息的那部分（被 L1 去重跳过的、或因预算被整条
        // 丢弃的轮不计入），与快照"实际喂入了什么"的既有哲学一致（同 F157 头注）。
        const eligibleRunIds = new Set(
          traceRuns
            .filter((r) => r.outputMessageId === null || !l1MessageIds.has(r.outputMessageId))
            .map((r) => r.runId),
        );
        toolTraceRunCount = eligibleRunIds.size;
        toolTraceStepCount = traceRuns
          .filter((r) => eligibleRunIds.has(r.runId))
          .reduce((sum, r) => sum + r.steps.length, 0);
      }
    } catch (e) {
      deps.log("agent run tool-call trace read failed, continuing without it", {
        runId: run.runId,
        detail: e instanceof Error ? e.message : "unexpected tool-call trace read failure",
      });
      // F190：toolTraceStatus 保持悲观默认 "degraded"，run/step 计数保持 0——降级为空是
      // 诚实的答案，同 L2/L3 既有纪律。
    }
  }

  /*
   * ── L3（F155）：文件式检索 ──────────────────────────────────────────────
   *
   * delta §1：以本轮输入文本为 query，对**已经存在、已经抽取成文本**的两类「文件」做全文
   * 检索（聊天附件 + 落地的画布产物，含保存的 mermaid 图），命中作为**一条**来源标记清晰的
   * 伪消息前置进 history。第三类「线程历史本身」由上面的 L1/L2 覆盖，这里不重做。
   *
   * ## 失败**降级**，不 fail run（delta §3.3 / verification V6）
   *
   * 这个 try/catch 与 L1/L2 那两层是同一种保守失败模式，也是本 delta 与既有五路召回引擎
   * 刻意分道的那一条：`retrieveCandidates` 的纪律是「任一路失败即整体 block」
   * （`RetrievalUnavailableError`），本路径**不复用**它——单路径、无融合，降级为空是诚实的
   * 答案，不是一个被污染的排序结果。V6 的反证就是：若这里误套用了 block 那条纪律，
   * 「检索失败时 run 仍成功」这条断言会当场红。
   *
   * ## 注入位置在 L2 摘要之前
   *
   * 顺序：[检索到的文件] → [早前对话摘要] → L1 近端原文。文件是**参考材料**，摘要与近端原文
   * 是**对话本身**，把参考材料放在最前、离当前轮最远，与 L1「近几轮永远优先」同一条取舍。
   */
  // F157：L3 三态默认值——没配 `deps.files` 就是 "not_configured"（这次执行根本没接这一层）；
  // 配了就悲观从 "degraded" 起步，只有真正查询成功才翻 "ok"（同 L2 的悲观默认写法）。
  let l3Status: ContextLayerStatus = deps.files ? "degraded" : "not_configured";
  let l3HitCount = 0;
  let l3Sources: readonly string[] = [];
  // F156（design-delta `personal-thread-own-attachment-recall` §2 点 2）：这次 L3 查询走的是
  // 哪条范围分支，由 `run.projectId` 是否为空**在发起查询之前**就已经确定——与查询成不成功、
  // 命中多少条无关（哪怕降级为空，「这次本该查的是哪条分支」仍是一个可以诚实记录的事实）。
  // `deps.files` 未配置时保持 `null`（这次执行根本没有发起 L3 查询）。
  const l3RetrievalScope: "own-attachment" | "project-retrieval" | null = deps.files
    ? (run.projectId === null || run.projectId === "" ? "own-attachment" : "project-retrieval")
    : null;
  if (deps.files) {
    try {
      const hits = await deps.files.search(
        orgId,
        {
          threadId: run.threadId,
          // 个人线程的 `chat_threads.project_id` 自 #594 起可空（`ClaimedAgentRun.projectId`
          // 因此是 `string | null`）——`null` 在检索端是**另一条查询分支**（只吃本线程自有
          // 附件），不是「没传这个可选参数」。空串同样按个人线程处理，不去猜一个项目 id。
          projectId: run.projectId === null || run.projectId === "" ? null : run.projectId,
          actorUserId: run.requesterUserId,
        },
        run.inputText,
        FILE_RETRIEVAL_MAX_HITS,
      );
      l3Status = "ok"; // F157：查询本身成功（不代表一定有命中——零命中也是 "ok"，见端口文档）。
      l3HitCount = hits.length;
      l3Sources = [...new Set(hits.map((h) => h.kind))];
      const fileContext = buildFileContextMessage(hits, run.inputText);
      if (fileContext !== null) history = [fileContext, ...history];
    } catch (e) {
      // 「查了但没查成」与「查了、没有相关文件」在日志里分得开——后者根本不到这里。
      deps.log("agent run L3 file retrieval failed, continuing without retrieved files", {
        runId: run.runId,
        detail: e instanceof Error ? e.message : "unexpected file retrieval failure",
      });
      // F157：l3Status 保持悲观默认 "degraded"，hitCount/sources 保持 0/[]——降级为空是诚实
      // 的答案（同 delta §3.3 的既有纪律），快照如实记这是「查了没查成」而不是「查了没结果」。
    }
  }

  // V9-b 前置 A（#970）：把附件元数据折进模型可见的 content——历史每轮 + 当前触发消息。
  // 触发消息（run.inputText）的附件走 run.inputAttachments（它不在 history 里，单独带，
  // 见 ClaimedAgentRun 注释），否则「刚传完就问」这条最常见路径恰好看不到附件。
  history = history.map((m) => ({ role: m.role, content: withAttachmentNotice(m.content, m.attachments) }));
  let userText = withAttachmentNotice(run.inputText, run.inputAttachments);

  /*
   * P2（#1561）—— 图像通道：把本轮触发消息挂的图片按可见性规则取出、定界，交给支持视觉的
   * provider；不支持 / 取不到 / 超上界的部分**逐条写进模型能读到的文本**。
   *
   * 位置在快照之前、模型调用之前：`visionNotice` 是 `userText` 的一部分，快照的
   * `estimatedTokens` 必须把它算进去，否则"这次到底喂了什么"这句话在这一格上就是错的。
   */
  const vision = await gatherVisionImages(deps, orgId, run);
  if (vision.notice !== null) {
    userText = userText.length > 0 ? `${userText}\n\n${vision.notice}` : vision.notice;
  }

  /*
   * F157 —— 可审计上下文快照：在三层组装完成、system+history+userText 就是即将真正喂给模型
   * 的那份内容的这一刻写下快照。挂在这里而不是 run 成功之后：无论接下来的模型调用成不成功，
   * "这次到底喂了什么"这件事已经发生、已经是历史事实——快照记录的是喂入，不是喂入之后的结果。
   * 可选依赖，写失败不 fail run（同 `meter()` 那条既有纪律：审计观测面，不是运行正确性）。
   */
  if (deps.contextSnapshots) {
    const estimatedTokens = Math.ceil(
      (system.length + userText.length
        + history.reduce((sum, m) => sum + m.content.length, 0))
      / ESTIMATED_TOKENS_CHAR_RATIO,
    );
    try {
      await deps.contextSnapshots.record(orgId, {
        runId: run.runId,
        l1MessageCount,
        l2Status,
        l2CoveredThroughId,
        l3Status,
        l3HitCount,
        l3Sources,
        l3RetrievalScope,
        toolTraceStatus,
        toolTraceRunCount,
        toolTraceStepCount,
        visionStatus: vision.status,
        visionImageCount: vision.images.length,
        visionOmittedCount: vision.omittedCount,
        estimatedTokens,
      });
    } catch (e) {
      deps.log("agent run context snapshot write failed; this run is not auditable via agent_run_context_snapshots", {
        runId: run.runId,
        detail: e instanceof Error ? e.message : "unexpected context snapshot write failure",
      });
    }
  }

  /* ── step: model_called -- exactly one FINAL answer, whatever it took to reach it ── */
  const modelStartedAt = deps.clock.now();
  let text: string;
  /**
   * F159 —— provider 报回来的 token 数。三条分支（completeWithProgress / completeStream /
   * complete）都可能给，也都可能不给（`tokens` 是可选字段）；没给就是 `undefined`，
   * 落库时记 0 而不是估一个数——估出来的数会被当成账。
   */
  let reportedTokens: number | undefined;
  /** F159 —— 上游若报了 prompt/completion 拆分就带上；没报是 undefined（不是 0）。 */
  let reportedPrompt: number | undefined;
  let reportedCompletion: number | undefined;
  /**
   * #1747 —— provider 交上来的候选脚本来源（deep-agent 的 `call_skill` 工具结果正文）。
   * 恒为数组，缺席时是空的——空数组喂给 `maybeRunSkillScript` 与不传逐字等价。
   */
  let scriptCandidates: readonly string[] = [];
  // #741: this used to be advanced by `executeToolLoop` as it recorded `tool_call` steps;
  // with that loop retired, `model_called` is the step right after context_built for a
  // FRESH run (stepSeqBase=1 ⇒ context_built=2 ⇒ this starts at 3, the pre-existing
  // constant). DA-07b resume continues numbering from `stepSeqBase` instead — see
  // `ClaimedAgentRun.resumeStepSeqBase`'s own doc for why a hardcoded constant here
  // collides with a run's own earlier (pre-interrupt) steps.
  const seqCursor = { value: stepSeqBase + 2 };
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
    let progressDeltaSeq = 0;
    if (wantsProgress && completeWithProgress) {
      // #742: a provider whose run is a remote, multi-step planning loop (today:
      // `DeepAgentModelProvider`) reports intermediate steps as they happen -- the ONE
      // remaining alternative branch now that #741 retired the TS tool loop (see this
      // file's own header). See `ModelCallPort.completeWithProgress`'s own doc comment
      // for the contract.
      const completion = await completeWithProgress(
        {
          modelProvider: run.modelProvider, modelId: run.modelId, system, user: userText,
            threadId: run.threadId,
          // DA-07b：人已裁决放行的 run 以 resume 方式续跑（provider 发 command.resume，
          // 不重发用户输入）。UX-9 D4：edit 变体把改后动作一并交给 provider——工具名
          // 沿用待批工具，参数 JSON 由 provider 解析校验（坏数据 ModelCallError，
          // fail closed），本层不做第二份解析副本。
          ...(run.pendingDecision === null
            ? {}
            : run.pendingDecision.kind === "approve"
              ? { resume: { decision: "approve" as const } }
              : {
                resume: {
                  decision: "edit" as const,
                  editedAction: {
                    name: run.pendingDecision.toolName,
                    argsJson: run.pendingDecision.editedArgsJson,
                  },
                },
              }),
          history,
          // #740：deep-agent 的 `call_skill` 要拿到本轮 pin 住的 skill 正文。
          skills: toolSkills,
          // #1747：远端把 skill 的执行委托给一次独立的子模型调用，那次调用收不到上面的
          // `system`，协议只能作为结构化输入过去。`undefined` ⇒ 这个键不出现在请求里。
          ...(scriptProtocol === undefined ? {} : { scriptProtocol }),
          // P2（#1561）：只有 `supportsVision` 明确报 true 的 provider 才拿得到这个字段
          // （`gatherVisionImages` 的门），所以空数组恒等于"这轮没有图要给你看"。
          ...(vision.images.length > 0 ? { images: vision.images } : {}),
          // F976 UC-9 pausePlanRun 的 P-2 落点：远端 run_id 创建成功后立即持久化，
          // 好让暂停能找到它去调 cancel。可选依赖，缺省 no-op（同 planLedger 附近的
          // 既有先例）——写失败只 log，不影响这轮回复本身。
          ...(deps.planLedger ? {
            onRemoteRunStarted: (remoteRunId: string) => {
              void deps.planLedger!.recordRemoteRunId(orgId, run.runId, remoteRunId).catch((e: unknown) => {
                deps.log("plan-control: failed to persist remote_run_id (pausePlanRun will be unable to cancel this run)", {
                  runId: run.runId, detail: e instanceof Error ? e.message : "unexpected write failure",
                });
              });
            },
          } : {}),
        },
        async (event) => {
          const stepStartedAt = deps.clock.now();
          // #742 Gap 1: `phase` absent/"complete" is the pre-existing behaviour verbatim
          // (one event, one terminal `succeeded` row). `phase: "in_progress"` is the new
          // branch -- it ALSO gets its own new row (append-only ledger, see
          // `AppendedRunStep.toolCallId`'s own doc for why this can't be an UPDATE); the
          // read side folds the pair back into one card for the same `toolCallId`.
          const status: RunStepStatus = event.phase === "in_progress" ? "in_progress" : "succeeded";
          await record(deps, orgId, {
            runId: run.runId, seq: seqCursor.value, kind: "tool_call", startedAt: stepStartedAt,
            status,
            inputDigest: event.toolArgsSummary === null ? null : sha256(event.toolArgsSummary),
            outputDigest: event.toolResultSummary === null ? null : sha256(event.toolResultSummary),
            failureCode: null,
            toolName: event.toolName,
            toolArgsSummary: event.toolArgsSummary,
            toolResultSummary: event.toolResultSummary,
            planningNote: event.planningNote,
            toolCallId: event.toolCallId ?? null,
          });
          seqCursor.value += 1;
        },
        // DA-03：token 增量落进与 completeStream 分支完全相同的 delta 账本
        // （appendModelDelta + 递增 seq），agui-bridge 的逐轮 readModelDeltas
        // 转发因此对两条通路一视同仁——它不需要知道 token 是谁产的。
        async (delta) => {
          if (delta === "") return;
          const seq = progressDeltaSeq;
          progressDeltaSeq += 1;
          await deps.runs.appendModelDelta(orgId, { runId: run.runId, seq, text: delta });
        },
      );
      if (completion.interrupted !== undefined) {
        // DA-07b（rubric D6）：run 停在敏感工具调用前等人裁决。这不是失败也不是完成——
        // run 落 awaiting_approval + 待批摘要，本轮执行到此为止：不写回、不置终态。
        // decideAgentRun 是唯一的出口（approve → 重新入队以 resume 续跑；reject → failed）。
        await record(deps, orgId, {
          runId: run.runId, seq: seqCursor.value, kind: "model_called", startedAt: modelStartedAt,
          inputDigest: systemDigest, outputDigest: null, failureCode: null,
          planningNote: `等待人工批准：${completion.interrupted.toolName}`,
        });
        await deps.runs.markAwaitingApproval(orgId, run.runId, completion.interrupted);
        return;
      }
      if (completion.text.trim() === "") {
        throw new ModelCallError("MODEL_CALL_FAILED", "provider returned neither content nor a progress event");
      }
      text = completion.text;
      reportedTokens = completion.tokens;
      reportedPrompt = completion.promptTokens;
      reportedCompletion = completion.completionTokens;
      // #1747：缺席 ⇒ 空数组 ⇒ 下面的判据退化成改动前那一条（只看 `text`）。
      scriptCandidates = completion.scriptCandidates ?? [];
    } else if (useLazySkillLoading) {
      /*
       * design-delta `skill-lazy-loading` §2.2 —— `system` 此刻是目录模式（见上面
       * `buildSystemPrompt` 调用点）。循环里每一轮：调一次 `complete()`，若回复里有
       * `read_skill` 请求且没到轮数上限，把对应 skill 的全文（或"未挂载"提示）追加进
       * `system` 再问一次；否则把这一轮的回复当最终答案。`system` 在循环里被**重新
       * 赋值**（不是局部变量）：循环结束后，本函数后面的 `regenerate`（run_script
       * 失败回喂）与 `record()` 的 `systemDigest` 都还在用同一个变量名，让"这次已经
       * 展开过的 skill 全文"在脚本重试时依然在场——否则模型改脚本时会"忘记"skill
       * 指令，比"根本没有渐进式披露"还差。
       *
       * ⚠ `useLazySkillLoading` 已经保证 `deps.model.completeStream === undefined`，
       * 这个分支只会走一次性的 `complete()`，不需要再判断走不走流式。
       */
      let rounds = 0;
      let completion = await deps.model.complete({
        modelProvider: run.modelProvider, modelId: run.modelId, system, user: userText,
        history, skills: toolSkills,
        ...(vision.images.length > 0 ? { images: vision.images } : {}),
      });
      while (completion.text.trim() !== "" && rounds < MAX_READ_SKILL_ROUNDS) {
        const requested = tryExtractReadSkillRequest(completion.text);
        if (requested === null) break;
        rounds += 1;
        const target = toolSkills.find((s) => s.stableName === requested);
        system = target
          ? appendSkillFullContent(system, target)
          : appendSkillNotMountedNotice(system, requested);
        completion = await deps.model.complete({
          modelProvider: run.modelProvider, modelId: run.modelId, system, user: userText,
          history, skills: toolSkills,
          ...(vision.images.length > 0 ? { images: vision.images } : {}),
        });
      }
      if (completion.text.trim() === "") {
        throw new ModelCallError("MODEL_CALL_FAILED", "provider returned empty content");
      }
      text = completion.text;
      reportedTokens = completion.tokens;
      reportedPrompt = completion.promptTokens;
      reportedCompletion = completion.completionTokens;
      scriptCandidates = completion.scriptCandidates ?? [];
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
            threadId: run.threadId,
            history, skills: toolSkills,
            ...(vision.images.length > 0 ? { images: vision.images } : {}),
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
          ...(vision.images.length > 0 ? { images: vision.images } : {}),
        });
      if (completion.text.trim() === "") {
        throw new ModelCallError("MODEL_CALL_FAILED", "provider returned empty content");
      }
      text = completion.text;
      reportedTokens = completion.tokens;
      reportedPrompt = completion.promptTokens;
      reportedCompletion = completion.completionTokens;
      // #1747：缺席 ⇒ 空数组 ⇒ 下面的判据退化成改动前那一条（只看 `text`）。
      scriptCandidates = completion.scriptCandidates ?? [];
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
    /*
     * F159：失败的调用**也记一行**。「失败就没有用量」会让计量流水与 `agent_runs` 的
     * 行数对不上，而对不上时没人分得清是漏记还是真没调用。
     * ⚠ 不再硬编 0（coord-main 2026-08-12 裁决②的修正）：部分 4xx 上游照样计费
     * prompt tokens 并把 usage 放在错误体里，provider 把它挂在 `ModelCallError.usage`
     * 上传过来——报了就如实记，没报才是 0。
     */
    await meter(deps, orgId, run, e instanceof ModelCallError ? (e.usage ?? {}) : {}, "failed");
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  await record(deps, orgId, {
    runId: run.runId, seq: seqCursor.value, kind: "model_called", startedAt: modelStartedAt,
    inputDigest: systemDigest, outputDigest: sha256(text), failureCode: null,
  });
  await meter(deps, orgId, run, {
    total: reportedTokens, prompt: reportedPrompt, completion: reportedCompletion,
  }, "succeeded");

  /*
   * ── #1624：模型写了脚本就真的跑它 ──
   *
   * 位置在 `model_called` 记完、计量记完**之后**：那次调用已经发生、已经产生了账，
   * 无论脚本跑不跑得起来都不该被改写。这一段只可能改变**写回给用户的正文**与
   * **随消息挂上的附件**，改变不了"模型被调用过一次"这个已成事实。
   *
   * 判据、失败文案、产物落盘全在 `run-skill-script.ts` 一处（见那个文件的头注）；
   * 这里只负责把 chat 特有的东西接上：怎么重新问模型要一版脚本（`regenerate`）。
   *
   * ⚠ 整段**不 fail run**：脚本失败是一次诚实的、带着真实 stderr 的回复，不是
   *   "这条消息没人答"。把它变成 `failRun` 会让用户既拿不到文件，也看不到失败原因——
   *   run 的终态错误码不进响应正文（本文件的既有纪律）。
   */
  let outputFiles: readonly ProducedFile[] = [];
  {
    const scripted = await maybeRunSkillScript(
      {
        sandbox: deps.sandbox,
        objects: deps.objects,
        log: deps.log,
        // 回喂：把上一次的真实 exitCode/stderr 作为一条 user 消息再问一次。
        // 用**同一个** system（含 skill 正文与执行协议）与同一段 history，
        // 否则第二次生成的脚本会在一个与第一次不同的上下文里写出来。
        regenerate: async (feedback) => {
          const retry = await deps.model.complete({
            modelProvider: run.modelProvider,
            modelId: run.modelId,
            system,
            user: feedback,
            history: [...history, { role: "assistant", content: text }],
            skills: toolSkills,
            ...(scriptProtocol === undefined ? {} : { scriptProtocol }),
          });
          /*
           * #1747 —— 回喂重试也要去工具结果里找脚本，理由与第一次尝试逐字相同。
           *
           * 少了这一句，deep-agent 那条路的失败诚实性会被悄悄换掉：第 1 次跑的是工具
           * 结果里的真脚本、真的失败了、拿到了真的 stderr；第 2 次却因为最终回复里没有
           * 代码围栏而以「model reply contained no fenced script block」终止——用户看到的
           * 就不再是沙箱返回的真实错误，而是一句关于回复格式的内部抱怨。真因照样消失，
           * 只是换了个消失的姿势（#660 / #1611 那条纪律的同一个缺口）。
           *
           * 一个都没有时**退回 `retry.text`**，让 `extractScript` 照常抛它那条诚实的
           * 「这次回复里根本没有脚本」——不在这里替它编一个空脚本。
           */
          const retryCandidates = [retry.text, ...(retry.scriptCandidates ?? [])];
          return retryCandidates.find((candidate) => tryExtractScript(candidate) !== null) ?? retry.text;
        },
      },
      { runId: run.runId, pinnedSkillCount: toolSkills.length, reply: text, scriptSources: scriptCandidates },
    );
    text = scripted.text;
    outputFiles = scripted.files;
  }

  /* ── hand off to #413 ── */
  // `writeback_pending`, not `succeeded`. §6: the run may only become succeeded after the
  // Chat writeback transaction commits, and that transaction is not in this slice.
  await deps.runs.storeOutputAwaitingWriteback(
    orgId, run.runId,
    // #1624：`files` 空数组 ⇒ 与该列 DEFAULT 一致，写回不插附件行（T2）。
    { text, finalStepSeq: seqCursor.value, files: outputFiles },
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
        detail: e instanceof Error ? `${e.name}: ${e.message}` : "unknown",
      });
      await deps.runs.failRun(input.orgId, outcome.run.runId, "MODEL_CALL_FAILED");
    }
  }
  return claimed.length;
}
