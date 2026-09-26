/**
 * Issue #4290 —— 明确改口时新决定取代旧决定：领域纯函数（decision-supersede.ts）。
 * 高把握的明确改口（explicit / same_kind）→ 自动取代；低把握（frame_only）→ 只弹卡、不取代（人类决定 2026-09-26
 * 「高把握自动、低把握弹卡」）；并列补充 / 无改口信号 / 不同作者 / 多条候选 / 类别不同 / 问句 / 假设 / 改口被评判否掉
 * → 既不取代也不弹卡。
 */
import { describe, expect, it } from "vitest";
import {
  changeClauses, decisionFrame, findSupersedes, hasChangeSignal, planSupersedes, supersedeMatch, type LiveDecision, type SupersedeFresh,
} from "../../src/domain/knowledge-graph/decision-supersede";

const ME = "u-me";
const OTHER = "u-other";
const fresh = (statement: string, over: Partial<SupersedeFresh> = {}): SupersedeFresh =>
  ({ id: "clm-new", kind: "decision", statement, authorId: ME, ...over });
const old = (statement: string, over: Partial<LiveDecision> = {}): LiveDecision =>
  ({ id: "clm-old", kind: "decision", statement, authorId: ME, scope: "personal", ...over });

const OLD_211 = old("我决定关注 211 高校");

describe("decisionFrame：框架动词 + 对象 + 类别词", () => {
  it.each([
    ["我决定关注 211 高校", "关注", "211高校", "高校"],
    ["改成关注 985 高校吧", "关注", "985高校", "高校"],
    ["改成关注 985 吧", "关注", "985", null],
    ["决定改为采用 Vue 框架。", "采用", "vue框架", "框架"],
    ["今天天气不错", null, "", null],
  ])("%s", (s, verb, object, kind) => {
    expect(decisionFrame(s)).toEqual({ verb, object, kind });
  });
});

describe("hasChangeSignal：明确改口", () => {
  it.each(["改成关注 985 吧", "决定改为关注 985 高校", "不再关注 211 高校", "211 算了，换成 985", "不关注 211 了，关注 985", "还是改成 985 吧"])(
    "改口：%s", (s) => expect(hasChangeSignal(s)).toBe(true));
  it.each([
    "也关注 985 高校", "另外再加上 985", "同时改成关注 985", // 并列补充
    "我决定关注 985 高校",                                 // 没有改口信号
    "不改成 985，还是 211", "别换成 985",                   // 否定的改口
    "改成关注 985 吗", "要不要改成 985？", "改成关注哪个？",  // 问句
    "如果改成 985，预算要重算",                             // 假设
  ])("不是改口：%s", (s) => expect(hasChangeSignal(s)).toBe(false));
});

describe("supersedeMatch：单对判定", () => {
  it("明确改口、同一作者、同框架同类 → 取代（same_kind）", () => {
    expect(supersedeMatch(fresh("改成关注 985 高校吧"), OLD_211)).toBe("same_kind");
  });
  it("新决定没写类别词（「改成关注 985 吧」）→ frame_only", () => {
    expect(supersedeMatch(fresh("改成关注 985 吧"), OLD_211)).toBe("frame_only");
  });
  it("明说旧对象（「不再关注 211 高校」「把 211 高校换成 985 高校」）→ explicit", () => {
    expect(supersedeMatch(fresh("不再关注 211 高校"), OLD_211)).toBe("explicit");
    expect(supersedeMatch(fresh("把 211 高校换成 985 高校"), OLD_211)).toBe("explicit");
  });
  it("并列补充 → 不取代", () => {
    expect(supersedeMatch(fresh("也关注 985 高校"), OLD_211)).toBeNull();
    expect(supersedeMatch(fresh("我决定也关注 985 高校"), OLD_211)).toBeNull();
  });
  it("没有改口信号 → 不取代", () => {
    expect(supersedeMatch(fresh("我决定关注 985 高校"), OLD_211)).toBeNull();
  });
  it("不同作者 → 不取代；作者未知 → 不取代", () => {
    expect(supersedeMatch(fresh("改成关注 985 高校"), old("我决定关注 211 高校", { authorId: OTHER }))).toBeNull();
    expect(supersedeMatch(fresh("改成关注 985 高校", { authorId: null }), OLD_211)).toBeNull();
    expect(supersedeMatch(fresh("改成关注 985 高校"), old("我决定关注 211 高校", { authorId: null }))).toBeNull();
  });
  it("不是决定 / 同一条 → 不取代", () => {
    expect(supersedeMatch(fresh("改成关注 985 高校", { kind: "fact" }), OLD_211)).toBeNull();
    expect(supersedeMatch(fresh("改成关注 985 高校"), old("我决定关注 211 高校", { kind: "todo" }))).toBeNull();
    expect(supersedeMatch(fresh("改成关注 985 高校", { id: "clm-old" }), OLD_211)).toBeNull();
  });
  it("框架动词不同（关注 vs 用）→ 不取代", () => {
    expect(supersedeMatch(fresh("改成用 Vue 写前端"), OLD_211)).toBeNull();
  });
  it("同框架但类别词不同（高校 vs 方向）→ 不算同一主题", () => {
    expect(supersedeMatch(fresh("改成关注 AI 方向"), OLD_211)).toBeNull();
  });
  it("问句 / 假设句里的改口 → 不取代", () => {
    expect(supersedeMatch(fresh("改成关注 985 高校吗"), OLD_211)).toBeNull();
    expect(supersedeMatch(fresh("如果改成关注 985 高校，预算要重算"), OLD_211)).toBeNull();
  });
});

