/**
 * 项目中枢 B3-T1（#4495）`getProjectEvidence` —— 单条证据回链（从结论的证据锚点跳回原材料）。
 *
 * 门同 `listProjectEvidence`（成员含观察者可读；非成员 / 容器不存在 ⇒ NO_PROJECT_ROLE）。
 * 证据不存在或不属于这个项目 ⇒ 同一个 `EVIDENCE_NOT_FOUND`——不泄露别的项目里某个 id 的存在性。
 * 已撤回的单元仍然回（锚点还指着它；界面按 `revoked` 标）。
 */
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { redactEvidenceForRole } from "../../domain/project/evidence-redaction";
import { ProjectEvidenceError } from "./evidence-errors";
import { authorizeProjectEvidenceAccess, type ProjectEvidenceDeps, type ProjectEvidenceViewer } from "./list-project-evidence";
import type { ProjectEvidenceRow } from "./project-evidence-ports";

export interface GetProjectEvidenceInput extends ProjectEvidenceViewer {
  readonly evidenceId: string;
}

export async function getProjectEvidence(deps: ProjectEvidenceDeps, input: GetProjectEvidenceInput): Promise<ProjectEvidenceRow> {
  const decision = await authorizeProjectEvidenceAccess(deps, input);
  const guarded = await deps.evidence.find(input.orgId, input.projectId, input.evidenceId);
  const d = discloseDecided(guarded, decision);
  if (!isDisclosed(d)) throw new ProjectEvidenceError("NO_PROJECT_ROLE");
  if (d.payload === null) throw new ProjectEvidenceError("EVIDENCE_NOT_FOUND");
  return redactEvidenceForRole(d.payload, decision.projectLayer?.role ?? null);
}
