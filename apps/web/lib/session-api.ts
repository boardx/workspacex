import { auth } from "@repo/contracts";
import * as identity from "@repo/contracts/identity";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ResolvedIdentity = z.infer<typeof identity.operations.resolveIdentity.out>;

export async function resolveIdentity(orgId: string, sessionToken: string): Promise<ResolvedIdentity> {
  return apiRequest<ResolvedIdentity>(identity.operations.resolveIdentity.path, {
    query: { orgId },
    sessionToken,
  });
}

/**
 * Organization switching must use the auth operation: it updates the bearer session's
 * currentOrgId and delegates identity context clearing server-side. The identity endpoint is
 * then read once to obtain the new role/context; no second switching semantic is introduced.
 */
export async function switchCurrentOrganization(
  toOrgId: string,
  sessionToken: string,
): Promise<ResolvedIdentity> {
  await apiRequest(auth.operations.switchOrgAtLogin.path, {
    method: "POST",
    body: { toOrgId },
    sessionToken,
  });
  return resolveIdentity(toOrgId, sessionToken);
}
