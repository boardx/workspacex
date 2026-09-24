// @global-scope-fixture table:embedding_models: 与 ontology-schema-migrations.test.ts 共用固定探针模型 `kg-f02-probe@1`（3 维），
//   `ON CONFLICT DO NOTHING`，任何顺序跑都收敛到同一行。
/**
 * Phase 18 F02 —— 本体表的 RLS：跨 org 读不到；个人空间只有本人读得到（I-14）；
 * 运行时角色 app_rw 对新表只有读权限（写入只能经 F03 执行器，I-3 的数据库一半）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addSegment, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG_A = "org-kg-f02-rls-a";
const ORG_B = "org-kg-f02-rls-b";
const USER_1 = "u-kg-f02-1";
const USER_2 = "u-kg-f02-2";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG_A, ORG_B);
  await seedOrg({ orgId: ORG_A, projectId: `${ORG_A}-p` });
  await seedOrg({ orgId: ORG_B, projectId: `${ORG_B}-p` });
  await addSegment({ orgId: ORG_A, segmentId: "seg-f02-rls-1", artifactId: "art-f02-rls-1" });
  await asOwner(async (c) => {
    const obj = (id: string, org: string, scopeKind: string, scopeId: string) =>
      c.query(
        `INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, created_by)
         VALUES ($1,$2,$3,$4,'person','张三','model')`, [id, org, scopeKind, scopeId],
      );
    await obj("o-a-session", ORG_A, "chat_session", "t-a");
    await obj("o-a-personal-1", ORG_A, "personal", USER_1);
    await obj("o-a-personal-2", ORG_A, "personal", USER_2);
    await obj("o-b-session", ORG_B, "chat_session", "t-b");
    const claim = (id: string, org: string, scopeKind: string, scopeId: string) =>
      c.query(
        `INSERT INTO claims (id, org_id, statement, status, tsv, created_by, scope_kind, scope_id, claim_kind)
         VALUES ($1,$2,'张三决定下周一上线','proposed','', 'model', $3, $4, 'decision')`, [id, org, scopeKind, scopeId],
      );
    await claim("c-a-session", ORG_A, "chat_session", "t-a");
    await claim("c-a-personal-1", ORG_A, "personal", USER_1);
    await c.query("INSERT INTO embedding_models (model, model_version, dims) VALUES ('kg-f02-probe','1',3) ON CONFLICT DO NOTHING");
    for (const [kind, id] of [["object", "o-a-personal-1"], ["object", "o-a-session"], ["claim", "c-a-personal-1"]]) {
      await c.query(
        `INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding)
         VALUES ($1, $2, $3, 'kg-f02-probe', '1', '[1,0,0]')`, [ORG_A, kind, id],
      );
    }
    await c.query("INSERT INTO claim_segments (claim_id, org_id, segment_id, stance) VALUES ('c-a-personal-1', $1, 'seg-f02-rls-1', 'contradicting')", [ORG_A]);
    await c.query(
      `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
       VALUES ('e-a-personal-1', $1, 'claim', 'c-a-personal-1', 'object', 'o-a-personal-1', 'about', 'model', 'personal', $2)`, [ORG_A, USER_1],
    );
    await c.query(
      `INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
       VALUES ('a-a-personal-1', $1, 'personal', $2, 'human', $2, 'remember', '{}', 'accepted')`, [ORG_A, USER_1],
    );
  });
});

const ids = (c: pg.Client, table: string) =>
  c.query<{ id: string }>(`SELECT id FROM ${table} WHERE id LIKE 'o-%' OR id LIKE 'c-a-%' ORDER BY id`).then((r) => r.rows.map((x) => x.id));

/** 同 asApp，但额外设置当前用户（F12 的召回会这样做）。 */
const asUser = <T>(org: string, user: string | null, fn: (c: pg.Client) => Promise<T>) =>
  asApp(org, async (c) => {
    if (user !== null) await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
    return fn(c);
  });

