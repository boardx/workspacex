import type { z } from "zod";
import {
  EntityDisplaySource, EntityLocalization, resolveEntityDisplay,
  type EntityKind, type EntityLocalizationAdminView, type EntityLocalizationWrite,
  type EntityLocalizationClear, type EntitySourceLocaleWrite,
} from "@repo/contracts/entity-localization";
import type { Locale } from "@repo/contracts/locale";
import { identity } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { EntityLocalizationRepository, AuthorizedLocalizationRequest, LocalizationOutcome, LocalizationVisibilityFacts } from "../../application/localization/entity-localization";
import { guard, discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { PLATFORM_ORG_ID, toOrgId } from "../../domain/org-id";

type Source = z.infer<typeof EntityDisplaySource>;
type Translation = z.infer<typeof EntityLocalization>;
export const LOCALIZATION_TABLES = {
  skill: { parent: "skills", table: "skill_localizations", id: "skill_id" },
  agent: { parent: "agents", table: "agent_localizations", id: "agent_id" },
} as const;
interface SourceRow {
  id: string; org_id: string; name: string; source_locale: Locale | null; source_revision: string;
  version_id: string | null; summary: unknown; duty: string | null; role_label: string | null; avatar_alt: string | null;
  visibility_scope: unknown; owner_team_id: string | null;
}
export interface SourceCandidate { source: Source; facts: LocalizationVisibilityFacts }
interface TranslationRow {
  org_id: string; entity_id: string; locale: Locale; source_revision: string;
  translation_revision: number; status: "draft" | "reviewed";
  name: string | null; summary: string | null; duty: string | null; role_label: string | null; avatar_alt: string | null;
}
function sourceOf(kind: EntityKind, row: SourceRow): Source {
  const fields = {
    name: row.name, summary: typeof row.summary === "string" ? row.summary : null,
    duty: row.duty, roleLabel: row.role_label,
    avatarAlt: row.avatar_alt,
  };
  return EntityDisplaySource.parse({ orgId: row.org_id, entityId: row.id, kind, revision: row.source_revision, versionId: row.version_id, locale: row.source_locale, fields });
}
function translationOf(kind: EntityKind, row: TranslationRow): Translation {
  return EntityLocalization.parse({
    orgId: row.org_id, entityId: row.entity_id, kind, sourceRevision: row.source_revision,
    locale: row.locale, revision: row.translation_revision, status: row.status,
    fields: { name: row.name, summary: row.summary, duty: row.duty, roleLabel: row.role_label, avatarAlt: row.avatar_alt },
  });
}

export async function localizationSources(session: TenantSession, orgId: string, kind: EntityKind, ids: readonly string[], shared = false): Promise<SourceCandidate[]> {
  if (ids.length === 0) return [];
  const platform = kind === "skill" && shared;
  const query = `SELECT * FROM entity_localization_sources WHERE kind=$2 AND id=ANY($3::text[])
    AND ${platform ? "org_id IN ($1,$4)" : "org_id=$1"}`;
  const result = await session.query<SourceRow>(query, platform ? [orgId, kind, ids, PLATFORM_ORG_ID] : [orgId, kind, ids]);
  return result.rows.map(row => ({ source: sourceOf(kind, row), facts: {
    scope: identity.VisibilityScope.parse(row.visibility_scope), ownerTeamId: row.owner_team_id,
  } }));
}
function discloseSource(candidate: SourceCandidate | undefined, authorize: AuthorizedLocalizationRequest["authorize"]): Source | null {
  if (!candidate) return null;
  const disclosed = discloseDecided(guard({ kind: "capability", id: candidate.source.entityId }, candidate.source), authorize(candidate.facts));
  return isDisclosed(disclosed) ? disclosed.payload : null;
}
async function translation(session: TenantSession, source: Source, locale: Locale): Promise<Translation | null> {
  const { table, id } = LOCALIZATION_TABLES[source.kind];
  const result = await session.query<TranslationRow>(
    `SELECT *,${id} AS entity_id FROM ${table} WHERE org_id=$1 AND ${id}=$2 AND locale=$3 AND source_revision=$4`,
    [source.orgId, source.entityId, locale, source.revision],
  );
  return result.rows[0] ? translationOf(source.kind, result.rows[0]) : null;
}

/** Tenant persistence. Display methods consume IDs already disclosed by the existing read use case. */
export class PgEntityLocalizationRepository implements EntityLocalizationRepository {
  constructor(private readonly db: DatabasePort) {}

  get(input: AuthorizedLocalizationRequest): Promise<EntityLocalizationAdminView | null> {
    return this.db.withTenant(toOrgId(input.orgId), async session => {
      const source = discloseSource((await localizationSources(session, input.orgId, input.kind, [input.entityId]))[0], input.authorize);
      return source ? { source, translation: await translation(session, source, input.locale) } : null;
    });
  }

  private async lockSource(session: TenantSession, input: Omit<AuthorizedLocalizationRequest, "locale">): Promise<Source | null> {
    const parent = LOCALIZATION_TABLES[input.kind].parent;
    const locked = await session.query(`SELECT id FROM ${parent} WHERE org_id=$1 AND id=$2 FOR UPDATE`, [input.orgId, input.entityId]);
    return locked.rows.length ? discloseSource((await localizationSources(session, input.orgId, input.kind, [input.entityId]))[0], input.authorize) : null;
  }

  put(input: AuthorizedLocalizationRequest & { body: EntityLocalizationWrite }): Promise<LocalizationOutcome<EntityLocalizationAdminView>> {
    return this.write(input, false);
  }
  clear(input: AuthorizedLocalizationRequest & { body: EntityLocalizationClear }): Promise<LocalizationOutcome<EntityLocalizationAdminView>> {
    return this.write({ ...input, body: { ...input.body, fields: {}, status: "draft" } }, true);
  }
  private write(input: AuthorizedLocalizationRequest & { body: EntityLocalizationWrite }, clearing: boolean): Promise<LocalizationOutcome<EntityLocalizationAdminView>> {
    return this.db.withTenant(toOrgId(input.orgId), async session => {
      const source = await this.lockSource(session, input);
      if (!source) return { kind: "not-found" };
      if (source.revision !== input.body.sourceRevision) return { kind: "source-changed" };
      const current = await translation(session, source, input.locale);
      if ((current?.revision ?? null) !== input.body.expectedTranslationRevision) return { kind: "translation-changed" };
      if (clearing && !current) return { kind: "translation-changed" };
      const { table, id } = LOCALIZATION_TABLES[input.kind];
      const fields = input.body.fields;
      // Parent FOR UPDATE serializes create/update/clear for each entity and prevents duplicate CAS winners.
      await session.query(`INSERT INTO ${table}
        (org_id,${id},locale,source_revision,translation_revision,status,name,summary,duty,role_label,avatar_alt,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(org_id,${id},locale,source_revision) DO UPDATE SET
          translation_revision=EXCLUDED.translation_revision,status=EXCLUDED.status,name=EXCLUDED.name,
          summary=EXCLUDED.summary,duty=EXCLUDED.duty,role_label=EXCLUDED.role_label,avatar_alt=EXCLUDED.avatar_alt,
          provenance='manual',updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,
      [source.orgId, source.entityId, input.locale, source.revision, (current?.revision ?? 0) + 1,
        input.body.status, fields.name ?? null, fields.summary ?? null, fields.duty ?? null,
        fields.roleLabel ?? null, fields.avatarAlt ?? null, input.actorId]);
      return { kind: "ok", view: { source, translation: await translation(session, source, input.locale) } };
    });
  }

  setSourceLocale(input: Omit<AuthorizedLocalizationRequest, "locale"> & { body: EntitySourceLocaleWrite }): Promise<LocalizationOutcome<Source>> {
    return this.db.withTenant(toOrgId(input.orgId), async session => {
      const source = await this.lockSource(session, input);
      if (!source) return { kind: "not-found" };
      if (source.revision !== input.body.expectedSourceRevision) return { kind: "source-changed" };
      await session.query(`UPDATE ${LOCALIZATION_TABLES[input.kind].parent} SET source_locale=$3,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2`, [input.orgId, input.entityId, input.body.locale]);
      const next = discloseSource((await localizationSources(session, input.orgId, input.kind, [input.entityId]))[0], input.authorize);
      if (!next) throw new Error("localization source disappeared within locked transaction");
      return { kind: "ok", view: next };
    });
  }

  displays(orgId: string, kind: EntityKind, ids: readonly string[], locale: Locale) {
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.db.withTenant(toOrgId(orgId), async session => {
      const visible = (await localizationSources(session, orgId, kind, [...new Set(ids)], true)).map(candidate => candidate.source);
      if (visible.length === 0) return new Map();
      const { table, id } = LOCALIZATION_TABLES[kind];
      const result = await session.query<TranslationRow>(
        `SELECT *,${id} AS entity_id FROM ${table} WHERE org_id=ANY($1::text[]) AND ${id}=ANY($2::text[]) AND locale=$3 AND source_revision=ANY($4::text[])`,
        [[...new Set(visible.map(source => source.orgId))], visible.map(source => source.entityId), locale, visible.map(source => source.revision)],
      );
      const translations = new Map(result.rows.map(row => [JSON.stringify([row.org_id, row.entity_id, row.source_revision]), translationOf(kind, row)]));
      return new Map(visible.map(source => [source.entityId, resolveEntityDisplay(source, locale,
        translations.get(JSON.stringify([source.orgId, source.entityId, source.revision])) ?? null)]));
    });
  }
}
