import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { isAidtModuleEnabled } from "./aidt-module-config";
import { isAidtProject } from "./project-aidt";

type NativeProject = z.infer<typeof project.ProjectListItem>;
type NativeMember = Pick<z.infer<typeof project.operations.listNonWorkshopMembers.out>["members"][number], "userId" | "displayName">;
/** Existing real learning groups; no course foreign key can be inferred from tags. */
export type AidtCourseGroup = Readonly<{ project: NativeProject; members: readonly NativeMember[]; canLink?: boolean }>;
export type AidtCourseActor = Readonly<{ orgId: string; userId: string; sessionToken: string; signal?: AbortSignal }>;

/** Full native project list plus authorized rosters, in bounded batches; homepage previews are truncated. */
export async function loadAidtCourseGroups(input: AidtCourseActor): Promise<readonly AidtCourseGroup[]> {
  const current = () => {
    if (!isAidtModuleEnabled() || input.signal?.aborted) throw new Error("AIDT_GROUP_CONTEXT_CHANGED");
    if (!input.orgId || !input.userId || !input.sessionToken) throw new Error("AIDT_GROUP_IDENTITY_REQUIRED");
  };
  current();
  const raw = await apiRequest<unknown>(project.operations.listProjects.path, { method: "GET", query: { orgId: input.orgId }, sessionToken: input.sessionToken, signal: input.signal });
  current();
  const projects = project.operations.listProjects.out.parse(raw), seen = new Set<string>();
  for (const item of projects) {
    if (seen.has(item.id)) throw new Error("AIDT_GROUP_MEMBERSHIP_INCONSISTENT");
    seen.add(item.id);
  }
  const candidates = projects.filter(isAidtProject), groups: AidtCourseGroup[] = [];
  const operation = project.operations.listNonWorkshopMembers;
  for (let offset = 0; offset < candidates.length; offset += 4) {
    current();
    const batch = await Promise.all(candidates.slice(offset, offset + 4).map(async (item) => {
      current();
      const response = operation.out.parse(await apiRequest<unknown>(operation.path.replace(":projectId", encodeURIComponent(item.id)), { method: "GET", sessionToken: input.sessionToken, signal: input.signal }));
      current();
      if (new Set(response.members.map(member => member.userId)).size !== response.members.length) throw new Error("AIDT_GROUP_MEMBERSHIP_INCONSISTENT");
      // Organization management metadata is not learning-group membership.
      if (!response.members.some(member => member.userId === input.userId)) return null;
      return { project: item, canLink: response.members.some(member => member.userId === input.userId && member.role === "owner"), members: response.members.map(({ userId, displayName }) => ({ userId, displayName })) };
    }));
    current();
    for (const group of batch) if (group) groups.push(group);
  }
  return groups;
}
