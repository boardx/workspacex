/**
 * `startSession` —— 开始访谈的硬门禁（F84 落地大纲这一半 + F88 落地同意位这一半；
 * uc-6-2 R3/AC5 + uc-6-3 R3 步骤7/AC2 + uc-6-4 startSession 契约）。
 *
 * ## 两道门禁为什么共用一个入口
 *
 * `startSession` 在契约里挂着两个错误码：`OUTLINE_NOT_CONFIRMED`（F84，「未经研究员
 * 确认的草案不得进现场」）与 `CONSENT_REQUIRED`（F88，「必需受访者是否已全部签署」）。
 * 两者是**合取**关系——都满足才放行，没有谁必须先判；本实现把大纲检查放在前面纯粹
 * 是既有代码顺序，不是优先级声明。
 *
 * ## F88 补的这一半：同意位门禁
 *
 * `checkConsentGate`（`consent-gate.ts`）是唯一判定实现——必需受访者＝本场名单里
 * `mode !== "observation"` 的对象，任何一人 `pending_consent` 就拒绝
 * （`ConsentRequiredError`）；非必需但同样待签的人不阻断，计入 `excludedSubjectIds`
 * 原样返回（E5：「不因一人未签而阻断全场」）。这条判定同时是 F69 录制入口
 * （`createRecordingConsentGate`）复用的那一个——两处不各自维护一份「是否已授权」。
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
import { checkConsentGate, type ConsentGateSubjectReader } from "./consent-gate";
import { ConsentRequiredError, NoInterviewAccessError, OutlineNotConfirmedError } from "./errors";
import type { OutlineRepository } from "./outline-ports";
import type { InterviewScopeRepository } from "./ports";

export interface StartSessionDeps {
  readonly outlines: OutlineRepository;
  readonly scope: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
  readonly consentGate: ConsentGateSubjectReader;
}

export interface StartSessionDto {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly interviewId: string;
}

export interface StartSessionResult {
  readonly startedAt: string;
  /** 在场但非必需、同意仍待签的人——不阻断开始，只是不被录音/转写（E5）。 */
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

  // F88：必需受访者（主访对象）是否已全部提交同意——与大纲检查是合取关系，
  // 谁先判都不影响正确性，这里放在后面纯粹是既有代码顺序。
  const gate = await checkConsentGate({ reader: deps.consentGate }, input.orgId, input.interviewId);
  if (gate.blocked) {
    throw new ConsentRequiredError(input.interviewId, gate.pendingRequiredSubjectIds);
  }

  return { startedAt: new Date().toISOString(), excludedSubjectIds: gate.excludedSubjectIds };
}
