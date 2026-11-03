import type { z } from "zod";
import { DisplayUpdateInput, type DisplayUpdateOffer, type DisplayUpdateResult } from "@repo/contracts/portable-package";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { authorizeLocalizationAdmin, EntityLocalizationError, type AuthorizedLocalizationRequest } from "./entity-localization";
export type UpdateOffer = z.infer<typeof DisplayUpdateOffer>;
export type UpdateResult = z.infer<typeof DisplayUpdateResult>;
export interface AuthoredDisplayUpdateRepository {
  offer(input: { orgId: OrgId; authorize: AuthorizedLocalizationRequest["authorize"] }): Promise<UpdateOffer>;
  apply(input: z.infer<typeof DisplayUpdateInput> & { orgId: OrgId; actorId: string; authorize: AuthorizedLocalizationRequest["authorize"] }): Promise<UpdateResult | null>;
}
export const AUTHORED_DISPLAY_UPDATE_REPOSITORY = Symbol("AuthoredDisplayUpdateRepository");
type Request = { orgId: OrgId; actorId: string };
type Deps = { identities: IdentityRepository; repository: AuthoredDisplayUpdateRepository };
export async function getAuthoredDisplayUpdateOffer(input: Request, deps: Deps) {
  const authorize = await authorizeLocalizationAdmin(input,deps);
  return deps.repository.offer({ orgId: input.orgId, authorize });
}
export async function applyAuthoredDisplayUpdate(input: Request & { body: unknown }, deps: Deps) {
  const authorize = await authorizeLocalizationAdmin(input,deps);
  const parsed = DisplayUpdateInput.safeParse(input.body);
  if (!parsed.success) throw new EntityLocalizationError("VALIDATION_FAILED");
  if (parsed.data.expectedOrgId !== input.orgId) throw new EntityLocalizationError("ROLE_INSUFFICIENT");
  const result = await deps.repository.apply({ ...input, ...parsed.data, authorize });
  if (!result) throw new EntityLocalizationError("SOURCE_CHANGED");
  return result;
}
