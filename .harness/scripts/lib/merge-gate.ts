// merge-gate.ts — #956 机械合并门禁（fail-closed）。
//
// 背景（2026-08-11 20:33 CST 事故）：`pr-queue` 在 20:32 仍把 #954/#943/#922 裁成
// WAITING_REVIEW / MERGE_BLOCKED，随后 repo owner（有 admin bypass 权限）在约 4 秒内
// 直接合并三项——`mergedBy=usamshen`、`latestReviews=[]`、`labels=[]`，其中 #922
// 合并前正文没有 `Closes #N`。`pr-queue` 是**只读建议**（见该文件头注释：不合并、
// 不改 label），从来就不是拦人的东西；coordinator-sop 的门禁完全靠自律，管理员
// bypass 一按就绕过。issue #956 要求"机械阻止,不能只靠 coordinator 自律"。
//
// 本文件只做一件更窄的事：给定单个 PR 在**当前 HEAD SHA** 上的客观事实（review
// 列表、label 列表、body），机械判定它是否满足三条合并前置条件——
//   1. 当前 head SHA 有一条独立（非作者本人）APPROVE review（COMMENT 不算数），
//      **或**存在 `review:*-ok` verdict label（见下方 2026-08-16 说明，两者取其一）
//   2. 恰好一个 `review:*` verdict label（0 个或 ≥2 个都判失败——ADR-023 铁律 1：
//      verdict 矛盾必须先摘除过期的再重判，"选一个凑合"不算通过）
//   3. body 含 `Closes #<issue>`
// 任一条不满足 → FAIL，退出非零。这段逻辑接成 CI job 后失败会挡住 PR 状态转绿，
// 但**不能**挡住 admin bypass（branch protection 没开、或开了没勾 "Include
// administrators" 时，管理员仍可无视任何 required check 直接点合并）——那一步
// 是 GitHub 仓库设置，必须人类在 Settings → Branches 手动做，见 merge-gate.ts
// CLI 与 PR 描述里的说明。
//
// `Closes #N` 解析复用 pr-queue.ts 的 parseClosesIssues、"OK 档 verdict" 判定复用
// 同文件的 isOkVerdict——同一条判定规则不允许在两处各写一份（AGENTS.md「同一
// 事实不得声明在两处」；本仓已因此漂移五次）。
//
// ⚠ 2026-08-16 修正：条件 1 原本**只**接受 GitHub 原生 APPROVE review。实测本仓
// 最近 100 个已合并 PR 里，0 个有原生 APPROVE，全仓也搜不到任何脚本调用过
// `gh pr review`。改成"原生 APPROVE 或 review:*-ok 标签，二者取一"（PR #1442）。
//
// ⚠⚠ 2026-08-16（同一天，人类第二次裁决）：进一步核实发现全仓 300 个 PR（不限
// 状态）里 review:feature-ok / review:e2e-ok 标签出现次数同样是 **0**——不只是
// 没人提交原生 review，标签机制本身在可观测历史里似乎也没被真正打过。task_3e1337b9
// 正在核实这套 review 裁决机制到底有没有在实际运转。在核实结果出来前，
// APPROVE_CHECK_SUSPENDED=true 让条件 3（独立 approve）**只记录、不拦人**——
// 这是明确的临时状态，不是把检查删掉。它连带**削弱了 #956 本身要堵的洞**
// （admin bypass 绕过 review 直接合并），人类已经知情并选择这个权衡，不是
// agent 自己拍板。恢复方式：task_3e1337b9 有结论后，把这个常量改回 false（如果
// 标签机制确实在用）或重新设计条件 3（如果确认根本没在用）。pr-queue.ts 的
// 同款检查同批次一起暂停，避免两个模块对同一个 PR 给出矛盾结论（见该文件同名
// 常量——APPROVE_CHECK_SUSPENDED 定义在那边，本文件只 import，不重复声明）。
import { APPROVE_CHECK_SUSPENDED, isOkVerdict, parseClosesIssues } from "./pr-queue";

/** 一次正式 review（GitHub review，不是普通评论）。与 pr-queue.ts 的 FormalReview 同形状。 */
export interface FormalReview {
  author: string;
  /** APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED */
  state: string;
  /** review 锚定的 commit SHA——head 一漂移它就失效 */
  commit: string;
}

/** 判定所需的全部事实。CLI 从 gh 取；测试直接构造。 */
export interface MergeGateFacts {
  number: number;
  author: string;
  headSha: string;
  body: string;
  labels: string[];
  reviews: FormalReview[];
}

