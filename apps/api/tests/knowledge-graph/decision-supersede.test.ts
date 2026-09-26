/**
 * Issue #4290 —— 明确改口时新决定取代旧决定：领域纯函数（decision-supersede.ts）。
 * 明确改口 → 取代；并列补充 / 无改口信号 / 不同作者 → 不取代；拿不准（多条候选 / 类别不同 / 问句 / 假设）→ 不取代。
 */
import { describe, expect, it } from "vitest";
import {
  decisionFrame, findSupersedes, hasChangeSignal, supersedeMatch, type LiveDecision, type SupersedeFresh,
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
    "决定关注985，不用再讨论了",     // 「不用再…了」是「不需要」
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

describe("findSupersedes：一条新决定取代哪几条", () => {
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
