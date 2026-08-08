/**
 * review-decision-model.ts —— PROP-HARNESS-AGENT-001 H3A-036（Epic E3，依赖
 * H3A-027 的 producer/verifier separation 先例、H3A-033 的 Workflow Event
 * envelope 校验风格）。
 *
 * 完成契约原文（`docs/proposals/PROP-HARNESS-AGENT-001.checklist.md`
 * H3A-036）："TPL-RVW-001 Revision-bound Review Decision | 027、033 |
 * revision、producer、reviewer、evidence 完整"。
 *
 * "revision" 对应字段是 `exact_sha`——绑定到一个精确 commit，不是模糊的
 * "最新代码"（Proposal TERM-WFL-014："exact-SHA review → Revision-bound
 * Review / 版本绑定审查"）。
 *
 * 形状取自 Proposal §10.5 的示例（PROP-HARNESS-AGENT-001.md:650-663）：
 *
 *   template_id: TPL-RVW-001
 *   template_version: 1
 *   instance_id: RVW-pr000-abcdef1
 *   task_id: TSK-658-canvas-01
 *   reviewer: <directory-agent-id>
 *   producer: <different-directory-agent-id>
 *   exact_sha: abcdef123456
 *   decision: approve
 *   evidence_refs: []
 *   findings: []
 *
 * line 665 原文："`reviewer == producer`、SHA 不匹配、evidence 不可读或
 * reviewer lease 无效时 Review Decision 无效。Task Result 只陈述产物和执行
 * 结果，不能隐含 APPROVE。"
 *
 * ⚠ 诚实标注——`decision` 枚举的推断依据：
 *   Proposal 原文只给出 `decision: approve` 一个逐字示例，没有在任何地方给出
 *   `decision` 字段的完整枚举清单。§11 状态机（PROP-HARNESS-AGENT-001.md:679-681）
 *   给出的是 transition 标签，不是字段值本身：
 *     verifying --> running: CHANGES + retry budget
 *     verifying --> ready_for_integration: independent APPROVE
 *   本文件把 `decision` 枚举推断为 `"approve" | "request_changes" | "reject"`：
 *     - `approve` 是原文逐字示例，直接采用；
 *     - `request_changes` 对应状态机的 CHANGES 分支语义（打回重做，走 retry
 *       budget，不是终止）；
 *     - `reject` 补一个"终止、不再走 retry"的第三态，避免只有二元 approve/
 *       CHANGES 时无法表达"这条路径彻底不通过"（H3A-036 完成契约本身没有
 *       要求"决定不可终止拒绝"，Proposal P6"独立验证是组织结构"也隐含
 *       reviewer 有权给出非临时性的否决）。
 *   如果后续 ADR 或 Proposal 补丁给出跟这里不一致的完整枚举，以原文为准，
 *   本文件的推断让路——同 workflow-event-model.ts 对 blocker/task_result
 *   专属字段的推断让路先例。
 *
 * 范围边界（同 H3A-030/033 的先例，避免越界做别人的事）：
 *   - 本条目只做**单表 schema 结构完整性**：字段存在、类型正确、
 *     `decision` 枚举合法。
 *   - **`reviewer === producer` 是这份 schema 自己的字段级约束**——直接在
 *     单表校验里判 FAIL，因为这是"同一份 Review Decision 实例内部两个字段
 *     是否相等"的字符串比较，不需要查任何外部权威源，属于结构完整性检查
 *     的一部分（同这个字段本身"完整"的含义——如果两个字段填了同一个值，
 *     这份 Review Decision 在语义上就是自相矛盾的，同 H3A-030
 *     `acceptance_refs` 空数组不算"完整"的判定风格）。
 *     这跟 H3A-027 `checkProducerVerifierSeparation`
 *     （role-authorization.ts）不是一回事、不重复：H3A-027 检查的是**角色
 *     注册表层面的静态一致性**——`registry.yaml` 的 `agents:`/`reviewers:`
 *     两个数组有没有身份重叠、6 个持久角色文件的 kind 有没有自相矛盾，这是
 *     "谁在系统里天生具备既能生产又能评审的身份"；本文件检查的是**某一份
 *     具体 Review Decision 实例**填的 `reviewer`/`producer` 两个字段是否
 *     恰好填成了同一个值——即使两个身份本身在注册表层面完全合法分离
 *     （一个只在 agents[]、一个只在 reviewers[]），也可能有人在具体实例里
 *     手滑或刻意填成同一个 actor，这条本文件必须自己拦，不能指望 H3A-027
 *     替它兜底（H3A-027 根本不读单份实例）。两者互补，没有交集重复。
 *   - SHA 是否等于当前受审对象的真实 exact SHA（"revision 是否 stale"）、
 *     evidence_refs 指向的路径是否真实可读、reviewer lease 是否有效——都是
 *     运行态语义，需要查询当前 Git HEAD/lease 系统/文件系统真实状态，不是
 *     单份 YAML 的结构校验，故意不在这里做（同 task-assignment-model.ts
 *     对 authority_snapshot_hash "只检查非空字符串存在，不校验是否等于当前
 *     哈希"的先例）。
 *   - `task_id` 指向的 Task Assignment 是否真实存在——跨表检查，留给未来
 *     的 dispatch/gate 条目（同 workflow-event-model.ts 对 task_id 的先例）。
 *   - `findings` 数组内部结构（severity/code/message 等）——Proposal 没有
 *     给出这个字段的形状，示例里 `findings: []`，本文件只检查"是字符串数组
 *     还是别的什么"这一步都不做假设，按"任意数组，元素形状不校验"处理，
 *     避免编一个 Proposal 没写的结构。
 *
 * 今天没有任何真实 TPL-RVW-001 实例——Epic E3 才刚起步，这是仓库的真实状态，
 * 不是本条目的 bug（同 task-assignment-model.ts/workflow-event-model.ts
 * 落地时 0 个真实实例的先例）。
 *
 * 校验风格延续 task-assignment-model.ts/workflow-event-model.ts 的先例：
 * plain TS interface + 手写校验函数，累积上报全部问题，不 fail-fast。
 */

