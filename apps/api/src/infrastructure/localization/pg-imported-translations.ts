import type { PackLocalization } from "@repo/contracts/pack-localization";
import type { TenantSession } from "../../application/ports/database.port";
import { LOCALIZATION_TABLES, type SourceCandidate } from "./pg-entity-localization-repository";

/** Package copy can replace only package-owned reviewed rows. Manual edits and
 * clear tombstones remain manual. A title-only release preserves omitted fields. */
export async function writeImportedTranslations(s: TenantSession, source: SourceCandidate["source"],
  translations: PackLocalization["translations"], actorId: string, preserveOmitted = false): Promise<number> {
  const { table, id } = LOCALIZATION_TABLES[source.kind];
  const columns = ["name","summary","duty","role_label","avatar_alt"];
  const value = (column: string) => preserveOmitted ? `COALESCE(EXCLUDED.${column},${table}.${column})` : `EXCLUDED.${column}`;
  let changed = 0;
  for (const [locale, fields] of Object.entries(translations)) {
    const result = await s.query(`INSERT INTO ${table}
      (org_id,${id},locale,source_revision,translation_revision,status,name,summary,duty,role_label,avatar_alt,provenance,updated_by)
      VALUES ($1,$2,$3,$4,1,'reviewed',$5,$6,$7,$8,$9,'import',$10)
      ON CONFLICT(org_id,${id},locale,source_revision) DO UPDATE SET
        translation_revision=${table}.translation_revision+1,${columns.map(column => `${column}=${value(column)}`).join(",")},
        updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()
      WHERE ${table}.provenance='import' AND ${table}.status='reviewed'
        AND ROW(${columns.map(column => `${table}.${column}`).join(",")})
          IS DISTINCT FROM ROW(${columns.map(value).join(",")}) RETURNING locale`,
    [source.orgId,source.entityId,locale,source.revision,fields.name ?? null,fields.summary ?? null,fields.duty ?? null,
      fields.roleLabel ?? null,fields.avatarAlt ?? null,actorId]);
    changed += result.rows.length;
  }
  return changed;
}
