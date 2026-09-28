/**
 * 项目中枢 B3-T1（#4495）`listProjectEvidence` —— 一个项目的证据库（六类来源归一后的单元）。
 *
 * 判定同 `list-project-resources.ts`：`authorize(read.published)` 对着项目对象本身，任何项目成员（含观察者）
 * 可读；拒绝按 `decision.reasonCode` 分层透传（ADMIN_NOT_SUPERUSER 在契约 `err` 里没有位置，折叠为
 * NO_PROJECT_ROLE），判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE（不降级放行）。容器不存在与「没有角色」
 * 从外部不可分辨。
 *
 * 内容经 `discloseDecided()` 出来——仓储只交 `Guarded<T>`，忘了判定是类型错误不是疏漏。
 *
 * ⚠ B3-T5 才做观察者脱敏（`speakerLabel` / `excerpt`）；本切片观察者与成员看到同一份。
 */
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ProjectEvidenceError } from "./evidence-errors";
import type { ProjectEvidenceListFilter, ProjectEvidencePage, ProjectEvidencePort } from "./project-evidence-ports";

/** 与 `PROJECT_RESOURCE_READ_ACTION` 同一个字面量：问的是同一个问题（你能不能看这个项目）。 */
export const PROJECT_EVIDENCE_READ_ACTION = "read.published";
/** 契约 `limit` 可选；缺省取这个（上限 200 由契约管）。 */
export const PROJECT_EVIDENCE_DEFAULT_LIMIT = 50;

export interface ProjectEvidenceDeps {
  readonly auth: AuthorizeDeps;
  readonly evidence: ProjectEvidencePort;
}

export interface ProjectEvidenceViewer {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

export interface ListProjectEvidenceInput extends ProjectEvidenceViewer {
  readonly sourceKind?: ProjectEvidenceListFilter["sourceKind"];
  readonly includeRevoked?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

/** 两个读用例共用的项目成员门；抛 `ProjectEvidenceError`，返回可用于 disclose 的决策。 */
export async function authorizeProjectEvidenceAccess(
  deps: ProjectEvidenceDeps,
  input: ProjectEvidenceViewer,
): Promise<PermissionDecision> {
  let decision: PermissionDecision;
  try {
    decision = await authorize(deps.auth, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      object: { kind: "project", id: input.projectId },
      action: PROJECT_EVIDENCE_READ_ACTION,
    });
  } catch {
    throw new ProjectEvidenceError("AUTH_SERVICE_UNAVAILABLE");
  }
  if (!decision.allowed) throw new ProjectEvidenceError("NO_PROJECT_ROLE");
  return decision;
}

export async function listProjectEvidence(deps: ProjectEvidenceDeps, input: ListProjectEvidenceInput): Promise<ProjectEvidencePage> {
  const decision = await authorizeProjectEvidenceAccess(deps, input);
  const filter: ProjectEvidenceListFilter = {
    limit: input.limit ?? PROJECT_EVIDENCE_DEFAULT_LIMIT,
    ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
    ...(input.includeRevoked !== undefined ? { includeRevoked: input.includeRevoked } : {}),
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
  };
  const guarded = await deps.evidence.list(input.orgId, input.projectId, filter);
  const d = discloseDecided(guarded, decision);
  // 上面已经按 `allowed` 抛过，这一支理论不可达；到达时按无权限处理而不是放行。
  if (!isDisclosed(d)) throw new ProjectEvidenceError("NO_PROJECT_ROLE");
  // 容器不存在 ⇒ 与「没有角色」同一个码（`permission-decision.ts` 文件头）。
  if (d.payload === null) throw new ProjectEvidenceError("NO_PROJECT_ROLE");
  return d.payload;
}
