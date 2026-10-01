/**
 * 项目证据库（项目中枢 B3-T1，#4495）——契约 `projectEvidence.operations.{listProjectEvidence, getProjectEvidence}`
 * 的真实 API 薄封装（形状同 `live-project-resources.ts`）。
 *
 * 响应一律用契约 `out` schema 解析：后端与本层并行开发，形状漂移要在这一层立刻暴露。
 * 来源枚举、来源→「AI 权限」开关的投影、中文标签全部从契约取，这里不复述。
 */
import { projectEvidence } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectEvidenceSourceKind = z.infer<typeof projectEvidence.ProjectEvidenceSourceKind>;
export type ProjectEvidenceItem = z.infer<typeof projectEvidence.ProjectEvidenceItem>;
export type ListProjectEvidenceOut = z.infer<typeof projectEvidence.operations.listProjectEvidence.out>;

export {
  PROJECT_EVIDENCE_SOURCE_LABEL_ZH,
  PROJECT_EVIDENCE_TO_AI_SOURCE,
} from "@repo/contracts/project-evidence";

/** 契约枚举的成员序，界面的筛选 chips 按它排。 */
export const PROJECT_EVIDENCE_SOURCE_KINDS: readonly ProjectEvidenceSourceKind[] = projectEvidence.ProjectEvidenceSourceKind.options;

function evidencePath(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    template,
  );
}

export async function listProjectEvidence(input: {
  projectId: string;
  sourceKind?: ProjectEvidenceSourceKind;
  includeRevoked?: boolean;
  limit?: number;
  cursor?: string;
}): Promise<ListProjectEvidenceOut> {
  const op = projectEvidence.operations.listProjectEvidence;
  const parsed = op.in.parse(input);
  const raw = await apiRequest<unknown>(evidencePath(op.path, { projectId: parsed.projectId }), {
    method: op.method,
    query: {
      sourceKind: parsed.sourceKind,
      includeRevoked: parsed.includeRevoked === undefined ? undefined : String(parsed.includeRevoked),
      limit: parsed.limit === undefined ? undefined : String(parsed.limit),
      cursor: parsed.cursor,
    },
  });
  return op.out.parse(raw);
}

export async function getProjectEvidence(input: { projectId: string; evidenceId: string }): Promise<ProjectEvidenceItem> {
  const op = projectEvidence.operations.getProjectEvidence;
  const parsed = op.in.parse(input);
  const raw = await apiRequest<unknown>(evidencePath(op.path, parsed), { method: op.method });
  return op.out.parse(raw);
}
