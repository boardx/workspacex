/**
 * review-decision-stale-gate.ts —— PROP-HARNESS-AGENT-001 H3A-037（Epic E3，
 * 依赖 H3A-036 的 TPL-RVW-001 schema，见 review-decision-model.ts）。
 *
 * 完成契约原文（`docs/proposals/PROP-HARNESS-AGENT-001.checklist.md`
 * H3A-037）："Review Decision stale gate | 036 | head/artifact 改变后旧
 * decision 自动失效"。
 *
 * 判定思路（同 H3A-034 workflow-event-append-only-gate.ts 的分层先例）：
 *   一份 Review Decision 绑定 `exact_sha`（它审的是哪个精确 commit）。如果
 *   对应分支/PR 之后又有了新 commit（head 领先于 exact_sha），或者
 *   `exact_sha` 这个 commit 本身在当前历史里已经不可达（被 rewrite/
 *   force-push），这份旧的 approve/request_changes/reject 就不该继续为
 *   "当前代码"背书——判 stale。
 *
 *   "head 改变" 与 "artifact 改变" 在这里收敛成同一件事：一次 Review
 *   Decision 审的对象就是 `exact_sha` 这个 commit 的完整 tree（它引用的
 *   所有 artifact 内容都固定在这个 commit 里）。只要 head 严格领先于
 *   `exact_sha`（有新 commit），这个 commit 的 tree 相对"当前代码"就已经
 *   过时——不需要另外逐个文件比对 artifact 内容，那是同一件事的重复表达。
 *   Proposal 没有为 Review Decision 定义"仅部分文件改变、其余保持有效"
 *   这种细粒度失效模型，本文件不替 Proposal 编一个没写过的语义。
 *
 * ⚠ 本条目最大的诚实标注——**task_id → 真实分支/PR head 的机械映射机制，
 * 本仓库今天不存在**：
 *   - Proposal §10.5 的 TPL-RVW-001 示例只给了 `task_id` 这一个字段，没有
 *     定义"怎么从 task_id 查到它对应检查的 git ref"这层机制。
 *   - `task-assignment-model.ts`（H3A-030，TPL-TSK-001）里也没有 `branch`/
 *     `head_ref`/`pr_number` 之类的字段——task_id 指向的 Task Assignment
 *     实例本身就不携带"这个任务对应哪个分支/PR"这个事实。
 *   - 因此，纯函数本身**不**假设"给定 task_id 就能查到 head"，而是要求
 *     调用方（doctor IO 层）已经把"这份实例对应的 head 是什么"这件事解析
 *     好、以 `resolvedHeadSha: string | null` 的形式传进来——`null` 表示
 *     "根本查不到对应 ref"（不是"没有新 commit"），据此产生 WARN/UNKNOWN
 *     而不是编造 PASS 或 FAIL。
 *   - doctor 层（review-decision-doctor.ts）今天的 `resolveHeadShaForTaskId`
 *     诚实地恒定返回 `null`——这是本条目的设计缺口，不是 bug。一旦未来
 *     有条目（比如 H3A-031 dispatch 协议扩展、或 task-assignment schema
 *     补上 head_ref 字段）建立了这层映射，doctor 只需要把 `null` 换成真实
 *     解析结果，本文件的纯函数判定逻辑不需要改一行。
 *
 * 校验风格延续 workflow-event-append-only-gate.ts 的先例：判定逻辑纯函数，
 * 真实 git IO（`git cat-file -e` / `git merge-base --is-ancestor`）放在
 * doctor 入口，这里只接收"已经查好的事实"。
 */
import type { Finding } from "./role-authorization";
import type { ReviewDecision } from "./review-decision-model";

/**
 * 一份 Review Decision 实例对应的真实 git 事实——由 doctor IO 层解析后传入。
 */
export interface ReviewDecisionHeadFact {
  reviewDecision: ReviewDecision;
  /**
   * 这份 Review Decision 审的分支/PR，其当前 head 的真实 SHA。
   * `null` = 无法解析出对应 ref（见文件头部"设计缺口"说明），不是"没有新
   * commit"。今天 doctor 层恒定传 `null`。
   */
  resolvedHeadSha: string | null;
  /**
   * `exact_sha` 这个 commit 本身在当前仓库历史里是否还能找到
   * （`git cat-file -e`）。只有 `resolvedHeadSha` 非 null 时才有意义，
   * `resolvedHeadSha` 为 null 时这个字段的值不影响判定。
   */
  exactShaExists: boolean;
  /**
   * `exact_sha` 是否是 `resolvedHeadSha` 的祖先
   * （`git merge-base --is-ancestor`）。`null` = 未解析
   * （`resolvedHeadSha` 为 null 时恒为 null）。
   */
  exactShaIsAncestorOfHead: boolean | null;
}

/**
 * H3A-037 判定：给定一批已经解析好 git 事实的 Review Decision 实例，
 * 输出 stale gate 的 Finding 列表。累积上报全部问题，不 fail-fast——同
 * review-decision-model.ts/workflow-event-append-only-gate.ts 的先例。
 */
export function checkReviewDecisionStale(facts: readonly ReviewDecisionHeadFact[]): Finding[] {
  const findings: Finding[] = [];

  for (const fact of facts) {
    const { reviewDecision: rd, resolvedHeadSha, exactShaExists, exactShaIsAncestorOfHead } = fact;

    if (resolvedHeadSha === null) {
      findings.push({
        code: "H3A037-REF-UNRESOLVED",
        severity: "WARN",
        sourceFile: rd.sourceFile,
        message:
          `无法解析 task_id "${rd.task_id}" 对应的真实分支/PR head——本仓库今天没有 task_id→ref ` +
          `的机械映射机制（设计缺口，见 review-decision-stale-gate.ts 文件头注释），无法判定这份 ` +
          `Review Decision（exact_sha=${rd.exact_sha}）是否 stale，如实标 UNKNOWN，不是回归`,
      });
      continue;
    }

    if (resolvedHeadSha === rd.exact_sha) continue; // fresh：head 就是这份 Review Decision 审的那个 commit

    if (!exactShaExists) {
      findings.push({
        code: "H3A037-EXACT-SHA-UNREACHABLE",
        severity: "FAIL",
        sourceFile: rd.sourceFile,
        message:
          `exact_sha "${rd.exact_sha}" 在当前仓库历史中不可达（可能已被 rewrite/force-push）—— ` +
          `这份 Review Decision 无法验证它审的是哪个真实版本，判 stale`,
      });
      continue;
    }

    if (exactShaIsAncestorOfHead === true) {
      findings.push({
        code: "H3A037-STALE-HEAD-ADVANCED",
        severity: "FAIL",
        sourceFile: rd.sourceFile,
        message:
          `head（${resolvedHeadSha}）已经领先于这份 Review Decision 审的 exact_sha（${rd.exact_sha}）—— ` +
          `审的是旧代码，新 commit 之后这份 "${rd.decision}" 不能继续为当前代码背书，判 stale`,
      });
    } else {
      findings.push({
        code: "H3A037-STALE-HISTORY-DIVERGED",
        severity: "FAIL",
        sourceFile: rd.sourceFile,
        message:
          `exact_sha（${rd.exact_sha}）不是当前 head（${resolvedHeadSha}）的祖先——历史已分叉或被改写，` +
          `这份 Review Decision 与当前代码的谱系关系不可验证，判 stale`,
      });
    }
  }

  return findings;
}
