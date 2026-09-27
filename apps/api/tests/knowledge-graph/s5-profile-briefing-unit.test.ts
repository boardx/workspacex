/**
 * issue #4360 / #4362（S5）—— 纯函数部分：
 *   - 契约：「关于我」分组规则（`kgProfileSection`）、简报形状与上限、新关系 `serves_goal`；
 *   - 画像摘要（`withProfileSummary`）：只认本人个人空间、按组排、条数与字数有界、不重复已召回的；
 *   - 简报组装（`composeBriefing`）：三段有界、有矛盾的不进「上次在做的事」、待办去重、续上首问逐字引用、引用指回那条；
 *   - 挂目标回复的解析（`parseGoalLinkText`）与提议的采纳门（`proposeGoalLinks`：只有高把握才挂）。
 */
import { describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { proposeGoalLinks } from "../../src/application/knowledge-graph/profile";
import type { GoalLinkPort } from "../../src/application/knowledge-graph/profile-ports";
import { BRIEFING_SECTION_LIMIT, composeBriefing, resumePrompt, type BriefingSources } from "../../src/domain/knowledge-graph/briefing";
import { GOAL_LINK_MIN_CONFIDENCE, PROFILE_SUMMARY_LIMIT, PROFILE_SUMMARY_MAX_CHARS, withProfileSummary } from "../../src/domain/knowledge-graph/profile";
import { fuseRecall, type RecallClaim } from "../../src/domain/knowledge-graph/recall";
import { northStar, restatedBackground } from "../../src/domain/knowledge-graph/north-star";
import { toOrgId } from "../../src/domain/org-id";
import { ModelGoalLinker, goalLinkUserText, parseGoalLinkText } from "../../src/infrastructure/knowledge-graph/model-goal-linker";

const GOAL = "我的目标是探索未来教育";

describe("S5 契约", () => {
  it("「关于我」分组：目标 / 偏好 / 约束与身份（本人第一人称单数的事实、风险）/ 在做的事（决定、待办）", () => {
    expect(KG.kgProfileSection("goal", GOAL)).toBe("goals");
    expect(KG.kgProfileSection("preference", "我更喜欢简洁的回答")).toBe("preferences");
    expect(KG.kgProfileSection("fact", "我是一名中学语文老师")).toBe("identity");
    expect(KG.kgProfileSection("risk", "我每周只有周末有空")).toBe("identity");
    expect(KG.kgProfileSection("fact", "我们团队有五个人")).toBeNull();
    expect(KG.kgProfileSection("fact", "客户 A 的合同在法务那里")).toBeNull();
    expect(KG.kgProfileSection("hypothesis", "我可能会换工作")).toBeNull();
    expect(KG.kgProfileSection("decision", "张三决定下周一上线 v2")).toBe("doing");
    expect(KG.kgProfileSection("todo", "下周约王老师")).toBe("doing");
    expect(Object.keys(KG.KG_PROFILE_SECTION_LABEL_ZH)).toEqual(["goals", "preferences", "identity", "doing"]);
  });

  it("新关系 serves_goal 在封闭枚举里；简报条数有上限", () => {
    expect(KG.KgRelation.safeParse("serves_goal").success).toBe(true);
    const item = {
      itemId: "recent:c", section: "recent", kind: "goal", cardKind: null, statement: GOAL, counterpart: null, goal: null,
      saidAt: null, cite: { claimId: "c", scope: "personal", threadId: null }, resumePrompt: resumePrompt("goal", GOAL),
    };
    expect(KG.KgSessionBriefing.safeParse({ dismissed: false, items: [item] }).success).toBe(true);
    expect(KG.KgSessionBriefing.safeParse({ dismissed: false, items: Array(KG.KG_BRIEFING_MAX_ITEMS + 1).fill(item) }).success).toBe(false);
    expect(Object.values(BRIEFING_SECTION_LIMIT).reduce((a, b) => a + b, 0)).toBe(KG.KG_BRIEFING_MAX_ITEMS);
  });
});

const claim = (id: string, statement: string, kind: KG.KgClaimKind, over: Partial<RecallClaim> = {}): RecallClaim => ({
  id, statement, kind, triState: "pending", saidAt: `2026-09-2${id.length % 7}T00:00:00Z`, scope: "personal", ...over,
});

describe("#4360 画像摘要（每轮带上，有界）", () => {
  const base = (claims: RecallClaim[]) => fuseRecall({ query: "今天天气如何", claims, objects: [], graph: [], limit: 8 });

  it("本人个人空间的身份 / 约束也带上（打分与强制召回都带不上的那种），走 claim 通道；claim 通道命中数如实加上", () => {
    const claims = [claim("i1", "我是一名中学语文老师", "fact"), claim("x1", "客户 A 的合同在法务那里", "fact")];
    const r0 = base(claims);
    expect(r0.items.map((i) => i.claim.id)).toEqual([]);
    const r = withProfileSummary(r0, claims);
    expect(r.items.map((i) => [i.claim.id, i.channels])).toEqual([["i1", ["claim"]]]);
    expect(r.plan.find((p) => p.channel === "claim")?.hitCount).toBe(1);
  });

  it("只认本人个人空间：本会话的、本人别的对话里的（originThreadId）不算画像", () => {
    const claims = [
      claim("s1", "我是一名中学语文老师", "fact", { scope: "chat_session" }),
      claim("o1", "我是一名中学数学老师", "fact", { originThreadId: "thr-x" }),
    ];
    expect(withProfileSummary(base(claims), claims).items).toEqual([]);
  });

  it("按 目标 → 偏好 → 约束与身份 → 在做的事 排，条数封顶；已经召回的不重复", () => {
    const claims = [
      claim("d1", "我决定先调研三所实验学校", "decision"),
      claim("i1", "我是一名中学语文老师", "fact"),
      claim("p1", "我更喜欢简洁的回答", "preference"),
      claim("g1", GOAL, "goal"),
      claim("t1", "下周约王老师聊课程设计", "todo"),
      claim("t2", "整理实验学校的名单", "todo"),
    ];
    const r0 = base(claims);
    const forced = new Set(r0.items.map((i) => i.claim.id));
    const r = withProfileSummary(r0, claims);
    const extra = r.items.filter((i) => !r0.items.includes(i)).map((i) => i.claim.id);
    expect(extra.length).toBeLessThanOrEqual(PROFILE_SUMMARY_LIMIT);
    for (const id of extra) expect(forced.has(id)).toBe(false);
    // 强制召回已经带上了目标 / 偏好 / 决定；画像补上的先是身份，再是待办。
    expect(extra[0]).toBe("i1");
    expect(extra).toContain("t1");
  });

  it("合计字数封顶：超出的那条不带", () => {
    const long = "我".concat("很".repeat(PROFILE_SUMMARY_MAX_CHARS));
    const claims = [claim("i1", long, "fact", { saidAt: "2026-09-26T00:00:00Z" }), claim("i2", "我是一名中学语文老师", "fact", { saidAt: "2026-09-01T00:00:00Z" })];
    const r = withProfileSummary(base(claims), claims);
    expect(r.items.map((i) => i.claim.id)).toEqual([]);
  });
});

const src = (over: Partial<BriefingSources> = {}): BriefingSources => ({ personal: [], threadTodos: [], cards: [], goalOf: new Map(), ...over });
const pc = (id: string, kind: KG.KgClaimKind, statement: string, day: number, over: Partial<BriefingSources["personal"][number]> = {}) => ({
  id, kind, statement, triState: "pending" as const, saidAt: `2026-09-${String(day).padStart(2, "0")}T08:00:00Z`,
  createdAt: `2026-09-${String(day).padStart(2, "0")}T08:00:01Z`, threadId: "thr-a1", ...over,
});

describe("#4362 开场简报组装", () => {
  it("没有记忆 ⇒ 什么都不给", () => {
    expect(composeBriefing(src())).toEqual([]);
  });

  it("三段有界：最近的目标与决定、没做完的待办、还没定下来的；决定带挂着的目标；续上首问逐字引用原文、引用指回那条", () => {
    const items = composeBriefing(src({
      personal: [
        pc("g1", "goal", GOAL, 20), pc("g2", "goal", "我的目标是半年内读完十本教育学著作", 10), pc("g3", "goal", "我的目标是学会游泳", 5),
        pc("d1", "decision", "我决定先调研三所实验学校", 21), pc("d2", "decision", "我决定周末整理书架", 22),
        pc("p1", "preference", "我更喜欢简洁的回答", 23),
        pc("t1", "todo", "下周约王老师聊课程设计", 19),
      ],
      threadTodos: [
        { id: "s1", statement: "下周约王老师聊课程设计", triState: "pending", saidAt: "2026-09-24T00:00:00Z", createdAt: "2026-09-24T00:00:00Z", threadId: "thr-a2" },
        { id: "s2", statement: "给家长会准备材料", triState: "pending", saidAt: "2026-09-18T00:00:00Z", createdAt: "2026-09-18T00:00:00Z", threadId: "thr-a2" },
      ],
      cards: [
        { promptId: "cp1", kind: "possible_change", threadId: "thr-a1", createdAt: "2026-09-25T00:00:00Z",
          newer: { id: "n1", statement: "我决定改成调研五所学校", kind: "decision", scope: "chat_session" }, older: { id: "d1", statement: "我决定先调研三所实验学校" } },
        { promptId: "cp0", kind: "conflict", threadId: "thr-a1", createdAt: "2026-09-01T00:00:00Z",
          newer: { id: "n0", statement: "旧卡", kind: "fact", scope: "chat_session" }, older: { id: "o0", statement: "更旧" } },
      ],
      goalOf: new Map([["d1", "g1"]]),
    }));
    expect(items.length).toBeLessThanOrEqual(KG.KG_BRIEFING_MAX_ITEMS);
    expect(items.map((i) => i.itemId)).toEqual([
      "recent:d2", "recent:d1", "recent:g1",
      "open_todos:s1", "open_todos:s2",
      "unresolved:cp1",
    ]);
    const d1 = items.find((i) => i.itemId === "recent:d1")!;
    expect(d1.goal).toEqual({ claimId: "g1", statement: GOAL });
    expect(d1.cite).toEqual({ claimId: "d1", scope: "personal", threadId: "thr-a1" });
    expect(d1.resumePrompt).toContain("我决定先调研三所实验学校");
    const todo = items.find((i) => i.itemId === "open_todos:s1")!;
    expect(todo.cite).toEqual({ claimId: "s1", scope: "chat_session", threadId: "thr-a2" });
    const card = items.find((i) => i.section === "unresolved")!;
    expect(card.cardKind).toBe("possible_change");
    expect(card.counterpart).toEqual({ claimId: "d1", statement: "我决定先调研三所实验学校" });
    expect(card.resumePrompt).toContain("我决定改成调研五所学校");
    expect(card.resumePrompt).toContain("我决定先调研三所实验学校");
    for (const i of items) {
      expect(KG.KgBriefingItem.safeParse(i).success).toBe(true);
      expect(i.resumePrompt.length).toBeLessThanOrEqual(KG.KG_BRIEFING_PROMPT_MAX_CHARS);
    }
  });

  it("有矛盾的条目不放进「上次在做的事」；超长原文截断", () => {
    const long = `我的目标是${"探索".repeat(80)}`;
    const items = composeBriefing(src({ personal: [pc("g1", "goal", long, 20), pc("d1", "decision", "我决定先调研三所实验学校", 21, { triState: "conflict" })] }));
    expect(items.map((i) => i.itemId)).toEqual(["recent:g1"]);
    expect(items[0]!.statement.length).toBeLessThanOrEqual(KG.KG_BRIEFING_STATEMENT_MAX_CHARS);
    expect(items[0]!.statement.endsWith("…")).toBe(true);
    expect(items[0]!.resumePrompt.length).toBeLessThanOrEqual(KG.KG_BRIEFING_PROMPT_MAX_CHARS);
  });
});

describe("#4360 模型提议挂哪个目标：只有高把握才挂", () => {
  it("解析：goal 编号或 null + 0..1 的把握度；读不懂 ⇒ null", () => {
    expect(parseGoalLinkText('{"goal":"g1","confidence":0.92}')).toEqual({ goalKey: "g1", confidence: 0.92 });
    expect(parseGoalLinkText('好的 {"goal":null,"confidence":0.1}')).toEqual({ goalKey: null, confidence: 0.1 });
    expect(parseGoalLinkText('{"goal":"g1","confidence":7}')).toEqual({ goalKey: "g1", confidence: 1 });
    expect(parseGoalLinkText("好的，收到。")).toBeNull();
    expect(parseGoalLinkText('{"goal":3,"confidence":0.9}')).toBeNull();
  });

  const run = async (reply: string) => {
    const set: Parameters<GoalLinkPort["set"]>[] = [];
    const logs: Array<{ msg: string; fields: Record<string, unknown> }> = [];
    const port: GoalLinkPort = {
      candidates: async () => ({ author: "u-a", items: [{ id: "p-d1", statement: "我决定先调研三所实验学校", kind: "decision" }], goals: [{ id: "p-g1", statement: GOAL }] }),
      set: async (...args) => { set.push(args); return { claimId: args[2].claimId, goalClaimId: args[2].goalClaimId, outcome: "linked" }; },
      revise: async () => "x",
    };
    const seen: string[] = [];
    const proposer = new ModelGoalLinker({ complete: async (input) => { seen.push(input.user); return { text: reply }; } },
      { enabled: true, provider: "p", modelId: "m" }, { info: () => undefined, error: () => undefined });
    const n = await proposeGoalLinks(
      { goalLinks: port, proposer, logger: { info: (msg, fields) => { logs.push({ msg, fields: fields as Record<string, unknown> }); }, error: () => undefined }, newId: () => "act-1" },
      { orgId: toOrgId("org-x"), threadId: "thr-1", messageId: "m-1" },
    );
    return { n, set, logs, seen };
  };

  it(`把握 ≥ ${GOAL_LINK_MIN_CONFIDENCE} ⇒ 以系统身份挂上（带 thread + message，数据库据此推作者）；目标用短号交给模型，不交 id`, async () => {
    const r = await run('{"goal":"g1","confidence":0.9}');
    expect(r.n).toBe(1);
    expect(r.set).toEqual([[toOrgId("org-x"), { kind: "system", threadId: "thr-1", messageId: "m-1" }, { actionId: "act-1", claimId: "p-d1", goalClaimId: "p-g1", confidence: 0.9 }]]);
    expect(r.seen[0]).toBe(goalLinkUserText({ item: { statement: "我决定先调研三所实验学校", kind: "decision" }, goals: [{ key: "g1", statement: GOAL }] }));
    expect(r.seen[0]).not.toContain("p-g1");
  });

  it("低把握 / 没有目标 / 编了个不存在的目标 / 读不懂 ⇒ 不挂，留日志说明原因", async () => {
    for (const [reply, reason] of [
      ['{"goal":"g1","confidence":0.5}', "low_confidence"], ['{"goal":null,"confidence":0.9}', "no_goal"],
      ['{"goal":"g7","confidence":0.95}', "unknown_goal"], ["好的，收到。", "unparseable"],
    ] as const) {
      const r = await run(reply);
      expect(r.n).toBe(0);
      expect(r.set).toEqual([]);
      expect(r.logs.find((l) => l.msg === "kg goal link not applied")?.fields.reason).toBe(reason);
    }
  });
});

describe("#4360 北极星指标：新会话里重复交代已知背景的比例", () => {
  const bg = [
    { id: "g1", kind: "goal" as const, statement: GOAL },
    { id: "i1", kind: "fact" as const, statement: "我是一名中学语文老师" },
    { id: "f1", kind: "fact" as const, statement: "客户 A 的合同在法务那里" },
  ];
  it("第一条消息把已知目标又说了一遍 ⇒ 算重复交代；只说「帮我规划」⇒ 不算；与「你」无关的事实不算背景", () => {
    expect(restatedBackground("我的目标是探索未来教育，帮我规划一下", bg)).toEqual(["g1"]);
    expect(restatedBackground("帮我规划一下", bg)).toEqual([]);
    expect(restatedBackground("客户 A 的合同在法务那里吗", bg)).toEqual([]);
    expect(restatedBackground("我是一名中学语文老师，想做一个阅读课", bg)).toEqual(["i1"]);
  });
  it("比例只算有已知背景的会话", () => {
    const r = northStar([
      { threadId: "t1", userId: "u", firstMessage: "我的目标是探索未来教育，帮我规划一下", background: bg },
      { threadId: "t2", userId: "u", firstMessage: "帮我规划一下", background: bg },
      { threadId: "t3", userId: "u", firstMessage: "你好", background: [] },
    ]);
    expect(r).toMatchObject({ sessions: 2, restated: 1, rate: 0.5 });
    expect(r.perSession).toEqual([
      { threadId: "t1", userId: "u", restatedClaimIds: ["g1"] }, { threadId: "t2", userId: "u", restatedClaimIds: [] },
    ]);
    expect(northStar([]).rate).toBeNull();
  });
});
