/**
 * Issue #4363（S6）—— 时间维度的纯函数：时间说法 → 区间（claim-time.ts）、抽取产物带上有效期 / 截止（extraction.ts）、
 * 召回排除过期与「不做了」的待办、同一主题新的优先（recall.ts）、链式取代历史（supersede-chain.ts）。
 */
import { describe, expect, it } from "vitest";
import { claimExpired, resolveTimeExpression } from "../../src/domain/knowledge-graph/claim-time";
import { buildExtractionBatch, parseExtraction } from "../../src/domain/knowledge-graph/extraction";
import { validateOntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { buildKnowledgeContextMessage, fuseRecall, type RecallClaim } from "../../src/domain/knowledge-graph/recall";
import { chainReplaced } from "../../src/domain/knowledge-graph/supersede-chain";

// 2026-09-24（周四）15:00 北京时间 = 07:00Z
const AT = new Date("2026-09-24T07:00:00.000Z");
const bj = (isoLocal: string) => new Date(`${isoLocal}+08:00`).toISOString();

describe("resolveTimeExpression：时间说法按说话时刻换算（北京时间，左闭右开）", () => {
  it.each([
    ["这周", bj("2026-09-28T00:00:00")],
    ["本周", bj("2026-09-28T00:00:00")],
    ["这个星期", bj("2026-09-28T00:00:00")],
    ["今天", bj("2026-09-25T00:00:00")],
    ["到年底", bj("2027-01-01T00:00:00")],
    ["年底前", bj("2027-01-01T00:00:00")],
    ["今年", bj("2027-01-01T00:00:00")],
    ["下个月之前", bj("2026-10-01T00:00:00")],
    ["这个月", bj("2026-10-01T00:00:00")],
    ["月底", bj("2026-10-01T00:00:00")],
    ["10月底", bj("2026-11-01T00:00:00")],
    ["十月十五日之前", bj("2026-10-15T00:00:00")],
    ["10 月 15 号", bj("2026-10-16T00:00:00")],
    ["3月底", bj("2027-04-01T00:00:00")], // 已经过去的月份 ⇒ 明年
  ])("%s ⇒ 到 %s 为止", (expr, until) => {
    expect(resolveTimeExpression(expr, AT)).toEqual({ from: AT.toISOString(), until });
  });

  it("「下周」「下个月」「明年」是一段将来的区间：从那一段开始", () => {
    expect(resolveTimeExpression("下周", AT)).toEqual({ from: bj("2026-09-28T00:00:00"), until: bj("2026-10-05T00:00:00") });
    expect(resolveTimeExpression("下个月", AT)).toEqual({ from: bj("2026-10-01T00:00:00"), until: bj("2026-11-01T00:00:00") });
    expect(resolveTimeExpression("明年", AT)).toEqual({ from: bj("2027-01-01T00:00:00"), until: bj("2028-01-01T00:00:00") });
  });

  it("周日晚上说「这周」：只到当晚为止（按北京时间切日历，不按 UTC）", () => {
    const sundayNight = new Date(bj("2026-09-27T22:00:00"));
    expect(resolveTimeExpression("这周", sundayNight)?.until).toBe(bj("2026-09-28T00:00:00"));
  });

  it.each(["", "以后", "有空的时候", "尽快", "目前", "13月底", "2 月 40 日"])("认不出「%s」⇒ null（长期有效，不猜）", (expr) => {
    expect(resolveTimeExpression(expr, AT)).toBeNull();
  });

  it("claimExpired：到了终点那一刻就过期；没有有效期永不过期", () => {
    const until = bj("2026-09-28T00:00:00");
    expect(claimExpired(until, new Date(Date.parse(until) - 1))).toBe(false);
    expect(claimExpired(until, new Date(until))).toBe(true);
    expect(claimExpired(null, new Date("2100-01-01"))).toBe(false);
    expect(claimExpired(undefined, new Date("2100-01-01"))).toBe(false);
  });
});

describe("抽取：timeExpr ⇒ 有效期（待办 ⇒ 截止日期）", () => {
  let n = 0;
  const newId = (p: string) => `${p}-${(n += 1)}`;
  const raw = (claims: unknown[]) => parseExtraction({ entities: [], claims });

  it("解析 timeExpr；空串 / 过长 / 缺省 ⇒ null", () => {
    const r = raw([
      { statement: "这周我在上海出差", kind: "fact", confidence: 0.9, about: [], quote: "这周我在上海出差", timeExpr: "这周" },
      { statement: "a", kind: "fact", timeExpr: "" },
      { statement: "b", kind: "fact", timeExpr: "x".repeat(41) },
      { statement: "c", kind: "fact" },
    ]);
    expect(r.claims.map((c) => c.timeExpr)).toEqual(["这周", null, null, null]);
  });

  it("事实 / 决定：valid_from = 说话时刻，valid_until = 那一段的终点；待办：due_at，不设有效期；认不出 / 没有消息时间 ⇒ 不带", () => {
    const result = raw([
      { statement: "这周我在上海出差", kind: "fact", timeExpr: "这周" },
      { statement: "到年底前先关注 211 高校", kind: "decision", timeExpr: "到年底" },
      { statement: "下个月之前交报告", kind: "todo", timeExpr: "下个月之前" },
      { statement: "有空再看", kind: "todo", timeExpr: "有空的时候" },
    ]);
    const batch = buildExtractionBatch({ threadId: "t", messageId: "m", messageBody: "…", messageAt: AT.toISOString(), result, known: [], newId });
    expect(batch!.claims.map((c) => ({ s: c.statement, from: c.validFrom, until: c.validUntil, due: c.dueAt }))).toEqual([
      { s: "这周我在上海出差", from: AT.toISOString(), until: bj("2026-09-28T00:00:00"), due: undefined },
      { s: "到年底前先关注 211 高校", from: AT.toISOString(), until: bj("2027-01-01T00:00:00"), due: undefined },
      { s: "下个月之前交报告", from: undefined, until: undefined, due: bj("2026-10-01T00:00:00") },
      { s: "有空再看", from: undefined, until: undefined, due: undefined },
    ]);
    expect(validateOntologyBatch(batch!, null)).toEqual({ ok: true });
    const noTime = buildExtractionBatch({ threadId: "t", messageId: "m", messageBody: "…", result, known: [], newId });
    expect(noTime!.claims.every((c) => c.validUntil === undefined && c.dueAt === undefined)).toBe(true);
  });

  it("执行器校验：起止颠倒 / 解析不了的时间 ⇒ KG_INVALID_BATCH", () => {
    const batch = buildExtractionBatch({
      threadId: "t", messageId: "m", messageBody: "x", messageAt: AT.toISOString(),
      result: raw([{ statement: "x", kind: "fact", timeExpr: "这周" }]), known: [], newId,
    })!;
    const flip = { ...batch, claims: [{ ...batch.claims[0]!, validFrom: bj("2026-10-01T00:00:00"), validUntil: bj("2026-09-28T00:00:00") }] };
    expect(validateOntologyBatch(flip, null)).toMatchObject({ ok: false, code: "KG_INVALID_BATCH" });
    const junk = { ...batch, claims: [{ ...batch.claims[0]!, dueAt: "not a date" }] };
    expect(validateOntologyBatch(junk, null)).toMatchObject({ ok: false, code: "KG_INVALID_BATCH" });
  });
});

describe("召回：过期不召回、「不做了」不召回、同一主题新的优先（S9 融合不变）", () => {
  const claim = (id: string, statement: string, over: Partial<RecallClaim> = {}): RecallClaim =>
    ({ id, statement, kind: "fact", triState: "pending", saidAt: null, scope: "chat_session", ...over });
  const NOW = new Date(bj("2026-10-02T09:00:00"));

  it("过期的不进打分，也不进决定 / 目标的强制召回；没过期的照常", () => {
    const r = fuseRecall({
      query: "我这周在哪里出差",
      claims: [
        claim("expired", "这周我在上海出差", { validUntil: bj("2026-09-28T00:00:00") }),
        claim("live", "这周我在北京出差", { validUntil: bj("2026-10-05T00:00:00") }),
        claim("forever", "我常驻杭州"),
        claim("dec-old", "这周先关注 211 高校", { kind: "decision", validUntil: bj("2026-09-28T00:00:00") }),
        claim("goal-old", "我的目标是这个月跑完半马", { kind: "goal", validUntil: bj("2026-10-01T00:00:00") }),
      ],
      objects: [], graph: [], limit: 8, now: NOW,
    });
    const ids = r.items.map((i) => i.claim.id);
    expect(ids).toContain("live");
    expect(ids).not.toContain("expired");
    expect(ids).not.toContain("dec-old");
    expect(ids).not.toContain("goal-old");
  });

  it("待办：「不做了」不召回；「做完了」照常召回，给模型的材料里标明已完成", () => {
    const r = fuseRecall({
      query: "交周报",
      claims: [
        claim("dropped", "周五前交周报", { kind: "todo", todoStatus: "dropped" }),
        claim("done", "周四交周报初稿", { kind: "todo", todoStatus: "done" }),
        claim("open", "下周一交周报终稿", { kind: "todo", todoStatus: "open" }),
      ],
      objects: [], graph: [], limit: 8, now: NOW,
    });
    expect(r.items.map((i) => i.claim.id).sort()).toEqual(["done", "open"]);
    const msg = buildKnowledgeContextMessage(r)!;
    expect(msg).toContain("周四交周报初稿（待办·已完成）");
    expect(msg).not.toContain("下周一交周报终稿（待办·已完成）");
  });

  it("同一主题（字面分与融合名次都相同）⇒ 新说的排前面，哪怕旧的已确认", () => {
    const r = fuseRecall({
      query: "报告的截止",
      claims: [
        claim("old", "报告的截止是周五", { saidAt: bj("2026-09-20T10:00:00"), triState: "confirmed" }),
        claim("new", "报告的截止是周三", { saidAt: bj("2026-09-30T10:00:00") }),
      ],
      objects: [], graph: [], limit: 8, now: NOW,
    });
    expect(r.items.map((i) => i.claim.id)).toEqual(["new", "old"]);
  });

  it("贴切度不同的不受新旧影响（S9：直接命中之间先比贴切度）", () => {
    const r = fuseRecall({
      query: "报告的截止日期",
      claims: [
        claim("relevant-old", "报告的截止日期是周五", { saidAt: bj("2026-09-20T10:00:00") }),
        claim("vague-new", "报告再改改", { saidAt: bj("2026-09-30T10:00:00") }),
      ],
      objects: [], graph: [], limit: 8, now: NOW, minLexical: 0.05,
    });
    expect(r.items[0]!.claim.id).toBe("relevant-old");
  });
});

describe("链式取代历史：211 → 985 → 清华", () => {
  const live = new Map([["p-qh", "改成关注清华"]]);
  const links = [
    { oldClaimId: "p-211", oldStatement: "我决定关注 211 高校", successorId: "p-985", undo: null },
    { oldClaimId: "p-985", oldStatement: "改成关注 985 高校", successorId: "p-qh", undo: { threadId: "t3", noticeId: "n2" } },
  ];

  it("两环都挂在链尾的活记忆下，从新到旧；只有直接那一环能撤销；更早的一环说清是被谁取代的", () => {
    expect(chainReplaced(links, live)).toEqual([
      { byClaimId: "p-qh", replaces: { claimId: "p-985", statement: "改成关注 985 高校" }, undo: { threadId: "t3", noticeId: "n2" } },
      {
        byClaimId: "p-qh", replaces: { claimId: "p-211", statement: "我决定关注 211 高校" }, undo: null,
        step: 2, replacedBy: { claimId: "p-985", statement: "改成关注 985 高校" },
      },
    ]);
  });

  it("中间那一环的撤销入口（若读口给了）在更深的位置一律不给", () => {
    const withUndo = [{ ...links[0]!, undo: { threadId: "t2", noticeId: "n1" } }, links[1]!];
    expect(chainReplaced(withUndo, live).find((r) => r.replaces.claimId === "p-211")!.undo).toBeNull();
  });

  it("撤销了后一环（985 又活了）⇒ 211 回到 985 下面、step 1、带撤销", () => {
    expect(chainReplaced([{ ...links[0]!, undo: { threadId: "t2", noticeId: "n1" } }], new Map([["p-985", "改成关注 985 高校"], ["p-211x", "x"]])))
      .toEqual([{ byClaimId: "p-985", replaces: { claimId: "p-211", statement: "我决定关注 211 高校" }, undo: { threadId: "t2", noticeId: "n1" } }]);
  });

  it("链断了（中间那条被忘掉，不在活记忆也不在取代记录里）/ 成环 ⇒ 不显示", () => {
    expect(chainReplaced([links[0]!], live)).toEqual([]);
    const loop = [
      { oldClaimId: "a", oldStatement: "a", successorId: "b", undo: null },
      { oldClaimId: "b", oldStatement: "b", successorId: "a", undo: null },
    ];
    expect(chainReplaced(loop, live)).toEqual([]);
  });
});
