import { project } from "@repo/contracts";
import { apiRequest } from "@/lib/api-client";
import { isAidtModuleEnabled } from "./aidt-module-config";

/** The normal Project list includes organization-managed containers. Only its real roster
 * establishes membership in an AIDT learning group; this adapter never grants permissions. */
export async function readAidtProjectMembership(projectId: string, userId: string, sessionToken: string, signal?: AbortSignal) {
  if (!isAidtModuleEnabled() || !projectId || !userId || !sessionToken || signal?.aborted) throw new Error("AIDT_MEMBERSHIP_CONTEXT_UNAVAILABLE");
  const operation = project.operations.listNonWorkshopMembers;
  const response = operation.out.parse(await apiRequest<unknown>(operation.path.replace(":projectId", encodeURIComponent(projectId)), { method: "GET", sessionToken, signal }));
  if (signal?.aborted) throw new Error("AIDT_MEMBERSHIP_CANCELLED");
  const matches = response.members.filter((member) => member.userId === userId);
  if (matches.length > 1) throw new Error("AIDT_MEMBERSHIP_INCONSISTENT");
  return matches[0]?.role ?? null;
}