describe("独立评审第 8 轮：只认真正的改口句式（宁可漏，不可误）", () => {
  it.each([
    "我不再犹豫了，决定关注211",     // 「不再」没支配框架动词
    "决定关注985，不过这事不急了",   // 「不急了」不是改口
  ])("「不再 / 不…了」不支配框架动词 ⇒ 不是改口：%s", (s) => expect(hasChangeSignal(s)).toBe(false));
  it.each(["不用 Vue 了，用 React", "不再用 Vue"])("「不用 X 了」「不再用 X」仍是改口：%s", (s) => expect(hasChangeSignal(s)).toBe(true));

  it.each([
    ["我决定关注985高校", "我不再犹豫了，决定关注211"],
    ["决定关注211高校", "决定关注985，不用再讨论了"],
    ["决定关注211高校", "决定关注985，不过这事不急了"],
  ])("改口信号误报：%s → %s 不取代", (o, n) => expect(supersedeMatch(fresh(n), old(o))).toBeNull());

  it.each([
    ["决定做测试", "上线日期改成周五，先测试"],
    ["决定用AI", "周会改成周五开，汇报AI进展"],
    ["决定用Go", "改成去Google面试"],
    ["决定用Go", "把Google换成Bing"],
    ["决定用Go", "mongo换成pg"],
  ])("旧对象只是碰巧出现在新句里（没连在改口句式上 / 不在词边界）：%s → %s 不取代", (o, n) =>
    expect(supersedeMatch(fresh(n), old(o))).toBeNull());

  it("重申旧决定（「不再用Vue了，改用React做前端」对「决定用React做前端」）→ 不取代", () => {
    expect(supersedeMatch(fresh("不再用Vue了，改用React做前端"), old("决定用React做前端"))).toBeNull();
  });
  it("重说同一个对象（「改成关注985高校」对「关注985高校」）→ 不取代", () => {
    expect(supersedeMatch(fresh("改成关注985高校"), old("关注985高校"))).toBeNull();
  });
  it("旧对象连在改口句式上 → explicit（ASCII 按词边界）", () => {
    expect(supersedeMatch(fresh("把 Go 换成 Rust"), old("决定用Go"))).toBe("explicit");
    expect(supersedeMatch(fresh("不再用 Vue 了，改用 React"), old("决定用 Vue"))).toBe("explicit");
    expect(supersedeMatch(fresh("Go 算了，换成 Rust"), old("决定用Go"))).toBe("explicit");
  });

  it.each([
    ["决定降低费用", null],
    ["决定优化用户体验", null],
    ["决定改进做法", null],
    ["决定精简选项", null],
  ])("单字框架动词在词里（费用 / 用户 / 做法 / 选项）不算框架：%s", (s, verb) => expect(decisionFrame(s).verb).toBe(verb));
  it.each([
    ["决定用 Vue", "改成优化用户体验"],
    ["决定用 Go", "改成降低费用"],
    ["决定做 A 方案", "改成换一种做法"],
    ["决定选 A", "改成精简选项"],
  ])("词里的单字动词不会凑出同框架：%s → %s 不取代", (o, n) => expect(supersedeMatch(fresh(n), old(o))).toBeNull());
});

