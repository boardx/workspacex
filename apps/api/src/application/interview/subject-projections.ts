/**
 * 「状态」列的两处投影 —— 组卡视图 与 访谈名单视图（F97，AC5 / I-19 / I-20）。
 *
 * ## 为什么这不是 `listSubjects` 的一部分
 *
 * `packages/contracts/src/interview.ts` 的 `Subject` 契约类型（`listSubjects`/
 * `createSubject`/`updateSubject` 共用的 out 形状）**没有 `consentStatus` 字段**——
 * 这份契约束已由人类签核确认（`design-signoff.md`），F97 不擅自改签过的契约形状
 * 去加一列。这是一个如实报告的契约缺口（见 PR 说明），不是本文件假装不存在的问题。
 *
 * 但 uc-6-7 R3-2 的六列里「状态」是第六列，AC1 明写「对象表六列可维护」，I-20 的
 * 断言就是「改一处同意位、组卡状态与名单状态同步变」——这条不变量必须能在某个
 * 层面被证明，即便契约的 wire 类型暂时没有位置装它。所以本文件在**应用层**
 * 提供两个投影函数，各自把 `SubjectRecord` 与 `deriveConsentStatus` 的结果拼在一起；
 * 两者调的是同一个纯函数、同一张同意书事实表，`consent-status-single-source.test.ts`
 * 直接调这两个函数来断言「改一次，两处都变」。
 *
 * 等 F87 把签署/门户流程建起来、契约需要正式暴露 `consentStatus` 时，
 * 这两个函数就是那次契约扩展的现成实现——不是需要重写的临时代码。
 *
 * ## 一次判定，两个 `Guarded` 载荷
 *
 * 对象行与同意位各自经 `guard()` 出门，但两者是**同一个人、同一条记录**的两个
 * facet，所以这里只调 `decideSubjectVisibility` 一次，同一个 `PermissionDecision`
 * 拿去解封两个 `Guarded` 值——不是各判一次；那样会让「对象可见但同意位被拒」
 * 这种自相矛盾的组合有机会出现。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { deriveConsentStatus, type SubjectConsentStatus, type SubjectRecord } from "../../domain/interview/subject";
import { decideSubjectVisibility } from "./subject-visibility-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DecisionIdFactory } from "../identity/ports";
import type { ConsentSubmissionStore, GuardedSubjectRow, SubjectRepository } from "./subject-ports";

export interface SubjectProjectionDeps {
  readonly subjects: SubjectRepository;
  readonly consent: ConsentSubmissionStore;
  readonly decisions: DecisionIdFactory;
}

export interface SubjectWithStatus extends SubjectRecord {
  readonly consentStatus: SubjectConsentStatus;
}

/** 同一行，外加算出该行时用的那个 `PermissionDecision`（F87 需要复用它去解封「提交时间」）。 */
export interface SubjectWithStatusAndDecision {
  readonly subject: SubjectWithStatus;
  readonly decision: PermissionDecision;
}

/**
 * 项目侧「组卡」投影：本组的观察/访谈对象表，含第六列「状态」。
 *
 * `interviewSessionId` 显式传入而不是从 `SubjectRecord` 上现读：一个对象未来可能
 * 被排进不止一场（A3 「对象跨组复用」标为 [待确认]），组卡此刻只关心
 * 「这一组当前对应的那一场」，把这个决定权交给调用方，不在这里替它选。
 */
export async function getGroupCardSubjects(
  deps: SubjectProjectionDeps,
  orgId: OrgId,
  viewerUserId: string,
  groupId: string,
  interviewSessionId: string | null,
): Promise<SubjectWithStatus[]> {
  const rows = await deps.subjects.listByGroup(orgId, groupId);
  return (await attachStatus(deps, orgId, viewerUserId, rows, interviewSessionId)).map((r) => r.subject);
}

/** 访谈侧「受访者名单」投影：同一张 `interview_subjects` 表，按场次取。 */
export async function getInterviewRosterSubjects(
  deps: SubjectProjectionDeps,
  orgId: OrgId,
  viewerUserId: string,
  interviewSessionId: string,
): Promise<SubjectWithStatus[]> {
  const rows = await deps.subjects.listByInterviewSession(orgId, interviewSessionId);
  return (await attachStatus(deps, orgId, viewerUserId, rows, interviewSessionId)).map((r) => r.subject);
}

/**
 * 同 `getInterviewRosterSubjects`，另外带出每一行的 `PermissionDecision`（F87 /
 * `get-consent-mirror.ts` 需要复用它去解封"提交时间"这个 facet，而不是另起一次判定——
 * 见 `subject-ports.ts` `ConsentSubmissionStore.latestFor` 头部注释同一条纪律）。
 */
export async function getInterviewRosterSubjectsWithDecision(
  deps: SubjectProjectionDeps,
  orgId: OrgId,
  viewerUserId: string,
  interviewSessionId: string,
): Promise<SubjectWithStatusAndDecision[]> {
  const rows = await deps.subjects.listByInterviewSession(orgId, interviewSessionId);
  return attachStatus(deps, orgId, viewerUserId, rows, interviewSessionId);
}

async function attachStatus(
  deps: SubjectProjectionDeps,
  orgId: OrgId,
  viewerUserId: string,
  rows: GuardedSubjectRow[],
  interviewSessionId: string | null,
): Promise<SubjectWithStatusAndDecision[]> {
  if (rows.length === 0) return [];

  const groupCtxCache = new Map<
    string,
    { orgRole: string | null; teamId: string | null; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null }
  >();
  const orgMembership = await deps.subjects.orgMembershipOf(orgId, viewerUserId);

  const out: SubjectWithStatusAndDecision[] = [];
  for (const row of rows) {
    let ctx = row.facts.groupId === null ? null : groupCtxCache.get(row.facts.groupId) ?? null;
    if (ctx === null && row.facts.groupId !== null) {
      ctx = await deps.subjects.viewerContextForGroup(orgId, viewerUserId, row.facts.groupId);
      groupCtxCache.set(row.facts.groupId, ctx);
    }
    const decision = decideSubjectVisibility({
      decisionId: deps.decisions.next(),
      subject: row.facts,
      viewer: { userId: viewerUserId, projectRole: ctx?.projectRole ?? null },
      orgRole: (ctx?.orgRole ?? orgMembership.orgRole) as OrgRole | null,
      viewerTeamId: ctx?.teamId ?? orgMembership.teamId,
    });

    const subjectDisclosed = discloseDecided(row.item, decision);
    if (!isDisclosed(subjectDisclosed)) continue;

    const bitsGuarded =
      interviewSessionId === null
        ? null
        : await deps.consent.latestFor(orgId, interviewSessionId, subjectDisclosed.payload.subjectId);
    const bitsDisclosed = bitsGuarded === null ? null : discloseDecided(bitsGuarded, decision);
    const bits = bitsDisclosed !== null && isDisclosed(bitsDisclosed) ? bitsDisclosed.payload : null;

    out.push({
      subject: { ...subjectDisclosed.payload, consentStatus: deriveConsentStatus(bits) },
      decision,
    });
  }
  return out;
}
