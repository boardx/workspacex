import type { z } from "zod";
import type { Detail, Entry, Kind, Write } from "@repo/contracts/ai-catalog-admin";
import type { TenantSession } from "../ports/database.port";

export const AI_CATALOG_STORAGE = Symbol("AI_CATALOG_STORAGE");
export interface PublishedSkillSnapshot {
  id: string;
  versionId: string;
  name: string;
  stableName: string;
  semanticLabel: string;
  digest: string;
  manifest: unknown;
  files: { path: string; content: Buffer; mediaType: string; digest: string }[];
}
/** Storage only; caller supplies an authorized tenant transaction and real actor. */
export interface AiCatalogStorage {
  catalogIdempotency(
    s: TenantSession,
    orgId: string,
    key: string,
  ): Promise<{
    kind: string;
    origin_id: string;
    origin_version_id: string;
    local_id: string;
    local_version_id: string;
  } | null>;
  catalogTargetExists(s: TenantSession, orgId: string): Promise<boolean>;
  catalogAudit(
    s: TenantSession,
    orgId: string,
    actor: string,
    action: string,
    kind: string,
    id: string,
  ): Promise<void>;
  catalogMarkManaged(s: TenantSession, kind: string, id: string): Promise<void>;
  catalogMarkPublished(
    s: TenantSession,
    kind: string,
    id: string,
    version: string,
    actor: string,
  ): Promise<void>;
  catalogPublications(
    s: TenantSession,
    kind: string,
    limit: number,
    offset: number,
  ): Promise<{ entity_id: string; version_id: string }[]>;
  catalogPublicationExists(
    s: TenantSession,
    kind: string,
    id: string,
    version: string,
  ): Promise<boolean>;
  catalogEnabledOrigins(
    s: TenantSession,
    orgId: string,
    kind: string,
  ): Promise<{ origin_id: string; origin_version_id: string }[]>;
  catalogLockOrganization(s: TenantSession, orgId: string): Promise<void>;
  catalogFindEnablement(
    s: TenantSession,
    orgId: string,
    key: string,
    kind: string,
    id: string,
    version: string,
  ): Promise<{
    kind: string;
    local_id: string;
    local_version_id: string;
    origin_id: string;
    origin_version_id: string;
  } | null>;
  catalogRecordEnablement(
    s: TenantSession,
    orgId: string,
    kind: string,
    origin: string,
    originVersion: string,
    id: string,
    version: string,
    actor: string,
    key: string,
  ): Promise<void>;
  catalogDefinition(
    s: TenantSession,
    orgId: string,
    row: z.infer<typeof Entry>,
  ): Promise<z.infer<typeof Detail>["definition"]>;

  catalogEntries(
    s: TenantSession,
    orgId: string,
    kind: z.infer<typeof Kind>,
    limit: number,
    offset: number,
    id?: string,
    entityType?: "agent" | "skill" | "skill-contract",
  ): Promise<z.infer<typeof Entry>[]>;
  catalogWrite(
    s: TenantSession,
    orgId: string,
    actorId: string,
    body: z.infer<typeof Write>,
    id?: string,
  ): Promise<{ id: string; versionId?: string | null }>;
  catalogPublish(
    s: TenantSession,
    orgId: string,
    actorId: string,
    kind: z.infer<typeof Kind>,
    id: string,
  ): Promise<{ id: string; versionId: string }>;
  catalogDisable(
    s: TenantSession,
    orgId: string,
    kind: z.infer<typeof Kind>,
    id: string,
  ): Promise<void>;
  readPublishedCatalogAgent(
    s: TenantSession,
    id: string,
    versionId: string,
  ): Promise<Record<string, unknown> | null>;
  copyPublishedCatalogAgent(
    s: TenantSession,
    orgId: string,
    actorId: string,
    row: Record<string, unknown>,
  ): Promise<{ id: string; versionId: string }>;
  readPublishedCatalogSkill(
    s: TenantSession,
    id: string,
    versionId: string,
  ): Promise<PublishedSkillSnapshot | null>;
  copyPublishedCatalogSkill(
    s: TenantSession,
    orgId: string,
    actorId: string,
    row: PublishedSkillSnapshot,
  ): Promise<{ id: string; versionId: string }>;
}