describe("独立评审第 8 轮复评：改口必须在同一分句里直接支配框架（结构规则，不是词表）", () => {
  // 「不 + 动词 + X + 了」只点名 X、不带新框架：X 不是旧决定的对象就什么都不取代——「不用再讨论了」「不用多想了」
  // 与「不用 Vue 了」在句式上一模一样，分辨它们的只有旧对象本身，所以这里不再有「不需要」词表。
  it("「不用再讨论了」只点名「再讨论」：是一个否定分句，但不带新框架", () => {
    expect(changeClauses("决定关注985，不用再讨论了")).toEqual([{ frame: null, namedOld: "再讨论", subject: "" }]);
  });

  it.each([
    // 评审点名的 6 句
    ["决定关注211高校", "决定关注985高校，不用多想了"],
    ["决定关注211高校", "决定关注985高校，不用特意讨论了"],
    ["决定关注985", "决定关注211，不做过多讨论了"],
    ["决定用React做前端", "前端框架还是用React，部署改成周五"],
    ["决定用Vue", "会议时间改成周五，用Vue写原型"],
    ["决定关注985", "周会改成周五，重点关注招聘"],
    // 不用 / 不做 / 不必 + 无关的词（框架出在别的分句，否定分句点名的不是旧对象）
    ["决定关注211高校", "决定关注985高校，不用再讨论了"],
    ["决定关注211高校", "决定关注985高校，不用管预算了"],
    ["决定用Vue", "决定用React，不用纠结了"],
    ["决定用Go", "用Rust写后端，不用再开会了"],
    ["决定做A方案", "决定做B方案，不做额外评审了"],
    ["决定选北京", "决定选上海，不必再比较了"],
    ["决定采用React框架", "采用Vue框架，不用写文档了"],
    ["决定用Vue", "我们不用加班了，用React"],
    ["决定关注985", "决定关注211，不用急了"],
    ["决定用Vue", "不用Vue写文档了"],
    // 改口词在另一个分句、改的是别的事
    ["决定用Vue", "周会改成线上，用React写原型"],
    ["决定关注211高校", "汇报时间改成下午，关注985高校"],
    ["决定用Go", "截止日期改为下周，用Rust重写"],
    ["决定用Vue", "会议室换成302，然后用React"],
    ["决定关注211高校", "报告模板换成新版，但关注985高校"],
    ["决定关注985", "开会地点改成三楼，关注211吧"],
    // 改口词支配了框架，但主语是别的事（旧决定里没有这个主语）
    ["决定用Vue", "周会改成用腾讯会议"],
    ["决定用Go", "部署脚本改用Python，后端用Rust"],
    ["决定用Vue", "把周会换成用腾讯会议"],
    // 重说（新对象与旧对象相等 / 互相包含）
    ["决定用React做前端", "改用React"],
    ["决定用Vue", "改成用Vue写原型"],
    ["决定关注985高校", "改成关注985"],
    ["决定用React", "还是改用React做前端吧"],
    ["决定关注211高校", "算了，还是关注211高校吧"],
    // 「算了」后面不是改口分句、也不是「还是 + 框架」
    ["决定关注211高校", "算了，关注985高校"],
    ["决定关注211高校", "这事算了，先吃饭"],
  ])("不取代：%s → %s", (o, n) => {
    expect(supersedeMatch(fresh(n), old(o))).toBeNull();
    expect(planSupersedes([fresh(n)], [old(o)])).toEqual({ supersedes: [], prompts: [] });
  });

  it.each([
    ["决定用Go", "把 Go 换成 Rust", "explicit"],
    ["决定用Vue", "不再用 Vue 了", "explicit"],
    ["决定用Vue", "不再使用Vue", "explicit"],
    ["决定关注211高校", "211高校算了，改成关注985高校", "explicit"],
    ["决定采用Vue框架", "改为采用React框架", "same_kind"],
    ["决定关注211高校", "算了，还是关注985高校吧", "same_kind"],
    ["决定用Vue", "不用Vue了，改用React", "explicit"],
    ["决定关注211高校", "不关注211高校了", "explicit"],
    ["决定关注211高校", "我们还是改成关注985高校吧", "same_kind"],
    ["决定用Go", "Go算了", "explicit"],
    ["决定前端用Vue", "前端不再用Vue了", "explicit"],
  ])("高把握 ⇒ 自动取代：%s → %s（%s）", (o, n, tier) => {
    expect(supersedeMatch(fresh(n), old(o))).toBe(tier);
    expect(planSupersedes([fresh(n)], [old(o)])).toEqual({ supersedes: [{ newerClaimId: "clm-new", olderClaimId: "clm-old" }], prompts: [] });
    expect(findSupersedes([fresh(n)], [old(o)])).toEqual([{ newerClaimId: "clm-new", olderClaimId: "clm-old" }]);
  });

  it.each([
    ["关注211高校", "改成关注985吧"],
    ["后端用Go", "后端改用Rust"],
    ["决定用Vue", "改成用React，Vue太慢"],
    ["决定关注211高校", "改成关注985吧"],
  ])("低把握（frame_only）⇒ 只弹卡、从不自动取代：%s → %s", (o, n) => {
    expect(supersedeMatch(fresh(n), old(o))).toBe("frame_only");
    expect(planSupersedes([fresh(n)], [old(o)])).toEqual({ supersedes: [], prompts: [{ newerClaimId: "clm-new", olderClaimId: "clm-old" }] });
    expect(findSupersedes([fresh(n)], [old(o)])).toEqual([]);
  });
});

