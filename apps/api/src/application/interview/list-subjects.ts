/**
 * `listSubjects` —— 对象表（H 组，uc-6-7）。
 *
 * ## 这是「两处投影一致」在应用层唯一的落点
 *
 * `groupId` 非空 ⇒ 项目侧组卡投影；`interviewId` 非空 ⇒ 访谈侧受访者名单投影。
 * 两条分支调的是 `SubjectRepository` 的两个不同方法，但那两个方法在基础设施层
 * 查的是**同一张 `interview_subjects` 表**——本文件不复制任何行，只换了一个
 * WHERE 子句。`object-two-projections-single-record.test.ts` 断言的正是：
 * 用 groupId 查到的那一行，与用 interviewId 查到的那一行，`subjectId` 相同、
 * 改一个字段两边都能看见新值。
 *
 * ⚠ `groupId` 与 `interviewId` 都缺省时，本用例返回空列表而不是「取全组织」——
 * 契约没有定义一个不带任何范围的批量列出语义，编一个出来就是发明契约没写的接口。
 *
 * ## 第二次判定（与 F80 的 `listInterviews`/`getInterview` 同一手法）
 *
 * 仓储已经按 `org_id` 过滤，但「观察者不可读对象表」（R5）是同一组织内的第二道线，
 * 不是租户隔离能管的。所以每一行回来时都带着 `guard()` 包住的载荷，这里用
 * `decideSubjectVisibility` 现判一次，只可能把可见集合收紧，不可能放宽。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { decideSubjectVisibility } from "./subject-visibility-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DecisionIdFactory } from "../identity/ports";
import type { GuardedSubjectRow, SubjectRepository } from "./subject-ports";

export type ListSubjectsResult = z.infer<typeof interview.operations.listSubjects.out>;
export type ListSubjectsInputDto = z.infer<typeof interview.operations.listSubjects.in>;

export interface ListSubjectsDeps {
  readonly repo: SubjectRepository;
  readonly decisions: DecisionIdFactory;
}

export interface ListSubjectsQuery {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly input: ListSubjectsInputDto;
}

interface DisclosedSubject {
  readonly subjectId: string;
  readonly displayName: string;
  readonly roleTitle: string;
  readonly orgName: string | null;
  readonly groupId: string | null;
  readonly contactMask: string | null;
  readonly sourceKind: "human" | "virtual";
}

function toResultItem(r: DisclosedSubject): ListSubjectsResult["items"][number] {
  return {
    subjectId: r.subjectId,
    displayName: r.displayName,
    roleTitle: r.roleTitle,
    orgName: r.orgName,
    groupId: r.groupId,
    contactMask: r.contactMask ?? "",
    sourceKind: r.sourceKind,
  };
}

/** 按 groupId 做一次判定所需的组织/项目层事实查询，同一个 groupId 只查一次。 */
async function makeGroupContextCache(repo: SubjectRepository, orgId: OrgId, viewerUserId: string) {
  const cache = new Map<
    string,
    { orgRole: string | null; teamId: string | null; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null }
  >();
  return async (groupId: string) => {
    const cached = cache.get(groupId);
    if (cached !== undefined) return cached;
    const ctx = await repo.viewerContextForGroup(orgId, viewerUserId, groupId);
    cache.set(groupId, ctx);
    return ctx;
  };
}

async function discloseRows(
  deps: ListSubjectsDeps,
  orgId: OrgId,
  viewerUserId: string,
  rows: GuardedSubjectRow[],
): Promise<DisclosedSubject[]> {
  if (rows.length === 0) return [];
  const groupCtx = await makeGroupContextCache(deps.repo, orgId, viewerUserId);
  const orgMembership = await deps.repo.orgMembershipOf(orgId, viewerUserId);

  const out: DisclosedSubject[] = [];
  for (const row of rows) {
    const ctx = row.facts.groupId === null ? null : await groupCtx(row.facts.groupId);
    const decision = decideSubjectVisibility({
      decisionId: deps.decisions.next(),
      subject: row.facts,
      viewer: { userId: viewerUserId, projectRole: ctx?.projectRole ?? null },
      orgRole: (ctx?.orgRole ?? orgMembership.orgRole) as OrgRole | null,
      viewerTeamId: ctx?.teamId ?? orgMembership.teamId,
    });
    const disclosed = discloseDecided(row.item, decision);
    if (isDisclosed(disclosed)) out.push(disclosed.payload);
  }
  return out;
}

export async function listSubjects(
  deps: ListSubjectsDeps,
  q: ListSubjectsQuery,
): Promise<ListSubjectsResult> {
  let rows: GuardedSubjectRow[];
  if (q.input.groupId !== null) {
    rows = await deps.repo.listByGroup(q.orgId, q.input.groupId);
  } else if (q.input.interviewId !== null) {
    rows = await deps.repo.listByInterviewSession(q.orgId, q.input.interviewId);
  } else {
    rows = [];
  }
  const disclosed = await discloseRows(deps, q.orgId, q.viewerUserId, rows);
  return { items: disclosed.map(toResultItem) };
}
