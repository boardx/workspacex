// pr-queue.ts — coord-main 的 PR 队列状态机（#451）。**唯一事实源**：本文件的
// `PR_QUEUE_STATES` 是枚举权威，`coordinator-sop.md` 的状态表由 pr-queue.test.ts
// 机械比对——文档写多一个/少一个状态，测试当场红（AGENTS.md「同一事实不得声明在两处」）。
//
// 背景：coordinator SOP 此前只有散文描述"合并前要看 CI/review/up-to-date"，判定
// 全靠会话临场记性。真实后果反复出现：review 锚在旧 SHA 却仍被当成有效、required
// check 是 skipped 被读成"绿"、Draft PR 被当成待合并。本文件把判定变成**纯函数 +
// 反证测试**：没有网络、没有 gh、给定事实必然得到同一结论。
//
// 分层刻意如此：
//   lib/pr-queue.ts  纯判定（本文件，可单测，不碰 IO）
//   pr-queue.ts      CLI：调 gh 取事实 → 喂给本文件 → 打印/JSON
// 破坏性动作（真的 merge）**永远不在这里执行**，见 mergeAuthorization 的注释。

/** PR 队列状态枚举（权威）。顺序即严重度：越靠前越"离合并远/越需要人介入"。 */
export const PR_QUEUE_STATES = [
  "MERGE_BLOCKED",
  "WAITING_WORKER",
  "CHANGES_REQUIRED",
  "WAITING_CI",
  "WAITING_REVIEW",
  "READY_TO_MERGE",
] as const;

export type PrQueueState = (typeof PR_QUEUE_STATES)[number];

/** coord-main 的两种执行模式。`unattended` = `/loop` 定时唤醒、人类不在场。 */
export type CoordMode = "attended" | "unattended";

/** GitHub check 的结论取值（GraphQL `conclusion`，pending 时为 null）。 */
export interface RequiredCheck {
  name: string;
  /** QUEUED / IN_PROGRESS / COMPLETED；未完成时 conclusion 为 null */
  status: string;
  conclusion: string | null;
}

/** 一次正式 review（GitHub review，不是普通评论）。 */
export interface FormalReview {
  author: string;
  /** APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED */
  state: string;
  /** review 锚定的 commit SHA——head 一漂移它就失效 */
  commit: string;
}

/** 判定所需的全部事实。CLI 从 gh 取；测试直接构造。 */
export interface PrFacts {
  number: number;
  author: string;
  isDraft: boolean;
  headSha: string;
  /** PR 正文里 `Closes #N` 解析出的 issue 号 */
  closesIssues: number[];
  /** PR 正文里 `Refs #N`（`Refs`/`Ref` 关键字）解析出的 issue 号——2026-08-18
   *  加的：见 parseRefsIssues 定义处的完整说明。 */
  refsIssues: number[];
  /** GitHub `mergeStateStatus`：CLEAN / DIRTY / BLOCKED / BEHIND / UNSTABLE / UNKNOWN / HAS_HOOKS */
  mergeStateStatus: string;
  /** 该 PR 上报出的**全部** check（必需与否见 REQUIRED_CHECKS）。缺席不等于通过。 */
  checks: RequiredCheck[];
  /** issue/PR 上的 `review:*` verdict label */
  verdictLabels: string[];
  formalReviews: FormalReview[];
}

export interface PrClassification {
  number: number;
  state: PrQueueState;
  /** 命中的全部理由——**不只报最严重那条**，否则修好一条才发现还有三条。 */
  reasons: string[];
  /** 阻断合并的理由子集（reasons 里导致 state ≠ READY_TO_MERGE 的那些） */
  blockers: string[];
  /** APPROVE_CHECK_SUSPENDED=true 时，本该拦人的独立 approve 理由挪到这里——
   *  仍然算出、仍然可见，只是不影响 state。见该常量定义处的说明。 */
  advisories: string[];
}

const OK_VERDICT = "review:feature-ok";
const E2E_OK_VERDICT = "review:e2e-ok";
const CHANGES_VERDICT = "review:changes";