describe("人类决定 2026-09-26「高把握自动、低把握弹卡」+ 第 8 轮第三次评审：改口被评判 / 问句 / 话题", () => {
  const nothing = (o: string, n: string) => {
    expect(supersedeMatch(fresh(n), old(o))).toBeNull();
    expect(planSupersedes([fresh(n)], [old(o)])).toEqual({ supersedes: [], prompts: [] });
  };
  it.each([
    // 1. 新对象在谓语 / 否定标记处结束；改口后面跟着对它自己的否定评判 ⇒ 整个丢掉（任何一档都不取代、也不弹卡）
    ["决定用Vue", "改成用React是不可能的"],
    ["决定用Vue", "改成用React不现实"],
    ["决定用Vue", "改成用React没必要"],
    ["决定用Vue", "改成用React的提议被否了"],
    ["决定用Vue框架", "改成用React框架是不可能的"],
    ["决定关注211高校", "改成关注985高校不现实"],
    ["决定关注211高校", "改成关注985高校的方案被否了"],
    ["决定用Vue", "改成用React，我觉得不行"],
    ["决定用Vue", "改成用React，不现实"],
    ["决定用Vue", "改用React，算了"],
    // 2. 问号在句中任何位置
    ["决定用Vue", "改成用React？不行，还是用Vue"],
    ["决定关注211高校", "改成关注985高校？再想想"],
    ["决定用Vue", "改用React?先不定"],
    // 3. 话题分句带主语：主语不在旧决定里 ⇒ 不是同一件事
    ["决定用Vue", "关于周会，改成用腾讯会议"],
    ["决定用Vitest", "单元测试那块，改成用Jest跑测试"],
    ["决定关注985", "周报，改成关注招聘进度"],
    ["决定用Vue", "有人提议，改成用React，我觉得不行"],
    ["决定用Vue", "有人提议，改成用React"],
    ["决定用Vue", "关于周会，我想了想，改成用腾讯会议"],
  ])("既不取代也不弹卡：%s → %s", (o, n) => nothing(o, n));

  it.each([
    ["改成用React是不可能的"], ["改成用React不现实"], ["改成用React没必要"], ["改成用React的提议被否了"], ["改成用React？不行，还是用Vue"],
  ])("没有改口分句：%s", (n) => expect(changeClauses(n)).toEqual([]));

  it("话题分句的主语出现在旧决定里 ⇒ 照常判（「前端那块，改成用React框架」对「前端用Vue框架」）", () => {
    expect(changeClauses("前端那块，改成用React框架")).toEqual([
      { frame: { verb: "用", object: "react框架", kind: "框架" }, namedOld: null, subject: "前端" },
    ]);
    expect(supersedeMatch(fresh("前端那块，改成用React框架"), old("决定前端用Vue框架"))).toBe("same_kind");
    expect(supersedeMatch(fresh("关于前端，不再用Vue了"), old("决定前端用Vue"))).toBe("explicit");
    expect(supersedeMatch(fresh("关于后端，不再用Vue了"), old("决定前端用Vue"))).toBeNull();
  });
  it("带框架动词的前一分句是陈述、不是话题：「决定用React，不再用Vue了」仍点名 Vue", () => {
    expect(supersedeMatch(fresh("决定用React，不再用Vue了"), old("决定用Vue"))).toBe("explicit");
  });
  it("「改成用React不用Vue了」：对象截在「不」前，同一分句里的「不用Vue了」仍是点名", () => {
    expect(changeClauses("改成用React不用Vue了").map((c) => c.frame?.object ?? null)).toEqual(["react", null]);
  });
  it("好的 / 我想了想 这类空话不当主语", () => {
    expect(supersedeMatch(fresh("好的，改成关注985高校"), old("决定关注211高校"))).toBe("same_kind");
    expect(supersedeMatch(fresh("我想了想，改成关注985高校"), old("决定关注211高校"))).toBe("same_kind");
  });
});

