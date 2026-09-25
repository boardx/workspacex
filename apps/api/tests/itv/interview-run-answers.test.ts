import { describe, expect, it } from "vitest";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { completeInterviewRunAnswers, InvalidInterviewAnswersError, parseInterviewRunAnswers } from "../../src/infrastructure/interview/workflow/interview-run-answers";

const questions = [
  { question_id: "q-1", body: "第一题？", purpose: "了解背景" },
  { question_id: "q-2", body: "第二题？", purpose: "了解实践" },
  { question_id: "q-3", body: "第三题？", purpose: "了解限制" },
];

describe("manual expert interview answers", () => {
  it("accepts a fenced JSON answer while keeping the original question IDs", () => {
    const text = `\`\`\`json\n${JSON.stringify({ answers: questions.map((question) => ({
      questionId: question.question_id, answer: `${question.body}的回答`,
    })) })}\n\`\`\``;
    expect(parseInterviewRunAnswers(text, questions)).toHaveLength(3);
  });

  it("recovers a malformed batch with bounded individual calls", async () => {
    const calls: string[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      calls.push(input.user);
      const payload = JSON.parse(input.user) as { questions: Array<{ questionId: string }> };
      if (payload.questions.length === 3) return { text: "模型回答过长，未返回 JSON" };
      return { text: JSON.stringify({ answers: [{ questionId: payload.questions[0]!.questionId, answer: "有依据的专家回答" }] }) };
    } };
    const result = await completeInterviewRunAnswers({ model, modelProvider: "test", modelId: "test",
      topic: "江西足球", expert: { display_name: "王志远", role: "足球专家", domains: ["足球"] }, questions });
    expect(result.map((answer) => answer.questionId)).toEqual(["q-1", "q-2", "q-3"]);
    expect(calls).toHaveLength(4);
  });

  it("preserves valid batch answers and retries only the missing ID", async () => {
    const calls: string[][] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const ids = (JSON.parse(input.user) as { questions: Array<{ questionId: string }> }).questions.map((item) => item.questionId);
      calls.push(ids);
      return { text: JSON.stringify({ answers: ids.filter((id) => calls.length > 1 || id !== "q-2")
        .map((questionId) => ({ questionId, answer: `回答 ${questionId}` })) }) };
    } };
    const result = await completeInterviewRunAnswers({ model, modelProvider: "test", modelId: "test",
      topic: "江西足球", expert: { display_name: "王志远", role: "足球专家", domains: ["足球"] }, questions });
    expect(calls).toEqual([["q-1", "q-2", "q-3"], ["q-2"]]);
    expect(result.map((answer) => answer.answer)).toEqual(["回答 q-1", "回答 q-2", "回答 q-3"]);
  });

  it("caps recovery calls when a custom interview has many questions", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      question_id: `q-${index}`, body: `题目 ${index}`, purpose: "了解实践",
    }));
    const calls: number[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const ids = (JSON.parse(input.user) as { questions: Array<{ questionId: string }> }).questions.map((item) => item.questionId);
      calls.push(ids.length);
      return { text: calls.length === 1 ? "无效批量回答" : JSON.stringify({ answers: ids.map((questionId) => ({
        questionId, answer: `回答 ${questionId}`,
      })) }) };
    } };
    const result = await completeInterviewRunAnswers({ model, modelProvider: "test", modelId: "test",
      topic: "江西足球", expert: { display_name: "王志远", role: "足球专家", domains: ["足球"] }, questions: many });
    expect(result).toHaveLength(8);
    expect(calls).toEqual([8, 8]);
  });

  it("does not invent answers when the retry still omits the requested ID", async () => {
    const model: ModelCallPort = { complete: async () => ({ text: '{"answers":[{"questionId":"wrong","answer":"回答"}]}' }) };
    await expect(completeInterviewRunAnswers({ model, modelProvider: "test", modelId: "test",
      topic: "江西足球", expert: { display_name: "王志远", role: "足球专家", domains: ["足球"] }, questions }))
      .rejects.toBeInstanceOf(InvalidInterviewAnswersError);
  });
});