/** 真正代表"这条 required check 通过了"的结论。其余一律不算绿。 */
const PASSING_CONCLUSIONS = new Set(["SUCCESS"]);
/** 还没有结论——等就是了，不是失败。 */
const PENDING_STATUSES = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"]);
/** 跑完了但结论不是通过，且属于"代码要改"的那一类。 */
const FAILING_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
/** 跑完了但**根本没产生真实结论**——门禁完整性问题，不是 worker 的代码问题。 */
const VACUOUS_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL", "CANCELLED", "STALE"]);

/** 合并状态里明确不可合并/不可信的取值（BEHIND 单独处理：要 rebase，属 worker 的活）。 */
const BLOCKING_MERGE_STATES = new Set(["DIRTY", "BLOCKED", "UNKNOWN", "HAS_HOOKS"]);

/**
 * **必需 check 的唯一声明处。**
 *
 * 本仓 `main` **没有开 GitHub branch protection**（`GET /branches/main/protection`
 * 返回 404 Branch not protected），所以"哪些 check 是必需的"在 GitHub 侧根本不存在
 * ——`statusCheckRollup` 把条件跳过的 job 和真正的门禁混在一起返回。把所有 check
 * 一律当必需会得到假阳性（`check-new-merges` 条件不满足时 SKIPPED 是正常的），
 * 把它们一律当可选又会让门禁空转。这里显式声明，并由 pr-queue.test.ts 对着
 * `.github/workflows/harness-verify.yml` 的 job id 机械核对，防改名漂移。
 *
 * 语义：**声明了的 check 必须出现且必须真绿**（没出现 = WAITING_CI，不是"没有就算了"）；
 * 未声明的 check 只有 FAILURE 才计入（红就是红），SKIPPED/NEUTRAL 视为条件未命中。
 *
 * #633（人类裁决 2026-08-06）：`fullstack-smoke` 摘出这份清单——浏览器 e2e 不再阻塞
 * 合并，只阻塞发布（backend-gates.yml 的 `e2e-core-loop` job，deploy 前置条件）。
 * 光摘出清单不够：本函数对**未声明**的 check 仍然「红就是红」（见下方 FAILING_CONCLUSIONS
 * 分支，不看 isRequired），所以 `harness-verify.yml` 的 `fullstack-smoke` job 同步加了
 * `continue-on-error: true`——两处必须一起改，只改一处仍会在真失败时把 PR 判成
 * CHANGES_REQUIRED，等于没摘。
 */
/**
 * 2026-08-09（#848）：`e2e-full` 从这份清单摘出。
 *
 * 它自 2026-08-05 起就带着 `if: github.event_name != 'pull_request'`——**被明确排除在 PR
 * 之外**（当时人类指令：「只有 tag 发布的时候才做，PR 的时候先不做，以提高速度」），
 * 而清单没有跟着改。后果：`classifyPr` 对**已声明**的 check 要求「出现且真绿」，
 * `SKIPPED` 视为未通过 ⇒ **此后每一个 PR 都被判 MERGE_BLOCKED，整整五天**。
 *
 * 于是所有人（含 coord-main）绕过 `pnpm harness pr-queue`，直接 `gh pr merge`——
 * 这是「空转的门」的**反面版本**：不是恒绿没用，是**恒红被绕过**。恒红的门比没有门更糟，
 * 因为它同时消耗信任并训练所有人跳过它。
 *
 * ⚠ 现在挡发布的 e2e 是 `backend-gates.yml` 的 `e2e-core-loop`（deploy 前置条件），
 * 不在这份 **PR 合并门**清单里——两者是不同的门，别再合并进来。
 */
/**
 * 2026-08-15（ADR-106 batch-1/6，#1277）：`verify` 拆成 `verify-control-plane` +
 * `verify-affected` 两个并行 job（wall-clock 拆分，语义不变）。这次改名照着
 * pr-queue.test.ts 的机械核对走：先跑测试确认真的会红（复现 #848 那类"改名后
 * 门禁静默失效"），改完这行再确认转绿——不是先改代码再回头补测试。
 */
export const REQUIRED_CHECKS = ["verify-control-plane", "verify-affected", "verify-full-compile"] as const;

