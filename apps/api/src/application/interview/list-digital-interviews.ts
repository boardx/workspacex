import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { DigitalInterviewStatusName } from "../../domain/interview/digital-interview";
import { projectDigitalInterviewState } from "../../domain/interview/digital-interview";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { InterviewScopeRepository } from "./ports";
import type { DigitalInterviewRepository } from "./digital-interview-ports";

export type DigitalInterviewHistory = z.infer<typeof interview.operations.listDigitalInterviews.out>;

export async function listDigitalInterviews(
  deps: {
    repo: DigitalInterviewRepository;
    scope: InterviewScopeRepository;
    decisions: DecisionIdFactory;
  },
  input: { orgId: OrgId; viewerUserId: string; status?: DigitalInterviewStatusName },
): Promise<DigitalInterviewHistory> {
  const rows = await deps.repo.listVisible(input);
  const projectIds = await deps.scope.projectIdsOf(input.orgId, input.viewerUserId);
  const membership = await deps.scope.orgMembershipOf(input.orgId, input.viewerUserId);
  const visible = rows.flatMap(({ item, facts }) => {
    const disclosed = discloseDecided(item, decideInterviewVisibility({
      decisionId: deps.decisions.next(),
      interview: facts,
      viewer: { userId: input.viewerUserId, projectIds },
      orgRole: membership.orgRole as OrgRole | null,
      viewerTeamId: membership.teamId,
    }));
    return isDisclosed(disclosed) ? [disclosed.payload] : [];
  });
  return {
    items: visible.map((row) => ({
      interviewId: row.interviewId,
      name: row.name,
      tags: [...row.tags],
      topic: row.topic,
      status: row.status,
      expertCount: row.selectedExpertIds.length,
      // F06 接入逐专家运行记录后由同一仓储聚合；当前状态基础中没有可伪造的完成记录。
      completedExpertCount: 0,
      primaryAction: projectDigitalInterviewState(row.status).primaryAction,
      updatedAt: row.updatedAt,
    })),
  };
}

export async function listDigitalExperts(
  repo: DigitalInterviewRepository,
  input: { orgId: OrgId; viewerUserId: string; domain?: string },
): Promise<z.infer<typeof interview.operations.listDigitalExperts.out>> {
  const rows = await repo.listVisibleExperts(input);
  return {
    items: rows.map((row) => ({
      expertId: row.expertId,
      initials: row.initials,
      displayName: row.displayName,
      role: row.role,
      domains: [...row.domains],
      materialBoundary: row.materialContextPackId === null
        ? "未绑定 Context Pack 材料版本"
        : `Context Pack ${row.materialContextPackId} · ${row.materialVersion}`,
      // 数字专家结论恒为探索性；绑定材料只增强可追溯性，不把推演升级为真人证据。
      exploratory: true,
    })),
  };
}
