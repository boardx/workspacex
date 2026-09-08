/**
 * 迭代 13（delta `design-chat-inputs` §3）—— V61 / V62 / V64。
 *
 * 澄清问题必须是**按这段 brief 生成的**（不是固定问卷念一遍）；模型不可用时退回通用问卷
 * 并**说明是兜底**（不是让新建流程失败）；问答落地成既有的 `problem` / `criteria`
 * （不新增第四种事实源）。
 */
import { describe, expect, it, vi } from "vitest";
import { designWorkbench as C } from "@repo/contracts";
import {
  FALLBACK_QUESTIONS,
  foldIntakeIntoCriteria,
  foldIntakeIntoProblem,
  generateIntakeQuestions,
  parseIntakeQuestions,
} from "../../src/application/design-workbench/intake-questions";

const deps = (complete: (input: { system: string; user: string }) => Promise<{ text: string; truncated?: boolean }>) => {
  const log = vi.fn();
  const model = { complete: vi.fn(complete) };
  return { d: { model: model as never, chatModel: { provider: "p", modelId: "m" }, log }, model, log };
};

const q = (dimension: string, text: string) => ({ dimension, text });
const reply = (qs: readonly { dimension: string; text: string }[]) => ({ text: JSON.stringify({ questions: qs }) });

describe("V61 澄清问题是按 brief 生成的，不是固定问卷", () => {
  it("brief 进了 prompt；返回的问题原样带出来", async () => {
    const { d, model } = deps(async () =>
      reply([q("who", "会员分几档？各自的核心权益是什么？"), q("task", "线下下单时最想省掉哪一步？"), q("success", "多少步之内下完一单算合格？")]),
    );
    const out = await generateIntakeQuestions(d, { brief: "牙膏消费品站，会员在线下单采购" });
    expect(out.fallback).toBe(false);
    expect(out.questions).toHaveLength(3);
    expect(out.questions[0]!.text).toContain("会员");
    // ⭐ 反证锚点：实现若直接返回 FALLBACK_QUESTIONS，这条红——那正是"固定问卷念一遍"。
    expect(out.questions).not.toEqual(FALLBACK_QUESTIONS);
    expect(model.complete.mock.calls[0]?.[0]?.user).toContain("牙膏");
  });

  it("同一实现对两段不同 brief 产出不同问题（问题来自模型，不是常量）", async () => {
    const byBrief = async (input: { user: string }) =>
      input.user.includes("牙膏")
        ? reply([q("who", "会员分几档？"), q("task", "线下下单省掉哪一步？"), q("success", "几步下完一单？")])
        : reply([q("who", "谁来审批？"), q("constraint", "审批要留痕多久？"), q("success", "多久走完一轮？")]);
    const a = await generateIntakeQuestions(deps(byBrief).d, { brief: "牙膏站" });
    const b = await generateIntakeQuestions(deps(byBrief).d, { brief: "内部审批工具" });
    expect(a.questions.map((x) => x.text)).not.toEqual(b.questions.map((x) => x.text));
    expect(b.questions[0]!.text).toContain("审批");
  });

  it("重复维度只留第一条；不合法的条目丢掉；超过上限截断", () => {
    const parsed = parseIntakeQuestions([
      q("who", "第一条"), q("who", "同维度的第二条"), { dimension: "nope", text: "维度不合法" }, { text: "缺维度" }, q("task", "合法"),
    ]);
    expect(parsed.map((x) => x.text)).toEqual(["第一条", "合法"]);
    expect(parseIntakeQuestions(Array.from({ length: 10 }, (_, i) => q(["who","problem","task","constraint","reference","success"][i % 6]!, `q${i}`))))
      .toHaveLength(C.INTAKE_MAX_QUESTIONS);
  });
});

describe("V62 模型不可用 ⇒ 退回通用问卷并标记 fallback，新建流程不被堵死", () => {
  it("调用抛错 / 输出不是 JSON / 被截断 / 问题太少 —— 四种都回退且 fallback=true", async () => {
    const cases: (() => Promise<{ text: string; truncated?: boolean }>)[] = [
      async () => { throw new Error("boom"); },
      async () => ({ text: "我觉得你应该先想清楚目标用户" }),
      async () => ({ text: '{"questions":[', truncated: true }),
      async () => reply([q("who", "只有一条")]),
    ];
    for (const c of cases) {
      const out = await generateIntakeQuestions(deps(c).d, { brief: "随便什么" });
      // ⭐ 反证锚点：实现若把失败抛出去，这里直接炸——新建流程会因为模型挂了而用不了。
      expect(out.fallback).toBe(true);
      expect(out.questions).toEqual(FALLBACK_QUESTIONS);
      expect(out.questions.length).toBeGreaterThanOrEqual(C.INTAKE_MIN_QUESTIONS);
    }
  });

  it("兜底问卷覆盖六个维度，且每条都过契约", () => {
    expect(new Set(FALLBACK_QUESTIONS.map((x) => x.dimension)).size).toBe(6);
    for (const x of FALLBACK_QUESTIONS) expect(C.IntakeQuestion.safeParse(x).success).toBe(true);
  });
});

describe("V64 问答落地成 problem / criteria，不新增第四种事实源", () => {
  const answers = [
    { question: "会员分几档？", answer: "两档：普通与金卡" },
    { question: "几步下完一单？", answer: "三步之内" },
  ];

  it("brief 与答案拼进 problem；答案原文可见", () => {
    const p = foldIntakeIntoProblem("牙膏站，会员线下采购", answers);
    expect(p).toContain("牙膏站");
    expect(p).toContain("两档：普通与金卡");
    expect(p).toContain("会员分几档？");
  });

  it("只有「成功长什么样」那一维的答案进 criteria，其余是背景不是验收条目", () => {
    const c = foldIntakeIntoCriteria(answers, ["几步下完一单？"]);
    expect(c.slice(0, 3)).toEqual([...C.DESIGN_PROJECT_INITIAL_CRITERIA]);
    expect(c).toContain("三步之内");
    // ⭐ 反证锚点：把所有答案都塞进 criteria ⇒ 这条红（背景会污染验收标准）
    expect(c).not.toContain("两档：普通与金卡");
  });

  it("没有答案时 criteria 就是默认三条，problem 不多出空行", () => {
    expect(foldIntakeIntoCriteria([], [])).toEqual([...C.DESIGN_PROJECT_INITIAL_CRITERIA]);
    expect(foldIntakeIntoProblem("只写了一句", [])).toBe("只写了一句");
  });

  it("契约里没有第四种字段：指导原则就是 problem / criteria", () => {
    // `DesignProject` 是 .strict()：多带一个 `guidelines` 会被拒。
    // ⭐ 反证锚点：真给契约加了这么个字段，这条立刻红——那就是同一事实的第四处声明。
    const base = {
      id: "p1", name: "n", template: "mobile", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [],
      pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
      chat: [], ownerId: "u1", ownerName: null, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
    };
    expect(C.DesignProject.safeParse(base).success).toBe(true);
    expect(C.DesignProject.safeParse({ ...base, guidelines: "第四种事实源" }).success).toBe(false);
  });
});
