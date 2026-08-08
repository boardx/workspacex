/**
 * One-time (idempotent, safe to run every deploy) backfill for `capability_listings` rows
 * missing for URL-imported skills (`skills` table, wave2 model) -- 2026-08-07, 人类实测
 * "我在后台不能看到导入了的 skills"。
 *
 * `pg-skill-url-import-repository.ts` did not write this row until this same change landed
 * (see that file's 2026-08-07 header addition). Every skill imported via URL *before* this
 * fix is enabled/published and fully executable, but has no directory row -- exactly the
 * bug report's symptom, for every org that imported one before today.
 *
 * Scoped strictly to `status = 'enabled'` skills with no matching `capability_listings` row
 * (matched by id, since `pg-skill-url-import-repository.ts` uses the skill's own id as the
 * listing's id -- same convention `pg-skill-starter-import-repository.ts` uses).
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";

export interface SkillListingBackfillReport {
  readonly candidateCount: number;
  readonly created: number;
}

export async function backfillSkillCapabilityListings(): Promise<SkillListingBackfillReport> {
  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  try {
    const { rows } = await owner.query<{ id: string; org_id: string; name: string }>(
      `SELECT sk.id, sk.org_id, sk.name
         FROM skills sk
        WHERE sk.status = 'enabled'
          AND NOT EXISTS (
                SELECT 1 FROM capability_listings cl
                 WHERE cl.id = sk.id AND cl.org_id = sk.org_id
              )`,
    );
    let created = 0;
    for (const row of rows) {
      const result = await owner.query(
        `INSERT INTO capability_listings
           (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
         VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.org_id, row.name],
      );
      if ((result.rowCount ?? 0) > 0) created += 1;
      console.log(`[backfill-skill-capability-listings] org=${row.org_id} skillId=${row.id} name=${row.name}`);
    }
    if (rows.length > 0) {
      console.log(`[backfill-skill-capability-listings] done: ${created} listing row(s) created`);
    } else {
      console.log("[backfill-skill-capability-listings] nothing to create -- every enabled skill already has a listing row");
    }
    return { candidateCount: rows.length, created };
  } finally {
    await owner.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await backfillSkillCapabilityListings();
}