export const REVIEW_DECISION_TEMPLATE_ID = "TPL-RVW-001" as const;

/** ⚠ 推断枚举——见文件头部注释。`approve` 是 Proposal 逐字示例，其余两项推断自 §11 状态机语义。 */
export const REVIEW_DECISIONS = ["approve", "request_changes", "reject"] as const;
export type ReviewDecisionVerdict = (typeof REVIEW_DECISIONS)[number];

export interface ReviewDecision {
  template_id: typeof REVIEW_DECISION_TEMPLATE_ID;
  template_version: number;
  instance_id: string;
  task_id: string;
  reviewer: string;
  producer: string;
  /** "revision"——完成契约字面用词，绑定到精确 commit（Proposal §10.5 原文字段名）。 */
  exact_sha: string;
  decision: ReviewDecisionVerdict;
  evidence_refs: string[];
  /** Proposal 没有给出内部结构（示例是 `findings: []`），元素形状不校验——见文件头部范围边界说明。 */
  findings: unknown[];
  /** 扫描时附加的定位信息，不是文档自身字段。 */
  sourceFile: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value: T | null;
  issues: ValidationIssue[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * 校验一份已解析的 YAML 是否是合法的 TPL-RVW-001 Review Decision 实例。
 * 调用方负责先判断"这份 YAML 看起来像不像 Review Decision"（同
 * task-assignment-model.ts 的 looksLikeTaskAssignment 先例）。
 */
export function validateReviewDecision(raw: unknown, sourceFile: string): ValidationResult<ReviewDecision> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#${field}`;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: sourceFile, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  if (r.template_id !== REVIEW_DECISION_TEMPLATE_ID) {
    issues.push({ path: p("template_id"), message: `必须等于 "${REVIEW_DECISION_TEMPLATE_ID}"，实得 ${JSON.stringify(r.template_id)}` });
  }
  if (typeof r.template_version !== "number" || !Number.isInteger(r.template_version) || r.template_version < 1) {
    issues.push({ path: p("template_version"), message: `必须是 ≥1 的整数，实得 ${JSON.stringify(r.template_version)}` });
  }
  if (!isNonEmptyString(r.instance_id)) issues.push({ path: p("instance_id"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.task_id)) issues.push({ path: p("task_id"), message: "必须是非空字符串" });

  const reviewerOk = isNonEmptyString(r.reviewer);
  if (!reviewerOk) issues.push({ path: p("reviewer"), message: "必须是非空字符串——完成契约要求 reviewer 完整" });
  const producerOk = isNonEmptyString(r.producer);
  if (!producerOk) issues.push({ path: p("producer"), message: "必须是非空字符串——完成契约要求 producer 完整" });

  // reviewer === producer：这份实例自己的字段级约束（同 actor 自产自签），
  // 不是跨表查 registry.yaml——见文件头部与 H3A-027 的分工说明。只在两个
  // 字段都是合法非空字符串时才比较，避免对"两个都缺失/都是空字符串"这种
  // 已经被上面两条 FAIL 覆盖的情况重复报告。
  if (reviewerOk && producerOk && r.reviewer === r.producer) {
    issues.push({
      path: p("reviewer"),
      message:
        `reviewer 和 producer 相同（都是 "${String(r.reviewer)}"）——Proposal §10.5 原文："reviewer == producer` +
        `……时 Review Decision 无效"，同一 actor 不能自产自签`,
    });
  }

  if (!isNonEmptyString(r.exact_sha)) {
    issues.push({ path: p("exact_sha"), message: "必须是非空字符串——完成契约要求 revision（exact_sha）完整，Proposal §10.5 原文" });
  }

  if (!REVIEW_DECISIONS.includes(r.decision as ReviewDecisionVerdict)) {
    issues.push({
      path: p("decision"),
      message: `必须是 ${REVIEW_DECISIONS.map((d) => `"${d}"`).join(" | ")} 之一（推断枚举，见文件头部注释），实得 ${JSON.stringify(r.decision)}`,
    });
  }

  if (!Array.isArray(r.evidence_refs) || !r.evidence_refs.every((x) => typeof x === "string") || r.evidence_refs.length === 0) {
    issues.push({
      path: p("evidence_refs"),
      message: "必须是至少含 1 个元素的字符串数组——完成契约要求 evidence 完整，空 evidence 不算完整（同 H3A-030 acceptance_refs 先例）",
    });
  }

  if (!Array.isArray(r.findings)) {
    issues.push({ path: p("findings"), message: "必须是数组（可以为空数组，但字段本身必须存在；元素内部形状 Proposal 未定义，不校验）" });
  }

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      template_id: REVIEW_DECISION_TEMPLATE_ID,
      template_version: r.template_version as number,
      instance_id: r.instance_id as string,
      task_id: r.task_id as string,
      reviewer: r.reviewer as string,
      producer: r.producer as string,
      exact_sha: r.exact_sha as string,
      decision: r.decision as ReviewDecisionVerdict,
      evidence_refs: r.evidence_refs as string[],
      findings: r.findings as unknown[],
      sourceFile,
    },
    issues: [],
  };
}

/** 判断一份已解析的 YAML 是否"看起来像" TPL-RVW-001 实例。 */
export function looksLikeReviewDecision(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  return (parsed as Record<string, unknown>).template_id === REVIEW_DECISION_TEMPLATE_ID;
}
