/**
 * UC-17.8 B5.1 —— 草稿「继续完善」对话的模型端口 + 唯一实现 `ModelDraftRefiner`。
 *
 * ## 走的是 `structureFeedbackDraft` 那条链，不是 agent-run
 *
 * 三次模型调用（首次澄清问题 / 每轮回复 / 提交时摘要）全部走注入的 `ModelCallPort.complete`
 * + 固定的 `FeedbackStructureModelConfig`（`KERNEL_FEEDBACK_STRUCTURE_MODEL_ID`），与
 * `structure-feedback-draft.ts`「语音转结构化字段」是**同一个端口、同一份配置、同一套
 * JSON 解析纪律**（`parseStructuredForKind`）。没有用 `deep-agent-engine-run-controller`
 * 那套 agent-run 机制：它是「一次 run = 一个 LangGraph thread + 事件流 + 工具循环」，而这里
 * 每轮只需要一段文本回复，对话历史本来就完整落在 `drafts.chat[]`（单一事实源），每次把它
 * 整段喂给模型即可——再开一个远端 thread 就是同一段历史的第二份副本。取舍全文见
 * `phases/phase-03-reuse-and-governance/contracts/design-ai-collab/domain.md`。
 * ⚠ 同 `structureFeedbackDraft`：**不传 `threadId`**，避免 `DeepAgentModelProvider` 把这次
 *   元任务误当成要接续的 Chat 会话。
 *
 * ## 失败 ⇒ 退回 D7 固定回执，并如实标记
 *
 * 与 `structureFeedbackDraft`（失败**抛** `STRUCTURING_FAILED`）不同：这里模型不可用/超时/
 * 输出不可解析时**不抛**，退回 `REFINE_SEED_QUESTION`/`REFINE_ACK`（D7 上线时的固定文案，
 * 本文件是它们的单一事实源），`source: "fallback"`——用户这次点击的主动作是「把我这句话记
 * 下来」，那句话必须落库；AI 没回好不该让它丢。但退路**必须**在记录上标出来（契约
 * `design-ai-collab.ts` 头注），不许静默假装是模型说的。
 * 提交时的摘要同理：失败 ⇒ 保留草稿上已有的 `structured`，`source: "fallback"`。
 */
import type { z } from "zod";
import { feedbackLoop, type designAiCollab } from "@repo/contracts";
import type { ModelCallPort } from "../../agent-run/ports";
import { ModelCallError } from "../../agent-run/ports";
import type { FeedbackKind, FeedbackStructured } from "../ports";
import type { FeedbackDraftChatTurn } from "../draft-ports";
import {
  type FeedbackStructureModelConfig,
  parseStructuredForKind,
  STRUCTURE_FEEDBACK_DRAFT_TIMEOUT_MS,
} from "../structure-feedback-draft";

export type AiReplySource = z.infer<typeof designAiCollab.AiReplySource>;
type FeedbackDraftView = z.infer<typeof feedbackLoop.FeedbackDraft>;

/** D7 固定文案——单一事实源，前端不复述。B5.1 起是**模型不可用时的退路**，不再是唯一路径。 */
export const REFINE_SEED_QUESTION =
  "这个需求/问题的边界在哪：只影响当前场景，还是所有相关入口都要一起改？优先级怎么排？";
export const REFINE_ACK = "已记录，还有想补充的吗？";

/**
 * 每轮回复的硬超时。比 `STRUCTURE_FEEDBACK_DRAFT_TIMEOUT_MS`（60s，整理整段口述）短：这是
 * 对话里的一句话，用户在等着看回复；超过这个时长退回固定回执比让人干等更诚实。摘要那一步
 * 复用 60s——它做的就是 `structureFeedbackDraft` 同一件事。
 */
export const DRAFT_REFINE_REPLY_TIMEOUT_MS = 30_000;

/** 模型看到的草稿上下文——`chat` 是完整历史（单一事实源在 `drafts.chat[]`）。 */
export type DraftRefineContext = Pick<FeedbackDraftView, "kind" | "detail" | "structured"> & {
  readonly chat: readonly FeedbackDraftChatTurn[];
};

export interface AiReply {
  readonly text: string;
  readonly source: AiReplySource;
}

