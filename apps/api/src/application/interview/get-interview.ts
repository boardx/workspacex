/**
 * `getInterview` —— 按 ID 直读（uc-6-0 V2 / V6，domain.md I-31）。
 *
 * ## 两件事必须同时成立，缺一条这个 feature 就是空的
 *
 * ① 非协作者按 ID 直读 `project_id IS NULL` 的访谈 **被拒**。
 * ② 那次被拒 **写审计**。
 *
 * ②不是装饰。「被拒绝的动作没有留痕」等于探测者可以无成本地反复试 id，
 * 而每一次失败都不留下任何可回查的痕迹 —— 这正是 provenance 契约里
 * `unauthorized-attempt` 那条注释说的事。
 *
 * ## 审计写失败 ⇒ 整个请求失败
 *
 * 与 artifact 束 `recordUnauthorizedAttempt` 同一立场，且这里照抄它的理由：
 * 「尽力而为的审计」意味着日志完整到出事的那一刻为止，而那一刻正是它有用的时候。
 * 调用者会看到 500 而不是 404 —— 对诚实的客户端是更糟的一天，对探测者则毫无信息量，
 * 因为它不是关于资源的信号。
 *
 * ## ⚠ 已知契约缺口（报告里有，未自行修改契约）
 *
 * `provenance.ProvenanceEvent.target.kind` 是封闭枚举
 * `artifact | artifact-version | capability | membership | project | organization`，
 * **没有 `interview`**；migration 0005 的 CHECK 是同一份枚举的第二次表达。
 * 于是这条审计只能把 target 记成 `organization`，把 `interviewId` 放进 `detail`。
 * 后果是具体的：`queryProvenance` 只能按 target 过滤，
 * 所以「这一场访谈被谁探过」**查不出来**，只能查「这个组织里有谁被拒过」。
 * 补法是给 phase-00 的契约枚举与 0005 的 CHECK 各加一个成员 —— 那是跨束契约改动，
 * 属于已签核的 phase-00 契约，不在 F80 的范围里，因此**报告而不是顺手改**。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { OrgRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError } from "./errors";
import type { InterviewScopeRepository } from "./ports";

export type GetInterviewResult = z.infer<typeof interview.operations.getInterview.out>;

export interface GetInterviewDeps {
  readonly repo: InterviewScopeRepository;
  readonly provenance: ProvenanceWriter;
  readonly decisions: DecisionIdFactory;
}

export interface GetInterviewInput {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly interviewId: string;
}

export async function getInterview(
  deps: GetInterviewDeps,
  input: GetInterviewInput,
): Promise<GetInterviewResult> {
  const found = await deps.repo.findVisibleById(input.orgId, input.viewerUserId, input.interviewId);

  // 第二次判定（与 `listInterviews` 同一条路径，理由见 `visibility-decision.ts`）。
  // 只可能把「SQL 说可见」再收紧，不可能放宽。
  let row: GetInterviewResult | null = null;
  if (found !== null) {
    const [projectIds, membership] = await Promise.all([
      deps.repo.projectIdsOf(input.orgId, input.viewerUserId),
      deps.repo.orgMembershipOf(input.orgId, input.viewerUserId),
    ]);
    const r = discloseDecided(
      found.item,
      decideInterviewVisibility({
        decisionId: deps.decisions.next(),
        interview: found.facts,
        viewer: { userId: input.viewerUserId, projectIds },
        orgRole: membership.orgRole as OrgRole | null,
        viewerTeamId: membership.teamId,
      }),
    );
    if (isDisclosed(r)) {
      const p = r.payload;
      row = {
        interviewId: p.interviewId,
        title: p.title,
        sourceKind: p.sourceKind,
        scope: {
          kind: p.projectId !== null ? "project" : p.researchProjectId !== null ? "research" : "none",
          projectId: p.projectId,
          researchProjectId: p.researchProjectId,
        },
        // 这四个字段在 F80 里恒为 null，**不是占位符**：
        // 提纲是 F84/F85 的对象，套用模板版本是 F82 的，进现场时间是 F88 的。
        // 契约把它们都声明成可空，所以「还没有」是一个契约内的合法取值；
        // 编一个假值出来才会让下一个人以为这些路径已经通了。
        outlineId: null,
        outlineStatus: null,
        appliedTemplateVersionId: null,
        startedAt: null,
      };
    }
  }

  if (row === null) {
    // ⚠ 无条件写，包括 id 根本不存在的情况。
    // 「只给真实对象记审计」这个显而易见的优化，会从另一侧把枚举探测面打开：
    // 能分辨「记了」与「没记」的人就知道哪些 id 是真的。
    await deps.provenance.append({
      orgId: input.orgId,
      type: "unauthorized-attempt",
      actorId: input.viewerUserId,
      target: { kind: "organization", id: input.orgId },
      detail: {
        action: "getInterview",
        reasonCode: "NO_INTERVIEW_ACCESS",
        // 见文件头：这本该是 target。契约枚举没有 `interview` 成员。
        interviewId: input.interviewId,
      },
    });
    throw new NoInterviewAccessError(input.interviewId);
  }

  return row;
}
