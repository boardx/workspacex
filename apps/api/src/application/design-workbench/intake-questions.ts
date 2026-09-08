/**
 * 迭代 13（design-delta `design-chat-inputs` §3）—— 新建设计前的**澄清问答**。
 *
 * ## 为什么问题要**生成**，不是固定问卷
 *
 * 固定问卷（「目标用户是谁 / 核心场景 / 竞品」）对每个产品都问同样的话：用户答得敷衍，
 * 模型也没多拿到什么。生成的问题能问到点上——做牙膏电商会问「会员的核心权益是什么」，
 * 做内部工具会问「谁审批」。
 *
 * ## 但模型挂了不能把新建流程堵死
 *
 * 所以 `generateIntakeQuestions` **从不抛**：模型不可用、超时、输出不合法，一律回退到
 * `FALLBACK_QUESTIONS`（§3.5 六维的通用问法）并把 `fallback` 置真，让界面能如实说
 * 「AI 没能生成针对性的问题，先按通用的问一遍」。**静默用兜底而不说**是另一回事，
 * 那会让用户以为这就是"针对他"的问题。
 *
 * ## 不落库
 *
 * 这一步纯粹是一次模型调用：问题在前端内存里，答案随 `createProject` 一次交上来，
 * 落地形态是既有的 `problem` / `criteria`。指导原则**不是第四种事实源**。
 */
import { designWorkbench } from "@repo/contracts";
import type { ModelCallPort } from "../agent-run/ports";
import type { FeedbackStructureModelConfig } from "../feedback/structure-feedback-draft";
import { extractJsonObject } from "./design-chat-model";

/**
 * §3.5 六个维度**顺序即优先级**——只答得动前两条也够开工。
 * 这张表同时是两件事：给模型的生成骨架，与模型不可用时的兜底问卷。
 * ⚠ 它是**骨架**，不是逐字问用户的话；把它原样念一遍就退化成固定问卷了。
 */
export const INTAKE_DIMENSIONS = [
  { key: "who", label: "谁会用", why: "决定信息密度与用词" },
  { key: "problem", label: "要解决什么", why: "决定首屏放什么" },
  { key: "task", label: "主线任务", why: "决定页面划分与跳转" },
  { key: "constraint", label: "关键约束", why: "决定边界，也决定不做什么" },
  { key: "reference", label: "参考与风格", why: "像什么、不像什么" },
  { key: "success", label: "成功长什么样", why: "直接变成验收标准" },
] as const satisfies readonly { key: designWorkbench.IntakeQuestion["dimension"]; label: string; why: string }[];

/** 模型不可用时的通用六问。措辞刻意朴素——它不假装自己是"针对你的"。 */
export const FALLBACK_QUESTIONS: readonly designWorkbench.IntakeQuestion[] = [
  { dimension: "who", text: "谁会用这个东西？他们对这件事有多熟？", hint: "例：门店店员，每天都用，不熟电脑" },
  { dimension: "problem", text: "现在他们是怎么绕过去的？哪一步最烦？", hint: "例：现在靠微信群报数，经常漏" },
  { dimension: "task", text: "用户打开它，最想完成的一件事是什么？", hint: "例：三步之内把今天的货订掉" },
  { dimension: "constraint", text: "有什么是必须有、或者一定不能有的？", hint: "例：必须能离线看，不做社交分享" },
  { dimension: "reference", text: "希望它像什么？不希望像什么？", hint: "例：像微信那样朴素，别像后台管理系统" },
  { dimension: "success", text: "做成什么样算做对了？", hint: "例：新店员不用培训就能下完一单" },
];

const SYSTEM_PROMPT =
  "你是一个产品设计顾问。用户用一两句话说了他想做的东西，你的任务是**问回去**——" +
  "提出几个能真正问到点上的问题，帮他把设计需要的上下文说清楚。" +
  "只输出一个 JSON 对象：" +
  '{"questions":[{"dimension":"who|problem|task|constraint|reference|success","text":"问题","hint":"一句示例答案"}]}。' +
  `问 ${designWorkbench.INTAKE_MIN_QUESTIONS}–${designWorkbench.INTAKE_MAX_QUESTIONS} 个，按下面的维度顺序覆盖（可以少覆盖几维，不要重复同一维）：` +
  INTAKE_DIMENSIONS.map((d) => `${d.key}=${d.label}（${d.why}）`).join("；") +
  "。⚠ 问题必须**针对他说的这个产品**——出现他领域里的具体名词，而不是「目标用户是谁」这种放之四海皆准的问法。" +
  "hint 是一句该领域里像样的示例答案，让人知道要答到什么颗粒度。用中文，每个问题不超过 40 字。";

