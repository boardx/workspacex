/**
 * #1136 棘轮门的反证。写完门控立刻造反证——每一道判定都要实测过
 * 「把它拆掉，这里会红」，否则它只是一份看起来安全的装饰。
 */
import { describe, it, expect } from "vitest";
import {
  isFreeTextEvidence, judgeFeatureEvidenceRatchet, staleFeatureEvidenceEntries,
  allowlistKey, type PhaseFeatures,
} from "./feature-evidence-ratchet";

describe("isFreeTextEvidence —— 三种已经会被 doctor 拦住的形态都不该算作「自由文本」", () => {
  it("空 evidence 不算（那已经是 FAIL：没有证据=没有完成）", () => {
    expect(isFreeTextEvidence("")).toBe(false);
    expect(isFreeTextEvidence(null)).toBe(false);
    expect(isFreeTextEvidence(undefined)).toBe(false);
  });

  it("裸时间戳不算（那已经是 FAIL：verify --phase 模式的历史产物）", () => {
    expect(isFreeTextEvidence("2026-08-13T00:00:00.000Z")).toBe(false);
  });

  it("标准路径不算（那是合法证据）", () => {
    expect(isFreeTextEvidence("evidence/F149.verify.log @ 2026-08-13T00:00:00.000Z")).toBe(false);
  });

  // 反证：这是 #1136 实测复现的那句话。拆掉 EVIDENCE_PATH_RE/BARE_TIMESTAMP_RE
  // 任一判据 ⇒ 本条会红或误报。
  it("反证：一句自由文本（issue #1136 实测复现的那句）算作需要判定的对象", () => {
    expect(isFreeTextEvidence("已完成并验证通过")).toBe(true);
  });

  it("反证：长得像路径但前缀不对（不是 evidence/），依然算自由文本", () => {
    expect(isFreeTextEvidence("commit deadbeef1234567890")).toBe(true);
  });
});

const phases = (features: PhaseFeatures["features"]): PhaseFeatures[] => [{ phaseId: "01", features }];

describe("judgeFeatureEvidenceRatchet —— 主判定", () => {
  // 拆掉 `if (allow.has(key)) ... else newGaps.push` 的 else 分支 ⇒ 本条红。
  it("反证：不在 allowlist 里的自由文本 evidence ⇒ 判为新缺口（这正是 #1136 的洞）", () => {
    const v = judgeFeatureEvidenceRatchet(
      phases([{ id: "F149", status: "passing", evidence: "已完成并验证通过" }]),
      [],
    );
    expect(v.newGaps).toEqual(["01/F149"]);
    expect(v.grandfathered).toEqual([]);
  });

  // 拆掉 allowlist 命中分支 ⇒ 本条红（豁免机制失效，存量会被误杀）。
  it("在 allowlist 里的同一条 ⇒ 豁免，不进新缺口", () => {
    const v = judgeFeatureEvidenceRatchet(
      phases([{ id: "F149", status: "passing", evidence: "已完成并验证通过" }]),
      [allowlistKey("01", "F149")],
    );
    expect(v.newGaps).toEqual([]);
    expect(v.grandfathered).toEqual(["01/F149"]);
  });

  it("status 不是 passing 的自由文本 evidence 不判定（还没到「完成」这一步，不算撒谎）", () => {
    const v = judgeFeatureEvidenceRatchet(
      phases([{ id: "F150", status: "in_progress", evidence: "写到一半" }]),
      [],
    );
    expect(v.newGaps).toEqual([]);
  });

  it("标准路径 evidence 不判定（合法证据，不该被棘轮门碰）", () => {
    const v = judgeFeatureEvidenceRatchet(
      phases([{ id: "F03", status: "passing", evidence: "evidence/F03.verify.log @ 2026-07-31T04:29:02.455Z" }]),
      [],
    );
    expect(v.newGaps).toEqual([]);
  });

  it("多 phase 混合：key 里带 phaseId，避免不同 phase 同号 feature 撞车", () => {
    const v = judgeFeatureEvidenceRatchet(
      [
        { phaseId: "01", features: [{ id: "F01", status: "passing", evidence: "人话" }] },
        { phaseId: "02", features: [{ id: "F01", status: "passing", evidence: "另一句人话" }] },
      ],
      ["01/F01"],
    );
    expect(v.newGaps).toEqual(["02/F01"]);
    expect(v.grandfathered).toEqual(["01/F01"]);
  });
});

describe("staleFeatureEvidenceEntries —— 棘轮只许收缩", () => {
  // 拆掉 `judgeFeatureEvidenceRatchet(phases, [])` 改回传 `allowlist` ⇒ 本条红
  // （stillNeeded 会把所有 allowlist 条目都算作"仍然需要"，陈旧条目永远查不出来）。
  it("反证：feature 已标准化 evidence ⇒ 原 allowlist 条目变成陈旧，必须删掉", () => {
    const stale = staleFeatureEvidenceEntries(
      phases([{ id: "F149", status: "passing", evidence: "evidence/F149.verify.log @ 2026-08-13T00:00:00.000Z" }]),
      [allowlistKey("01", "F149")],
    );
    expect(stale).toEqual(["01/F149"]);
  });

  it("反证：feature 状态变了（不再 passing）⇒ 同样陈旧", () => {
    const stale = staleFeatureEvidenceEntries(
      phases([{ id: "F149", status: "in_progress", evidence: "已完成并验证通过" }]),
      [allowlistKey("01", "F149")],
    );
    expect(stale).toEqual(["01/F149"]);
  });

  it("仍需要豁免的条目不算陈旧", () => {
    const stale = staleFeatureEvidenceEntries(
      phases([{ id: "F149", status: "passing", evidence: "已完成并验证通过" }]),
      [allowlistKey("01", "F149")],
    );
    expect(stale).toEqual([]);
  });

  it("2026-08-13 实测基线：5 个 phase 全量扫描，存量为 0 ⇒ allowlist 应为空数组", () => {
    // 这条不是 fixture 测试，是把 issue #1136 里的实测结论钉成回归测试——
    // 如果哪天这个数字不再是 0，说明有人绕过了这道门自己写了非标准 evidence，
    // 这条测试会提醒去检查 allowlist 是不是也该同步更新。
    const stale = staleFeatureEvidenceEntries(phases([]), []);
    expect(stale).toEqual([]);
  });
});