describe("findSupersedes：一条新决定取代哪几条", () => {
  it("frame_only 的卡：同一句旧决定在会话和个人空间各有一条 → 一张卡，〈旧〉取本会话那条", () => {
    const live = [old("我决定关注 211 高校", { id: "b" }), old("我决定关注211高校", { id: "z", scope: "chat_session" })];
    expect(planSupersedes([fresh("改成关注 985 吧")], live)).toEqual({ supersedes: [], prompts: [{ newerClaimId: "clm-new", olderClaimId: "z" }] });
  });
  it("frame_only 但两条不同的旧决定都匹配 → 不弹卡", () => {
    const live = [old("我决定关注 211 高校", { id: "a" }), old("我决定关注双一流", { id: "b" })];
    expect(planSupersedes([fresh("改成关注 985 吧")], live)).toEqual({ supersedes: [], prompts: [] });
  });
  it("唯一的一条旧决定 → 取代它", () => {
    expect(findSupersedes([fresh("改成关注 985 高校")], [OLD_211])).toEqual([{ newerClaimId: "clm-new", olderClaimId: "clm-old" }]);
  });
  it("同一句旧决定在会话和个人空间各有一条 → 两条一起取代", () => {
    const live = [old("我决定关注 211 高校", { id: "a", scope: "chat_session" }), old("我决定关注211高校", { id: "b" })];
    expect(findSupersedes([fresh("改成关注 985 高校")], live).map((p) => p.olderClaimId)).toEqual(["a", "b"]);
  });
  it("两条不同的旧决定都同样匹配 → 说不清改的是哪条，一条都不取代", () => {
    const live = [old("我决定关注 211 高校", { id: "a" }), old("我决定关注双一流高校", { id: "b" })];
    expect(findSupersedes([fresh("改成关注 985 高校")], live)).toEqual([]);
  });
  it("明说的那一档优先：「不再关注 211 高校」只取代 211 那条", () => {
    const live = [old("我决定关注 211 高校", { id: "a" }), old("我决定关注双一流高校", { id: "b" })];
    expect(findSupersedes([fresh("不再关注 211 高校，改成 985")], live)).toEqual([{ newerClaimId: "clm-new", olderClaimId: "a" }]);
  });
  it("别人的旧决定、并列补充、无关的决定 → 空", () => {
    const live = [old("我决定关注 211 高校", { id: "a", authorId: OTHER }), old("我决定用周报模板 B", { id: "b" })];
    expect(findSupersedes([fresh("改成关注 985 高校")], live)).toEqual([]);
    expect(findSupersedes([fresh("也关注 985 高校")], [OLD_211])).toEqual([]);
  });
  it("确定可复现：输入顺序不影响结果", () => {
    const live = [old("我决定关注 211 高校", { id: "z", scope: "chat_session" }), old("我决定关注 211 高校", { id: "a" })];
    const f = [fresh("改成关注 985 高校")];
    expect(findSupersedes(f, live)).toEqual(findSupersedes(f, [...live].reverse()));
  });
});

