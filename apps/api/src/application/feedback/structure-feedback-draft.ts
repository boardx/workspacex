/**
 * `structureFeedbackDraft`（FB-5）—— 把语音转录出来的一段自由文本整理成
 * `{kind, title, detail}`，填进"提交反馈"表单，人工再改再提交。
 *
 * ## 语音本身不是新增能力，这一步才是
 *
 * 语音→文字复用的是既有的 chat composer 麦克风那条实时转写通路
 * （`use-asr-draft.ts` / `WS /chat/asr-draft`，见前端头注），本用例接手的起点是
 * **转录完成之后的一段文字**，不新开一次性音频转文字的协议。这条边界与 D4/E2
 * 决策无关：产出仍然是纯文字，语音只是这段文字的输入手段。
 *
 * ## 与 `generate-thread-title.ts` 同一套骨架，与 `generate-followup-suggestions.ts`
 *    同一套"要求 JSON、容错解析"手法
 *
 * 固定走注入的 `structureModel` 配置（不是被选中 Agent 的快照，同 `generate-thread-
 * title.ts` 头注理由——这是一次元任务，不需要推理/工具能力）；硬超时用
 * `Promise.race` 包一层（`ModelCallPort.complete` 本身没有比"起标题"更短的超时）。
 *
 * ⚠ 与 `generateThreadTitle` **不同**的一点：那里失败静默降级（标题不好看不影响
 *   发消息这个主动作）。这里模型调用失败会**抛出**，由控制器映射成
 *   `DEPENDENCY_UNAVAILABLE`——因为"把语音整理成结构化 issue"是用户这次点击唯一
 *   要做的事，静默返回空表单等于假装成功；而转录文字本身已经在输入框里（前端
 *   ASR 通路的产物），失败只是"没帮你整理"，不丢用户已经说出口的话。
 */
import type { z } from "zod";
import { feedbackLoop } from "@repo/contracts";
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";

export type FeedbackKind = z.infer<typeof feedbackLoop.FeedbackKind>;
export type FeedbackStructured = z.infer<typeof feedbackLoop.FeedbackStructured>;

/** 同 `ThreadTitleModelConfig` 的既有先例——接口形状声明在这里，唯一实现
 *  （`infrastructure/feedback/feedback-structure-model-config.ts`）由组合根注入。 */
export interface FeedbackStructureModelConfig {
  readonly provider: string;
  readonly modelId: string;
}

export const FEEDBACK_STRUCTURE_MODEL_CONFIG = Symbol("FeedbackStructureModelConfig");

