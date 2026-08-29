import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { ensureDatabase } from "../support/db";

const DB = "wsx_interview_persona_upgrade_test";
const cfg = () => ({ ...migrationConfig(), database: DB });
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "workspacex-kernel";
const FOLLOW_UP = "20260829150000_complete_interview_expert_personas.sql";

function psql(database: string, sql: string): string {
  return execFileSync(
    "docker",
    [
      "compose", "-f", join(MIGRATIONS_DIR, "..", "docker-compose.dev.yml"), "-p", COMPOSE_PROJECT,
      "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", database,
      "-v", "ON_ERROR_STOP=1", "-tAc", sql,
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
}

let legacyDir: string;

beforeAll(() => {
  ensureDatabase();
  psql("postgres", `DROP DATABASE IF EXISTS ${DB}`);
  psql("postgres", `CREATE DATABASE ${DB}`);
  legacyDir = mkdtempSync(join(tmpdir(), "interview-persona-legacy-"));
  cpSync(MIGRATIONS_DIR, legacyDir, { recursive: true });
  unlinkSync(join(legacyDir, FOLLOW_UP));
}, 120_000);

afterAll(() => {
  if (legacyDir) rmSync(legacyDir, { recursive: true, force: true });
  try { psql("postgres", `DROP DATABASE IF EXISTS ${DB}`); } catch { /* preserve assertion failure */ }
}, 120_000);

it("upgrades a database that already recorded the original expert-profile migration", async () => {
  await migrate(cfg(), { dir: legacyDir });

  expect(
    psql(DB, "SELECT count(*) FROM information_schema.columns " +
      "WHERE table_name='digital_interview_expert_candidates' AND column_name='age'").trim(),
  ).toBe("0");
  expect(
    psql(DB, "SELECT count(*) FROM information_schema.columns " +
      "WHERE table_name='digital_interview_expert_snapshots' AND column_name='service_value'").trim(),
  ).toBe("0");

  const result = await migrate(cfg());
  expect(result.applied).toEqual([FOLLOW_UP]);

  const expectedColumns = [
    "age", "occupation", "goals", "interests", "pain_points", "motivations", "influences",
    "personality_traits", "service_value",
  ];
  for (const table of ["digital_interview_expert_candidates", "digital_interview_expert_snapshots"]) {
    const columns = psql(
      DB,
      `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ` +
        `AND column_name IN (${expectedColumns.map((column) => `'${column}'`).join(",")}) ORDER BY column_name`,
    ).trim().split("\n");
    expect(columns).toEqual([...expectedColumns].sort());
  }
}, 300_000);
