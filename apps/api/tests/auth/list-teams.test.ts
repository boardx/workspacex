/**
 * `listTeams`（#639 delta，迭代 1）—— 只读团队列表，真 Postgres。
 *
 * ## 反证 C 在这里
 *
 * `memberCount` 必须是 `COUNT(*) FROM org_memberships WHERE team_id = $1` 的**真查询**，
 * 不是硬编码 0。本文件造一个有两名成员的团队和一个零成员的团队，断言前者的
 * `memberCount === 2` 而不是 0——一个把 `memberCount` 写死成 0 的实现在"零成员团队"
 * 那个断言上照样绿，只有"有成员团队非零"这条能戳穿它。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listTeams } from "../../src/application/auth/list-teams";
import { PgTeamRepository } from "../../src/infrastructure/auth/pg-team-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f639-list-teams";

let db: PgDatabase;
let repo: PgTeamRepository;

const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgTeamRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
});

describe("listTeams", () => {
  it("memberCount 是真查询——有成员的团队非零，零成员的团队为零", async () => {
    const fixture = await seedOrg({ orgId: ORG, teamNames: ["staffed", "empty"], projectId: `${ORG}-p` });
    const staffedTeamId = fixture.teams.staffed ?? "";
    await addOrgMember(ORG, "u-list-teams-1", "consultant", staffedTeamId);
    await addOrgMember(ORG, "u-list-teams-2", "consultant", staffedTeamId);
    // admin 自己不挂在任何团队上——不能让"总有至少一个成员"的巧合掩盖 empty 团队应为 0。
    await addOrgMember(ORG, "u-list-teams-admin", "admin", null);

    const out = await listTeams({ repo }, { orgId: toOrgId(ORG) });

    const staffed = out.teams.find((t) => t.teamId === fixture.teams.staffed);
    const empty = out.teams.find((t) => t.teamId === fixture.teams.empty);
    expect(staffed?.memberCount).toBe(2);
    expect(empty?.memberCount).toBe(0);
  });

  it("空组织（无团队）返回空数组，不是报错", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    const out = await listTeams({ repo }, { orgId: toOrgId(ORG) });
    expect(out.teams).toEqual([]);
  });
});
