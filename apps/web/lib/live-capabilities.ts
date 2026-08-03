/** #406 — 已签组织能力目录的前端薄封装。这里只读，不暴露 mutate。 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type CapabilityKind = z.infer<typeof identity.CapabilityKind>;
export type CapabilityListing = z.infer<typeof identity.CapabilityListing>;

export async function listCapabilities(
  orgId: string,
  kind: CapabilityKind,
): Promise<CapabilityListing[]> {
  return apiRequest<CapabilityListing[]>(identity.operations.listCapabilities.path, {
    method: "GET",
    query: { orgId, kind },
  });
}
