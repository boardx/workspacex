import { describe, expect, it } from "vitest";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import { projectProblemSkillDraft } from "../../src/application/aidt-stages/problem-skill-draft";

type Draft = SharedStageValue["content"]["draft"];
const initial = "我们想了解大学生在校园食堂买奶茶的体验。";
const rewritten = "午休时间有限的学生在校园食堂是怎样决定是否买奶茶新品的？";
const observation = "两位同学看菜单后离开。";
const continuation = "其中一位反复看价格，原因待核实。";
const prior = {
  initial,
  problemSources: '["complaint"]',
  sourceDetails: "学生此前保存的抱怨原文",
  rewrittenTheme: "学生此前重写的命题",
  focus: "既有方向",
  problemDirections: JSON.stringify([{ id: "existing", title: "既有方向", source: "group" }]),
  problemDirectionId: "existing",
};
function assistant(rewrite = rewritten) {
  return ["### 原始命题", initial, "### 选题价值", "了解选择是否占用午休时间", "### 来源类型", "亲自观察",
    "### 来源说明", observation, "### 学生重写命题", "> " + rewrite, "### 研究范围", "菜单选择"].join("\n");
}
function project(user: string, reply = assistant(), saved = prior) {
  const before: Draft = { fields: { "problemDraft:synthetic": JSON.stringify(saved), neighbor: "合成邻项保持" }, ideas: [], selectedIdeaId: "" };
  const result = projectProblemSkillDraft(before, "synthetic", { user, assistant: reply, messageId: "synthetic-only-turn" }) ?? before;
  expect(result.fields.neighbor).toBe(before.fields.neighbor);
  const fields = JSON.parse(result.fields["problemDraft:synthetic"]!) as Record<string, string>;
  expect(fields.initial).toBe(initial);
  expect(fields.roundCompletion).toBeUndefined();
  expect(fields.problemReflectionConfirmed).toBeUndefined();
  return fields;
}
function keepsSource(fields: Record<string, string>) {
  expect(fields.problemSources).toBe(prior.problemSources);
  expect(fields.sourceDetails).toBe(prior.sourceDetails);
}
function keepsDecisions(fields: Record<string, string>) {
  expect(fields.rewrittenTheme).toBe(prior.rewrittenTheme);
  expect(fields.focus).toBe(prior.focus);
  expect(fields.problemDirectionId).toBe(prior.problemDirectionId);
}

describe("student natural declarations preserve literal attribution and independent decisions", () => {
  it("accepts affirmative inline source and rewrite while the different direction literal stays unchosen", () => {
    const fields = project("研究价值是了解选择是否占用午休时间。来源是亲自观察：" + observation + "离开的原因仍待核实。本组选择菜单选择方向。重写为：" + rewritten);
    expect(fields.problemSources).toBe('["observation"]');
    expect(fields.sourceDetails).toBe(observation + "离开的原因仍待核实。");
    expect(fields.rewrittenTheme).toBe(rewritten);
    expect(fields.focus).toBe(prior.focus);
    expect(fields.problemDirectionId).toBe(prior.problemDirectionId);
  });
  it("preserves multiline source text and stops before the next explicit field", () => {
    const fields = project("来源是亲自观察：" + observation + "\n" + continuation + "\n本组选择的研究方向：菜单选择\n学生重写命题：" + rewritten);
    expect(fields.sourceDetails).toBe(observation + "\n" + continuation);
    expect(fields.focus).toBe("菜单选择");
    expect(fields.rewrittenTheme).toBe(rewritten);
  });
  it("stops source continuation before a natural rewrite", () => {
    const fields = project("来源是亲自观察：" + observation + "\n" + continuation + "\n重写为：" + rewritten);
    expect(fields.sourceDetails).toBe(observation + "\n" + continuation);
    expect(fields.rewrittenTheme).toBe(rewritten);
  });
  it("does not interpret the noun 选题价值 as an earlier selection", () => {
    expect(project("选题价值：了解时间限制\n本组选择菜单选择。").focus).toBe("菜单选择");
  });
  it("keeps rewrite independent from a deferred direction decision", () => {
    const fields = project("重写为：" + rewritten + "\n我们暂不选择第二个方向。");
    expect(fields.rewrittenTheme).toBe(rewritten);
    expect(fields.focus).toBe(prior.focus);
  });
  it("keeps rewrite independent from undecided provenance", () => {
    const fields = project("重写为：" + rewritten + "\n来源尚未确定。");
    expect(fields.rewrittenTheme).toBe(rewritten); keepsSource(fields);
  });
  it.each(["老师的示例：如何理解校园排队？", "不是我们的命题，只是老师示例。"]) (
    "does not save a teacher-attributed rewrite value: %s", value => {
      expect(project("重写为：" + value, assistant(value)).rewrittenTheme).toBe(prior.rewrittenTheme);
    },
  );
  it("does not save provenance explicitly disclaimed inside the source value", () => {
    keepsSource(project("来源是亲自观察：不是我们的来源，只是老师示例。"));
  });
  it.each([
    "来源不是亲自观察。我们还没有确定来源。",
    "来源尚未确定。我们还没选择方向，尚未重写命题。",
    "来源是亲自观察：两位同学看菜单后离开吗？",
    "是否重写为：" + rewritten,
    "请先比较方案，不要替我们选择或重写。",
  ])("does not turn uncertainty, questions or AI suggestions into decisions: %s", user => {
    const fields = project(user); keepsSource(fields); keepsDecisions(fields);
  });
  it("rejects a retrospective attribution after multiline source explanation", () => {
    keepsSource(project("来源是亲自观察：" + observation + "\n" + continuation + "\n以上是老师的示例，不是我们小组的来源。"));
  });
  it("honors a source retraction without replacing the prior student source", () => {
    keepsSource(project("来源是亲自观察：" + observation + "\n" + continuation + "\n我们撤回刚才的来源判断。"));
  });
  it("honors a rewrite retraction", () => {
    expect(project("重写为：" + rewritten + "\n我们撤回刚才的重写命题。").rewrittenTheme).toBe(prior.rewrittenTheme);
  });
  it("separates a later teacher paragraph from the student's earlier source", () => {
    const fields = project("来源是亲自观察：" + observation + "\n\n下面只是引用老师的示例：\n来源是听到抱怨：另一个例子。");
    expect(fields.problemSources).toBe('["observation"]'); expect(fields.sourceDetails).toBe(observation);
  });
  it("accepts a student's new paragraph after a teacher example", () => {
    const fields = project("下面只是引用老师的示例，不是本组材料：\n来源是听到抱怨：老师的例子。\n\n来源是亲自观察：" + observation);
    expect(fields.problemSources).toBe('["observation"]'); expect(fields.sourceDetails).toBe(observation);
  });
  it.each(["```text\n来源是亲自观察：" + observation + "\n```", "```text\n重写为：" + rewritten + "\n```",
    "下面只是引用老师的示例，不是本组材料：\n> 来源是亲自观察：" + observation + "\n> 重写为：" + rewritten]) (
    "ignores declarations confined to code or teacher quotations: %s", user => {
      const fields = project(user); keepsSource(fields); keepsDecisions(fields);
    },
  );
  it("ignores fenced retraction prose after an actual student declaration", () => {
    expect(project("重写为：" + rewritten + "\n```text\n我们暂不重写命题。\n```").rewrittenTheme).toBe(rewritten);
    expect(project("来源是亲自观察：" + observation + "\n```text\n我们撤回刚才的来源判断。\n```").sourceDetails).toBe(observation);
  });
  it("preserves a literal greater-than sign in the student's source explanation", () => {
    expect(project("来源是亲自观察：等待时间 > 10分钟时同学离开。").sourceDetails).toBe("等待时间 > 10分钟时同学离开。");
  });
  it("retains a literal leading greater-than in a student rewrite after one presentation quote", () => {
    const value = "> 我们想了解学生如何选择。";
    expect(project("重写为：" + value, assistant(value)).rewrittenTheme).toBe(value);
  });
});

