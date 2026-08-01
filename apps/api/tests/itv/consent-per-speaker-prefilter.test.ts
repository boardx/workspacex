/**
 * F93 -- O-05's per-speaker Context Pack front-filter, as a pure decision
 * (`domain/context-pack/consent-prefilter.ts`), no database involved (issue #74: pure tests run
 * locally, Postgres-dependent tests are typecheck-only).
 *
 * The property under test is not "declined subjects are excluded" alone -- a function that
 * excludes everything attributable to ANY subject would pass that one-sided version and be
 * useless. Each block below has its counter-proof.
 */
import { describe, expect, it } from "vitest";
import {
  applyConsentPrefilter,
  type ConsentGatedCandidate,
} from "../../src/domain/context-pack/consent-prefilter";

interface Candidate extends ConsentGatedCandidate {
  readonly content: string;
}

const cand = (segmentId: string, speakerSubjectId: string | null, content = "x"): Candidate => ({
  segmentId,
  speakerSubjectId,
  content,
});

describe("F93 / O-05 -- 同意位 per-speaker Context Pack 前置过滤", () => {
  it("一个受访者的片段被拒绝 AI 分析：其 segment 进 excluded，不进 eligible", () => {
    const declined = cand("s-declined", "subj-1", "P-11 的原话");
    const out = applyConsentPrefilter([declined], new Set(["subj-1"]));

    expect(out.eligible).toEqual([]);
    expect(out.excluded).toEqual([declined]);
    expect(out.excludedSubjectIds).toEqual(["subj-1"]);
    // 内容仍然存在于 excluded 里（供人工原文引述），不是被删除 -- 只是不进 eligible。
    expect(out.excluded[0]!.content).toBe("P-11 的原话");
  });

  it("反证：同一位受访者一旦不在 declined 名单里，其片段立刻回到 eligible -- 证明这是前置过滤而非出口遮盖", () => {
    const segment = cand("s-1", "subj-1");
    const stillDeclined = applyConsentPrefilter([segment], new Set(["subj-1"]));
    expect(stillDeclined.eligible).toEqual([]);

    // 同一个函数、同一条候选，唯一变化的是调用方传入的「当前同意位」这份事实 -- 不存在第二条
    // 「解锁」代码路径需要和过滤器保持同步。
    const nowAuthorized = applyConsentPrefilter([segment], new Set());
    expect(nowAuthorized.eligible).toEqual([segment]);
    expect(nowAuthorized.excluded).toEqual([]);
  });

  it("反证（更贴近真实场景）：declined 名单非空，但换了另一位受访者 -- 未涉案的这位必须放行", () => {
    const other = cand("s-other", "subj-2");
    const out = applyConsentPrefilter([other], new Set(["subj-1"]));
    // 一个「凡是有 speakerSubjectId 就排除」的实现会让这条测试落空 -- 这正是要防的那种实现。
    expect(out.eligible).toEqual([other]);
    expect(out.excluded).toEqual([]);
  });

  it("speakerSubjectId 为 null（不可归属受访者的普通材料）永远放行，即使 declined 名单非空", () => {
    const fileSegment = cand("s-file", null);
    const out = applyConsentPrefilter([fileSegment], new Set(["subj-1", "subj-2"]));
    expect(out.eligible).toEqual([fileSegment]);
    expect(out.excludedSubjectIds).toEqual([]);
  });

  it("混合批次：declined 与 authorized 受访者的片段分别落入 excluded / eligible，互不影响", () => {
    const a = cand("s-a", "subj-decline");
    const b = cand("s-b", "subj-ok");
    const c = cand("s-c", null);
    const out = applyConsentPrefilter([a, b, c], new Set(["subj-decline"]));

    expect(out.eligible.map((x) => x.segmentId).sort()).toEqual(["s-b", "s-c"]);
    expect(out.excluded.map((x) => x.segmentId)).toEqual(["s-a"]);
    expect(out.excludedSubjectIds).toEqual(["subj-decline"]);
  });

  it("留痕口径：excludedSubjectIds 记录的是「本次归纳排除了哪些受访者」的类别与去重名单，不是逐条 segment", () => {
    // 同一位受访者贡献了三段 -- 全部被排除，但受访者名单里只出现一次（不是「排除了 3 条」）。
    const segs = [cand("s-1", "subj-x"), cand("s-2", "subj-x"), cand("s-3", "subj-x")];
    const out = applyConsentPrefilter(segs, new Set(["subj-x"]));
    expect(out.excluded).toHaveLength(3);
    expect(out.excludedSubjectIds).toEqual(["subj-x"]);
  });

  it("declined 名单为空（全体受访者已授权 AI 分析）：全部候选原样放行，excluded 恒空", () => {
    const segs = [cand("s-1", "subj-1"), cand("s-2", null), cand("s-3", "subj-2")];
    const out = applyConsentPrefilter(segs, new Set());
    expect(out.eligible).toEqual(segs);
    expect(out.excluded).toEqual([]);
    expect(out.excludedSubjectIds).toEqual([]);
  });

  it("多位受访者同时被排除：excludedSubjectIds 去重且按字典序排列，与调用顺序无关", () => {
    const segs = [cand("s-1", "subj-b"), cand("s-2", "subj-a"), cand("s-3", "subj-b")];
    const out = applyConsentPrefilter(segs, new Set(["subj-a", "subj-b"]));
    expect(out.excludedSubjectIds).toEqual(["subj-a", "subj-b"]);
  });
});