/**
 * 2026-08-16（人类第二次裁决，同一天）：独立 approve 检查（"verdict label 必须
 * 锚定当前 head 的正式 review 背书"这条）**暂停，只记录、不拦人**。
 *
 * 起因：merge-gate.ts 第一次修正（PR #1442）把条件放宽成"原生 APPROVE 或
 * review:*-ok 标签，二者取一"后，进一步核实发现全仓 300 个 PR（不限状态）里
 * review:feature-ok / review:e2e-ok 标签出现次数同样是 0——不只是没人提交原生
 * review，标签机制本身在可观测历史里似乎也没被真正打过。task_3e1337b9 正在
 * 核实这套 review 裁决机制到底有没有在实际运转。
 *
 * 这个常量**同时**门控 pr-queue.ts（本文件）与 merge-gate.ts（从本文件导入，
 * 不在那边另定义一份——同一件事只能有一个开关，不能各改各的），两个模块此后
 * 对同一个 PR 会给出一致结论，不会出现"一个放行、另一个拦"的窗口期。
 *
 * ⚠ 这**削弱了 #956/#451 本身要堵的洞**（admin bypass 绕过 review 直接合并）：
 * 人类已经知情并选择这个权衡，不是 agent 自己拍板。恢复方式：task_3e1337b9
 * 有结论后，把这个常量改回 false（如果标签机制确实在用）或重新设计整条检查
 * （如果确认根本没在用）——改这一行，两个模块同时恢复，不用分别改。
 */
export const APPROVE_CHECK_SUSPENDED = true;

/**
 * 2026-08-16（人类第三次裁决，同一天）：连"至少要有一个 review:* verdict
 * label"这条也暂停——真实 PR #1467 因为这条被 merge-gate 判 FAIL，人类要求
 * 放宽。同样是"只记录、不拦人"，不是删掉判断。
 *
 * ⚠ **只暂停"零个 label"这个子分支**，"label 不唯一/自相矛盾"（同时存在
 * review:changes 与 review:feature-ok 一类）**继续拦人**——那不是"还没被
 * review"，是数据本身自相矛盾，跟"暂停 approve 门槛"不是同一类问题，不能
 * 顺带一起放过。
 *
 * 累计效果说明清楚：APPROVE_CHECK_SUSPENDED + 本常量都为 true 时，
 * merge-gate.ts 实际只剩条件 1（body 必须含 `Closes #N`）在拦人——这是当前
 * 对 #956 保留的唯一防线。pr-queue.ts 这边"没有 verdict label"原本只是
 * WAITING_REVIEW（不是 MERGE_BLOCKED），暂停后变成不产生任何阻塞信号，
 * 仅在 advisories 里如实记录。
 *
 * 恢复方式同 APPROVE_CHECK_SUSPENDED：task_3e1337b9 有结论后改这一行。
 */
export const VERDICT_LABEL_EXISTENCE_CHECK_SUSPENDED = true;

export function isOkVerdict(label: string): boolean {
  return label === OK_VERDICT || label === E2E_OK_VERDICT;
}

/**
 * 把 PR 的客观事实判定为队列状态。**纯函数**：同样的事实必然同样的结论。
 *
 * fail-closed 纪律（每一条都对应 #451 的一个必需反证）：
 * - 事实缺失一律按最坏处理：声明过的 required check 没出现 = "没跑"，不是"CI 绿"；
 *   `mergeStateStatus` 为 UNKNOWN = 不可合并，不是"大概能合"。
 * - verdict label 只有被**锚定当前 head SHA 的正式 review** 背书才算数；head 一漂移
 *   旧 review 立即失效（铁律 9）。
 * - 作者自审不算 review——approve 者与 PR 作者同一人时，该 approve 直接不计入。
 *
 * 严重度优先级（从上往下第一个命中的决定 state；reasons 仍收集全部命中项）：
 *   MERGE_BLOCKED → WAITING_WORKER → CHANGES_REQUIRED → WAITING_CI → WAITING_REVIEW → READY_TO_MERGE
 */
/**
 * check 语义的**唯一实现**（#2540：doctor 判「关闭 issue 的 PR 合入时是否全绿」复用它，
 * 不另抄一份）。必需 check 与"顺带跑的 check"分开判：见 REQUIRED_CHECKS 的注释（本仓
 * main 没有 branch protection，GitHub 侧不存在"必需"这个概念，必须自己声明）。
 */
