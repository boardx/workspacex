/**
 * evidence-legacy.ts —— `.harness/state/evidence-legacy.json` 的单一事实源：
 * schema、读取、以及 #391 补上的**反向一致性门**。
 *
 * ## 它堵的洞
 *
 * 指纹门控（ADR-022 / `evidence-fingerprint.ts`）上线前就已 passing 的 feature，
 * 其 evidence 日志由旧版 verify 产出、没有指纹尾行。名单给它们开了 WARN 而非 FAIL
 * 的口子，并在 `_why` 里用人话写着「只减不增」。
 *
 * 实测（2026-09-21，issue #391）：那句人话**没有任何脚本执行它**——
 *
 *   · 9 条豁免里有 6 条（00/F02 F03 F04 F05 F09 F15）对应的日志**早就补上了指纹**，
 *     豁免已经用不着了，却在名单里躺了近两个月没人发现；
 *   · 往 `grandfathered` 里塞一条新 key，doctor 照样 exit 0——名单可以无声长大，
 *     「只减不增」是口头豁免；
 *   · 剩下的条目没有任何理由与复核期限，可以无限期躺下去。
 *
 * 这正是 AGENTS.md 那句「没有脚本的规范条目视为未落地」。本文件把三件事变成会红的东西：
 *
 *   1. **陈旧**：条目对应的 feature 今天已经不在「passing + 日志缺指纹」这个集合里
 *      （补上指纹了 / 状态变了 / feature 没了）⇒ FAIL，必须删掉。
 *      留着一条已补好的豁免，等于给未来的回归留一扇没人看守的门（同 #539 / #1136 的教训）。
 *   2. **长大**：`grandfathered` 必须是 `_baseline` 的子集。`_baseline` 是 2026-07-29
 *      门控落地那一刻的**冻结历史快照**，不随时间变；要加新条目就必须改它，
 *      而那是一次在 diff 里显眼、必须过 review 的显式动作。
 *   3. **无声长期化**：每条都必须写明 `reason`（为什么今天还免）与 `review_by`
 *      （复核期限）。过了期限 ⇒ FAIL：豁免要续期，就得有人再签一次字。
 *
 * ## `_baseline` 不是第二份事实源
 *
 * 两者是**两个不同的事实**，不是同一事实的两份副本：
 *   · `_baseline`  = 「2026-07-29 门控落地时，哪些 feature 已 passing 且日志缺指纹」——
 *                    已经发生的历史，永远不变；
 *   · `grandfathered` = 「今天还欠着哪几条」——随清理而收缩。
 * 判据是 `grandfathered ⊆ _baseline`，所以两者不会各说各话。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths";

export const LEGACY_EVIDENCE_PATH = join(REPO_ROOT, ".harness/state/evidence-legacy.json");

/** `phaseId/featureId`，与 feature-evidence-ratchet 的 allowlist 条目同型。 */
export type LegacyKey = string;

export function legacyKey(phaseId: string, featureId: string): LegacyKey {
  return `${phaseId}/${featureId}`;
}

export interface LegacyEvidenceEntry {
  readonly key: LegacyKey;
  /** 为什么这条今天还免——空字符串不接受，口头豁免不算理由。 */
  readonly reason: string;
  /** 复核期限 `YYYY-MM-DD`。过期 ⇒ FAIL，要续期就得显式改这个日期。 */
  readonly review_by: string;
}