export interface MergeGateResult {
  passed: boolean;
  /** 命中的全部失败理由——不只报第一条，方便一次性修完。 */
  reasons: string[];
  /** APPROVE_CHECK_SUSPENDED=true 时，条件 3 本该报的理由挪到这里——仍然打印出来，
   *  只是不计入 passed。空转的门是"看着挡、实际没挡"；这里反过来，是"明说没挡、
   *  但记录了它本来会挡什么"，两者不是一回事，不要混淆。 */
  advisories: string[];
}

const VERDICT_PREFIX = "review:";

/**
 * 机械判定一个 PR 是否满足 #956 的三条合并前置条件。**纯函数**：同样的事实
 * 必然同样的结论，没有网络、没有 gh、可单测。
 */
export function evaluateMergeGate(facts: MergeGateFacts): MergeGateResult {
  const reasons: string[] = [];
  const advisories: string[] = [];

  // ── 1. Closes #N ─────────────────────────────────────────────────────────
  if (parseClosesIssues(facts.body).length === 0) {
    reasons.push("PR 正文没有 `Closes #N`——合并后 issue 不会关闭，审计链断在这里（AGENTS.md 完成定义第 5 条）");
  }

  // ── 2. 唯一 verdict label ────────────────────────────────────────────────
  const verdictLabels = facts.labels.filter((l) => l.startsWith(VERDICT_PREFIX));
  if (verdictLabels.length === 0) {
    reasons.push("没有任何 `review:*` verdict label——还没有人正式裁决过这个 PR");
  } else if (verdictLabels.length > 1) {
    reasons.push(
      `verdict label 不唯一：同时存在 ${verdictLabels.join("/")}——必须先摘除过期的那个再重判（ADR-023 铁律 1），不能选一个凑合`,
    );
  }

  // ── 3. 独立 approve：GitHub 原生 APPROVE review 优先，其次接受 review:*-ok 标签 ──
  // 作者自审不算 review；COMMENT/CHANGES_REQUESTED 都不算 APPROVE；锚在旧 SHA 的
  // APPROVE 在 head 漂移后立即失效——同一条铁律，pr-queue.ts 已实现过一次，这里
  // 因为只关心"通过与否"而非完整队列状态机，判定更窄，但结论必须与之一致。
  //
  // 标签路径（2026-08-16 新增，见文件头说明）：只要存在任一 `-ok` 后缀的 verdict
  // 标签（`review:feature-ok`/`review:e2e-ok`），就当作满足本条——不再要求同时
  // 有原生 APPROVE。标签本身没有"是否锚定当前 head"这个概念（GitHub label 不
  // 记快照 SHA），所以标签路径**不做 head 漂移检查**——这是已知的、比原生 review
  // 路径更弱的地方，不是疏漏。
  const approvals = facts.reviews.filter((r) => r.state.toUpperCase() === "APPROVED");
  const independentCurrentShaApprovals = approvals.filter(
    (r) => r.author !== facts.author && r.commit === facts.headSha,
  );
  const hasOkVerdictLabel = facts.labels.some(isOkVerdict);
  if (independentCurrentShaApprovals.length === 0 && !hasOkVerdictLabel) {
    const selfApprovals = approvals.filter((r) => r.author === facts.author);
    const staleApprovals = approvals.filter((r) => r.author !== facts.author && r.commit !== facts.headSha);
    let reason: string;
    if (selfApprovals.length > 0) {
      reason = `作者自审：${facts.author} 自己 approve 了自己的 PR——独立性是 review 的全部意义`;
    } else if (staleApprovals.length > 0) {
      reason =
        `只有锚在旧 SHA 的 APPROVE（${staleApprovals.map((r) => r.commit.slice(0, 12)).join("/")}）,` +
        `当前 head \`${facts.headSha.slice(0, 12)}\` 已漂移，旧结论失效，也没有 review:*-ok 标签兜底`;
    } else {
      reason = "当前 head SHA 上没有独立 APPROVE review，也没有 review:*-ok 标签——COMMENT/CHANGES_REQUESTED 都不算数";
    }
    // APPROVE_CHECK_SUSPENDED 时降级为 advisory：仍然算出、仍然打印，只是不拦人。
    // 见文件头 2026-08-16 第二次裁决的说明。
    (APPROVE_CHECK_SUSPENDED ? advisories : reasons).push(
      APPROVE_CHECK_SUSPENDED ? `[已暂停，仅记录] ${reason}` : reason,
    );
  }

  return { passed: reasons.length === 0, reasons, advisories };
}