describe("F02: RLS", () => {
  it("跨 org 读不到", async () => {
    const seen = await asUser(ORG_B, null, (c) => ids(c, "ontology_objects"));
    expect(seen).toEqual(["o-b-session"]);
  });

  it("不设当前用户 ⇒ 任何人的个人空间都看不见（fail closed）", async () => {
    expect(await asUser(ORG_A, null, (c) => ids(c, "ontology_objects"))).toEqual(["o-a-session"]);
    expect(await asUser(ORG_A, null, (c) => ids(c, "claims"))).toEqual(["c-a-session"]);
  });

  it("个人空间只有本人看得见", async () => {
    expect(await asUser(ORG_A, USER_1, (c) => ids(c, "ontology_objects"))).toEqual(["o-a-personal-1", "o-a-session"]);
    expect(await asUser(ORG_A, USER_2, (c) => ids(c, "ontology_objects"))).toEqual(["o-a-personal-2", "o-a-session"]);
    expect(await asUser(ORG_A, USER_2, (c) => ids(c, "claims"))).toEqual(["c-a-session"]);
  });

  it("app_rw 对新表没有写权限（写入只能经执行器）", async () => {
    await expect(
      asUser(ORG_A, USER_1, (c) => c.query(
        `INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, created_by)
         VALUES ('o-x', $1, 'chat_session', 't-a', 'person', 'x', 'model')`, [ORG_A],
      )),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(ORG_A, USER_1, (c) => c.query(
        `INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
         VALUES ('a-x', $1, 'chat_session', 't-a', 'model', 'm', 'x', '{}', 'accepted')`, [ORG_A],
      )),
    ).rejects.toThrow(/permission denied/);
  });

  it("个人空间行不能以别人的身份写进去（WITH CHECK）", async () => {
    // claims 仍有 0009 的写权限（F45 与检索夹具依赖）；个人空间的 RESTRICTIVE WITH CHECK 仍然生效。
    // F03 起，带作用域的直写先被 kg_scoped_write_guard（BEFORE 触发器）拒掉——两道防线，任一道拒都算。
    await expect(
      asUser(ORG_A, USER_2, (c) => c.query(
        `INSERT INTO claims (id, org_id, statement, status, tsv, scope_kind, scope_id)
         VALUES ('c-forged', $1, 'x', 'proposed', '', 'personal', $2)`, [ORG_A, USER_1],
      )),
    ).rejects.toThrow(/row-level security|KG_WRITE_OUTSIDE_EXECUTOR/);
  });

  it("object_embeddings 跟随目标行的可见性：别人个人空间的向量读不到（I-14，数据库层）", async () => {
    const seen = (user: string | null) => asUser(ORG_A, user, (c) =>
      c.query<{ target_id: string }>("SELECT target_id FROM object_embeddings ORDER BY target_id").then((r) => r.rows.map((x) => x.target_id)));
    expect(await seen(USER_1)).toEqual(["c-a-personal-1", "o-a-personal-1", "o-a-session"]);
    expect(await seen(USER_2)).toEqual(["o-a-session"]);
    expect(await seen(null)).toEqual(["o-a-session"]);
    expect(await asUser(ORG_B, USER_1, (c) => c.query("SELECT 1 FROM object_embeddings").then((r) => r.rows.length))).toBe(0);
  });

  it("个人空间结论的证据（claim_segments）同样只有本人看得见", async () => {
    const q = (user: string) => asUser(ORG_A, user, (c) => c.query("SELECT 1 FROM claim_segments WHERE claim_id = 'c-a-personal-1'").then((r) => r.rows.length));
    expect(await q(USER_1)).toBe(1);
    expect(await q(USER_2)).toBe(0);
  });

  it("个人空间的边与审计动作同样只有本人看得见", async () => {
    const q = (user: string, sql: string) => asUser(ORG_A, user, (c) => c.query(sql).then((r) => r.rows.length));
    expect(await q(USER_1, "SELECT 1 FROM ontology_edges WHERE id = 'e-a-personal-1'")).toBe(1);
    expect(await q(USER_2, "SELECT 1 FROM ontology_edges WHERE id = 'e-a-personal-1'")).toBe(0);
    expect(await q(USER_1, "SELECT 1 FROM ontology_actions WHERE id = 'a-a-personal-1'")).toBe(1);
    expect(await q(USER_2, "SELECT 1 FROM ontology_actions WHERE id = 'a-a-personal-1'")).toBe(0);
  });

  it("目标行删除 ⇒ 它的向量一起删", async () => {
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, created_by)
         VALUES ('o-a-doomed', $1, 'chat_session', 't-a', 'term', 'x', 'model')`, [ORG_A]);
      await c.query(
        `INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding)
         VALUES ($1, 'object', 'o-a-doomed', 'kg-f02-probe', '1', '[0,1,0]')`, [ORG_A]);
      await c.query("DELETE FROM ontology_objects WHERE id = 'o-a-doomed'");
      const left = await c.query("SELECT 1 FROM object_embeddings WHERE target_id = 'o-a-doomed'");
      expect(left.rows).toHaveLength(0);
    });
  });
});

describe("F02: ontology_actions 只追加", () => {
  it("UPDATE / DELETE / TRUNCATE 都被拒（即使是属主）", async () => {
    for (const sql of [
      "UPDATE ontology_actions SET action_type = 'x' WHERE id = 'a-a-personal-1'",
      "DELETE FROM ontology_actions WHERE id = 'a-a-personal-1'",
      "TRUNCATE ontology_actions",
    ]) {
      await expect(asOwner((c) => c.query(sql))).rejects.toThrow(/append-only/);
    }
  });

  it("同名临时表 `organizations` 冒充「org 已删除」 ⇒ 不生效", async () => {
    await expect(asOwner(async (c) => {
      await c.query("CREATE TEMP TABLE organizations (id text)");
      await c.query("DELETE FROM ontology_actions WHERE id = 'a-a-personal-1'");
    })).rejects.toThrow(/append-only/);
  });

  it("整个 org 删除时级联放行（租户离开，不是篡改日志）", async () => {
    const ORG_C = "org-kg-f02-rls-c";
    await resetOrgs(ORG_C);
    await seedOrg({ orgId: ORG_C, projectId: `${ORG_C}-p` });
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
         VALUES ('a-c-1', $1, 'chat_session', 't-c', 'model', 'm', 'extract', '{}', 'accepted')`, [ORG_C]);
    });
    await resetOrgs(ORG_C);
    const left = await asOwner((c) => c.query("SELECT 1 FROM ontology_actions WHERE id = 'a-c-1'"));
    expect(left.rows).toHaveLength(0);
  });
});

