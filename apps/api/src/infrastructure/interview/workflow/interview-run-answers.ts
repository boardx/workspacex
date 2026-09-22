import type { ModelCallPort } from "../../../application/agent-run/ports";

interface Question {
  readonly question_id: string;
  readonly body: string;
  readonly purpose: string;
}

export interface InterviewRunAnswer {
  readonly questionId: string;
  readonly question: string;
  readonly answer: string;
}

export class InvalidInterviewAnswersError extends Error {
  constructor() { super("MODEL_OUTPUT_INVALID"); }
}

export function parseInterviewRunAnswers(text: string, questions: readonly Question[]): readonly InterviewRunAnswer[] {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  let parsed: unknown;
  try { parsed = JSON.parse(fenced?.[1] ?? text.trim()); }
  catch { throw new InvalidInterviewAnswersError(); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { answers?: unknown }).answers)) {
    throw new InvalidInterviewAnswersError();
  }
  const candidates = (parsed as { answers: unknown[] }).answers;
  return questions.map((question) => {
    const candidate = candidates.find((value) => value !== null && typeof value === "object"
      && (value as { questionId?: unknown }).questionId === question.question_id) as { answer?: unknown } | undefined;
    const answer = typeof candidate?.answer === "string" ? candidate.answer.trim() : "";
    if (!answer) throw new InvalidInterviewAnswersError();
    return { questionId: question.question_id, question: question.body, answer };
  });
}

export async function completeInterviewRunAnswers(input: {
  readonly model: ModelCallPort;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly topic: string;
  readonly expert: { readonly display_name: string; readonly role: string; readonly domains: readonly string[] };
  readonly questions: readonly Question[];
}): Promise<readonly InterviewRunAnswer[]> {
  const system = `你正在模拟受访专家“${input.expert.display_name}”。角色：${input.expert.role}；领域：${input.expert.domains.join("、")}。请始终以该专家第一人称、结合其专业背景具体作答。只返回 JSON：{"answers":[{"questionId":"输入中的原始 ID","answer":"回答"}]}。每题必须回答，questionId 必须逐字复制。`;
  const user = JSON.stringify({ topic: input.topic, questions: input.questions.map((question) => ({
    questionId: question.question_id, question: question.body, purpose: question.purpose,
  })) });
  const call = (systemPrompt: string, userPrompt: string) => input.model.complete({
    modelProvider: input.modelProvider, modelId: input.modelId, system: systemPrompt,
    user: userPrompt, history: [],
  });
  const first = await call(system, user);
  try { return parseInterviewRunAnswers(first.text, input.questions); }
  catch (error) {
    if (!(error instanceof InvalidInterviewAnswersError)) throw error;
  }
  // A long multi-question answer can be truncated or omit an ID. Retry once, one question at
  // a time, so one malformed answer does not discard the other questions.
  const answers: InterviewRunAnswer[] = [];
  for (const question of input.questions) {
    const response = await call(`${system}\n这次只回答一题，返回一个 answers 条目。`, JSON.stringify({
      topic: input.topic, questions: [{ questionId: question.question_id, question: question.body, purpose: question.purpose }],
    }));
    answers.push(...parseInterviewRunAnswers(response.text, [question]));
  }
  return answers;
}
