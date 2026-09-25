/**
 * feature-owner.ts —— #1142 的 owner 命名空间棘轮门（纯判定，无 I/O）。
 *
 * ## 它堵的洞
 *
 * `feature.owner` 与 `.harness/agents/registry.yaml` 的角色 id 是**两个不同的
 * 命名空间**。#1142 的实测（2026-08-13，290 个 feature；本 PR 复测 2026-09-21，
 * 450 个 feature）：
 *
 *   · 175 个（39%）owner 为 null——出了问题不知道该找谁
 *   · 非 null 的绝大多数是 sprint 期一次性把手（`w2-chat4` `w3-itv11` `w0-auth`
 *     `claude-e` `remote-f01`……），sprint 一结束它们就是死链接
 *   · 真·registry 角色 id 只有个位数
 *
 * ⇒ 今天无法可靠地把一个 feature 映射到一个真实角色。`owner` 字段记录的是
 * **写入那一刻**谁在做，而不是**现在**谁负责——与本仓已知的
 * 「静态痕迹 ≠ 动态事实」同型。
 *
 * ## 为什么是棘轮而不是直接判红
 *
 * 直接把「owner ∉ 身份命名空间」升成 FAIL，今天会让 200 多个存量 feature 一起炸红。
 * 「上线即全红」等于没有门——这是 #539 / #1136 已经写进 allowlist `_readme` 的教训。
 * 所以沿用同一个棘轮模式（`rewrite-coverage-allowlist.json` /
 * `feature-evidence-allowlist.json`）：
 *
 *   · 今天已存在的非法 owner 快照进 allowlist，仍然通过，但打印「存量豁免，待人裁」
 *   · **今天之后**任何新增的非法 owner ⇒ 不在 allowlist 里 ⇒ 直接 FAIL
 *   · allowlist 只许收缩
 *
 * ## 为什么 allowlist 的 key 带 owner 取值
 *
 * 条目形如 `01/F123=w2-chat4`，而不是只写 `01/F123`。只写 `phase/feature` 的话，
 * 把一个已豁免 feature 的 owner 从 `w2-chat4` 改成另一个随便编的值，仍然命中豁免
 * ——那道门会变成「这条 feature 的 owner 字段从此免检」，正好是本 issue 要堵的洞的
 * 永久版。带上取值之后，**任何改动**都必须落到合法身份上，或者显式重新登记。
 *
 * ## 为什么不按前缀猜
 *
 * #1142 原文明确不建议按前缀猜（`w2-chat4` → `coord-chat`）：猜出来的归属会产生
 * 一个**看起来精确、其实编造**的记录，比留空更糟。所以这里只做两件事——
 * 把不合法的挡在门外、把存量如实列成一份待人裁清单——**一个字都不猜**。
 * 归一化（issue 建议范围第 1 条）需要人裁，不在机械门的能力范围内。
 *
 * ## null 的显式化，以及为什么要按 status 分两档
 *
 * `owner: null` 不是「非法」，它是类型里合法的「未认领」。但它今天是**无声的**：
 * doctor 只在「同阶段有并行开发」时才提一句（`checkOrphanInProgress`），
 * 175 个 unowned 在体检输出里根本不出现。这就是 #1142 建议范围第 2 条要显式化的东西。
 *
 * 但**不能一刀切地全报**。2026-09-21 复测这 175 个的分布：
 *
 *   · `not_started` 166 个 —— 这是**正常状态**，不是欠债：`claim.ts` 的保护 1 要求
 *     `owner === null` 才能认领，没认领的活本来就该没有 owner。把它们每次体检都报一遍，
 *     只会把 doctor 训练成「那一片黄的不用看」，顺带盖掉下面那 9 个真问题。
 *   · 非 `not_started` 9 个（全部是 `passing`）—— 这才是 #1142 说的
 *     「出了问题不知道该找谁」：活已经做完了，仓库里却没有任何人的名字。
 *
 * ⇒ `unownedActive`（有人动过却无主）与 `unownedNotStarted`（还没人认领）分开返回，
 * 由调用方决定各自的严重度。把两者混成一个数字，等于用 166 条噪音埋掉 9 条信号。
 *
 * ⚠ 刻意**不**把 null 改写成字符串 `"unowned"` 写回 feature_list.json：
 * `claim.ts` 的保护 1 是 `f.owner !== null && f.owner !== owner ⇒ 拒绝认领`，
 * 真那么改会让这 175 个 feature 全部变成谁也认领不了的死件；
 * `validate-fl.ts` 的「尚未开工却已有 owner」也会全部误报。
 * 显式化要的是「被看见」，不是「往事实源里塞一个假 owner」。
 */

