import type { z } from "zod";
import { operations } from "@repo/contracts/portable-package";
import type { EntityKind } from "@repo/contracts/entity-localization";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { authorizeLocalizationAdmin, EntityLocalizationError, type AuthorizedLocalizationRequest } from "./entity-localization";

export type PortableExport = z.infer<typeof operations.exportSkill.out> | z.infer<typeof operations.exportAgent.out>;
export interface PortableExportRepository {
  get(input: { orgId: OrgId; kind: EntityKind; entityId: string; authorize: AuthorizedLocalizationRequest["authorize"] }): Promise<PortableExport | null>;
}
export const PORTABLE_EXPORT_REPOSITORY = Symbol("PortableExportRepository");
export async function exportPortablePackage(input: { orgId: OrgId; actorId: string; kind: EntityKind; entityId: string },
  deps: { identities: IdentityRepository; repository: PortableExportRepository }) {
  const authorize = await authorizeLocalizationAdmin(input, deps);
  const pack = await deps.repository.get({ ...input, authorize });
  if (!pack) throw new EntityLocalizationError("ENTITY_NOT_FOUND");
  return input.kind === "skill" ? operations.exportSkill.out.parse(pack) : operations.exportAgent.out.parse(pack);
}
