/**
 * 待定阈值登记表 —— **把「还不知道」变成显式的、不可硬编码的东西**
 *
 * ## 为什么需要这个文件
 * 有一类事实：**规则已经确定，数值还没人给**。
 * 例如「样本量低于阈值时显示『样本不足』」——规则明确，阈值是多少没人裁决。
 *
 * 这类东西的默认失败模式是：实现者随手填一个「看起来合理」的数字，
 * 它一旦渲染出来就会被截图进对外汇报，从此变成事实上的标准。
 * 本项目已经发生过一次（有人编了 `sampleSize=18` 和「口径表 v3」，
 * 制造出「已算过、已过线」的假象，而 UC 明写那三个数「需产品给出」）。
 *
 * ⇒ 登记在这里的每一项都：
 *   ① `known: false` —— 类型上就拿不到数值，硬编码会被 `lint-pending-thresholds` 抓到
 *   ② 带 `rule` —— **规则本身是确定的，可以先做成结构性断言**（不必等数值）
 *   ③ 带 `owner` 与 `blocksWhat` —— 谁该给、不给会卡住什么
 *
 * ## 数值到位后怎么做
 * 把该项改成 `{ known: true, value, source }`，`source` 记明出处（哪条裁决 / 谁给的 / 什么时候）。
 * **不要直接把数字写进业务代码**——那样下次改它又要全仓找。
 */

export type PendingThreshold = {
  readonly known: false;
  /** 规则本身（确定的部分）——据此写结构性断言，不必等数值 */
  readonly rule: string;
  /** 谁该给这个数 */
  readonly owner: "产品" | "合规" | "法务" | "运维";
  /** 不给会卡住什么；「不阻塞」也要写明，否则会被当成可以永远拖 */
  readonly blocksWhat: string;
  /** 追溯：这条待定项从哪来 */
  readonly ref: string;
};

export type ResolvedThreshold<T> = {
  readonly known: true;
  readonly value: T;
  /** 数值的出处——哪条裁决、谁给的、什么时候。没有出处的数值等于没有依据 */
  readonly source: string;
  readonly rule: string;
};

export type Threshold<T> = PendingThreshold | ResolvedThreshold<T>;

/** 取值；未定时抛错而不是返回默认值——**静默默认是这类缺陷的温床** */
export function requireValue<T>(t: Threshold<T>, name: string): T {
  if (!t.known) {
    throw new Error(
      `阈值「${name}」尚未裁决（应由${t.owner}给出）。规则：${t.rule}。` +
        `不给会卡住：${t.blocksWhat}。出处：${t.ref}。` +
        `⚠ 不要在此处填一个「看起来合理」的默认值——它会被当成事实标准。`,
    );
  }
  return t.value;
}

export const THRESHOLDS = {
  /* ── N-2：召回质量基线 ────────────────────────────────────────── */
  vectorRecallBaseline: {
    known: false,
    rule:
      "带权限过滤的 pgvector 召回，其 recall 不得低于基线；低于即判失败，" +
      "**不得静默放行**（放行等于把「召回够不够」这件事变成没人负责）",
    owner: "产品",
    blocksWhat:
      "它是上线门槛却没有门槛值。F10 五路召回可以先实现，" +
      "但「召回质量达标」这条验收在数值给出前无法判定",
    ref: "design-coherence N-2 / context-pack 缺口 3",
  },

  /* ── N-3：token 预算的五路配额 ────────────────────────────────── */
  retrievalChannelQuota: {
    known: false,
    rule:
      "五路（fts / vector / graph / metadata / claim）各自的 token 配额之和不得超过总预算；" +
      "任何一路被截断都必须产生 `budget` 类 omission —— **截断不得静默发生**",
    owner: "产品",
    blocksWhat: "不阻塞：O-36 已定总预算与阈值可配，五路怎么分可以先按等分实现并标注待定",
    ref: "design-coherence N-3 / context-pack 缺口 4",
  },

  /* ── N-6：摄取进人工复核的判据 ────────────────────────────────── */
  reviewPendingTrigger: {
    known: false,
    rule:
      "命中判据即进 `REVIEW_PENDING`，**不得静默入库**；" +
      "复核处置必须留痕（谁、何时、接受还是拒绝、理由）",
    owner: "产品",
    blocksWhat:
      "不阻塞：判据的**结构**（命中即进复核、不得静默）可以先实现并断言，" +
      "具体阈值（如置信度低于多少、PII 命中几类）后填",
    ref: "design-coherence N-6 / artifact 缺口 7",
  },

  /* ── N-1 / N-4：留存期五参数（合规输入缺口）──────────────────── */
  retentionMaterial: {
    known: false,
    rule: "材料保留期到期后进入删除流程；同意书上的数字**必须按项目动态渲染**（D-14），不得写死",
    owner: "合规",
    blocksWhat:
      "⚠ **现在 /consent 上的保留期曾被写死** —— 只要有项目配了不同的值，" +
      "同意书就会向受访者作出与实际不符的承诺。这是合规风险，不是文案问题",
    ref: "design-coherence N-4 / D-14 / DECISIONS-UI-ROUND TODO-3",
  },
  retentionAudit: {
    known: false,
    rule: "审计日志「不可删」与留存期如何共存：不可删对象不受留存期约束，单独走法定留存清单（O-01）",
    owner: "合规",
    blocksWhat: "见 legalHoldCategories —— 两者是同一个缺口的两面",
    ref: "design-coherence N-1 / O-01",
  },
  contextPackSnapshotRetention: {
    known: false,
    rule: "Context Pack 固化快照是审计依据（可重放），但体量可能很大；留存期需与 D-14 五参数统一",
    owner: "合规",
    blocksWhat: "不阻塞实现；影响 replay 的可用窗口",
    ref: "design-coherence N-4 / context-pack 缺口 5",
  },

  /* ── N-1：法定留存清单（外部输入缺口，最硬的一条）──────────────── */
  legalHoldCategories: {
    known: false,
    rule:
      "属法定留存的对象**不得删除**，即使收到合规撤回请求；" +
      "与「固定快照不可删」（artifact I-11）和「撤回必须物理删除」（D-15）三者构成三角约束",
    owner: "法务",
    blocksWhat:
      "🔴 **真实阻塞**：X-4 的冲突（快照不可删 vs 合规必须删）以此为判据。" +
      "在这份清单给出之前，「哪些快照属于法定留存、不得删」**没有判据**——" +
      "撤回删除相关的 feature 无法定稿",
    ref: "design-coherence N-1 / X-4 / O-39",
  },
} as const satisfies Record<string, Threshold<unknown>>;

export type ThresholdName = keyof typeof THRESHOLDS;

/** 仍待裁决的项——供报告与门控使用 */
export function pendingThresholds(): { name: ThresholdName; t: PendingThreshold }[] {
  return (Object.entries(THRESHOLDS) as [ThresholdName, Threshold<unknown>][])
    .filter((e): e is [ThresholdName, PendingThreshold] => !e[1].known)
    .map(([name, t]) => ({ name, t }));
}

/** 会真正卡住开工的那些（`blocksWhat` 以 🔴 开头） */
export function blockingThresholds() {
  return pendingThresholds().filter((p) => p.t.blocksWhat.startsWith("🔴"));
}
