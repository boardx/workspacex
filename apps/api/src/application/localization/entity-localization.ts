import {
  EntityLocalizationWrite, EntityLocalizationClear, EntitySourceLocaleWrite,
  EntityLocalizationError as LocalizationErrorCode,
  type EntityKind, type EntityLocalizationAdminView, type EntityDisplaySource,
  type LocalizedEntityDisplay,
} from "@repo/contracts/entity-localization";
import type { z } from "zod";
import type { Locale } from "@repo/contracts/locale";
import type { IdentityRepository, OrgMembershipRow } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
import { decideCapabilityVisibility, canMutateCapabilities } from "../../domain/identity/capability-listing";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { VisibilityScope } from "../../domain/identity/roles";

export interface LocalizationRequest {
  orgId: string; actorId: string; kind: EntityKind; entityId: string; locale: Locale;
}
export interface LocalizationVisibilityFacts { scope: VisibilityScope; ownerTeamId: string | null }
export type AuthorizedLocalizationRequest = LocalizationRequest & {
  authorize: (facts: LocalizationVisibilityFacts) => PermissionDecision;
};
export type LocalizationOutcome<T> = { kind: "ok"; view: T }
  | { kind: "not-found" | "source-changed" | "translation-changed" };
export interface EntityLocalizationRepository {
  get(input: AuthorizedLocalizationRequest): Promise<EntityLocalizationAdminView | null>;
  put(input: AuthorizedLocalizationRequest & { body: EntityLocalizationWrite }): Promise<LocalizationOutcome<EntityLocalizationAdminView>>;
  clear(input: AuthorizedLocalizationRequest & { body: EntityLocalizationClear }): Promise<LocalizationOutcome<EntityLocalizationAdminView>>;
  setSourceLocale(input: Omit<AuthorizedLocalizationRequest, "locale"> & { body: EntitySourceLocaleWrite }): Promise<LocalizationOutcome<z.infer<typeof EntityDisplaySource>>>;
  /** IDs must come from an already-authorized directory result, never a raw user list. */
  displays(orgId: string, kind: EntityKind, ids: readonly string[], locale: Locale): Promise<ReadonlyMap<string, LocalizedEntityDisplay>>;
}
export const ENTITY_LOCALIZATION_REPOSITORY = Symbol("EntityLocalizationRepository");
type Deps = { identities: IdentityRepository; repository: EntityLocalizationRepository };
export class EntityLocalizationError extends Error {
  constructor(readonly code: z.infer<typeof LocalizationErrorCode>) {
    super(code); this.name = "EntityLocalizationError";
  }
}
export async function authorizeLocalizationAdmin(input: { orgId: string; actorId: string }, deps: Pick<Deps, "identities">) {
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || !canMutateCapabilities(membership.orgRole)) throw new EntityLocalizationError("ROLE_INSUFFICIENT");
  return localizationAuthorizer(membership, input.actorId);
}
export function localizationAuthorizer(membership: OrgMembershipRow, actorId: string) {
  return (facts: LocalizationVisibilityFacts) => decideCapabilityVisibility({
    decisionId: `localization:${actorId}`, orgRole: membership.orgRole,
    requesterTeamId: membership.teamId, ...facts,
  });
}
function unwrap<T>(outcome: LocalizationOutcome<T>): T {
  if (outcome.kind === "ok") return outcome.view;
  const code = { "not-found": "ENTITY_NOT_FOUND", "source-changed": "SOURCE_CHANGED", "translation-changed": "TRANSLATION_CHANGED" } as const;
  throw new EntityLocalizationError(code[outcome.kind]);
}
export async function getLocalizationAdmin(input: LocalizationRequest, deps: Deps) {
  const authorize = await authorizeLocalizationAdmin(input, deps);
  const view = await deps.repository.get({ ...input, authorize });
  if (!view) throw new EntityLocalizationError("ENTITY_NOT_FOUND");
  return view;
}
export async function putLocalization(input: LocalizationRequest & { body: unknown }, deps: Deps) {
  const authorize = await authorizeLocalizationAdmin(input, deps);
  const parsed = EntityLocalizationWrite.safeParse(input.body);
  if (!parsed.success) throw new EntityLocalizationError("VALIDATION_FAILED");
  return unwrap(await deps.repository.put({ ...input, authorize, body: parsed.data }));
}
export async function clearLocalization(input: LocalizationRequest & { body: unknown }, deps: Deps) {
  const authorize = await authorizeLocalizationAdmin(input, deps);
  const parsed = EntityLocalizationClear.safeParse(input.body);
  if (!parsed.success) throw new EntityLocalizationError("VALIDATION_FAILED");
  return unwrap(await deps.repository.clear({ ...input, authorize, body: parsed.data }));
}
export async function setLocalizationSourceLocale(input: Omit<LocalizationRequest, "locale"> & { body: unknown }, deps: Deps) {
  const authorize = await authorizeLocalizationAdmin(input, deps);
  const parsed = EntitySourceLocaleWrite.safeParse(input.body);
  if (!parsed.success) throw new EntityLocalizationError("VALIDATION_FAILED");
  return unwrap(await deps.repository.setSourceLocale({ ...input, authorize, body: parsed.data }));
}
