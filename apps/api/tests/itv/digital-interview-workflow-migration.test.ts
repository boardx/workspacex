import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { ensureDatabase, migrateOnce } from "../support/db";

const MIGRATION = fileURLToPath(new URL(
  "../../migrations/20260815120000_f04_digital_interview_workflow.sql",
  import.meta.url,
));

const BUSINESS_TABLES = [
  "digital_interview_revisions",
  "digital_interview_topic_versions",
  "digital_interview_expert_snapshot_versions",
  "digital_interview_expert_snapshots",
  "digital_interview_question_versions",
  "digital_interview_questions",
  "digital_interview_skill_threads",
  "digital_interview_skill_messages",
  "digital_interview_skill_proposals",
  "digital_interview_step_receipts",
] as const;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
}, 120_000);

describe("F04 digital interview workflow migration", () => {
  it("creates normalized tenant tables with forced RLS and composite tenant foreign keys", async () => {
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      const tables = await client.query<{ table_name: string; rls: boolean; forced: boolean }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
          ORDER BY c.relname`,
        [[...BUSINESS_TABLES]],
      );
      expect(tables.rows).toHaveLength(BUSINESS_TABLES.length);
      expect(tables.rows.every((row) => row.rls && row.forced)).toBe(true);

      const missingOrgColumns = await client.query<{ table_name: string }>(
        `SELECT wanted.table_name
           FROM unnest($1::text[]) AS wanted(table_name)
          WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'public'
               AND c.table_name = wanted.table_name
               AND c.column_name = 'org_id'
          )`,
        [[...BUSINESS_TABLES]],
      );
      expect(missingOrgColumns.rows).toEqual([]);

      const foreignKeys = await client.query<{ table_name: string; definition: string }>(
        `SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition
           FROM pg_constraint k
           JOIN pg_class c ON c.oid = k.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND k.contype = 'f'
            AND c.relname = ANY($1::text[])`,
        [[...BUSINESS_TABLES]],
      );
      expect(foreignKeys.rows.length).toBeGreaterThanOrEqual(BUSINESS_TABLES.length);
      expect(foreignKeys.rows.every((row) => /FOREIGN KEY \(org_id(?:,|\))/.test(row.definition))).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("enforces receipt identity, one current version per revision, and the proposal lifecycle", async () => {
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])`,
        [[
          "digital_interview_step_receipts",
          "digital_interview_topic_versions",
          "digital_interview_expert_snapshot_versions",
          "digital_interview_question_versions",
        ]],
      );
      expect(indexes.rows.some((row) =>
        row.indexdef.includes("(org_id, interview_id, operation_id)"),
      )).toBe(true);
      for (const table of ["topic", "expert_snapshot", "question"] as const) {
        expect(indexes.rows.some((row) =>
          row.indexname === `digital_interview_${table}_versions_one_current`,
        )).toBe(true);
      }

      const proposalCheck = await client.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(k.oid) AS definition
           FROM pg_constraint k
           JOIN pg_class c ON c.oid = k.conrelid
          WHERE c.relname = 'digital_interview_skill_proposals'
            AND k.contype = 'c'`,
      );
      const definitions = proposalCheck.rows.map((row) => row.definition).join("\n");
      for (const state of ["proposed", "applied_to_draft", "rejected", "committed", "stale"] as const) {
        expect(definitions).toContain(state);
      }
    } finally {
      await client.end();
    }
  });

  it("is safe to replay after a partially completed deployment", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      await client.query(sql);
      await client.query(sql);
      const tables = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
        [[...BUSINESS_TABLES]],
      );
      expect(Number(tables.rows[0]?.count)).toBe(BUSINESS_TABLES.length);
    } finally {
      await client.end();
    }
  });

  it("installs the pinned PostgresSaver 0.1.2 schema during migration instead of application boot", async () => {
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'langgraph_interview'
          ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "checkpoint_blobs",
        "checkpoint_migrations",
        "checkpoint_writes",
        "checkpoints",
      ]);
      const versions = await client.query<{ v: number }>(
        "SELECT v FROM langgraph_interview.checkpoint_migrations ORDER BY v",
      );
      expect(versions.rows.map((row) => row.v)).toEqual([0, 1, 2, 3, 4]);
    } finally {
      await client.end();
    }
  });
});
