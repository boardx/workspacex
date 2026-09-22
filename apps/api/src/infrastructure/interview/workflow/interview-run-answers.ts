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

function availableInterviewRunAnswers(text: string, questions: readonly Question[]): ReadonlyMap<string, InterviewRunAnswer> {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  let parsed: unknown;
  try { parsed = JSON.parse(fenced?.[1] ?? text.trim()); }
  catch { throw new InvalidInterviewAnswersError(); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { answers?: unknown }).answers)) {
    throw new InvalidInterviewAnswersError();
  }
  const candidates = (parsed as { answers: unknown[] }).answers;
  const available = new Map<string, InterviewRunAnswer>();
  for (const question of questions) {
    const candidate = candidates.find((value) => value !== null && typeof value === "object"
      && (value as { questionId?: unknown }).questionId === question.question_id) as { answer?: unknown } | undefined;
    const answer = typeof candidate?.answer === "string" ? candidate.answer.trim() : "";
    if (answer) available.set(question.question_id, { questionId: question.question_id, question: question.body, answer });
  }
  return available;
}

export function parseInterviewRunAnswers(text: string, questions: readonly Question[]): readonly InterviewRunAnswer[] {
  const available = availableInterviewRunAnswers(text, questions);
  return questions.map((question) => {
    const answer = available.get(question.question_id);
    if (!answer) throw new InvalidInterviewAnswersError();
    return answer;
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
  let available: ReadonlyMap<string, InterviewRunAnswer>;
  try { available = availableInterviewRunAnswers(first.text, input.questions); }
  catch (error) {
    if (!(error instanceof InvalidInterviewAnswersError)) throw error;
    available = new Map();
  }
  const missing = input.questions.filter((question) => !available.has(question.question_id));
  if (missing.length === 0) return input.questions.map((question) => available.get(question.question_id)!);
  const recovered = new Map(available);
  // Normal interviews have three questions. A custom confirmation can contain more, so cap
  // the recovery at three individual calls and use one bounded batch call beyond that.
  const groups = missing.length <= 3 ? missing.map((question) => [question]) : [missing];
  for (const group of groups) {
    const response = await call(`${system}\n只回答本次输入的问题，返回对应的 answers 条目。`, JSON.stringify({
      topic: input.topic, questions: group.map((question) => ({
        questionId: question.question_id, question: question.body, purpose: question.purpose,
      })),
    }));
    for (const answer of parseInterviewRunAnswers(response.text, group)) recovered.set(answer.questionId, answer);
  }
  return input.questions.map((question) => recovered.get(question.question_id)!);
}