/**
 * StatusContext（commit status，REST `statuses` / GraphQL rollup 里的 `context`+`state`）→ RequiredCheck
 * 的**唯一**映射：它没有 status/conclusion 之分，只有一个 state（SUCCESS / PENDING / FAILURE / ERROR / EXPECTED）。
 * pr-queue.ts 读活 rollup 与 doctor ⑤ 重建合入时刻都走这里——本仓自己就会往 head 上打 commit status
 * （coord-projection 的 `coord/andon`），rollup 不是只有 CheckRun；两处各写一套映射就是第二份事实源。
 */
export function statusContextToCheck(context: string, state: string | null | undefined): RequiredCheck {
  return { name: context, status: state ? "COMPLETED" : "UNKNOWN", conclusion: state ?? null };
}

export function classifyChecks(checks: RequiredCheck[]): { blocked: string[]; changes: string[]; waitingCi: string[] } {
  const blocked: string[] = [];
  const changes: string[] = [];
  const waitingCi: string[] = [];
  const required = new Set<string>(REQUIRED_CHECKS);
  const seen = new Set<string>();
  for (const check of checks) {
    const isRequired = required.has(check.name);
    if (isRequired) seen.add(check.name);
    const status = check.status.toUpperCase();
    const conclusion = (check.conclusion ?? "").toUpperCase();
    const label = isRequired ? "required check" : "check";
    if (PASSING_CONCLUSIONS.has(conclusion)) continue;
    if (conclusion === "" || PENDING_STATUSES.has(status)) {
      // 非必需的 check 还没跑完不该拦着——但必需的必须等
      if (isRequired) waitingCi.push(`required check \`${check.name}\` 还没有结论（status=${check.status}）`);
      continue;
    }
    if (FAILING_CONCLUSIONS.has(conclusion)) {
      // 红就是红：即使不在必需清单里，也不当作没看见
      changes.push(`${label} \`${check.name}\` 结论 ${conclusion}——退回 worker 修（先按 SOP 分诊是否基础设施问题）`);
      continue;
    }
    if (VACUOUS_CONCLUSIONS.has(conclusion)) {
      // 必需的 check 空转 = 门禁完整性问题；非必需的空转 = 条件没命中，正常
      if (isRequired)
        blocked.push(
          `required check \`${check.name}\` 结论 ${conclusion}——**没有产生真实通过**，` +
            "这是门禁完整性问题（空转的门），不是 worker 的代码问题，必须由 coord-main 查 workflow 条件",
        );
      continue;
    }
    if (isRequired) blocked.push(`required check \`${check.name}\` 结论 ${conclusion} 不在已知取值内——未知一律不放行`);
  }
  for (const name of REQUIRED_CHECKS) {
    // 缺席 ≠ 通过。三态纪律与 module-lock 的 queryActiveClaim 一致：问不到不等于空闲。
    if (!seen.has(name)) waitingCi.push(`required check \`${name}\` 根本没有出现在这个 PR 上——没跑不等于绿`);
  }
  return { blocked, changes, waitingCi };
}

