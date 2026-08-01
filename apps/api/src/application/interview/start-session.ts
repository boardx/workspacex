/**
 * `startSession` —— 开始访谈的硬门禁（F84 落地大纲这一半；uc-6-2 R3/AC5 + uc-6-4 startSession 契约）。
 *
 * ## 为什么这个契约操作的实现出现在 F84 而不是 F88
 *
 * `startSession` 在契约里同时挂着两个错误码：`OUTLINE_NOT_CONFIRMED`（本 feature，
 * 「未经研究员确认的草案不得进现场」是 F84 的 user_visible_behavior 原文）与
 * `CONSENT_REQUIRED`（F88「开始访谈的硬门禁」，检查必需受访者是否已全部签署）。
 * 两个门禁共用一个入口，但各自的数据模型分属不同 feature——F88 的同意位查询依赖
 * F87（尚未开工）。
 *
 * ⚠ **已知缺口，如实报告**：本实现只做大纲确认门禁，不做同意位门禁。
 * `CONSENT_REQUIRED` 这条路径现在恒不可达——F88 落地时需要在这个函数里补上
 * 「必需受访者是否已全部提交同意」的检查，且顺序应在大纲检查之后或之前都不影响
 * 正确性（两个门禁是合取关系，没有哪个必须先判）。这里不预先编一个没有依据的
 * 同意位判断去填满契约的两个错误码。
 *
 * ## 为什么要判「看的人是不是这场访谈的人」
 *
 * `OutlineRepository.getByInterview` 返回的是 `Guarded<OutlineRecord>`——大纲是这场
 * 访谈的一个 facet，不是独立可授权对象（见 `outline-ports.ts`）。这里用与 F80
 * 判定访谈本身可见性**同一条规则**（`decideInterviewVisibility`）解封，而不是
 * 假装「既然拿到了 interviewId 就有权」——那正是 `lint-permission-paths` 要挡的
 * 「读到裸行」的那类漏洞在应用层的对应形态。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { DecisionIdFactory } from "../identity/ports";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError, OutlineNotConfirmedError } from "./errors";
import type { OutlineRepository } from "./outline-ports";
import type { InterviewScopeRepository } from "./ports";

export interface StartSessionDeps {
  readonly outlines: OutlineRepository;
  readonly scope: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
}

export interface StartSessionDto {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly interviewId: string;
}

export interface StartSessionResult {
  readonly startedAt: string;
  /** F88 落地同意位门禁前，恒为空数组——本实现不判断任何人是否被排除。 */
  readonly excludedSubjectIds: readonly string[];
}

export async function startSession(deps: StartSessionDeps, input: StartSessionDto): Promise<StartSessionResult> {
  const guarded = await deps.outlines.getByInterview(input.orgId, input.viewerUserId, input.interviewId);
  // 未生成过大纲 —— 与「无权」同一个答案（uc-6-0/E3 的立场：不存在与无权不可区分），
  // 也满足「这场访谈还不能进现场」这件事。
  if (guarded === null) {
    throw new OutlineNotConfirmedError(input.interviewId);
  }

  const [orgMembership, projectIds] = await Promise.all([
    deps.scope.orgMembershipOf(input.orgId, input.viewerUserId),
    deps.scope.projectIdsOf(input.orgId, input.viewerUserId),
  ]);
  const decision = decideInterviewVisibility({
    decisionId: deps.decisions.next(),
    interview: guarded.facts,
    viewer: { userId: input.viewerUserId, projectIds },
    orgRole: orgMembership.orgRole as OrgRole | null,
    viewerTeamId: orgMembership.teamId,
  });
  const disclosed = discloseDecided(guarded.item, decision);
  if (!isDisclosed(disclosed)) {
    throw new NoInterviewAccessError(input.interviewId);
  }

  // 未生成过、或大纲仍是 `pending_confirm` —— 两种情况都不满足「已确认」，
  // 用同一个错误码：调用方看到的是同一件事「这场访谈还不能进现场」。
  if (disclosed.payload.status !== "confirmed") {
    throw new OutlineNotConfirmedError(input.interviewId);
  }
  return { startedAt: new Date().toISOString(), excludedSubjectIds: [] };
}
