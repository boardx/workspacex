import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ExistingImportOutcome,
  PersistVerifiedImportOutcome,
  SkillStarterImportRepository,
  SkillStarterImportResult,
} from "../../application/skill-import/ports";
import { skillContentDigest } from "../../domain/skill/starter-pack";
import { PLATFORM_ORG_ID } from "../../domain/org-id";

interface ImportRow {
  status: "pending" | "succeeded" | "failed";
  payload_digest: string;
  result_json: SkillStarterImportResult | null;
  failure_code: string | null;
}

async function findImport(
  session: TenantSession,
  orgId: string,
  idempotencyKey: string,
): Promise<ImportRow | null> {
  const found = await session.query<ImportRow>(
    `SELECT status, payload_digest, result_json, failure_code
       FROM starter_pack_imports
      WHERE org_id = $1 AND idempotency_key = $2`,
    [orgId, idempotencyKey],
  );
  return found.rows[0] ?? null;
}

function existingOutcome(
  existing: ImportRow,
  payloadDigest: string,
): Exclude<ExistingImportOutcome, { readonly kind: "missing" }> {
  if (existing.payload_digest !== payloadDigest) return { kind: "idempotency-conflict" };
  if (existing.status === "succeeded" && existing.result_json) {
    return { kind: "replayed", result: existing.result_json };
  }
  return { kind: "previous-failure", failureCode: existing.failure_code ?? "SKILL_STARTER_PACK_INVALID" };
}

export class PgSkillStarterImportRepository implements SkillStarterImportRepository {
  constructor(private readonly db: DatabasePort) {}

  async findExisting(input: Parameters<SkillStarterImportRepository["findExisting"]>[0]) {
    return this.db.withTenant(input.orgId, async (session): Promise<ExistingImportOutcome> => {
      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (!existing) return { kind: "missing" };
      return existingOutcome(existing, input.payloadDigest);
    });
  }

  async persistVerified(input: Parameters<SkillStarterImportRepository["persistVerified"]>[0]) {
    return this.db.withTenant(input.orgId, async (session): Promise<PersistVerifiedImportOutcome> => {
      // Serialize imports per organization. This closes the race between conflict detection
      // and inserts without blocking unrelated tenants.
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);

      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (existing) return existingOutcome(existing, input.payloadDigest);

      const importId = `skill-import-${randomUUID()}`;
      const importedAt = new Date().toISOString();
      await session.query(
        `INSERT INTO starter_pack_imports
          (id, org_id, pack_id, pack_version, pack_digest, payload_digest, idempotency_key,
           administrator_id, imported_at, status, result_json, failure_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULL,NULL)`,
        [
          importId,
          input.orgId,
          input.pack.packId,
          input.pack.packVersion,
          input.pack.packDigest,
          input.payloadDigest,
          input.idempotencyKey,
          input.actorId,
          importedAt,
        ],
      );

      const stableNames = input.pack.skills.map((skill) => skill.stableName);
      const names = input.pack.skills.map((skill) => skill.name.toLocaleLowerCase());
      // ⚠ 同时对着 `PLATFORM_ORG_ID` 查——四个官方 skill（`skill-platform-*`）在
      // `listAll()`/`GET /skills` 里对每个组织都可见（design-delta `platform-owned-skills`
      // 的 `OR org_id = PLATFORM_ORG_ID` 兜底），但这条冲突检查此前只查了 `org_id = $1`
      // 自己。两条唯一约束（`skills_name_casefold_uniq`/`capability_listings_uniq`）也都是
      // `(org_id, ...)` 维度，永远不会因为撞了平台行而失败——组织能悄悄导入一个和平台
      // 官方 skill 同名的 skill，`GET /skills` 把两条拼在一起返回、互不去重，chat 的
      // `#` 挂载列表与 `/skill` 目录里就会看到同一个名字出现两次，且都能被独立挂载。
      // 这里把平台组织也纳入冲突判定，从源头挡住这种新的同名重复。
      const conflicts = await session.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM skills
            WHERE (org_id = $1 OR org_id = $4)
              AND (stable_name = ANY($2::text[]) OR lower(name) = ANY($3::text[]))
           UNION ALL
           SELECT 1 FROM capability_listings
            WHERE (org_id = $1 OR org_id = $4) AND kind = 'skill' AND lower(name) = ANY($3::text[])
         ) AS present`,
        [input.orgId, stableNames, names, PLATFORM_ORG_ID],
      );
      if (conflicts.rows[0]?.present) {
        await session.query(
          `UPDATE starter_pack_imports
              SET status = 'failed', failure_code = 'SKILL_STARTER_PACK_CONFLICT'
            WHERE id = $1 AND org_id = $2`,
          [importId, input.orgId],
        );
        return { kind: "name-conflict" };
      }

      const skillIds: string[] = [];
      const versionIds: string[] = [];
      for (const skill of input.pack.skills) {
        const skillId = `skill-${randomUUID()}`;
        const versionId = `skill-version-${randomUUID()}`;
        skillIds.push(skillId);
        versionIds.push(versionId);

        await session.query(
          `INSERT INTO skills
            (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)`,
          [skillId, input.orgId, skill.stableName, skill.name, input.actorId, importedAt],
        );
        await session.query(
          `INSERT INTO skill_versions
            (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id,
             created_at, published)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,false)`,
          [
            versionId,
            input.orgId,
            skillId,
            skill.semanticVersion,
            skillContentDigest(skill),
            JSON.stringify(skill.manifest),
            input.actorId,
            importedAt,
          ],
        );
        for (const file of skill.files) {
          await session.query(
            `INSERT INTO skill_version_files
              (org_id, version_id, path, content, media_type, digest)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              input.orgId,
              versionId,
              file.path,
              Buffer.from(file.contentBase64, "base64"),
              file.mediaType,
              file.digest,
            ],
          );
        }
        await session.query("SELECT wave2_publish_skill_version($1, $2)", [input.orgId, versionId]);

        // `capability_listings` is the signed Wave 1 directory projection. It is created in
        // the same transaction so the UI can never see a Skill definition without its row,
        // or a selectable row whose immutable definition rolled back.
        await session.query(
          `INSERT INTO capability_listings
            (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
           VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)`,
          [skillId, input.orgId, skill.name],
        );
      }

      const result: SkillStarterImportResult = {
        importId,
        packId: input.pack.packId,
        packVersion: input.pack.packVersion,
        packDigest: input.pack.packDigest,
        status: "succeeded",
        skillIds,
        versionIds,
        importedAt,
      };
      await session.query(
        `UPDATE starter_pack_imports
            SET status = 'succeeded', result_json = $3::jsonb, failure_code = NULL
          WHERE id = $1 AND org_id = $2`,
        [importId, input.orgId, JSON.stringify(result)],
      );
      return { kind: "created", result };
    });
  }

  async recordFailure(input: Parameters<SkillStarterImportRepository["recordFailure"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);
      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (existing) {
        return existingOutcome(existing, input.payloadDigest);
      }
      await session.query(
        `INSERT INTO starter_pack_imports
          (id, org_id, pack_id, pack_version, pack_digest, payload_digest, idempotency_key,
           administrator_id, imported_at, status, result_json, failure_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',NULL,$10)`,
        [
          `skill-import-${randomUUID()}`,
          input.orgId,
          input.packId,
          input.packVersion,
          input.packDigest,
          input.payloadDigest,
          input.idempotencyKey,
          input.actorId,
          new Date().toISOString(),
          input.failureCode,
        ],
      );
      return { kind: "previous-failure" as const, failureCode: input.failureCode };
    });
  }
}
