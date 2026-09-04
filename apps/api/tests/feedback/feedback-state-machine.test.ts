/**
 * FB-2 —— 状态机与可见性的**纯判定**（`domain/feedback/product-feedback.ts`）。
 *
 * ⚠ 这个文件**只验判定**，不验落库。落库那一半（CHECK 约束 / RLS / 只有两列可改）
 *   由 `product-feedback-persistence.test.ts` 在真库上验。两者不重复：
 *   这里保证「用例会回一个具名的、能显示给人看的错误」，那里保证
 *   「并发/直连 SQL/以后新写的路径」也守同一条规则。
 */
import { describe, expect, it } from "vitest";
import {
  allowedTransitionsFrom,
  canReadDetail,
  canTriage,
  triage,
  type FeedbackStatus,
} from "../../src/domain/feedback/product-feedback";

const ALL: readonly FeedbackStatus[] = ["待处理", "已进入迭代", "已修复", "不做", "已归档"];

describe("FB-2 分诊状态机", () => {
  it("转「不做」没写理由 ⇒ 被拒，且错误码是具名的", () => {
    expect(triage({ current: "待处理", next: "不做", reason: null })).toEqual({
      kind: "rejected",
      code: "TRIAGE_REASON_REQUIRED",
    });
  });

  it("只有空白的理由等同于没写 —— 空格串不是理由", () => {
    expect(triage({ current: "待处理", next: "不做", reason: "   " })).toEqual({
      kind: "rejected",
      code: "TRIAGE_REASON_REQUIRED",
    });
  });

  it("理由的必填判定发生在转移合法性之前 —— 同一请求恒得到同一个错误码", () => {
    // 「已修复 → 不做」既非法、又没写理由。两个毛病先报哪个都对，但必须每次都一样，
    // 否则调用方按错误码分支的逻辑会随版本漂移。
    expect(triage({ current: "已修复", next: "不做", reason: null })).toEqual({
      kind: "rejected",
      code: "TRIAGE_REASON_REQUIRED",
    });
  });

  it("目标状态 = 当前状态 ⇒ unchanged（幂等重放不写第二条流水）", () => {
    expect(triage({ current: "已进入迭代", next: "已进入迭代", reason: null })).toEqual({
      kind: "unchanged",
      at: "已进入迭代",
    });
  });

  it("「已修复 → 不做」不是一条边 —— 要改判必须先退回待处理，留下两条痕迹", () => {
    const out = triage({ current: "已修复", next: "不做", reason: "重复反馈" });
    expect(out).toEqual({ kind: "rejected", code: "ILLEGAL_TRANSITION", from: "已修复", to: "不做" });
  });

  it("每个终态都能回「待处理」—— 否则改判的唯一表达方式是再提一条新反馈", () => {
    for (const from of ["已修复", "不做"] as const) {
      expect(triage({ current: from, next: "待处理", reason: null })).toMatchObject({
        kind: "changed",
        to: "待处理",
      });
    }
  });

  it("理由两端的空白被裁掉；裁完为空的理由变成 null 而不是空字符串", () => {
    const out = triage({ current: "待处理", next: "已进入迭代", reason: "  排期到下周  " });
    expect(out).toEqual({ kind: "changed", from: "待处理", to: "已进入迭代", reason: "排期到下周" });
  });

  it("反证：状态机不是「什么都允许」—— 至少存在一条被拒的边", () => {
    // 一张全通的转移表会让上面每一条断言都平凡通过。这里显式钉死它不是全通的。
    const rejected = ALL.flatMap((from) =>
      ALL.filter((to) => to !== from && !allowedTransitionsFrom(from).includes(to)),
    );
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("`allowedTransitionsFrom` 返回副本 —— 改它改不动状态机", () => {
    const edges = allowedTransitionsFrom("待处理") as FeedbackStatus[];
    edges.push("已修复");
    expect(allowedTransitionsFrom("待处理")).not.toContain("已修复");
  });
});

describe("FB-2 已归档（issue #2681）", () => {
  it("「已修复 → 已归档」合法", () => {
    expect(triage({ current: "已修复", next: "已归档", reason: null })).toEqual({
      kind: "changed", from: "已修复", to: "已归档", reason: null,
    });
  });

  it("「不做 → 已归档」合法", () => {
    expect(triage({ current: "不做", next: "已归档", reason: null })).toEqual({
      kind: "changed", from: "不做", to: "已归档", reason: null,
    });
  });

  it("「已归档 → 待处理」合法 —— 归错了或问题又被提起，能拉回收件箱", () => {
    expect(triage({ current: "已归档", next: "待处理", reason: null })).toEqual({
      kind: "changed", from: "已归档", to: "待处理", reason: null,
    });
  });

  it("「待处理 → 已归档」非法 —— 还没有结论，谈不上收起来", () => {
    expect(triage({ current: "待处理", next: "已归档", reason: null })).toEqual({
      kind: "rejected", code: "ILLEGAL_TRANSITION", from: "待处理", to: "已归档",
    });
  });

  it("「已进入迭代 → 已归档」非法 —— 同上，必须先走到 已修复/不做 这两个终态", () => {
    expect(triage({ current: "已进入迭代", next: "已归档", reason: null })).toEqual({
      kind: "rejected", code: "ILLEGAL_TRANSITION", from: "已进入迭代", to: "已归档",
    });
  });
});

describe("FB-2 正文可见性（D3）", () => {
  it("管理员看得到别人的正文", () => {
    expect(canReadDetail({ viewerId: "u-admin", viewerOrgRole: "admin", submittedBy: "u-other" })).toBe(true);
  });

  it("提交人看得到自己的正文（哪怕不是管理员）", () => {
    expect(canReadDetail({ viewerId: "u-me", viewerOrgRole: "consultant", submittedBy: "u-me" })).toBe(true);
  });

  it("既不是管理员也不是提交人 ⇒ 看不到 —— 这是 D3 唯一会漏的那一格", () => {
    expect(canReadDetail({ viewerId: "u-me", viewerOrgRole: "consultant", submittedBy: "u-other" })).toBe(false);
  });
});

describe("FB-2 分诊权限", () => {
  it("只有组织管理员能分诊", () => {
    expect(canTriage("admin")).toBe(true);
    expect(canTriage("consultant")).toBe(false);
    // null = 不是本组织成员。⚠ 这一格必须显式验：`canTriage(null)` 若为 true，
    //   组织外的人就能分诊，而 controller 那层传的正是可能为 null 的 orgRole。
    expect(canTriage(null)).toBe(false);
  });
});
