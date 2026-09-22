/**
 * #391 反向一致性门的反证。
 *
 * 写完门控立刻造反证——每一道判定都要实测过「把它拆掉，这里会红」，
 * 否则它只是一份看起来安全的装饰（同 #1136 `feature-evidence-ratchet.test.ts` 的纪律）。
 */
import { describe, it, expect } from "vitest";
import {
  judgeLegacyEvidenceRatchet, legacyKey, parseLegacyEvidence,
  type LegacyEvidenceList, type LegacyKey, type LegacyObservation,
} from "./evidence-legacy";

const TODAY = new Date("2026-09-21T00:00:00.000Z");

function list(
  entries: readonly { key: string; reason?: string; review_by?: string }[],
  baseline: readonly string[] = entries.map((e) => e.key),
): LegacyEvidenceList {
  return {
    gateLandedAt: "2026-07-29",
    baseline,
    entries: entries.map((e) => ({
      key: e.key,
      reason: e.reason ?? "旧版 verify 日志，缺指纹尾行",
      review_by: e.review_by ?? "2026-12-31",
    })),
  };
}

const seen = (pairs: readonly [LegacyKey, boolean][]): ReadonlyMap<LegacyKey, LegacyObservation> =>
  new Map(pairs.map(([k, stillMissingFingerprint]) => [k, { stillMissingFingerprint }]));

describe("parseLegacyEvidence —— 名单读不懂就抛，不静默降级", () => {
  it("接受完整形态", () => {
    const parsed = parseLegacyEvidence({
      _gate_landed_at: "2026-07-29",
      _baseline: ["00/F01"],
      grandfathered: [{ key: "00/F01", reason: "旧日志", review_by: "2026-12-31" }],
    });
    expect(parsed.baseline).toEqual(["00/F01"]);
    expect(parsed.entries).toEqual([{ key: "00/F01", reason: "旧日志", review_by: "2026-12-31" }]);
  });

  // 反证：这正是本 issue 修复前 evidence-legacy.json 的真实形态——一串裸 key，
  // 没有理由、没有期限。拆掉「必须是对象」那一句 ⇒ 本条红，无声长期化的口子又开回来。
  it("反证：#391 修复前的裸字符串条目被拒绝（没有理由也没有期限的豁免就是口头豁免）", () => {
    expect(() =>
      parseLegacyEvidence({
        _gate_landed_at: "2026-07-29",
        _baseline: ["00/F01"],
        grandfathered: ["00/F01", "00/F02"],
      }),
    ).toThrow(/必须是对象/);
  });

  // 反证：拆掉 _baseline 校验 ⇒ 本条红，「只减不增」就失去了参照系。
  it("反证：缺 _baseline 被拒绝（没有冻结快照就无法判定名单是否长大了）", () => {
    expect(() =>
      parseLegacyEvidence({ _gate_landed_at: "2026-07-29", grandfathered: [] }),
    ).toThrow(/_baseline/);
  });

  it("缺 _gate_landed_at 被拒绝", () => {
    expect(() => parseLegacyEvidence({ _baseline: [], grandfathered: [] })).toThrow(/_gate_landed_at/);
  });

  it("顶层不是对象被拒绝", () => {
    expect(() => parseLegacyEvidence(["00/F01"])).toThrow(/顶层必须是对象/);
  });
});

