/**
 * #391：把「evidence-legacy.json 今天是否干净」钉成回归测试。
 *
 * 上面的 `lib/evidence-legacy.test.ts` 测的是判据本身；这里测的是**仓库当下的真实数据**
 * ——判据写对了但名单没清，门一样是摆设。两条都要有。
 *
 * 修复前（main，2026-09-21 实测）本文件全红：
 *   · 名单里 9 条豁免有 6 条（00/F02 F03 F04 F05 F09 F15）对应的日志早已补上指纹 ⇒ 陈旧；
 *   · 条目是裸字符串、没有 _baseline ⇒ parseLegacyEvidence 直接抛。
 */
import { describe, expect, it } from "vitest";
import { observeLegacyEntry } from "./doctor";
import { loadFeatureList } from "./lib/features";
import {
  judgeLegacyEvidenceRatchet, loadLegacyEvidence,
  type LegacyKey, type LegacyObservation,
} from "./lib/evidence-legacy";

const list = loadLegacyEvidence();

/** 名单里出现过的 phase，逐个读真实 feature_list 并实测每条日志的指纹状态。 */
function observeAll(): ReadonlyMap<LegacyKey, LegacyObservation> {
  const out = new Map<LegacyKey, LegacyObservation>();
  for (const entry of list?.entries ?? []) {
    const [phaseId, featureId] = entry.key.split("/");
    if (!phaseId || !featureId) continue;
    out.set(entry.key, observeLegacyEntry(phaseId, loadFeatureList(phaseId).features, featureId));
  }
  return out;
}

describe("evidence-legacy.json 的反向一致性（#391）", () => {
  it("名单可解析：条目带 key / reason / review_by，且有 _baseline 冻结快照", () => {
    expect(list).not.toBeNull();
    for (const e of list!.entries) {
      expect(e.reason.trim()).not.toBe("");
      expect(e.review_by).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // 反证核心：这一条在修复前是红的——F02/F03/F04/F05/F09/F15 的日志都已带指纹，
  // 豁免早就用不着，却一直留在名单里遮着「这条本该早就修好」这件事。
  it("没有陈旧条目：每一条豁免对应的 feature 今天仍然是「passing + 日志缺指纹」", () => {
    const v = judgeLegacyEvidenceRatchet(list!, observeAll(), new Date());
    expect(v.stale).toEqual([]);
  });

  it("名单没有长大：grandfathered ⊆ _baseline", () => {
    const v = judgeLegacyEvidenceRatchet(list!, observeAll(), new Date());
    expect(v.grown).toEqual([]);
  });

  it("没有过期豁免：过了 review_by 就得清掉或由人类显式续期", () => {
    const v = judgeLegacyEvidenceRatchet(list!, observeAll(), new Date());
    expect(v.expired.map((e) => `${e.key}@${e.review_by}`)).toEqual([]);
    expect(v.malformed).toEqual([]);
  });
});
