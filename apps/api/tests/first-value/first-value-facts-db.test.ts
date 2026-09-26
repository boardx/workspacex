/**
 * E3 —— `first_value_facts` 真 PostgreSQL（app_rw 身份）：
 *   · 先写者胜：同组织同步第二次写入不改 occurred_at；
 *   · RLS：另一租户读不到；
 *   · 上报函数排除 personal-local、只回序号不回 org_id（先证明有行，空集不算绿）。
 *   · benchmark 计数函数：personal-local 的席位不计入、只回一行两个计数。
 *   · usage 计数函数（#4226）：只回一行五列；按能力编号分组只算有编号的技能；personal-local 的运行/token 不计入。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgFirstValueFacts } from "../../src/infrastructure/first-value/pg-first-value-facts";
import { PgTelemetryFacts } from "../../src/infrastructure/telemetry/pg-telemetry-facts";
import type { OrgId } from "../../src/domain/org-id";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const STD = "org-fv-std";
const LOCAL = "org-fv-local";
const session = (c: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): TenantSession =>
  ({ query: (sql: string, params?: unknown[]) => c.query(sql, params) }) as unknown as TenantSession;
const db = {
  withTenant: (orgId: string, fn: (s: TenantSession) => Promise<unknown>) => asApp(orgId, (c) => fn(session(c))),
  withoutTenant: (fn: (s: TenantSession) => Promise<unknown>) => asApp(null, (c) => fn(session(c))),
  close: async () => undefined,
} as unknown as DatabasePort;
const store = new PgFirstValueFacts(db);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(STD, LOCAL);
  await seedOrg({ orgId: STD, projectId: "p-fv-std" });
  await seedOrg({ orgId: LOCAL, kind: "personal-local", projectId: "p-fv-local" });
});
afterAll(async () => {
  await resetOrgs(STD, LOCAL);
});

describe("first_value_facts", () => {
  it("先写者胜", async () => {
    await store.recordFirst(STD as OrgId, "first_sign_in", new Date("2026-09-24T00:00:00.000Z"));
    await store.recordFirst(STD as OrgId, "first_sign_in", new Date("2026-09-24T01:00:00.000Z"));
    const rows = await store.listForOrg(STD as OrgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurredAt.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("RLS：别的租户读不到", async () => {
    const n = await asApp(LOCAL, async (c) => (await c.query("SELECT count(*)::int AS n FROM first_value_facts WHERE org_id = $1", [STD])).rows[0].n);
    expect(n).toBe(0);
  });

  it("上报函数：personal-local 排除，不回 org_id", async () => {
    await store.recordFirst(LOCAL as OrgId, "first_sign_in", new Date("2026-09-24T00:00:00.000Z"));
    const { facts } = await new PgTelemetryFacts(db).firstValueFacts();
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.orgKind === "standard")).toBe(true);
    expect(facts.some((f) => f.orgId === STD || f.orgId === LOCAL)).toBe(false);
  });
});

describe("kernel_benchmark_counts_for_report", () => {
  const seats = async () => (await asApp(null, async (c) =>
    (await c.query("SELECT run_count, seat_count FROM kernel_benchmark_counts_for_report($1, $2)", [new Date(0), new Date()])).rows));

  it("app_rw 可调用；只回一行两列；personal-local 的席位不计入，普通组织的计入", async () => {
    const before = await seats();
    expect(before).toHaveLength(1);
    expect(Object.keys(before[0]).sort()).toEqual(["run_count", "seat_count"]);
    // I-3：personal-local 组织的成员只能是它自己的 owner（`${orgId}-owner`，见 seedOrg），
    // 插入别的 user_id 会被 `personal_local_org_is_single_member` 触发器拒绝。
    await asOwner((c) => c.query("INSERT INTO org_memberships (user_id, org_id, org_role) VALUES ($1, $2, 'admin')", [`${LOCAL}-owner`, LOCAL]));
    expect(Number((await seats())[0].seat_count)).toBe(Number(before[0].seat_count));
    await asOwner((c) => c.query("INSERT INTO org_memberships (user_id, org_id, org_role) VALUES ('u-bench-std', $1, 'admin')", [STD]));
    expect(Number((await seats())[0].seat_count)).toBe(Number(before[0].seat_count) + 1);
  });
});

describe("kernel_usage_counts_for_report（#4226）", () => {
  // 独立时间窗，避免与其他测试的运行混在一起。
  const P0 = new Date("2031-01-01T00:00:00.000Z");
  const P1 = new Date("2031-01-02T00:00:00.000Z");
  const AT = "2031-01-01T12:00:00.000Z";
  const usage = async () => (await asApp(null, async (c) =>
    (await c.query("SELECT * FROM kernel_usage_counts_for_report($1, $2)", [P0, P1])).rows));

  async function seedRun(orgId: string, projectId: string, actor: string, runId: string, versionIds: string[], tokens: number): Promise<void> {
    const thread = `th-${runId}`;
    await addChatThread({ orgId, id: thread, projectId, visibilityScope: "plenary", createdBy: actor });
    await addChatMessage({ orgId, id: `${runId}-in`, threadId: thread, body: "hi", authorId: actor });
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids, model_provider, model_id, status, created_at)
         VALUES ($1,$2,$3,$4,'a','av',$5::jsonb,'p','m','succeeded',$6)`,
        [runId, orgId, thread, `${runId}-in`, JSON.stringify(versionIds), AT]);
      await c.query(
        `INSERT INTO token_usage_events (id, org_id, user_id, run_id, model_provider, model_id, tokens_total, outcome, occurred_at)
         VALUES ($1,$2,$3,$4,'p','m',$5,'succeeded',$6)`,
        [`tu-${runId}`, orgId, actor, runId, tokens, AT]);
    });
  }
  async function seedSkill(orgId: string, id: string, manifest: object): Promise<string> {
    const v = `${id}-v1`;
    await asOwner(async (c) => {
      await c.query(`INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
                     VALUES ($1,$2,$1,$1,'enabled','u',now(),now())`, [id, orgId]);
      await c.query(`INSERT INTO skill_versions (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
                     VALUES ($1,$2,$3,'1.0.0',$4,$5::jsonb,'u',now(),true)`, [v, orgId, id, "a".repeat(64), JSON.stringify(manifest)]);
    });
    return v;
  }

  it("app_rw 可调用；只回一行五列；有编号的技能按编号计、无编号的不计；personal-local 不计入", async () => {
    const before = await usage();
    expect(before).toHaveLength(1);
    expect(Object.keys(before[0]).sort()).toEqual(["capability_runs", "organization_count", "run_count", "seat_count", "token_count"]);

    const withId = await seedSkill(STD, "sk-usage-wx", { capabilityId: "WX-S007" });
    const noId = await seedSkill(STD, "sk-usage-none", {});
    const badId = await seedSkill(STD, "sk-usage-bad", { capabilityId: "数据分析" });
    const localWithId = await seedSkill(LOCAL, "sk-usage-local", { capabilityId: "WX-S007" });
    await seedRun(STD, "p-fv-std", "u-bench-std", "run-usage-1", [withId, noId], 100);
    await seedRun(STD, "p-fv-std", "u-bench-std", "run-usage-2", [noId, badId], 50);
    // personal-local：只有 owner 能是成员（I-3），运行与 token 都不得计入。
    await seedRun(LOCAL, "p-fv-local", `${LOCAL}-owner`, "run-usage-local", [localWithId], 999);

    const after = (await usage())[0];
    expect(Number(after.run_count) - Number(before[0].run_count)).toBe(2);
    expect(Number(after.token_count) - Number(before[0].token_count)).toBe(150);
    expect(after.capability_runs).toEqual({ "WX-S007": Number(before[0].capability_runs["WX-S007"] ?? 0) + 1 });

    const base = await new PgTelemetryFacts(db).usageBase(P0, P1);
    expect(base!.skillPackRuns).toContainEqual({ capabilityId: "WX-S007", runCount: 1 });
    expect(base!.skillPackRuns.some((r) => r.capabilityId === "数据分析")).toBe(false);
  });
});