export interface StructureFeedbackDraftDeps {
  readonly model: ModelCallPort;
  readonly structureModel: FeedbackStructureModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export interface StructureFeedbackDraftInput {
  readonly transcript: string;
}

export interface StructureFeedbackDraftResult {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly detail: string;
  /** UC-17.8 B2.4：模型按 kind 拆出的结构化字段；没拆出来/解析不出 ⇒ `null`，正文仍是完整原文。 */
  readonly structured: FeedbackStructured | null;
}

/**
 * ⚠ 2026-09-02 devapp 实测：8 秒不够——真实模型把一段口述整理成带完整正文的 JSON，
 *   常常要十几秒，此前一律撞超时、界面报 503 `STRUCTURING_FAILED`。这是用户**主动点击**
 *   后等待的一次调用（按钮上有「AI 整理中…」），不是每条消息都触发的后台任务，
 *   取值向 `generate-followup-suggestions.ts`（没有自己的短超时，靠 provider 的
 *   `KERNEL_MODEL_TIMEOUT_MS`）靠拢而不是向 `generate-thread-title.ts` 的 3 秒靠拢。
 */
export const STRUCTURE_FEEDBACK_DRAFT_TIMEOUT_MS = 60_000;

export class FeedbackStructuringUnavailableError extends Error {
  constructor(readonly detail: string) {
    super("feedback draft structuring failed");
  }
}

export const STRUCTURE_FEEDBACK_DRAFT_SYSTEM_PROMPT =
  "你是一个反馈整理助手。用户会给你一段口述的产品反馈（可能是缺陷描述、也可能是需求" +
  "建议，语序可能不通顺，因为是语音转录的）。请把它整理成结构化的反馈条目，只输出一个" +
  "JSON 对象，不要任何解释性文字、不要 markdown 代码块标记。JSON 形如：" +
  '{"kind":"缺陷或需求二选一","title":"不超过120字的简短标题","detail":"完整的正文，' +
  '保留用户描述的关键信息（复现步骤/期望行为等），可以比原话更有条理，但不要编造原话' +
  '没有提到的细节","structured":{...}}。kind 字段只能是「缺陷」或「不确定时用需求」两个词之一。' +
  // UC-17.8 B2.4：按 kind 额外拆出结构化字段。缺字段就省略该键，不要编造；整段拆不出来就给 {}。
  "structured 字段按 kind 给出：kind 为「缺陷」时形如 " +
  '{"reproFrequencyEnv":"复现频率·环境，如「每次 · Chrome 128」","expectedResult":"期望结果",' +
  '"actualResult":"实际结果","reproSteps":"复现步骤，用「1. 2. 3.」编号、每步一行"}；' +
  "kind 为「需求」时形如 " +
  '{"useScenario":"使用场景","expectedCapability":"期望能力","priorityScope":"优先级·影响范围，如「P1 · 全部项目」"}。' +
  "原话里没有提到的字段直接省略该键，不要编造。";

/**
 * UC-17.8 B2.4：从模型输出里取 `structured`。只认契约 `FeedbackStructured` 能解析的形状，且键集
 * 必须与 `kind` 匹配（缺陷 ⇒ `BugStructuredFields`，需求 ⇒ `ReqStructuredFields`）——模型把
 * 需求字段填给缺陷时不"顺手纠正"，直接当没拆出来（`null`）。空对象 `{}` 与没拆出来等价。
 * 解析失败**不抛**：结构化字段是正文的补充，正文（完整原文）才是这次点击的主产物。
 */
export function parseStructuredForKind(kind: FeedbackKind, raw: unknown): FeedbackStructured | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  // 只保留字符串值：模型偶尔会给 null / 数组，契约 `.strict()` 会整段拒掉，先清洗再校验。
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") cleaned[k] = v.trim();
  }
  const schema = kind === "缺陷" ? feedbackLoop.BugStructuredFields : feedbackLoop.ReqStructuredFields;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return null;
  return parsed.data;
}

/** 从模型输出里找出第一个 `{...}` 片段——同 `generate-followup-suggestions.ts` 的
 *  既有先例：模型偶尔会在 JSON 前后加解释性文字或代码块标记，不要求整段严格 JSON。 */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function clamp(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export async function structureFeedbackDraft(
  deps: StructureFeedbackDraftDeps,
  input: StructureFeedbackDraftInput,
): Promise<StructureFeedbackDraftResult> {
  let completion: { readonly text: string };
  try {
    completion = await Promise.race([
      deps.model.complete({
        modelProvider: deps.structureModel.provider,
        modelId: deps.structureModel.modelId,
        // ⚠ 不传 threadId，同 generate-thread-title.ts 的既有先例——避免
        // DeepAgentModelProvider 把这次元任务调用误当成要接续的真实会话。
        system: STRUCTURE_FEEDBACK_DRAFT_SYSTEM_PROMPT,
        user: input.transcript,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("feedback structuring model call timed out")), STRUCTURE_FEEDBACK_DRAFT_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    const detail = e instanceof ModelCallError
      ? e.detail
      : e instanceof Error ? e.message : "unexpected model call failure";
    deps.log("feedback draft structuring model call failed", {
      modelProvider: deps.structureModel.provider,
      modelId: deps.structureModel.modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail,
    });
    throw new FeedbackStructuringUnavailableError(detail);
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(completion.text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unparseable model output";
    deps.log("feedback draft structuring: model output was not parseable JSON", { detail });
    throw new FeedbackStructuringUnavailableError(detail);
  }

  const obj = parsed as Record<string, unknown>;
  const kind: FeedbackKind = obj.kind === "缺陷" ? "缺陷" : "需求";
  const rawTitle = typeof obj.title === "string" && obj.title.trim() !== "" ? obj.title.trim() : input.transcript.trim();
  const rawDetail = typeof obj.detail === "string" && obj.detail.trim() !== "" ? obj.detail.trim() : input.transcript.trim();

  return {
    kind,
    title: clamp(rawTitle, 120),
    detail: clamp(rawDetail, 4000),
    structured: parseStructuredForKind(kind, obj.structured),
  };
}