describe("judgeLegacyEvidenceRatchet ① 陈旧 —— 豁免只许收缩", () => {
  // 这是 #391 实测到的那 6 条（00/F02 F03 F04 F05 F09 F15）的机器形态：
  // 日志早就补上了指纹，豁免用不着了，却在名单里躺了近两个月没人发现。
  // 拆掉 `if (seen && !seen.stillMissingFingerprint) stale.push(...)` ⇒ 本条红。
  it("反证：日志已经补上指纹 ⇒ 这条豁免陈旧，必须删掉", () => {
    const v = judgeLegacyEvidenceRatchet(list([{ key: "00/F02" }]), seen([["00/F02", false]]), TODAY);
    expect(v.stale).toEqual(["00/F02"]);
    expect(v.active).toEqual([]);
  });

  it("日志今天仍然缺指纹 ⇒ 豁免仍然生效，不算陈旧", () => {
    const v = judgeLegacyEvidenceRatchet(list([{ key: "00/F01" }]), seen([["00/F01", true]]), TODAY);
    expect(v.stale).toEqual([]);
    expect(v.active.map((e) => e.key)).toEqual(["00/F01"]);
  });

  // in-scope 纪律：`doctor --phase 01` 没扫到 phase 00，不该把 00 的条目误判成
  // 「不再需要」——那会把陈旧检查变成假阳性门（同 #1136 棘轮）。
  // 拆掉 `if (seen && ...)` 里的 `seen &&` ⇒ 本条红。
  it("反证：本次没扫到的 phase，其条目不判陈旧（局部运行不得误杀）", () => {
    const v = judgeLegacyEvidenceRatchet(list([{ key: "00/F01" }]), seen([]), TODAY);
    expect(v.stale).toEqual([]);
  });

  it("多条混合：只有观测到「不再缺指纹」的那几条变陈旧", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01" }, { key: "00/F02" }, { key: "00/F14" }]),
      seen([["00/F01", true], ["00/F02", false], ["00/F14", true]]),
      TODAY,
    );
    expect(v.stale).toEqual(["00/F02"]);
    expect(v.active.map((e) => e.key)).toEqual(["00/F01", "00/F14"]);
  });
});

describe("judgeLegacyEvidenceRatchet ② 长大 —— grandfathered ⊆ _baseline", () => {
  // 反证：修复前往 grandfathered 里塞一条新 key，doctor 照样 exit 0——
  // 「只减不增」只写在 _why 的人话里，没有任何脚本执行它。
  // 拆掉 `if (!baseline.has(entry.key)) grown.push(...)` ⇒ 本条红。
  it("反证：不在 _baseline 里的条目被判为偷加（名单不得无声长大）", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01" }, { key: "09/F77" }], ["00/F01"]),
      seen([["00/F01", true], ["09/F77", true]]),
      TODAY,
    );
    expect(v.grown).toEqual(["09/F77"]);
    // 一个缺陷只打一条话：偷加的条目不再同时被算进 stale/active，
    // 否则同一条 key 会带着「已陈旧」和「不在 _baseline 里」两句互相打架的提示。
    expect(v.stale).toEqual([]);
    expect(v.active.map((e) => e.key)).toEqual(["00/F01"]);
  });

  it("baseline 的真子集是合法的（名单只许收缩）", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01" }], ["00/F01", "00/F02", "00/F14"]),
      seen([["00/F01", true]]),
      TODAY,
    );
    expect(v.grown).toEqual([]);
  });
});

describe("judgeLegacyEvidenceRatchet ③ 过期 —— 豁免不得无声长期化", () => {
  // 拆掉 isExpired 那一句 ⇒ 本条红，豁免可以无限期躺下去。
  it("反证：过了 review_by ⇒ 判红，要么清掉要么由人类显式续期", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01", review_by: "2026-09-20" }]),
      seen([["00/F01", true]]),
      TODAY,
    );
    expect(v.expired.map((e) => e.key)).toEqual(["00/F01"]);
  });

  it("review_by 当天仍然有效（期限是最后一天，不是前一天）", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01", review_by: "2026-09-21" }]),
      seen([["00/F01", true]]),
      TODAY,
    );
    expect(v.expired).toEqual([]);
  });

  it("期限未到不判红", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01", review_by: "2026-12-31" }]),
      seen([["00/F01", true]]),
      TODAY,
    );
    expect(v.expired).toEqual([]);
  });
});

describe("judgeLegacyEvidenceRatchet ④ 不可审计 —— 空理由 / 坏日期", () => {
  it("反证：reason 是空白 ⇒ 判红（口头豁免不算理由）", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01", reason: "   " }]),
      seen([["00/F01", true]]),
      TODAY,
    );
    expect(v.malformed).toEqual(["00/F01"]);
  });

  it("反证：review_by 不是 YYYY-MM-DD ⇒ 判红（坏日期不能当期限，否则过期判定形同虚设）", () => {
    const v = judgeLegacyEvidenceRatchet(
      list([{ key: "00/F01", review_by: "以后再说" }]),
      seen([["00/F01", true]]),
      TODAY,
    );
    expect(v.malformed).toEqual(["00/F01"]);
    expect(v.expired).toEqual([]);
  });
});

describe("legacyKey", () => {
  it("带 phaseId，避免不同 phase 同号 feature 撞车", () => {
    expect(legacyKey("00", "F01")).toBe("00/F01");
    expect(legacyKey("01", "F01")).toBe("01/F01");
  });
});