export interface FeatureOwnerLike {
  readonly id: string;
  readonly owner: string | null | undefined;
  /** feature 的 status。只用来区分「还没人认领」与「有人动过却无主」两档。 */
  readonly status: string;
}

export interface PhaseFeatureOwners {
  readonly phaseId: string;
  readonly features: readonly FeatureOwnerLike[];
}

/** allowlist 条目形状：`<phaseId>/<featureId>=<owner 取值>`。 */
export type OwnerAllowlistKey = string;

export function ownerAllowlistKey(phaseId: string, featureId: string, owner: string): OwnerAllowlistKey {
  return `${phaseId}/${featureId}=${owner}`;
}

/** 未认领：null / undefined / 纯空白都算。空白字符串是「留空」的另一种写法，不是身份。 */
export function isUnowned(owner: string | null | undefined): boolean {
  return owner === null || owner === undefined || owner.trim() === "";
}

export interface OwnerGap {
  readonly phaseId: string;
  readonly featureId: string;
  readonly owner: string;
  readonly key: OwnerAllowlistKey;
}

export interface OwnerVerdict {
  /** 非法 owner 且不在 allowlist 里 ⇒ 判红。 */
  readonly newGaps: readonly OwnerGap[];
  /** 非法 owner 但在 allowlist 里 ⇒ 存量豁免，待人裁归一化。 */
  readonly grandfathered: readonly OwnerGap[];
  /** 非 not_started 却无主：活已经开工/做完，仓库里没有任何人的名字。显式化，不判红。 */
  readonly unownedActive: readonly string[];
  /** not_started 且无主：正常的待认领状态，只计数，不逐条列。 */
  readonly unownedNotStarted: readonly string[];
}

/**
 * 主判定。
 *
 * @param phases    当前全部 phase 的 feature 快照
 * @param knownIds  合法身份命名空间 = registry.yaml ∪ `.harness/agents/*.yaml`
 *                  （由 `lib/agent-identity.ts` 提供，本文件不自己定义身份是什么）
 * @param allowlist 存量豁免名单
 */
export function judgeFeatureOwners(
  phases: readonly PhaseFeatureOwners[],
  knownIds: ReadonlySet<string>,
  allowlist: readonly OwnerAllowlistKey[],
): OwnerVerdict {
  const allow = new Set(allowlist);
  const newGaps: OwnerGap[] = [];
  const grandfathered: OwnerGap[] = [];
  const unownedActive: string[] = [];
  const unownedNotStarted: string[] = [];

  for (const { phaseId, features } of phases) {
    for (const f of features) {
      if (isUnowned(f.owner)) {
        (f.status === "not_started" ? unownedNotStarted : unownedActive).push(`${phaseId}/${f.id}`);
        continue;
      }
      const owner = (f.owner as string).trim();
      if (knownIds.has(owner)) continue;
      const gap: OwnerGap = { phaseId, featureId: f.id, owner, key: ownerAllowlistKey(phaseId, f.id, owner) };
      if (allow.has(gap.key)) grandfathered.push(gap);
      else newGaps.push(gap);
    }
  }
  return { newGaps, grandfathered, unownedActive, unownedNotStarted };
}

/**
 * 棘轮体检：allowlist 里已经不再需要豁免的条目（owner 已归一化到真实身份 /
 * 被清空 / feature 已不存在）必须删掉。留着等于给未来的回归留一扇没人看守的门
 * ——那个取值一旦被再写回来，会命中一条陈旧豁免而静悄悄通过。
 */
export function staleOwnerAllowlistEntries(
  phases: readonly PhaseFeatureOwners[],
  knownIds: ReadonlySet<string>,
  allowlist: readonly OwnerAllowlistKey[],
): OwnerAllowlistKey[] {
  const { newGaps, grandfathered } = judgeFeatureOwners(phases, knownIds, allowlist);
  const stillNeeded = new Set([...newGaps, ...grandfathered].map((g) => g.key));
  return allowlist.filter((key) => !stillNeeded.has(key));
}
