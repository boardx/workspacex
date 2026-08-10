/**
 * F11 — 团队增删改 + 删除前占用校验（O-29 ④ / I-7）。
 * phase-01 `org-admin` · usecases.md `MutateTeam`。
 *
 * ⚠ **本文件按 worker 交接说明未在本地执行**（需要 Postgres）；已跑
 * `pnpm --filter api run typecheck`，请 coordinator 在隔离环境里跑一次真实断言。
 *
 * ## 「不做级联删除」这条反证怎么戳穿
 *
 * 最容易写错的版本是"占用校验只做样子，删除照样执行"（例如占用查询写成 `LIMIT 1`
 * 却忘了真的 `return` 阻断）。本文件在断言 `TeamInUseError` 之后，紧接着再查一次
 * `teams` 表和被占用的那一行，断言**两者都还在**——只断言异常类型的测试会漏掉
 * "异常抛出去了，但 DELETE 已经先跑完了" 这种更隐蔽的部分失败。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mutateTeam, TeamInUseError } from "../../src/application/auth/mutate-team";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgTeamRepository } from "../../src/infrastructure/auth/pg-team-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addBinding, addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f11-teams";
const ADMIN = "u-f11-teams-admin";

const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgTeamRepository;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

async function teamRow(teamId: string): Promise<{ id: string; name: string } | undefined> {
  const res = await asOwner((c) => c.query<{ id: string; name: string }>("SELECT id, name FROM teams WHERE id = $1", [teamId]));
  return res.rows[0];
}

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
  fixture = await seedOrg({ orgId: ORG, teamNames: ["energy"], projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", null);
});

describe("create", () => {
  it("建一个新团队", async () => {
    const out = await mutateTeam(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "create", teamId: null, name: "growth" },
    );
    expect(out.team?.name).toBe("growth");
    expect(await teamRow(out.team!.teamId)).toEqual({ id: out.team!.teamId, name: "growth" });
  });

  it("幂等重放：同名重复提交返回既有 team，不新建第二行（O-29 ④ 组织内名称唯一）", async () => {
    const first = await mutateTeam(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "create", teamId: null, name: "growth" },
    );
    const second = await mutateTeam(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "create", teamId: null, name: "growth" },
    );
    expect(second.team?.teamId).toBe(first.team?.teamId);
    const rows = await asOwner((c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM teams WHERE org_id = $1 AND name = $2", [ORG, "growth"]),
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it("非管理员调用被拒", async () => {
    await expect(
      mutateTeam({ repo }, { orgId: toOrgId(ORG), actorOrgRole: "consultant", op: "create", teamId: null, name: "x" }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" } satisfies Partial<OrgAdminError>);
  });
});

describe("rename", () => {
  it("改名不改 id，已有 acl_binding 绑定不受影响", async () => {
    const energyId = fixture.teams.energy!;
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: energyId },
      object: { kind: "project", id: fixture.projectId },
      scope: "team-only",
      ownerTeamId: energyId,
    });

    const renamed = await mutateTeam(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "rename", teamId: energyId, name: "energy-renamed" },
    );
    expect(renamed.team?.teamId).toBe(energyId);
    expect(renamed.team?.name).toBe("energy-renamed");

    const binding = await asOwner((c) =>
      c.query<{ owner_team_id: string }>("SELECT owner_team_id FROM acl_bindings WHERE org_id = $1 AND owner_team_id = $2", [
        ORG,
        energyId,
      ]),
    );
    expect(binding.rows).toHaveLength(1);
  });

  it("目标团队不存在（并发下已被删除）——映射为 VERSION_CHANGED", async () => {
    await expect(
      mutateTeam(
        { repo },
        { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "rename", teamId: "team-does-not-exist", name: "x" },
      ),
    ).rejects.toMatchObject({ reasonCode: "VERSION_CHANGED" } satisfies Partial<OrgAdminError>);
  });
});

describe("delete — 占用校验（I-7）", () => {
  it("有成员归属时阻断，且列出占用项，且不做级联删除", async () => {
    const energyId = fixture.teams.energy!;
    await addOrgMember(ORG, "u-f11-teams-member", "consultant", energyId);

    await expect(
      mutateTeam({ repo }, { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "delete", teamId: energyId, name: null }),
    ).rejects.toThrow(TeamInUseError);

    let caught: TeamInUseError | null = null;
    try {
      await mutateTeam({ repo }, { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "delete", teamId: energyId, name: null });
    } catch (e) {
      caught = e as TeamInUseError;
    }
    expect(caught).toBeInstanceOf(TeamInUseError);
    expect(caught!.occupancy.memberCount).toBe(1);
    expect(caught!.occupancy.items.length).toBeGreaterThan(0);
    expect(caught!.occupancy.items.some((it) => it.kind === "member" && it.id === "u-f11-teams-member")).toBe(true);

    // ⚠ 不做级联删除：团队行还在。
    expect(await teamRow(energyId)).toBeDefined();
  });

  it("有 team-only 绑定归属时阻断，且列出占用项", async () => {
    const energyId = fixture.teams.energy!;
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: energyId },
      object: { kind: "project", id: fixture.projectId },
      scope: "team-only",
      ownerTeamId: energyId,
    });

    let caught: TeamInUseError | null = null;
    try {
      await mutateTeam({ repo }, { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "delete", teamId: energyId, name: null });
    } catch (e) {
      caught = e as TeamInUseError;
    }
    expect(caught).toBeInstanceOf(TeamInUseError);
    expect(caught!.occupancy.aclBindingCount).toBe(1);
    expect(caught!.occupancy.items.length).toBeGreaterThan(0);
    expect(await teamRow(energyId)).toBeDefined();
  });

  it("无成员无绑定的空团队可以被删除", async () => {
    const created = await mutateTeam(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "create", teamId: null, name: "empty-team" },
    );
    const teamId = created.team!.teamId;
    const out = await mutateTeam(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "delete", teamId, name: null },
    );
    // 迭代 4 修复：`delete` 现在把被删团队的 (id, name) 带回来（不再是 null）——
    // `deleteTeam` 用例要用这个名字写进 provenance 的 `detail.name`，行删除之后就
    // 再也查不到了，只能靠这次调用顺路带出。
    expect(out.team).toEqual({ teamId, name: "empty-team" });
    expect(await teamRow(teamId)).toBeUndefined();
  });

  it("目标团队不存在——映射为 VERSION_CHANGED", async () => {
    await expect(
      mutateTeam(
        { repo },
        { orgId: toOrgId(ORG), actorOrgRole: "admin", op: "delete", teamId: "team-does-not-exist", name: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "VERSION_CHANGED" } satisfies Partial<OrgAdminError>);
  });
});