export interface IntakeQuestionsDeps {
  readonly model: ModelCallPort;
  readonly chatModel: FeedbackStructureModelConfig;
  readonly log: (message: string, fields: Record<string, unknown>) => void;
}

/** 逐条过契约；不合法的丢掉，重复维度只留第一条。 */
export function parseIntakeQuestions(raw: unknown): readonly designWorkbench.IntakeQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: designWorkbench.IntakeQuestion[] = [];
  const seen = new Set<string>();
  for (const q of raw) {
    const parsed = designWorkbench.IntakeQuestion.safeParse(q);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.dimension)) continue;
    seen.add(parsed.data.dimension);
    out.push(parsed.data);
    if (out.length >= designWorkbench.INTAKE_MAX_QUESTIONS) break;
  }
  return out;
}

export async function generateIntakeQuestions(
  deps: IntakeQuestionsDeps,
  input: { readonly brief: string },
): Promise<{ readonly questions: readonly designWorkbench.IntakeQuestion[]; readonly fallback: boolean }> {
  const fallback = { questions: FALLBACK_QUESTIONS, fallback: true } as const;
  let text: string;
  try {
    const completion = await deps.model.complete({
      modelProvider: deps.chatModel.provider,
      modelId: deps.chatModel.modelId,
      system: SYSTEM_PROMPT,
      user: `用户说他想做的东西：\n${input.brief.trim()}`,
    });
    text = completion.text;
    if (completion.truncated === true) {
      deps.log("intake: question round truncated, using fallback", {});
      return fallback;
    }
  } catch (e) {
    deps.log("intake: model call failed, using fallback questions", { detail: e instanceof Error ? e.message : "unknown" });
    return fallback;
  }
  let obj: Record<string, unknown>;
  try {
    obj = extractJsonObject(text) as Record<string, unknown>;
  } catch {
    deps.log("intake: model output was not parseable JSON, using fallback", { length: text.length });
    return fallback;
  }
  const questions = parseIntakeQuestions(obj.questions);
  // 少于下限就当没生成成功——两个问题问不出一份能用的上下文，不如老老实实用通用六问。
  if (questions.length < designWorkbench.INTAKE_MIN_QUESTIONS) {
    deps.log("intake: too few usable questions, using fallback", { got: questions.length });
    return fallback;
  }
  return { questions, fallback: false };
}

/**
 * 把问答汇成写进 `problem` 的一段人话。
 *
 * 刻意**不调模型**：这一步只是把用户自己的话拼起来，调模型既慢又可能改写他的原意，
 * 而这段文本随后是要给他自己看、自己改的。真正的"提炼"发生在他编辑那一步。
 */
export function foldIntakeIntoProblem(brief: string, answers: readonly designWorkbench.IntakeAnswer[]): string {
  const lines = [brief.trim()];
  if (answers.length > 0) {
    lines.push("");
    for (const a of answers) lines.push(`- ${a.question.trim()}：${a.answer.trim()}`);
  }
  return lines.join("\n").slice(0, 4000);
}

/**
 * 「成功长什么样」那一维的答案直接变成验收标准，追加在默认三条之后。
 * 其余维度不进 `criteria`——它们是背景，不是可验收的条目。
 */
export function foldIntakeIntoCriteria(
  answers: readonly designWorkbench.IntakeAnswer[],
  successQuestions: readonly string[],
): readonly string[] {
  const extra = answers
    .filter((a) => successQuestions.includes(a.question))
    .map((a) => a.answer.trim())
    .filter((s) => s !== "");
  return [...designWorkbench.DESIGN_PROJECT_INITIAL_CRITERIA, ...extra];
}