export function classifyPr(facts: PrFacts): PrClassification {
  const blocked: string[] = [];
  const waitingWorker: string[] = [];
  const changes: string[] = [];
  const waitingCi: string[] = [];
  const waitingReview: string[] = [];
  const advisories: string[] = [];

  // ── 1. 关联 issue ────────────────────────────────────────────────────────
  // 2026-08-18 修正（实测 PR #1540 反证）：原来只认 Closes #N，会把"一个大 issue
  // 拆多个连续 PR 交付、中间几块用 Refs 不用 Closes（只有最后一块该关闭 issue）"
  // 这类**合法模式**误判——#1493 这个 issue 就是这么拆的（#1537/#1540/…）。
  // 这条检查的本意是"能追溯到 issue"（#956 事故是完全没有任何 issue 关联），
  // 不是"必须由这个 PR 关闭"——两件事之前混成了一条规则，现在拆开：Closes 或
  // Refs 任一存在都算满足"可追溯"，不再要求必须是 Closes。
  // 判据本体在 issueTraceabilityFailure（与 merge-gate.ts 共享，见其定义处）。
  // 这里 facts 已经是解析好的 issue 号数组，直接用长度判断，语义与共享判据一致；
  // pr-queue.test.ts 有一条用例机械比对两者结论，防止哪天单独改一处又分叉。
  if (facts.closesIssues.length === 0 && facts.refsIssues.length === 0) {
    blocked.push(
      "PR 正文既没有 `Closes #N` 也没有 `Refs #N`——追溯不到任何 issue（AGENTS.md 完成定义第 5 条）",
    );
  }

  // ── 2. verdict label 自洽性 ──────────────────────────────────────────────
  const okLabels = facts.verdictLabels.filter(isOkVerdict);
  const hasChanges = facts.verdictLabels.includes(CHANGES_VERDICT);
  if (okLabels.length > 0 && hasChanges) {
    blocked.push(
      `verdict label 自相矛盾：同时存在 ${CHANGES_VERDICT} 与 ${okLabels.join("/")}——` +
        "必须由 coord-main 摘除过期的那个再重判（铁律 1）",
    );
  }

  // ── 3. 合并状态 ──────────────────────────────────────────────────────────
  const mergeState = facts.mergeStateStatus.toUpperCase();
  if (BLOCKING_MERGE_STATES.has(mergeState)) {
    blocked.push(`mergeStateStatus=${mergeState}——GitHub 侧就不可合并/不可信，不存在"本地验过所以能合"的绕行（铁律 3）`);
  }

  // ── 4. checks ────────────────────────────────────────────────────────────
  // 语义在 classifyChecks（与 doctor 的完成定义第 7 条共用同一份，#2540）。
  {
    const gaps = classifyChecks(facts.checks);
    blocked.push(...gaps.blocked);
    changes.push(...gaps.changes);
    waitingCi.push(...gaps.waitingCi);
  }

  // ── 5. review 锚定 SHA + 禁止自审 ────────────────────────────────────────
  // 事实分类走共享的 classifyApprovals（与 merge-gate.ts 同一份算法，见其定义处）；
  // 但**怎么用**这些事实两边不同，那是各自的规则，不共享。
  const { independentCurrentSha: currentShaApprovals, selfApprovals, staleApprovals } =
    classifyApprovals(facts.formalReviews, facts.author, facts.headSha);
  if (selfApprovals.length > 0) {
    blocked.push(`作者自审：${facts.author} 自己 approve 了自己的 PR——独立性是 review 的全部意义（铁律 1）`);
  }

  if (facts.formalReviews.some((r) => r.state.toUpperCase() === "CHANGES_REQUESTED" && r.commit === facts.headSha)) {
    changes.push("当前 head SHA 上有 CHANGES_REQUESTED 的正式 review");
  }
  if (hasChanges) {
    changes.push(`带 ${CHANGES_VERDICT} label——等 worker 返工`);
  }
  if (okLabels.length > 0 && currentShaApprovals.length === 0) {
    const reason =
      `verdict label ${okLabels.join("/")} 没有锚定当前 head \`${facts.headSha}\` 的独立 approve 背书` +
      (staleApprovals.length > 0
        ? `（只有锚在 ${staleApprovals.map((r) => r.commit).join("/")} 的旧 review，head 已漂移，旧结论失效，铁律 9）`
        : "（根本查不到对应的正式 review——来路不明的 verdict 应摘除后重判，铁律 1）");
    // APPROVE_CHECK_SUSPENDED 时降级为 advisory，不再进 blocked（见该常量定义处）。
    (APPROVE_CHECK_SUSPENDED ? advisories : blocked).push(
      APPROVE_CHECK_SUSPENDED ? `[已暂停，仅记录] ${reason}` : reason,
    );
  }
  if (okLabels.length === 0) {
    // VERDICT_LABEL_EXISTENCE_CHECK_SUSPENDED 时降级为 advisory，不再进
    // waitingReview（见该常量定义处，2026-08-16 人类第三次裁决）。
    const reason = "还没有 `review:*-ok` verdict——按 SOP §3 路由调起必需 reviewer";
    (VERDICT_LABEL_EXISTENCE_CHECK_SUSPENDED ? advisories : waitingReview).push(
      VERDICT_LABEL_EXISTENCE_CHECK_SUSPENDED ? `[已暂停，仅记录] ${reason}` : reason,
    );
  } else if (!APPROVE_CHECK_SUSPENDED && currentShaApprovals.length === 0) {
    waitingReview.push(`需要针对当前 head \`${facts.headSha}\` 重新派 exact-SHA review`);
  }

  // ── 6. Draft ─────────────────────────────────────────────────────────────
  if (facts.isDraft) {
    waitingWorker.push("PR 仍是 Draft——作者尚未宣称完成，不进入 review/合并流程");
  }
  if (mergeState === "BEHIND") {
    waitingWorker.push("mergeStateStatus=BEHIND——分支落后 base，worker 需要 rebase 后重跑 CI");
  }

  const reasons = [...blocked, ...waitingWorker, ...changes, ...waitingCi, ...waitingReview];
  const state: PrQueueState =
    blocked.length > 0
      ? "MERGE_BLOCKED"
      : waitingWorker.length > 0
        ? "WAITING_WORKER"
        : changes.length > 0
          ? "CHANGES_REQUIRED"
          : waitingCi.length > 0
            ? "WAITING_CI"
            : waitingReview.length > 0
              ? "WAITING_REVIEW"
              : "READY_TO_MERGE";

  return {
    number: facts.number,
    state,
    reasons,
    blockers: state === "READY_TO_MERGE" ? [] : reasons,
    advisories,
  };
}

