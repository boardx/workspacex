import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { ensureDatabase } from "../support/db";

/**
 * #619 —— 「加约束的迁移能不能升级一个**已经有数据**的库」。
 *
 * ## 为什么需要这个文件（它挡的是一个真的发生过的空转）
 *
 * `20260807000000_i619_...sql` 给 `capability_listings` 加了
 * `capability_listings_agent_needs_abbr_duty`。第一版**直接 ADD CONSTRAINT，没有回填**，
 * 而全套 4900+ 用例**全绿**——因为测试库都是从零建的：本迁移的文件名排在 i617
 * （20260807030000）和一切写 agent 的路径之前，约束加上去时表是空的。
 * ⇒「已有 agent 的库能不能升上来」这个问题**在测试里从来没有被问过**。
 *
 * 实际结果是升级必炸：凡跑过 #662/#691 的部署，每个 org 至少有一行系统预置 agent 的
 * listing，`ADD CONSTRAINT` 会校验既有行并抛
 * `... is violated by some row`，迁移中断。
 *
 * ## 这个测试**必须**走"分两次迁移"这条路，不能简化
 *
 * 一次性把全部迁移跑完 = 复现原来那个空转（表是空的，约束当然加得上）。所以这里：
 *   ① 用一份**摘掉 i619** 的迁移目录建库 —— 等价于「本 PR 之前的既有部署」
 *   ② 按 `ensureSystemAgent` 在 main 上的写法插一行**没有 abbr/duty** 的 agent listing
 *   ③ 再用**完整**迁移目录迁一次 —— 这才是真实升级路径
 * 第 ③ 步不炸、且既有行被回填成非空，才算这条路通。
 */

const DB = "wsx_i619_upgrade_path_test";
const cfg = () => ({ ...migrationConfig(), database: DB });
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "workspacex-kernel";

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

  // ① 一份摘掉 i619 的迁移目录 = 本 PR 之前的既有部署。
  legacyDir = mkdtempSync(join(tmpdir(), "i619-legacy-"));
  cpSync(MIGRATIONS_DIR, legacyDir, { recursive: true });
  unlinkSync(join(legacyDir, "20260807000000_i619_agent_roster_capability_convergence.sql"));
}, 120_000);

afterAll(() => {
  if (legacyDir) rmSync(legacyDir, { recursive: true, force: true });
  try { psql("postgres", `DROP DATABASE IF EXISTS ${DB}`); } catch { /* 清理失败不该盖掉真实断言 */ }
}, 120_000);

it("已经有 agent listing 的库能升级：i619 回填既有行而不是被既有行卡死", async () => {
  await migrate(cfg(), { dir: legacyDir });

  // ② main 的 `ensureSystemAgent` 就是这个形状：不带 abbr/duty。
  psql(DB, "INSERT INTO organizations (id,name,kind) VALUES ('org-i619','X','organization')");
  psql(
    DB,
    "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint) " +
      "VALUES ('agent-legacy','org-i619','agent','通用助手','org-wide',NULL,true,NULL)",
  );
  // 反证：此刻这一行**确实**是约束挡得住的那种行——升级前 abbr/duty 两列压根不存在，
  // 所以既有行必然两列皆空。若哪天升级前就有这两列（有人把它们挪到更早的迁移里），
  // 这个测试就不再测原来那件事，必须在这里当场失败而不是继续绿。
  expect(
    psql(DB, "SELECT count(*) FROM information_schema.columns " +
      "WHERE table_name='capability_listings' AND column_name IN ('abbr','duty')").trim(),
  ).toBe("0");

  // ③ 真实升级路径。原实现在这一步抛
  //    `check constraint "capability_listings_agent_needs_abbr_duty" ... is violated by some row`。
  const result = await migrate(cfg());
  expect(result.applied).toContain("20260807000000_i619_agent_roster_capability_convergence.sql");

  // 回填要给出**非空**值，不是把约束放宽。
  const [abbr, duty] = psql(DB, "SELECT abbr || '|' || duty FROM capability_listings WHERE id='agent-legacy'")
    .trim().split("|");
  expect(abbr).toBeTruthy();
  expect(duty).toBeTruthy();

  // 约束确实存在（回填不是靠"没加约束"蒙混过关）——再插一行无 abbr/duty 的 agent 必须被挡。
  expect(() =>
    psql(DB, "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint) " +
      "VALUES ('agent-after','org-i619','agent','x','org-wide',NULL,true,NULL)"),
  ).toThrow(/capability_listings_agent_needs_abbr_duty/);
}, 300_000);
