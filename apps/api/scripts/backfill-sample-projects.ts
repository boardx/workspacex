/**
 * backlog E2 —— 给存量组织补种内置脱敏示例项目（幂等，每次部署可跑）。
 *
 * 同 `backfill-default-agents.ts` 的形状：OWNER 连接只用来跨租户枚举「组织 + 最早的 admin」
 * （RLS 故意挡住应用角色做这种读），真正的写入走 `createSampleProjectSeeder` ——与
 * `/auth/bootstrap`、`/auth/register-open` 逐字相同的写路径（`ensureSampleProject`）。
 *
 * 候选：非平台组织、有 admin、且**没有**带「内置示例」标签的项目（含已归档——用户归档
 * 即删除，不种回来）。离线：只碰 PostgreSQL 与已配置的对象存储；索引由 ingestion worker
 * 之后在本地异步完成。
 */
import { isCliEntry } from "./cli-entry";
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PLATFORM_ORG_ID, toOrgId } from "../src/domain/org-id";
import { SAMPLE_PROJECT_TAG } from "../src/application/project/sample-project/sample-project-content";
import { createSampleProjectSeeder } from "../src/infrastructure/project/sample-project-seeder";
import { createObjectStore } from "../src/infrastructure/storage/create-object-store";

export interface SampleProjectBackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly failed: number;
}

export async function backfillSampleProjects(): Promise<SampleProjectBackfillReport> {
  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  let candidates: { orgId: string; actorId: string }[];
  let skippedNoAdmin = 0;
  try {
    const { rows } = await owner.query<{ org_id: string; actor_id: string | null }>(
      `SELECT o.id AS org_id,
              (SELECT m.user_id FROM org_memberships m
                WHERE m.org_id = o.id AND m.org_role = 'admin'
                ORDER BY m.user_id ASC LIMIT 1) AS actor_id
         FROM organizations o
        WHERE o.id <> $2
          AND NOT EXISTS (SELECT 1 FROM project_tags t WHERE t.org_id = o.id AND t.tag = $1)`,
      [SAMPLE_PROJECT_TAG, PLATFORM_ORG_ID],
    );
    candidates = rows
      .filter((r): r is { org_id: string; actor_id: string } => r.actor_id !== null)
      .map((r) => ({ orgId: r.org_id, actorId: r.actor_id }));
    skippedNoAdmin = rows.length - candidates.length;
  } finally {
    await owner.end();
  }

  const db = new PgDatabase(appConfig());
  try {
    const seed = createSampleProjectSeeder(db, await createObjectStore());
    let created = 0;
    let failed = 0;
    for (const { orgId, actorId } of candidates) {
      try {
        const r = await seed({ orgId: toOrgId(orgId), actorId });
        if (r.created) created += 1;
        console.log(`[backfill-sample-projects] org=${orgId} project=${r.projectId} created=${r.created}`);
      } catch (e) {
        // 一个组织失败（如该 admin 被停用）不挡其他组织；非零退出让部署看得见。
        failed += 1;
        console.error(`[backfill-sample-projects] org=${orgId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`[backfill-sample-projects] done: candidates=${candidates.length} created=${created} failed=${failed} skippedNoAdmin=${skippedNoAdmin}`);
    return { candidateCount: candidates.length, skippedNoAdmin, created, failed };
  } finally {
    await db.close();
  }
}

if (isCliEntry(import.meta.url)) {
  const report = await backfillSampleProjects();
  if (report.failed > 0) process.exitCode = 1;
}
