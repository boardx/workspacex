/**
 * AG02 —— agent_versions.tool_policy CHECK 迁移（03-agent-role.md R3 ②，ADR-120 #2）。
 * 旧「必须为空数组」CHECK 被替换为「数组且每项符合能力分类格式」CHECK；
 * 对同一组样本，DB CHECK 与契约 `StarterPackToolPolicy.safeParse` 判定一致（单源核对）。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRole as R } from "@repo/contracts";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-ag02-toolpolicy";
let seq = 0;

async function insertVersion(toolPolicy: unknown): Promise<{ ok: boolean; error?: string }> {
  const id = `ag02-v${++seq}`;
  const agentId = `agt-${id}`;
  try {
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$1,$1,'enabled','u',now(),now())`, [agentId, ORG]);
      await c.query(
        `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
           skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
         VALUES ($1,$2,$3,'1.0.0',$4,'i','{}','p','m',$5::jsonb,'u',now(),now())`,
        [id, ORG, agentId, "a".repeat(64), JSON.stringify(toolPolicy)]);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as { constraint?: string }).constraint ?? e) };
  }
}

const SAMPLES: unknown[] = [
  [], ["knowledge.search"], ["knowledge.search", "crm.read"], ["doc-store.read"],
  [{ token: "x" }], ["Knowledge.Search"], ["https://api.openai.com"], ["openai"], ["sk-abc"],
  ["knowledge."], [""], [1], [null], [["crm.read"]], "knowledge.search", { a: 1 },
  ["a." + "b".repeat(70)], Array.from({ length: 65 }, (_, i) => `cat.c${i}`),
];

describe("AG02 tool_policy CHECK migration", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-ag02" });
  });

  it('accepts ["knowledge.search"]', async () => {
    expect(await insertVersion(["knowledge.search"])).toEqual({ ok: true });
  });

  it('rejects [{"token":"x"}] via the tool_policy CHECK', async () => {
    const r = await insertVersion([{ token: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("agent_versions_tool_policy_check");
  });

  it("the legacy empty-array-only CHECK is gone (exactly one tool_policy CHECK remains)", async () => {
    const defs = await asOwner(async (c) => (await c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'agent_versions'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%tool_policy%'`)).rows.map((r) => r.def));
    expect(defs).toHaveLength(1);
    expect(defs[0]).not.toMatch(/jsonb_array_length\(tool_policy\)\s*=\s*0/);
  });

  it.each(SAMPLES.map((sample) => ({ sample })))("DB CHECK agrees with contract safeParse for $sample", async ({ sample }) => {
    const contractOk = R.StarterPackToolPolicy.safeParse(sample).success;
    expect((await insertVersion(sample)).ok).toBe(contractOk);
  });
});
