import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { ensureDatabase } from "../support/db";

/**
 * #1705（#728 D-1）—— 「加 `role_label` NOT NULL 的迁移能不能升级一个**已经有 agent
 * 数据**的库」，同 `i619-migration-upgrade-path.test.ts` 一模一样的反证形状（同一份
 * `.harness/instructions` 纪律要求：写完门控立刻造反证，不能只靠"从零建的测试库全绿"
 * 就相信升级路径没问题——那条纪律本身就是 i619 那次真实空转换来的）。
 *
 * ## 为什么两张表都要反证（`agents` + `capability_listings`）
 *
 * `20260821180000_i1705_agent_role_label.sql` 给两张表都加了 `role_label`：两列都
 * **没有** NOT NULL/kind 条件强制（刻意收窄，见迁移文件头注——`agents` 被 20+ 个
 * 不相关测试的最小 INSERT 共享，`capability_listings` 还有一条独立于 `agents` 的
 * 「能力目录」admin 写路径），只有「非空则非空白」的宽松 CHECK。两处回填逻辑不同（`agents` 从
 * `role`/`name` 回填；`capability_listings` 优先从关联的 `agents.role_label` 投影，
 * 没有对应 `agents` 行时退到自己的 `duty`/`name`），所以两处都要独立反证"升级一个已有
 * 数据的库不会被自己加的约束卡死"。
 *
 * ## 必须走"分两次迁移"这条路
 *
 * 一次性把全部迁移跑完 = 表从一开始就是空的，约束当然加得上，问题从未被问过。所以：
 *   ① 用一份**摘掉 i1705**的迁移目录建库 —— 等价于「本 PR 之前的既有部署」
 *   ② 插一行**没有 role_label** 的 `agents` 行 + 一行对应的 `capability_listings` 行
 *      （形状照抄 `pg-self-publish-agent-repository.ts` 的既有落库形状：`id` 相等）
 *   ③ 再用**完整**迁移目录迁一次 —— 这才是真实升级路径
 * 第 ③ 步不炸、且两处既有行都被回填成非空，才算这条路通。
 */

const DB = "wsx_i1705_upgrade_path_test";
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

  // ① 一份摘掉 i1705 的迁移目录 = 本 PR 之前的既有部署。
  legacyDir = mkdtempSync(join(tmpdir(), "i1705-legacy-"));
  cpSync(MIGRATIONS_DIR, legacyDir, { recursive: true });
  unlinkSync(join(legacyDir, "20260821180000_i1705_agent_role_label.sql"));
}, 120_000);

afterAll(() => {
  if (legacyDir) rmSync(legacyDir, { recursive: true, force: true });
  try { psql("postgres", `DROP DATABASE IF EXISTS ${DB}`); } catch { /* 清理失败不该盖掉真实断言 */ }
}, 120_000);

