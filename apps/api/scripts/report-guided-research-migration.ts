/**
 * WF07 / E12 —— 打印引导式研究 Stage 1 迁移的未迁会话清单（只读；期望 0）。
 * 用法：`pnpm --filter api exec tsx scripts/report-guided-research-migration.ts`；清单非空时退出码 1。
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { reportGuidedResearchMigration } from "./lib/guided-research-stage1-migration";

const client = new pg.Client(migrationConfig());
await client.connect();
try {
  const report = await reportGuidedResearchMigration(client);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.unmigrated.length === 0 && report.unmigratedReceipts.length === 0 ? 0 : 1;
} finally {
  await client.end();
}