/** 从 PR 正文解析 `Closes #N` / `closes #N`（GitHub 支持的闭合关键字取常用子集）。 */
export function parseClosesIssues(body: string): number[] {
  const out = new Set<number>();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  for (const m of body.matchAll(re)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/**
 * 从 PR 正文解析 `Refs #N` / `Ref #N`（大小写不敏感）——GitHub 不会因为这个
 * 关键字自动关闭 issue，纯粹是"这个 PR 跟那个 issue 有关"的声明。
 *
 * 用途：一个大 issue 拆成多个连续 PR 交付时，中间几块只 `Refs`，只有最后一块
 * `Closes`。见 pr-queue.ts classifyPr 条件 1 与 merge-gate.ts 条件 1 的说明——
 * "能追溯到 issue"（Closes 或 Refs 任一）和"这个 PR 该不该关闭 issue"（只看
 * Closes）是两件事，本函数只负责前者的"Refs"那一半。
 */
export function parseRefsIssues(body: string): number[] {
  const out = new Set<number>();
  const re = /\bref[s]?\s+#(\d+)\b/gi;
  for (const m of body.matchAll(re)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

// ── 与 merge-gate.ts 共享的判据（ADR-107 阶段二 a，2026-08-18）─────────────
//
// ⚠ 范围说明（实测修正 ADR-107 的原始设想，别照 ADR 正文直接理解）：
//
// ADR-107 阶段二 a 原本写的是"merge-gate 变成对 pr-queue 判定结果的薄包装"。
// 实测两条否决它：
//   ① `merge-gate` job 在 harness-verify.yml 里**没有 needs**，与 verify-* 并发
//      跑；而 classifyPr 要求全部 REQUIRED_CHECKS 存在且为绿，否则判 WAITING_CI。
//      薄包装会让 merge-gate 在那些 check 还在跑时永远看到 pending ⇒ 恒失败。
//   ② 两个模块的条件 2/3 **不是重复，是不同的规则**：
//      · 条件 2：pr-queue 判"ok 与 changes 标签自相矛盾"；merge-gate 判"恰好
//        一个 review:* 标签"（零个/多个都失败）——不同判据。
//      · 条件 3：pr-queue 判"**有** ok 标签**但**缺 approve 背书"（来路不明的
//        verdict）；merge-gate 判"approve 与 ok 标签**都没有**"——触发条件相反。
//   ⇒ 强行合并会把两套真实存在的不同规则揉成一套，那是引入 bug，不是消除重复。
//
// 真正逐字重复的只有**条件 1（issue 可追溯）**，抽在下面。approve 相关的事实
// 计算（哪些是独立的/锚定当前 head 的/陈旧的）两边算法一样、用途不同，也抽出来
// 共享，避免再出现 #1547 那种"改了一处忘另一处"。

/** 条件 1 共享判据：PR 能否追溯到 issue。返回失败理由；null = 通过。 */
export function issueTraceabilityFailure(body: string): string | null {
  if (parseClosesIssues(body).length === 0 && parseRefsIssues(body).length === 0) {
    return "PR 正文既没有 `Closes #N` 也没有 `Refs #N`——追溯不到任何 issue（AGENTS.md 完成定义第 5 条）";
  }
  return null;
}

/** approve 事实的分类结果——两个模块算法相同，但下游怎么用各不相同。 */
export interface ApprovalFacts {
  /** 非作者本人 + 锚定当前 head 的 APPROVE */
  independentCurrentSha: FormalReview[];
  /** 作者自己 approve 自己 */
  selfApprovals: FormalReview[];
  /** 非作者本人但锚在旧 SHA（head 已漂移，结论失效） */
  staleApprovals: FormalReview[];
}

/** 把 review 列表按"独立性 + 是否锚定当前 head"分类。纯函数，无 IO。 */
export function classifyApprovals(
  reviews: FormalReview[],
  author: string,
  headSha: string,
): ApprovalFacts {
  const approvals = reviews.filter((r) => r.state.toUpperCase() === "APPROVED");
  return {
    independentCurrentSha: approvals.filter((r) => r.author !== author && r.commit === headSha),
    selfApprovals: approvals.filter((r) => r.author === author),
    staleApprovals: approvals.filter((r) => r.author !== author && r.commit !== headSha),
  };
}

export interface MergeAuthorization {
  allowed: boolean;
  reason: string;
}

/**
 * 合并授权判定。**本函数不合并任何东西**——它只回答"现在允许人去点合并吗"。
 *
 * 两条 fail-closed：
 * 1. `unattended`（`/loop` 定时唤醒、人类不在场）**永远** false，哪怕状态是
 *    READY_TO_MERGE。铁律 12 的原话是 "NEVER attempt to merge a PR yourself"。
 * 2. mode 无法确定时按 `unattended` 处理（见 resolveCoordMode）——默认不授权。
 *
 * 真正的 `gh pr merge` 由人类执行：CLI 只把命令打印出来。这是
 * loop-design-principles「破坏性动作永远在 loop 之外」的直接落地，不是保守。
 */
export function mergeAuthorization(state: PrQueueState, mode: CoordMode): MergeAuthorization {
  if (mode !== "attended") {
    return {
      allowed: false,
      reason:
        "无人值守模式（unattended）下一律不授权合并——只推进到 READY_TO_MERGE 并汇报，" +
        "等人类在场处理（coordinator-sop.md 铁律 12）",
    };
  }
  if (state !== "READY_TO_MERGE") {
    return { allowed: false, reason: `状态是 ${state}，不是 READY_TO_MERGE——机械门禁未全绿` };
  }
  return { allowed: true, reason: "机械门禁全绿且人类在场：可由 coord-main 执行合并" };
}

/**
 * 模式解析，fail-closed：**只有**显式 `--attended` 才算人类在场。
 * 缺省、拼错、环境变量说了别的——一律 unattended（不授权合并）。
 */
export function resolveCoordMode(flags: Record<string, boolean>): CoordMode {
  return flags["attended"] === true ? "attended" : "unattended";
}

/** 合并后收尾核验所需事实。 */
export interface PostMergeFacts {
  number: number;
  merged: boolean;
  mergeCommit: string | null;
  /** 该 merge commit 是否真的在 main 的历史里（`git branch --contains` 实测，不信 API 措辞） */
  mergeCommitOnMain: boolean;
  closesIssues: number[];
  /** 关联 issue 的实际状态：号 → 是否已 CLOSED */
  issueClosed: Record<number, boolean>;
  /** 该合并是否触发了需要盯的 CD/健康检查；null = 没查到（按未确认处理） */
  deploymentTracked: boolean | null;
}

/** 合并后核验：返回未通过的项。空数组 = 收尾干净。 */
export function postMergeGaps(facts: PostMergeFacts): string[] {
  const gaps: string[] = [];
  if (!facts.merged) gaps.push(`PR #${facts.number} 并未处于 merged 状态`);
  if (!facts.mergeCommit) gaps.push("拿不到 merge commit——无法证明代码进了 main");
  if (!facts.mergeCommitOnMain)
    gaps.push(`merge commit ${facts.mergeCommit ?? "(缺失)"} 不在 main 的历史里——"标了 merged 但代码不在 main" 是假完成`);
  if (facts.closesIssues.length === 0) gaps.push("没有关联 issue，无法核验 issue 是否关闭");
  for (const issue of facts.closesIssues) {
    if (facts.issueClosed[issue] !== true) gaps.push(`关联 issue #${issue} 仍未关闭`);
  }
  if (facts.deploymentTracked !== true)
    gaps.push("未确认相关 CD / 健康检查已进入监控——查不到按未进入处理（fail-closed）");
  return gaps;
}