it("已经有 agent 数据的库能升级：i1705 回填既有行而不是被既有行卡死", async () => {
  await migrate(cfg(), { dir: legacyDir });

  // ② 一行没有 role_label 的 agents（`role` 有值，走「优先取 role」的回填分支）+
  //    一行对应的 capability_listings（`id` 与 agents 相等，同自助发布的既有形状）。
  psql(DB, "INSERT INTO organizations (id,name,kind) VALUES ('org-i1705','X','organization')");
  psql(
    DB,
    "INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,initials,role,visibility,source," +
      "publish_state,concurrency_limit,degrade_policy) VALUES " +
      "('agent-legacy','org-i1705','agent-legacy','通用助手','enabled','u-seed',now(),now(),'TY','通用对话与任务协助'," +
      "'全组织可用','self','运行中',1,'跟随组织级')",
  );
  psql(
    DB,
    "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint,abbr,duty) " +
      "VALUES ('agent-legacy','org-i1705','agent','通用助手','org-wide',NULL,true,NULL,'TY','通用对话与任务协助')",
  );
  // 反证：此刻这一行**确实**是约束挡得住的那种行——升级前 role_label 列压根不存在，
  // 所以既有行必然为空。若哪天升级前就有这一列，这个测试就不再测原来那件事，必须
  // 在这里当场失败而不是继续绿。
  expect(
    psql(DB, "SELECT count(*) FROM information_schema.columns " +
      "WHERE table_name='agents' AND column_name='role_label'").trim(),
  ).toBe("0");
  expect(
    psql(DB, "SELECT count(*) FROM information_schema.columns " +
      "WHERE table_name='capability_listings' AND column_name='role_label'").trim(),
  ).toBe("0");

  // ③ 真实升级路径。若回填逻辑有误，这一步会抛 NOT NULL 违规或 CHECK 违规。
  const result = await migrate(cfg());
  expect(result.applied).toContain("20260821180000_i1705_agent_role_label.sql");

  // 回填要给出**非空**值，不是把约束放宽——`agents.role_label` 取自 `role` 前 8 字。
  const agentsRoleLabel = psql(DB, "SELECT role_label FROM agents WHERE id='agent-legacy'").trim();
  expect(agentsRoleLabel).toBeTruthy();
  expect(agentsRoleLabel).toBe("通用对话与任务协助".slice(0, 8));

  // `capability_listings.role_label` 应该投影自刚回填好的 `agents.role_label`（同一个
  // id 相等的行），不是各自独立回填出两个不一致的短标签。
  const capsRoleLabel = psql(DB, "SELECT role_label FROM capability_listings WHERE id='agent-legacy'").trim();
  expect(capsRoleLabel).toBeTruthy();
  expect(capsRoleLabel).toBe(agentsRoleLabel);

  // 待确认标记：机械回填出来的占位头衔，两张表都应标 true（人类还没看过这段文字）。
  expect(psql(DB, "SELECT role_label_needs_confirmation FROM agents WHERE id='agent-legacy'").trim()).toBe("t");
  expect(
    psql(DB, "SELECT role_label_needs_confirmation FROM capability_listings WHERE id='agent-legacy'").trim(),
  ).toBe("t");

  // `agents.role_label` 刻意**没有** NOT NULL（见迁移文件头注：整张表被 20+ 个不相关
  // 测试文件的最小 INSERT 共享，「建 agent 时必填」只在 `createAgent` 这条写路径的
  // 契约层强制）——所以这里不断言 agents 表会拒绝空 role_label，只验证一个没写它的行
  // 确实能插入成功（装置自检：约束没有被误加成 NOT NULL）。
  psql(DB, "INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES " +
    "('agent-after','org-i1705','agent-after','x','enabled','u-seed',now(),now())");
  expect(
    psql(DB, "SELECT role_label FROM agents WHERE id='agent-after'").trim(),
  ).toBe("");

  // `capability_listings.role_label` 同样**没有** NOT NULL/kind 条件强制（迁移文件头注：
  // 「能力目录」admin 表单这条独立写路径不产出这个字段，人类 2026-08-21 裁决明确不
  // 把它变成 role_label 的事实源）——所以一行没写 role_label 的 agent listing
  // 必须能正常插入，不被任何 CHECK 挡住。
  psql(DB, "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint,abbr,duty) " +
    "VALUES ('agent-after','org-i1705','agent','x','org-wide',NULL,true,NULL,'x','x')");
  expect(
    psql(DB, "SELECT role_label FROM capability_listings WHERE id='agent-after'").trim(),
  ).toBe("");

  // 但那条「非空则非空白」的宽松 CHECK 确实存在——传一个纯空格必须被拒。
  expect(() =>
    psql(DB, "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint,abbr,duty,role_label) " +
      "VALUES ('agent-blank','org-i1705','agent','x','org-wide',NULL,true,NULL,'x','x','   ')"),
  ).toThrow(/capability_listings_role_label_present/);
}, 300_000);