export interface LegacyEvidenceList {
  readonly gateLandedAt: string;
  /** 门控落地那一刻的冻结快照；`grandfathered` 只能是它的子集。 */
  readonly baseline: readonly LegacyKey[];
  readonly entries: readonly LegacyEvidenceEntry[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 严格解析。读不懂就抛——名单是门控的输入，「读不出来就当没有」在这里等于
 * 把整道门静默关掉（`isLegacyEvidence` 那种「读不出按不豁免」只对单条查询安全，
 * 对体检不安全：那会让一份写坏的名单表现得像一份干净的名单）。
 */
export function parseLegacyEvidence(raw: unknown): LegacyEvidenceList {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("evidence-legacy.json 顶层必须是对象");
  }
  const o = raw as Record<string, unknown>;

  const gateLandedAt = o["_gate_landed_at"];
  if (typeof gateLandedAt !== "string" || !DATE_RE.test(gateLandedAt)) {
    throw new Error("evidence-legacy.json 缺少合法的 _gate_landed_at（YYYY-MM-DD）");
  }

  const baselineRaw = o["_baseline"];
  if (!Array.isArray(baselineRaw) || baselineRaw.some((k) => typeof k !== "string")) {
    throw new Error("evidence-legacy.json 缺少 _baseline（门控落地时的冻结快照，字符串数组）");
  }

  const entriesRaw = o["grandfathered"];
  if (!Array.isArray(entriesRaw)) throw new Error("evidence-legacy.json 的 grandfathered 必须是数组");
  const entries = entriesRaw.map((e, i) => {
    if (typeof e !== "object" || e === null) {
      throw new Error(`grandfathered[${i}] 必须是对象 { key, reason, review_by }——裸字符串条目没有理由也没有期限，已不再接受`);
    }
    const r = e as Record<string, unknown>;
    if (typeof r["key"] !== "string" || r["key"] === "") throw new Error(`grandfathered[${i}] 缺少 key`);
    if (typeof r["reason"] !== "string") throw new Error(`grandfathered[${i}] 缺少 reason`);
    if (typeof r["review_by"] !== "string") throw new Error(`grandfathered[${i}] 缺少 review_by`);
    return { key: r["key"], reason: r["reason"], review_by: r["review_by"] };
  });

  return { gateLandedAt, baseline: baselineRaw as string[], entries };
}

/** 读盘 + 解析。文件不存在返回 null（空名单与「没有名单」在语义上一致）。 */
export function loadLegacyEvidence(path: string = LEGACY_EVIDENCE_PATH): LegacyEvidenceList | null {
  if (!existsSync(path)) return null;
  return parseLegacyEvidence(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * 单条查询：这条 feature 今天是否被豁免。
 * 读不出名单时按「不豁免」处理——宁可多红，不可漏放（沿用门控上线时的取舍）。
 */
export function legacyEntryFor(
  phaseId: string,
  featureId: string,
  path: string = LEGACY_EVIDENCE_PATH,
): LegacyEvidenceEntry | null {
  let list: LegacyEvidenceList | null;
  try {
    list = loadLegacyEvidence(path);
  } catch {
    return null;
  }
  const key = legacyKey(phaseId, featureId);
  return list?.entries.find((e) => e.key === key) ?? null;
}

/**
 * 一条豁免今天是否还用得着。由调用方（doctor）实测后填进来：
 * 「对应 feature 仍是 passing，且它的 evidence 日志今天仍然缺指纹」。
 */
export interface LegacyObservation {
  readonly stillMissingFingerprint: boolean;
}

export interface LegacyRatchetVerdict {
  /** 已经用不着的条目（日志补上指纹了 / 不再 passing / feature 没了）⇒ 必须删掉。 */
  readonly stale: readonly LegacyKey[];
  /** 不在 `_baseline` 里 ⇒ 名单长大了，这条是偷加的。 */
  readonly grown: readonly LegacyKey[];
  /** 过了 `review_by` ⇒ 豁免无声长期化，要么清掉要么显式续期。 */
  readonly expired: readonly LegacyEvidenceEntry[];
  /** `reason` 为空或 `review_by` 不是合法日期 ⇒ 不是可审计的豁免。 */
  readonly malformed: readonly LegacyKey[];
  /** 未被判陈旧的条目——今天仍在生效（可能同时落在 grown/expired/malformed 里，那几项各自判红）。 */
  readonly active: readonly LegacyEvidenceEntry[];
}

/**
 * 主判定。
 *
 * `observations` 只覆盖**本次真正扫到的 phase**的条目：`doctor --phase 01` 这类局部
 * 运行不该把「这次没扫到的 phase」误判成「不再需要」——那会把陈旧检查变成假阳性门
 * （同 #1136 棘轮的 in-scope 纪律）。`grown` / `expired` / `malformed` 三项只看名单
 * 本身，与扫描范围无关，所以永远全量判。
 */
export function judgeLegacyEvidenceRatchet(
  list: LegacyEvidenceList,
  observations: ReadonlyMap<LegacyKey, LegacyObservation>,
  today: Date,
): LegacyRatchetVerdict {
  const baseline = new Set(list.baseline);
  const stale: LegacyKey[] = [];
  const grown: LegacyKey[] = [];
  const expired: LegacyEvidenceEntry[] = [];
  const malformed: LegacyKey[] = [];
  const active: LegacyEvidenceEntry[] = [];

  for (const entry of list.entries) {
    // 不在冻结快照里的条目压根不该存在，先判红再说——不必再追问它是不是「陈旧」
    // 或者过没过期，那只会为同一个缺陷打出两三条互相矛盾的话。
    if (!baseline.has(entry.key)) {
      grown.push(entry.key);
      continue;
    }
    if (entry.reason.trim() === "" || !DATE_RE.test(entry.review_by)) {
      malformed.push(entry.key);
    } else if (isExpired(entry.review_by, today)) {
      expired.push(entry);
    }
    const seen = observations.get(entry.key);
    if (seen && !seen.stillMissingFingerprint) stale.push(entry.key);
    else active.push(entry);
  }
  return { stale, grown, expired, malformed, active };
}

/** `review_by` 是**当天有效**的最后一天：`review_by < 今天` 才算过期。 */
function isExpired(reviewBy: string, today: Date): boolean {
  return reviewBy < today.toISOString().slice(0, 10);
}
