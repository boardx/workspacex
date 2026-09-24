/**
 * Phase 18 F02 —— 本体表的 RLS：跨 org 读不到；个人空间只有本人读得到（I-14）；
 * 运行时角色 app_rw 对新表只有读权限（写入只能经 F03 执行器，I-3 的数据库一半）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

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
    await expect(
      asUser(ORG_A, USER_2, (c) => c.query(
        `INSERT INTO claims (id, org_id, statement, status, tsv, scope_kind, scope_id)
         VALUES ('c-forged', $1, 'x', 'proposed', '', 'personal', $2)`, [ORG_A, USER_1],
      )),
    ).rejects.toThrow(/row-level security/);
  });
});
