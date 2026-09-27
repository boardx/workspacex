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

describe("citationCorrectionRate", () => {
  it("没有被引用过 ⇒ null；否则 纠正 / 引用（4 位小数）", () => {
    expect(citationCorrectionRate(0, 0)).toBeNull();
    expect(citationCorrectionRate(3, 7)).toBe(0.4286);
    expect(citationCorrectionRate(0, 5)).toBe(0);
  });
});