export interface DraftSummary {
  /** 摘要出来的字段（已按 `kind` 严格解析）；退路时 = 传入的原值。 */
  readonly structured: FeedbackStructured | null;
  readonly source: AiReplySource;
}

/** 用例层依赖的端口——`update-feedback-draft.ts` / `submit-feedback-draft.ts` 只认这个形状。 */
export interface DraftRefineModel {
  /** 首次打开「继续完善」时的澄清问题：按 `kind` + 已有结构化字段 + 正文生成。 */
  seedQuestion(ctx: DraftRefineContext): Promise<AiReply>;
  /** 用户每说一句之后的回复；`ctx.chat` 已含这句用户消息。 */
  reply(ctx: DraftRefineContext): Promise<AiReply>;
  /** 提交时把整段对话摘要成结构化字段。 */
  summarize(ctx: DraftRefineContext): Promise<DraftSummary>;
}

export interface ModelDraftRefinerDeps {
  readonly model: ModelCallPort;
  readonly structureModel: FeedbackStructureModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

const KIND_FIELDS: Record<FeedbackKind, string> = {
  缺陷:
    '{"reproFrequencyEnv":"复现频率·环境","expectedResult":"期望结果","actualResult":"实际结果","reproSteps":"复现步骤，用「1. 2. 3.」编号、每步一行"}',
  需求: '{"useScenario":"使用场景","expectedCapability":"期望能力","priorityScope":"优先级·影响范围"}',
};

export const DRAFT_REFINE_CHAT_SYSTEM_PROMPT =
  "你是产品反馈的设计协作助手。用户正在完善一条反馈草稿（类型是「缺陷」或「需求」），你的任务是" +
  "帮他把边界、优先级、影响范围、复现条件这些**还没说清楚的地方**问清楚。每次只问一个最关键的" +
  "问题，或者对用户刚说的话做一句简短确认再追问一点；不要复述草稿、不要编造用户没说的事实、" +
  "不要给结论、不要输出 markdown。用中文，不超过 120 字，只输出要说的话本身。";

export const DRAFT_REFINE_SUMMARY_SYSTEM_PROMPT =
  "你是产品反馈的整理助手。下面是一条反馈草稿（类型、正文、已填的结构化字段）以及提交人与" +
  "助手之间把边界谈清楚的对话。请把**对话里新说清楚的信息**整理进结构化字段，只输出一个 JSON " +
  "对象，不要任何解释、不要 markdown 代码块标记。已填字段若对话里有更准确的说法可以改写，" +
  "对话没提到的字段直接省略该键，不要编造。";

function describeContext(ctx: DraftRefineContext, opts: { readonly withChat: boolean }): string {
  const lines = [
    `类型：${ctx.kind}`,
    `正文：${ctx.detail.trim() === "" ? "（还没写）" : ctx.detail}`,
    `已填的结构化字段：${ctx.structured === null ? "（无）" : JSON.stringify(ctx.structured)}`,
    `该类型的结构化字段形如：${KIND_FIELDS[ctx.kind]}`,
  ];
  if (opts.withChat) {
    const turns = ctx.chat.filter((t) => t.kind === "message");
    lines.push("对话记录（按时间顺序）：");
    if (turns.length === 0) lines.push("（还没有对话）");
    for (const t of turns) lines.push(`${t.role === "user" ? "提交人" : "助手"}：${t.text}`);
  }
  return lines.join("\n");
}

/** 只留本 kind 契约声明的键——键集合从契约 schema 的 `shape` 读，不在这里再抄一份字段名。 */
function onlyKindKeys(kind: FeedbackKind, raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const shape = kind === "缺陷" ? feedbackLoop.BugStructuredFields.shape : feedbackLoop.ReqStructuredFields.shape;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k in shape) out[k] = v;
  }
  return out;
}