describe("第 8 轮第四次评审：自动取代只给干净的整句（人类决定：误自动取代是唯一不许出现的结果，多一张卡很便宜）", () => {
  const plan = (o: string, n: string) => planSupersedes([fresh(n)], [old(o)]);
  const CARD = { supersedes: [], prompts: [{ newerClaimId: "clm-new", olderClaimId: "clm-old" }] };
  const NONE = { supersedes: [], prompts: [] };
  const AUTO = { supersedes: [{ newerClaimId: "clm-new", olderClaimId: "clm-old" }], prompts: [] };

  it.each([
    // 1. 另起一个分句的否决（明确的评判 ⇒ 不弹卡）
    ["关注211高校", "改成关注985高校，我反对"],
    ["关注211高校", "改成关注985高校，不可行"],
    ["关注211高校", "改成关注985高校，我不赞成"],
    ["关注211高校", "改成关注985高校，老板没同意"],
    ["关注211高校", "改成关注985高校，不太合适"],
    ["关注211高校", "改成关注985高校，没意义"],
    ["用Vue", "把Vue换成React，不可行"],
    // 2. 自我更正回到旧选择
    ["关注211高校", "改成关注985高校，不对，还是关注211高校"],
    ["关注211高校", "改成关注985高校，哦不，还是211高校吧"],
    // D. 「…的事」是被谈论的话题；开玩笑 / 说着玩 收回整句
    ["用Vue", "把Vue换成React的事下周再讨论"],
    ["关注211高校", "改成关注985高校，开玩笑的"],
    ["用Vue", "不用Vue了，说着玩的"],
  ])("收回 ⇒ 不自动、不弹卡：%s → %s", (o, n) => {
    expect(supersedeMatch(fresh(n), old(o))).toBeNull();
    expect(plan(o, n)).toEqual(NONE);
  });

  it.each([
    // 1. 认不出的后续分句（否决，但不在评判表里）⇒ 说不准 ⇒ 弹卡
    ["关注211高校", "改成关注985高校，被老板否决了"],
    ["关注211高校", "改成关注985高校，还不如维持现状"],
    ["关注211高校", "改成关注985高校，领导不批"],
    ["用Vue", "不用Vue了，这个方案被否了"],
    // 3. 转述
    ["关注211高校", "改成关注985高校，这是老板说的"],
    ["用Vue", "不用Vue了，这是他的意见"],
    // 4. 共同的类别词前面不是短限定语（跨了范围）⇒ 不算 same_kind
    ["用React做前端开发", "改成用Rust做后端开发"],
    ["用Python写数据脚本", "改用Go写部署脚本"],
    ["用飞书沟通内部事务", "改成用邮件沟通外部事务"],
    // 5. 明说两条都留
    ["关注211高校", "改成关注985高校，211高校继续关注"],
    // 其余分句说不准（原因里提旧对象、条件、暂定）
    ["关注211高校", "改成关注985高校，因为211高校太远"],
    ["关注211高校", "改成关注985高校，暂定"],
    ["关注211高校", "改成关注985高校，不过要看预算"],
    ["用Vue", "Vue算了，换成React，领导定的"],
  ])("说不准 ⇒ 只弹卡、不自动：%s → %s", (o, n) => {
    expect(supersedeMatch(fresh(n), old(o))).toBe("frame_only");
    expect(plan(o, n)).toEqual(CARD);
  });

  it.each([
    ["关注211高校", "改成关注985高校吧", "same_kind"],
    ["用Vue", "把Vue换成React", "explicit"],
    ["用Vue", "不再用Vue了", "explicit"],
    ["关注211高校", "211高校算了，改成关注985高校", "explicit"],
    ["关注211高校", "改成关注985高校，因为离家近", "same_kind"],
    ["用Vue", "把Vue换成React，毕竟生态好", "explicit"],
    ["关注211高校", "改成关注985高校，好的", "same_kind"],
    ["关注211高校", "就改成关注985高校吧，定了", "same_kind"],
    ["采用Vue框架", "改为采用React框架，那就这样", "same_kind"],
    ["用Vue", "不用Vue了，改用React", "explicit"],
    ["关注北京高校", "改成关注上海高校", "same_kind"],
    ["关注211高校", "改成关注C9高校", "same_kind"],
  ])("干净的整句 ⇒ 自动：%s → %s（%s）", (o, n, tier) => {
    expect(supersedeMatch(fresh(n), old(o))).toBe(tier);
    expect(plan(o, n)).toEqual(AUTO);
  });

  it("「后端改用Rust」对「后端用Go」：两边都没有类别词 ⇒ 弹卡（一直如此，不是这一轮挪下来的）", () => {
    expect(plan("后端用Go", "后端改用Rust")).toEqual(CARD);
  });
  it("「改成关注 985 吧」仍是卡", () => expect(plan("关注211高校", "改成关注 985 吧")).toEqual(CARD));
});
