/**
 * feature-evidence-ratchet.ts —— #1136 的棘轮门。
 *
 * ## 它堵的洞
 *
 * `doctor.ts` 的 `checkPassingEvidence` 对「evidence 是自由文本、不是标准
 * `evidence/<Fxx>.verify.log @ …` 路径」这一档，此前只打 WARN，不 FAIL。
 * 反证实测（issue #1136）：手改一条 feature 为 `passing` + evidence 写一句人话
 * + sprint 留 null，`pnpm harness doctor` **exit 0**——完成定义被单方面绕过，
 * 且 doctor 还会照常打印"✓ 所有 passing 都有真实非空证据"，那句话此时是假的。
 *
 * ## 为什么不是裸 A（直接把 WARN 升 FAIL）
 *
 * coord-main 2026-08-13 裁决：裸升级会让存量非标准 evidence 不经盘点就全部炸红——
 * "上线即全红"等于没有门（同棘轮名单 #539 的既有教训，见
 * `rewrite-coverage-allowlist.json` 的 `_readme`）。所以套用同一个棘轮模式：
 *
 *   · 今天已存在的非标准 evidence（若有）快照进 allowlist，仍然通过，但打印
 *     "存量豁免，待清理"
 *   · **今天之后**任何新增的非标准 evidence ⇒ 不在 allowlist 里 ⇒ 直接 FAIL
 *   · allowlist 只许收缩：条目对应的 feature 一旦不再是"非标准 evidence 的 passing"
 *     （标准化了，或状态变了），就是陈旧条目，必须删掉——留着等于给未来的回归
 *     留一扇没人看守的门
 *
 * 实测（2026-08-13，5 个 phase 全量扫描）：**今天存量为 0**——不需要任何豁免，
 * 这份机制从落地那一刻起就是满棘轮（allowlist 应为空数组）。
 */

export interface FeatureLike {
  readonly id: string;
  readonly status: string;
  readonly evidence: string | null | undefined;
}

export interface PhaseFeatures {
  readonly phaseId: string;
  readonly features: readonly FeatureLike[];
}

/** `phaseId/featureId` —— allowlist 的条目形状，与 evidence-fingerprint 里的判据引用同型。 */
export type AllowlistKey = string;

export function allowlistKey(phaseId: string, featureId: string): AllowlistKey {
  return `${phaseId}/${featureId}`;
}

/** doctor.ts 里已有的两个正则，原样复用，不重新定义一遍判据。 */
const EVIDENCE_PATH_RE = /^evidence\/(F\d+)\.verify\.log @ /;
const BARE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/**
 * 一条 passing feature 的 evidence 是否属于「自由文本」这一档——
 * 既不是空（那已经 FAIL）、也不是裸时间戳（那也已经 FAIL）、也不是标准路径。
 */
export function isFreeTextEvidence(evidence: string | null | undefined): boolean {
  if (!evidence) return false;
  const trimmed = evidence.trim();
  if (trimmed === "") return false;
  if (BARE_TIMESTAMP_RE.test(trimmed)) return false;
  return !EVIDENCE_PATH_RE.test(evidence);
}

export interface RatchetVerdict {
  /** 需要判红的 `phaseId/featureId`（自由文本 evidence 且不在 allowlist 里）。 */
  readonly newGaps: readonly AllowlistKey[];
  /** 在 allowlist 里、仍然合法豁免的条目（自由文本 evidence 且状态仍是 passing）。 */
  readonly grandfathered: readonly AllowlistKey[];
}

/** 主判定：给定当前全部 phase 的 feature 快照 + allowlist，谁该红、谁该豁免。 */
export function judgeFeatureEvidenceRatchet(
  phases: readonly PhaseFeatures[],
  allowlist: readonly AllowlistKey[],
): RatchetVerdict {
  const allow = new Set(allowlist);
  const newGaps: AllowlistKey[] = [];
  const grandfathered: AllowlistKey[] = [];

  for (const { phaseId, features } of phases) {
    for (const f of features) {
      if (f.status !== "passing") continue;
      if (!isFreeTextEvidence(f.evidence)) continue;
      const key = allowlistKey(phaseId, f.id);
      if (allow.has(key)) grandfathered.push(key);
      else newGaps.push(key);
    }
  }
  return { newGaps, grandfathered };
}

/**
 * 棘轮体检：allowlist 里已经不需要豁免的条目（feature 已标准化 / 不再 passing /
 * 已不存在）应当被删掉，否则它会一直遮住"这条本该早就修好"这件事。
 *
 * ⚠ 这里**不是**照抄 #539 `staleAllowlistEntries` 的"用空 allowlist 重算"写法——
 * 实测发现那一步在这里是死代码：`judgeFeatureEvidenceRatchet` 里每条命中判据的
 * feature 必定落进 `newGaps` 或 `grandfathered` 二者之一（从不因为 allowlist 而被
 * 跳过整个判定，这与 #539 的 `if (allow.has(...)) continue;` 不同——那里 allowlist
 * 会让路由整条跳过判定，这里 allowlist 只决定分到哪个桶）。所以 `newGaps ∪
 * grandfathered` 本就与传入的 allowlist 无关，传 `[]` 还是传真实 allowlist 结果
 * 完全一样——写那一步只是抄了形状，没抄语义，反证测出来是空转，已经删掉。
 *
 * 真正的判据只有一句：**allowlist 里的条目，如果对应的 feature 今天已经不在
 * "passing 且自由文本 evidence" 这个集合里，就是陈旧的**。
 */
export function staleFeatureEvidenceEntries(
  phases: readonly PhaseFeatures[],
  allowlist: readonly AllowlistKey[],
): AllowlistKey[] {
  const { newGaps, grandfathered } = judgeFeatureEvidenceRatchet(phases, allowlist);
  const stillNeeded = new Set([...newGaps, ...grandfathered]);
  return allowlist.filter((key) => !stillNeeded.has(key));
}