/** 同 `structure-feedback-draft.ts` 的既有先例：取第一个 `{...}` 片段，不要求整段严格 JSON。 */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export class ModelDraftRefiner implements DraftRefineModel {
  constructor(private readonly deps: ModelDraftRefinerDeps) {}

  private async complete(system: string, user: string, timeoutMs: number, what: string): Promise<string | null> {
    try {
      const completion = await Promise.race([
        this.deps.model.complete({
          modelProvider: this.deps.structureModel.provider,
          modelId: this.deps.structureModel.modelId,
          system,
          user,
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`${what} model call timed out`)), timeoutMs);
        }),
      ]);
      return completion.text;
    } catch (e) {
      const detail = e instanceof ModelCallError ? e.detail : e instanceof Error ? e.message : "unexpected model call failure";
      this.deps.log(`feedback draft refine: ${what} model call failed, falling back`, {
        modelProvider: this.deps.structureModel.provider,
        modelId: this.deps.structureModel.modelId,
        code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
        detail,
      });
      return null;
    }
  }

  private async say(ctx: DraftRefineContext, instruction: string, fallback: string, what: string): Promise<AiReply> {
    const user = `${describeContext(ctx, { withChat: true })}\n\n${instruction}`;
    const text = await this.complete(DRAFT_REFINE_CHAT_SYSTEM_PROMPT, user, DRAFT_REFINE_REPLY_TIMEOUT_MS, what);
    const trimmed = text?.trim() ?? "";
    if (trimmed === "") {
      if (text !== null) this.deps.log(`feedback draft refine: ${what} model output was empty, falling back`, {});
      return { text: fallback, source: "fallback" };
    }
    return { text: trimmed.slice(0, 4000), source: "model" };
  }

  seedQuestion(ctx: DraftRefineContext): Promise<AiReply> {
    return this.say(ctx, "提交人刚打开「继续完善」，请先问他一个最关键的澄清问题。", REFINE_SEED_QUESTION, "seed question");
  }

  reply(ctx: DraftRefineContext): Promise<AiReply> {
    return this.say(ctx, "请回应提交人刚说的最后一句。", REFINE_ACK, "reply");
  }

  async summarize(ctx: DraftRefineContext): Promise<DraftSummary> {
    const user = `${describeContext(ctx, { withChat: true })}\n\n请输出整理后的结构化字段 JSON。`;
    const text = await this.complete(DRAFT_REFINE_SUMMARY_SYSTEM_PROMPT, user, STRUCTURE_FEEDBACK_DRAFT_TIMEOUT_MS, "summary");
    if (text === null) return { structured: ctx.structured, source: "fallback" };
    let raw: unknown;
    try {
      raw = extractJsonObject(text);
    } catch (e) {
      this.deps.log("feedback draft refine: summary output was not parseable JSON, keeping draft fields", {
        detail: e instanceof Error ? e.message : "unparseable model output",
      });
      return { structured: ctx.structured, source: "fallback" };
    }
    // 模型可能把字段包在 `structured` 键下（同 `structureFeedbackDraft` 的输出形状），也可能直接给字段。
    const obj = raw as Record<string, unknown>;
    const candidate = obj.structured !== undefined && typeof obj.structured === "object" ? obj.structured : raw;
    // 与 `structureFeedbackDraft` 的一处**有意**差别：先把不属于本 kind 的键丢掉再严格解析。那里
    // 「模型把需求字段填给缺陷 ⇒ 整段当没拆出来」是因为正文才是主产物、字段只是补充；这里摘要
    // 就是主产物，模型顺手多给一个别的 kind 的键不该让整段对话的整理成果归零——但仍只认本
    // kind 的键（`.strict()` 不动），不做跨 kind 的"顺手纠正"。
    const parsed = parseStructuredForKind(ctx.kind, onlyKindKeys(ctx.kind, candidate));
    if (parsed === null) {
      this.deps.log("feedback draft refine: summary had no usable fields for kind, keeping draft fields", { kind: ctx.kind });
      return { structured: ctx.structured, source: "fallback" };
    }
    // 摘要出来的字段覆盖同名字段，没摘出来的保留原值（契约 `submitFeedbackDraft` 头注逐字）。
    // 原值若是另一种 kind 的字段（用户改过类型），严格解析会整段拒掉——那就只留这次摘出来的。
    const merged = parseStructuredForKind(ctx.kind, { ...(ctx.structured ?? {}), ...parsed }) ?? parsed;
    return { structured: merged, source: "model" };
  }
}
