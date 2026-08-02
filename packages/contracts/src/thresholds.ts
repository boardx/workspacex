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

import type { QueryTaskName } from "./context-pack";

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

/**
 * 相关度阈值的取值形状（O-36：默认值 + 按任务类型可配）。
 *
 * `byTask` 用 `Partial`：**没配的任务类型走 `default`**，而不是「没配就没有阈值」。
 * 一个「没配就不过滤」的实现会让丢弃清单在某些任务类型下神秘地空掉。
 */
export type RelevanceThresholdValue = {
  readonly default: number;
  readonly byTask: Partial<Record<QueryTaskName, number>>;
};

export const THRESHOLDS = {
  /* ── O-36：Context Pack 相关度阈值（**已裁决**，故 known: true）──────── */
  contextPackRelevance: {
    known: true,
    value: { default: 0.45, byTask: {} },
    rule:
      "低于阈值的候选不进 items[]，但**必须**逐条进 omissions[]（reason=`low-confidence`）——" +
      "「不得静默丢弃」；阈值**按任务类型可配**，未单独配置的任务类型用 default",
    source:
      "裁决 O-36（DECISIONS-OPEN 第 7 条：0.45 可配、配置维度＝按任务类型）；" +
      "原型「被丢弃 · 14 条低相关，相关度低于 0.45」",
  } satisfies ResolvedThreshold<RelevanceThresholdValue>,

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

  /* ── O-23 未裁的那一半：项目级 AI 权限三开关的**默认值** ──────────
   *
   * ⚠ 这三项不是「数值没人给」，是**出处被伪造过**。2026-07-30 更正前，
   * `feature_list` F58 的 notes 与 `uc-4-2:120` 都写着「默认全关为 O-23」，
   * 而 `DECISIONS-OPEN.md:655` 的 O-23 裁决行**逐字只有一句**——
   * 「裁决：合成规则 = 取交集（收紧优先），且不可被下层放宽」。
   * 「默认全关」只出现在推荐段（`:650-651`），**裁决行未提**。
   *
   * 而**原型（权威）说的是反的**（`WorkspaceX Standalone.html` 字节偏移，
   * 判读：`background:#17171A` + 旋钮 `right:2px` = 开；`#DEDCD3` + `left:2px` = 关）：
   *   `15.2532M` 设置磁贴副标题逐字「AI 权限 / 3 项 · 1 项已关」 ⇒ **2 项开**
   *   `15.2748M` 主动提议收敛 = 开 · 语音转便签 = 开 · 画布落笔 = 关（本场覆写）
   *   `15.2146M` 蓝本预览「与蓝本一致」段 `AI 可在小组画布落笔` = **开**（蓝本默认）
   * 且 `uc-4-2:103` 引 [D-10]「AI 画布写权限：**默认直接落笔**」，与蓝本默认一致。
   *
   * ⇒ 「全关」是**未被裁决、且被原型与 D-10 两次否定**的一侧。
   * 登记在此的意义：谁想拿到一个 boolean 就会**抛错**，而不是拿到一个
   * 从未被裁决的 `false`——那个 `false` 会被写进测试断言并从此变成事实标准。
   * 数值到位后改成 `{ known: true, value, source }`，`source` 必须记明裁决号。
   */
  projectAiDefaultProposeConvergence: {
    known: false,
    rule:
      "「Facilitator 主动提议收敛」开关的默认值。规则部分已定（O-23：三粒度取交集、" +
      "收紧优先、下层不可放宽、服务端求交），**只有默认值未定**",
    owner: "产品",
    blocksWhat:
      "🔴 **真实阻塞 F58**：`ai-permission-default-off.test.ts` 这个文件名本身就预设了答案。" +
      "在裁决给出前不许写该断言——原型此项为**开**，写成「默认关」会把一个" +
      "从未被裁决且与原型相反的方向固化成绿灯",
    ref: "O-23（裁决行只答了合成规则）/ 原型 15.2532M · 15.2748M / uc-4-2 R7",
  },
  projectAiDefaultVoiceToNote: {
    known: false,
    rule: "「实时转录与语音转便签」开关的默认值。同上，规则已定、默认值未定",
    owner: "产品",
    blocksWhat: "🔴 **真实阻塞 F58**：原型此项为**开**，见 `ref`",
    ref: "O-23 / 原型 15.2748M（`#17171A` + `right:2px`）/ uc-4-2 R7",
  },
  projectAiDefaultCanvasWrite: {
    known: false,
    rule:
      "「AI 直接在小组画布落笔」开关的默认值。⚠ 本项**多一层歧义**：原型里蓝本默认为" +
      "**开**（15.2146M）、这一场被覆写为**关**（15.2748M），需连带裁决" +
      "「默认值指蓝本默认还是空白新建默认」",
    owner: "产品",
    blocksWhat:
      "🔴 **真实阻塞 F58 与 07-canvas**：[D-10] 逐字「默认直接落笔」，" +
      "与「默认全关」直接相反（`uc-4-2:103` vs 旧 `:120`，相隔 17 行）",
    ref: "O-23 / D-10 / 原型 15.2146M（蓝本＝开）· 15.2748M（本场＝关）",
  },

  /* ── O-37：Skill 满意度最小样本量（F62；数值待产品确认，结构断言已定）──── */
  skillSatisfactionMinSample: {
    known: false,
    rule:
      "满意度口径 `👍/(👍+👎)`（不含未评价、不加权）；样本量（👍+👎 之和）低于最小样本量时" +
      "返回 `value: null ∧ insufficient: true`（显示「样本不足」），**不返回百分比**——" +
      "这条结构断言无论最终数值是多少都成立，可先于数值裁决实现并测试",
    owner: "产品",
    blocksWhat:
      "不阻塞：F62 的四条 verification 里 `satisfaction-sample-insufficient.test.ts` 断言的是" +
      "结构规则（低于阈值⇒样本不足），用例可用注入的任意阈值验证；" +
      "只有 `getSatisfaction` 接口接真实数据时才需要这个数",
    ref: "usecases.md:410（阈值来自 thresholds.ts）/ KNOWN_CONTRACT_GAPS.S4（skills.ts）/ F62 notes（O-37）",
  },

  /* ── F131（UC-21.1 R3 / I-30′）：第三方源隔离期天数（**有原型出处的默认值**）──── */
  mcpQuarantineDays: {
    known: true,
    value: 14,
    rule:
      "第三方源默认进入隔离期，期内仅平台组可调用；隔离期天数是组织级参数，" +
      "`quarantineUntil` 由注册时刻 + 本参数算出，代码中不得另抄一份字面量",
    source: "原型 16,683,800 逐字「第三方源默认进入 14 天隔离期」",
  } satisfies ResolvedThreshold<number>,

  /* ── F60（UC-4.4 / O-36 第 3 项）：额度异常判据 —— 相对均值倍数 + 观察窗口 ──── */
  agentQuotaAnomalyMultiplier: {
    known: true,
    value: 10,
    rule:
      "单人单日调用量达 24 小时滚动窗口均值的本倍数以上即判额度异常并自动限速；" +
      "判据是**相对均值的倍数**而非绝对阈值——代码中不得另抄一份字面量 `10`",
    source:
      "requirements/04-agent/uc-4-4-agent-行为审计.md R4/R10「裁决（O-36 第 3 项）：" +
      "10 倍 / 24 小时滚动窗口」",
  } satisfies ResolvedThreshold<number>,
  agentQuotaAnomalyWindowHours: {
    known: true,
    value: 24,
    rule: "额度异常判据的观察窗口（滚动窗口，非自然日）；与 `agentQuotaAnomalyMultiplier` 成对使用",
    source: "requirements/04-agent/uc-4-4-agent-行为审计.md R10「裁决（O-36 第 3 项）：10 倍 / 24 小时滚动窗口」",
  } satisfies ResolvedThreshold<number>,

  /* ── F60（UC-4.4 / O-36 第 4 项）：agent 互调深度上限（**唯一有原型依据的一项**）── */
  agentCallChainMaxDepth: {
    known: true,
    value: 2,
    rule:
      "agent 互调调用链深度上限；深度 3 在第 3 层被终止并留痕（防止 agent 互调递归）。" +
      "代码中不得另抄一份字面量 `2`",
    source:
      "requirements/04-agent/uc-4-4-agent-行为审计.md R10「裁决（O-36 第 4 项）：深度上限 ＝ 2" +
      "（采信原型，是 O-36 八项中唯一有原型依据的一项）」",
  } satisfies ResolvedThreshold<number>,

  /* ── O-16（F95 / uc-6-5 R3）：普遍性断言触发线 + 跨组织聚合最小样本量
   * （**全仓单一门槛**——契约与 usecases.md 明写「本束只引用不重新声明」，
   * 这两个数字只能在这里出现一次）──────────────────────────────────── */
  generalizationClaimMinIndependentSubjects: {
    known: true,
    value: 5,
    rule:
      "触发「普遍性断言」写作约束的独立受访者数下限；计数口径 = distinct(subjectId)，" +
      "同一人多次发言只算 1，`附和·非独立证据` 与 `sourceKind=virtual` 均不计入；" +
      "低于此数时阻断并给出实际人数 + 「部分受访者提到」改写建议",
    source: "requirements/06-itv/uc-6-5-访谈回流成洞察.md R3 step6「[已裁决 O-16]」/ D-16",
  } satisfies ResolvedThreshold<number>,
  crossOrgAggregationMinSample: {
    known: true,
    value: 8,
    rule: "跨组织不可逆聚合的最小样本量；低于此数的分组标「不可推断」，全仓不存在第二个聚合门槛值",
    source: "requirements/06-itv/uc-6-5-访谈回流成洞察.md R3「[已裁决 O-16]」/ D-16 / X-7",
  } satisfies ResolvedThreshold<number>,

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

/**
 * 本次装配用的相关度阈值 —— **前后端唯一的取数口**（O-36）。
 *
 * ⚠ 不许任何地方再写 `0.45`。它此前散在四处：契约注释、`usecases.md`、
 * 前端 mock 的三段文案、以及调用日志文案里；只要有人按任务类型配了一个新值，
 * 界面上那句「相关度 0.38 < 阈值 0.45」就会当场说谎，而没有任何东西会红。
 */
export function relevanceThresholdFor(task: QueryTaskName): number {
  const t = THRESHOLDS.contextPackRelevance;
  const v = requireValue<RelevanceThresholdValue>(t, "contextPackRelevance");
  return v.byTask[task] ?? v.default;
}

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
