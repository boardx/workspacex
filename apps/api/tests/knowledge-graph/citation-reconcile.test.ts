/**
 * S7（#4364）—— 引用 chip 的对账判据（纯函数）：chip 恒为召回集合的子集，且只出回答真的用到的那几条。
 */
import { describe, expect, it } from "vitest";
import {
  answerUsesStatement, citationCorrectionRate, reconcileCitations,
} from "../../src/domain/knowledge-graph/citation";

const R = (claimId: string, statement: string) => ({ claimId, statement });

describe("reconcileCitations", () => {
  it("回答照抄 / 换个说法但关键词还在 ⇒ 用到了；按召回名次", () => {
    const recalled = [R("c1", "主库用 PostgreSQL，不用 MySQL"), R("c2", "我们决定周五发版")];
    const answer = "按你 9/20 的决定，周五发版；另外主库还是 PostgreSQL，不用 MySQL。";
    expect(reconcileCitations(answer, recalled)).toEqual(["c1", "c2"]);
  });

  it("模型提到一条没被召回的说法 ⇒ 不会出现（候选只有召回集合）", () => {
    const recalled = [R("c1", "客户 A 要求 v2 下周一上线")];
    const answer = "客户 A 要求 v2 下周一上线。另外客户 B 要求全部界面用中文（这条不在召回里）。";
    expect(reconcileCitations(answer, recalled)).toEqual(["c1"]);
    expect(reconcileCitations("客户 B 要求全部界面用中文", recalled)).toEqual([]);
  });

  it("召回了但回答没用到 ⇒ 不出；只沾一两个常见字的也不算", () => {
    const recalled = [R("c1", "用户偏好周末不打电话"), R("c2", "发票按月开具")];
    expect(reconcileCitations("好的，我们下周再聊这个用户的问题。", recalled)).toEqual([]);
  });

  it("结论太短切不出两个单元 ⇒ 要求整句出现", () => {
    expect(answerUsesStatement("我记得是 v2", "v2")).toBe(true);
    expect(answerUsesStatement("我记得是 v3", "v2")).toBe(false);
  });

  it("空回答 / 空召回 ⇒ 空；同一 id 只出一次", () => {
    expect(reconcileCitations("", [R("c1", "周五发版")])).toEqual([]);
    expect(reconcileCitations("周五发版", [])).toEqual([]);
    expect(reconcileCitations("周五发版的事", [R("c1", "周五发版"), R("c1", "周五发版")])).toEqual(["c1"]);
  });
});

describe("reconcileCitations：兄弟结论（review F3）——共享的部分分不出是哪条，要靠各自独有的单元", () => {
  it.each([
    ["日期", "发布日期是9月20日", "发布日期是10月1日", "好的，发布日期是9月20日。"],
    ["金额", "预算是50万", "预算是80万", "按你说的，预算是50万。"],
    ["名字", "负责人是张三", "负责人是李四", "负责人是张三，有事找他。"],
    ["否定", "决定用MySQL", "决定不用MySQL", "你之前决定用MySQL。"],
    ["否定（反过来）", "决定不用MySQL", "决定用MySQL", "你之前决定不用MySQL。"],
  ])("%s：两条都召回，回答只用了其中一条 ⇒ 只出那一条", (_k, used, sibling, answer) => {
    expect(reconcileCitations(answer, [R("sib", sibling), R("used", used)])).toEqual(["used"]);
  });

  it("两条都说到了 ⇒ 两条都出", () => {
    expect(reconcileCitations("原定发布日期是9月20日，后来改成发布日期是10月1日。",
      [R("a", "发布日期是9月20日"), R("b", "发布日期是10月1日")])).toEqual(["a", "b"]);
  });

  it("没有兄弟时同样挡住：数字对不上 / 被说反 ⇒ 不算用到", () => {
    expect(reconcileCitations("预算是80万。", [R("c", "预算是50万")])).toEqual([]);
    expect(reconcileCitations("你决定不用MySQL。", [R("c", "决定用MySQL")])).toEqual([]);
    expect(reconcileCitations("你决定用MySQL。", [R("c", "决定不用MySQL")])).toEqual([]);
  });

  it("单个汉字不算单元：「月」「日」「万」凑不出用到", () => {
    expect(reconcileCitations("这个月的日程已经排满，预计一万步。", [R("c", "月日万")])).toEqual([]);
  });
});

describe("citationCorrectionRate", () => {
  it("没有被引用过 ⇒ null；否则 纠正 / 引用（4 位小数）", () => {
    expect(citationCorrectionRate(0, 0)).toBeNull();
    expect(citationCorrectionRate(3, 7)).toBe(0.4286);
    expect(citationCorrectionRate(0, 5)).toBe(0);
  });
});