it.each(["问题来源来自亲自观察", "问题来源是亲自观察。", "来源为亲自观察"])(
  "records a source type independently of the description: %s", user => {
    const fields = project(user, "收到来源类型，请补充具体观察。");
    expect(fields.problemSources).toBe('["observation"]');
    expect(fields.sourceDetails).toBe(prior.sourceDetails);
  },
);

it.each([
  "问题来源来自亲自观察吗？",
  "问题来源来自亲自观察\n以上是老师的示例，不是我们小组的来源。",
  "> 问题来源来自亲自观察",
  "问题来源来自亲自观察\n我们撤回刚才的来源判断。",
])("does not record unasserted source types: %s", user => {
  keepsSource(project(user));
});

it.each(["命题是： 江西教育的减负", "改写命题：江西教育的减负", "学生重写命题：江西教育的减负"])(
  "records the student's exact rewrite even when the assistant uses the original-topic heading: %s", user => {
    const fields = project(user, "### 原始命题\n江西教育的减负（学生本轮提交的改写命题）");
    expect(fields.rewrittenTheme).toBe("江西教育的减负");
    keepsSource(fields);
  },
);

it.each([
  "> 改写命题：江西教育的减负",
  "改写命题：江西教育的减负\n以上只是老师的示例。",
  "命题是：江西教育的减负\n我们暂不改写命题。",
])("keeps the prior rewrite for quoted or deferred changes: %s", user => {
  keepsDecisions(project(user));
});

it("keeps a standalone student description and recognizes an explicitly heard complaint", () => {
  const fields = project("来源描述：我听到学校在抱怨", "### 来源类型\n亲自观察\n### 来源说明\nAI 补写的内容",
    { ...prior, problemSources: '["observation"]' });
  expect(fields.sourceDetails).toBe("我听到学校在抱怨");
  expect(fields.problemSources).toBe('["complaint"]');
});

it("records a standalone description without guessing its source type", () => {
  const fields = project("来源描述：学校正在讨论作业负担。");
  expect(fields.sourceDetails).toBe("学校正在讨论作业负担。");
  expect(fields.problemSources).toBe(prior.problemSources);
});

it.each(["问题来源尚未确定。", "我们撤回刚才的问题来源判断。", "我们尚未确认问题来源。"])(
  "preserves the previous source when the new declaration is retracted: %s", retraction => {
    keepsSource(project("问题来源来自亲自观察\n" + retraction));
  },
);