/**
 * 云上的迁移身份 `owner` 不是超级用户、没有 BYPASSRLS（packages/cloud-deploy）。本地和 CI 以
 * postgres（超级用户）跑迁移，所有 SECURITY DEFINER 函数在测试里天然绕过 RLS——云上不会。
 * 这里造一个「属主角色的成员、但不绕过 RLS」的角色 SET ROLE 过去，复现云上的执行身份。
 */
describe("F02: 属主角色不绕过 RLS 时（云上的 owner）", () => {
  const PROBE = "kg_f02_probe_owner";
  const asProbeSetup = async (c: import("pg").Client) => {
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE}') THEN
        CREATE ROLE ${PROBE} NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT;
      END IF; END $$`);
    await c.query(`GRANT ${(await c.query<{ o: string }>("SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE oid = 'ontology_objects'::regclass")).rows[0]!.o} TO ${PROBE}`);
  };
  const asProbe = <T>(fn: (c: import("pg").Client) => Promise<T>) => asOwner(async (c) => {
    await asProbeSetup(c);
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL ROLE ${PROBE}`);
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG_A]);
      return await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  });

  it("该角色确实受 RLS 约束（看不到别的 org），且属主例外让它看得到本 org 所有人的个人空间", async () => {
    const r = await asProbe(async (c) => ({
      bypass: (await c.query<{ b: boolean }>("SELECT rolbypassrls OR rolsuper AS b FROM pg_roles WHERE rolname = current_user")).rows[0]!.b,
      objects: (await c.query<{ id: string }>("SELECT id FROM ontology_objects WHERE id LIKE 'o-%' ORDER BY id")).rows.map((x) => x.id),
    }));
    expect(r.bypass).toBe(false);
    expect(r.objects).toEqual(["o-a-personal-1", "o-a-personal-2", "o-a-session"]);
  });

  it("删除结论时向量清理在 RLS 下仍然生效（清理函数本身以不绕过 RLS 的属主身份运行）", async () => {
    const left = await asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        // 先把清理触发器函数的属主换成探针角色：否则它仍以 postgres（超级用户）运行，测不到 RLS 的影响。
        await asProbeSetup(c);
        await c.query(`ALTER FUNCTION object_embeddings_follow_target() OWNER TO ${PROBE}`);
        await c.query(`SET LOCAL ROLE ${PROBE}`);
        await c.query("SELECT set_config('app.current_org', $1, true)", [ORG_A]);
        await c.query("DELETE FROM claims WHERE id = 'c-a-personal-1'");
        await c.query("RESET ROLE");
        // 以超级用户数残留：object_embeddings 的 target_visible 策略会把孤儿行藏起来，用它数等于没数。
        return (await c.query("SELECT 1 FROM object_embeddings WHERE target_id = 'c-a-personal-1'")).rows.length;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(left).toBe(0);
  });
});

