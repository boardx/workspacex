/**
 * team-crud delta（#639），迭代 2 —— `createTeam`/`renameTeam`/`deleteTeam`。真实起服务 +
 * 真 Postgres，同 `password-reset-revokes-sessions.test.ts` 的模式。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f639-iter2";
const PROJECT = "proj-f639-iter2";
const ADMIN = "u-f639-iter2-admin";
const ADMIN_EMAIL = "iter2-admin@f639.test";
const MEMBER = "u-f639-iter2-member";
const MEMBER_EMAIL = "iter2-member@f639.test";
const PASSWORD = "correct-horse-battery-staple";

let BASE: string;
let app: NestExpressApplication;

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([ADMIN, MEMBER], [ADMIN_EMAIL, MEMBER_EMAIL]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: ADMIN, email: ADMIN_EMAIL, password: PASSWORD });
  await seedCredential({ userId: MEMBER, email: MEMBER_EMAIL, password: PASSWORD });
});

async function loginAs(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  return ((await res.json()) as { sessionToken: string }).sessionToken;
}

async function createTeamHttp(token: string, name: string) {
  return fetch(`${BASE}/organizations/${ORG}/teams/create`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
}

async function renameTeamHttp(token: string, teamId: string, name: string) {
  return fetch(`${BASE}/organizations/${ORG}/teams/${teamId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
}

async function deleteTeamHttp(token: string, teamId: string) {
  return fetch(`${BASE}/organizations/${ORG}/teams/${teamId}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}

describe("createTeam / renameTeam（#639 delta，迭代 2）", () => {
  it("反证：组织内重名真的被拒绝（TEAM_NAME_CONFLICT），不是允许重复", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);

    const first = await createTeamHttp(token, "growth");
    expect(first.status).toBe(201);

    const dup = await createTeamHttp(token, "growth");
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as { reasonCode: string };
    expect(dupBody.reasonCode).toBe("TEAM_NAME_CONFLICT");

    // 独立核实：库里只有一行叫这个名字的团队，不是悄悄建了第二行。
    const count = await asOwner((c) =>
      c.query("SELECT count(*)::int AS n FROM teams WHERE org_id = $1 AND name = $2", [ORG, "growth"]),
    );
    expect((count.rows[0] as { n: number }).n).toBe(1);
  }, 60_000);

  it("renameTeam 撞到既有团队名同样被拒绝", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    const a = await createTeamHttp(token, "alpha");
    const aBody = (await a.json()) as { teamId: string };
    await createTeamHttp(token, "beta");

    const rename = await renameTeamHttp(token, aBody.teamId, "beta");
    expect(rename.status).toBe(409);
    const renameBody = (await rename.json()) as { reasonCode: string };
    expect(renameBody.reasonCode).toBe("TEAM_NAME_CONFLICT");

    // "alpha" 团队的名字没被改动。
    const row = await asOwner((c) => c.query("SELECT name FROM teams WHERE id = $1", [aBody.teamId]));
    expect((row.rows[0] as { name: string }).name).toBe("alpha");
  }, 60_000);

  it("非 admin 越权被拒绝（FORBIDDEN），团队没被建出来", async () => {
    const token = await loginAs(MEMBER_EMAIL, PASSWORD);
    const res = await createTeamHttp(token, "should-not-exist");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("FORBIDDEN");

    const count = await asOwner((c) =>
      c.query("SELECT count(*)::int AS n FROM teams WHERE org_id = $1 AND name = $2", [ORG, "should-not-exist"]),
    );
    expect((count.rows[0] as { n: number }).n).toBe(0);
  }, 60_000);

  it("正常创建 + 改名真的落库", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    const created = await createTeamHttp(token, "gamma");
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { teamId: string; name: string };
    expect(createdBody.name).toBe("gamma");

    const renamed = await renameTeamHttp(token, createdBody.teamId, "gamma-2");
    expect(renamed.status).toBe(200);

    const row = await asOwner((c) => c.query("SELECT name FROM teams WHERE id = $1", [createdBody.teamId]));
    expect((row.rows[0] as { name: string }).name).toBe("gamma-2");
  }, 60_000);

  it("反证（#638 迭代 4）：创建/改名各写一条独立的 provenance_events 行——actor/kind/target 都对得上", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    const created = await createTeamHttp(token, "delta-team");
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { teamId: string; name: string };

    const renamed = await renameTeamHttp(token, createdBody.teamId, "delta-team-renamed");
    expect(renamed.status).toBe(200);

    const events = await asOwner((c) =>
      c.query<{ type: string; actor_id: string; target_kind: string; target_id: string }>(
        `SELECT type, actor_id, target_kind, target_id FROM provenance_events
          WHERE org_id = $1 AND target_kind = 'team' AND target_id = $2 ORDER BY at ASC`,
        [ORG, createdBody.teamId],
      ),
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0]).toMatchObject({ type: "team-created", actor_id: ADMIN, target_kind: "team", target_id: createdBody.teamId });
    expect(events.rows[1]).toMatchObject({ type: "team-renamed", actor_id: ADMIN, target_kind: "team", target_id: createdBody.teamId });
  }, 60_000);
});

describe("deleteTeam（#639 delta，迭代 2）", () => {
  it("反证：非空团队真的被拒绝、零变化", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    // 组织已经在 beforeEach 里 seed 过（含 "energy" 团队，MEMBER 已加入）——这里不重复
    // seedOrg，否则撞 `organizations_pkey`（同一个 orgId 的第二次插入）。
    const occupiedTeamId = await asOwner(async (c) => {
      const r = await c.query<{ id: string }>("SELECT id FROM teams WHERE org_id = $1 AND name = $2", [ORG, "energy"]);
      return r.rows[0]!.id;
    });
    // MEMBER 已经在 beforeEach 里加进了 "energy" 团队，所以它非空。

    const res = await deleteTeamHttp(token, occupiedTeamId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("TEAM_NOT_EMPTY");

    // 独立核实：团队行还在，成员归属没被清空——不是"报错了但其实已经删了一半"。
    const teamRow = await asOwner((c) => c.query("SELECT id FROM teams WHERE id = $1", [occupiedTeamId]));
    expect(teamRow.rows).toHaveLength(1);
    const memberRow = await asOwner((c) =>
      c.query("SELECT team_id FROM org_memberships WHERE user_id = $1", [MEMBER]),
    );
    expect((memberRow.rows[0] as { team_id: string | null }).team_id).toBe(occupiedTeamId);
  }, 60_000);

  it("清空成员后能删；不存在的 teamId 返回 TEAM_NOT_FOUND", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    const created = await createTeamHttp(token, "empty-team");
    const createdBody = (await created.json()) as { teamId: string };

    const res = await deleteTeamHttp(token, createdBody.teamId);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { deleted: true };
    expect(body.deleted).toBe(true);

    const row = await asOwner((c) => c.query("SELECT id FROM teams WHERE id = $1", [createdBody.teamId]));
    expect(row.rows).toHaveLength(0);

    const notFound = await deleteTeamHttp(token, "team-does-not-exist");
    expect(notFound.status).toBe(404);
    const notFoundBody = (await notFound.json()) as { reasonCode: string };
    expect(notFoundBody.reasonCode).toBe("TEAM_NOT_FOUND");
  }, 60_000);

  it("反证（#638 迭代 4）：删除成功写一条 team-deleted，被拒绝的删除（非空/不存在）不写", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    const created = await createTeamHttp(token, "epsilon-team");
    const createdBody = (await created.json()) as { teamId: string };

    const res = await deleteTeamHttp(token, createdBody.teamId);
    expect(res.status).toBe(201);

    const events = await asOwner((c) =>
      c.query<{ type: string; actor_id: string; target_kind: string; target_id: string }>(
        `SELECT type, actor_id, target_kind, target_id FROM provenance_events
          WHERE org_id = $1 AND target_kind = 'team' AND target_id = $2`,
        [ORG, createdBody.teamId],
      ),
    );
    // team-created（创建时）+ team-deleted（本次删除）——恰好两条，不是伪造的占位数据。
    expect(events.rows).toHaveLength(2);
    expect(events.rows.map((r) => r.type).sort()).toEqual(["team-created", "team-deleted"]);
    for (const row of events.rows) {
      expect(row.actor_id).toBe(ADMIN);
    }

    // 被拒绝的删除（team-does-not-exist）不应该留下任何 provenance 行。
    await deleteTeamHttp(token, "team-does-not-exist");
    const rejectedEvents = await asOwner((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM provenance_events
          WHERE org_id = $1 AND target_kind = 'team' AND target_id = 'team-does-not-exist'`,
        [ORG],
      ),
    );
    expect(rejectedEvents.rows[0]!.n).toBe(0);
  }, 60_000);
});

describe("旧 mutateTeam 端点保持不受影响（回归）", () => {
  it("op 形式的请求仍然走幂等重放路径，不是新拒绝语义", async () => {
    const token = await loginAs(ADMIN_EMAIL, PASSWORD);
    const first = await fetch(`${BASE}/organizations/${ORG}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId: ORG, op: "create", teamId: null, name: "legacy-team" }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { team: { teamId: string; name: string } };

    const second = await fetch(`${BASE}/organizations/${ORG}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId: ORG, op: "create", teamId: null, name: "legacy-team" }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { team: { teamId: string; name: string } };
    // 幂等重放：同一个 teamId，不是拒绝、也不是第二行。
    expect(secondBody.team.teamId).toBe(firstBody.team.teamId);

    const count = await asOwner((c) =>
      c.query("SELECT count(*)::int AS n FROM teams WHERE org_id = $1 AND name = $2", [ORG, "legacy-team"]),
    );
    expect((count.rows[0] as { n: number }).n).toBe(1);
  }, 60_000);
});
