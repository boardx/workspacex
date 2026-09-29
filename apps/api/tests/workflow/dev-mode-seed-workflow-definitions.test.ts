/**
 * 回归：迁移 + `pnpm harness dev-mode seed` 之后 `workflow_definitions` 为空，任何 Workflow 都无法从 UI / API 发起。
 * 现在 dev-mode 种子（scripts/seed-dev-mode-accounts.ts）经 UC-WR-1 发布校验导入内置 Definition：
 * 真跑这个脚本（真实 PostgreSQL），断言 Dev Mode Org 有已发布的演示 Workflow，且重跑幂等。
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEV_MODE_ORG_NAME } from "@repo/dev-mode-accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_APPROVAL_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-approval-workflow-graph";
import { DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));

function runSeed(): string {
  return execFileSync("pnpm", ["exec", "tsx", "scripts/seed-dev-mode-accounts.ts"], {
    cwd: API_DIR,
    env: { ...process.env, WORKSPACEX_DEV_MODE: "1", NODE_ENV: "development" },
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function devOrgId(): Promise<string | null> {
  const r = await asOwner((c) => c.query<{ id: string }>("SELECT id FROM organizations WHERE name = $1 AND kind = 'organization'", [DEV_MODE_ORG_NAME]));
  return r.rows[0]?.id ?? null;
}

async function publishedKeys(orgId: string): Promise<string[]> {
  const r = await asOwner((c) =>
    c.query<{ key: string }>("SELECT key FROM workflow_definition_versions WHERE org_id = $1 AND status = 'published' ORDER BY key", [orgId]),
  );
  return r.rows.map((x) => x.key);
}

describe("dev-mode seed publishes the built-in workflow definitions", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  }, 120_000);
  afterAll(async () => {
    const id = await devOrgId();
    if (id) {
      const users = await asOwner((c) => c.query<{ user_id: string }>("SELECT user_id FROM org_memberships WHERE org_id = $1", [id]));
      await resetOrgs(id);
      await asOwner((c) => c.query("DELETE FROM credentials WHERE user_id = ANY($1::text[])", [users.rows.map((u) => u.user_id)]));
    }
  });

  it("a fresh stack has published demo definitions after the seed, and a re-run is idempotent", async () => {
    const out = runSeed();
    const orgId = await devOrgId();
    expect(orgId).not.toBeNull();
    const keys = await publishedKeys(orgId!);
    expect(keys).toEqual(expect.arrayContaining([DEMO_WORKFLOW_KEY, DEMO_APPROVAL_WORKFLOW_KEY]));
    expect(out).toContain(`Workflow 已发布：${DEMO_WORKFLOW_KEY}@1`);
    // 每个内置 key 都有 workflow_definitions 行（Skill 未解析的也有，只是没有 published 版本）
    const defs = await asOwner((c) => c.query<{ n: string }>("SELECT count(*) AS n FROM workflow_definitions WHERE org_id = $1", [orgId]));
    expect(Number(defs.rows[0]!.n)).toBeGreaterThanOrEqual(keys.length);

    runSeed();
    expect(await publishedKeys(orgId!)).toEqual(keys);
  }, 120_000);
});
