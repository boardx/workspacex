/**
 * F15 一次性链接与**使用者记录**（I-11）。
 *
 * `user_visible_behavior` 逐字：「一次性链接被用过即失效且 `invite_link.used_by`
 * 记录使用者与时间」。这句话有两半，而它们各自的失败形态完全不同：
 *
 *   · **用过即失效** —— 反向断言：第一次成功 ∧ 第二次失败。只测第一次，
 *     一个从不写 `used_at` 的实现全绿。
 *   · **记录使用者** —— 必须**查得出是谁用的哪一条**。只断言 `used_by IS NOT NULL`，
 *     一个把 `used_by` 写成常量 `'someone'` 的实现全绿；只在写路径断言，
 *     一个谁也读不到那一列的实现全绿（等于没记）。
 *     ⇒ 这里断言的是 (使用者 → 链接) 这个**对应关系**能被查出来。
 *
 * ## 并发那一条是本文件的核心
 *
 * 「恰好一次」不是「先查一下还没被用过，然后标记」。那个形状在并发下**两个人都进得来**，
 * `used_by` 是后写的那一个——没有异常、没有约束冲突、没有一行日志。
 * 所以有一条两路同时核销的断言，且它断言的是「恰好一个成功」而不是「至少一个成功」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { consumeInviteLink } from "../../src/application/auth/consume-invite-link";
import { listInviteLinks } from "../../src/application/auth/list-invite-links";
import { revokeInviteLinks } from "../../src/application/auth/revoke-invite-links";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { facilitator, fixedIds, newDb, readerCtx, repos, toOrgId } from "../support/invite-link";

const ORG = "org-f15-onetime";
const PROJECT = `${ORG}-p`;
const HOST = "u-f15o-host";
const MEMBER = "u-f15o-member";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];

const orgId = toOrgId(ORG);
const ids = fixedIds("dec-f15-onetime");

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  repo = repos(db).links;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null);
}, HOOK_TIMEOUT_MS);

function issueOnce(identity: "member" | "observer" | "groupLead" = "member") {
  return issueInviteLink(
    { repo },
    {
      orgId,
      projectId: PROJECT,
      kind: "main",
      groupId: null,
      identity,
      validity: "once",
      ...facilitator(HOST),
    },
  );
}

const asHost = () => readerCtx({ orgId: ORG, projectId: PROJECT, actorId: HOST });

describe("用过即失效（I-11 的第一半，双向断言）", () => {
  it("第一次成功；第二次被拒且理由是 LINK_ALREADY_USED", async () => {
    const link = await issueOnce();

    const grant = await consumeInviteLink({ repo }, { token: link.token, principalId: "guest-1" });
    expect(grant.linkId).toBe(link.linkId);

    await expect(
      consumeInviteLink({ repo }, { token: link.token, principalId: "guest-2" }),
    ).rejects.toMatchObject({ reasonCode: "LINK_ALREADY_USED" });
  });

  it("⚠ 并发两路核销同一条一次性链接 ⇒ **恰好一个**成功", async () => {
    const link = await issueOnce();

    const results = await Promise.allSettled([
      consumeInviteLink({ repo }, { token: link.token, principalId: "race-a" }),
      consumeInviteLink({ repo }, { token: link.token, principalId: "race-b" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    // 「至少一个」会让「两个都成功」通过。这里要的是恰好。
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrgAdminError);

    // 库里也只有一个使用者，而且就是成功的那一路。
    const rows = await asApp(ORG, (c) =>
      c.query<{ used_by: string | null }>("SELECT used_by FROM invite_links WHERE id = $1", [
        link.linkId,
      ]),
    );
    const winner = (ok[0] as PromiseFulfilledResult<{ linkId: string }>).value;
    expect(winner.linkId).toBe(link.linkId);
    expect(["race-a", "race-b"]).toContain(rows.rows[0]?.used_by);
  });

  it("一次性链接用掉后，同一槽位可以重新签发一条新的", async () => {
    const first = await issueOnce();
    await consumeInviteLink({ repo }, { token: first.token, principalId: "guest-1" });
    const second = await issueOnce();
    expect(second.linkId).not.toBe(first.linkId);
    const grant = await consumeInviteLink({ repo }, { token: second.token, principalId: "guest-3" });
    expect(grant.linkId).toBe(second.linkId);
  });

  it("非一次性档**不**因用过而失效（否则主链接就变成一次性的了）", async () => {
    const main = await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "main",
        groupId: null,
        identity: "observer",
        validity: "7d",
        ...facilitator(HOST),
      },
    );
    for (const p of ["a", "b", "c"]) {
      const g = await consumeInviteLink({ repo }, { token: main.token, principalId: p });
      expect(g.linkId).toBe(main.linkId);
    }
    const rows = await listInviteLinks({ repo, ids }, asHost());
    // 对非一次性链接，`used_by` 是「最近一次使用者」。
    expect(rows.find((r) => r.linkId === main.linkId)?.usedBy).toBe("c");
  });
});

describe("记录使用者（I-11 的第二半）：查得出**是谁用的哪一条**", () => {
  it("三条一次性链接、三个使用者 ⇒ 对应关系逐条查得出", async () => {
    const a = await issueOnce("member");
    const b = await issueOnce("observer");
    const c = await issueOnce("groupLead");

    await consumeInviteLink({ repo }, { token: a.token, principalId: "guest-A" });
    await consumeInviteLink({ repo }, { token: c.token, principalId: "guest-C" });

    const rows = await listInviteLinks({ repo, ids }, asHost());
    const byId = new Map(rows.map((r) => [r.linkId, r]));

    // ⚠ 断言的是**对应关系**，不是「有值」。一个把 used_by 写成常量的实现
    //   能让「有值」全绿，让这三行同时红。
    expect(byId.get(a.linkId)?.usedBy).toBe("guest-A");
    expect(byId.get(c.linkId)?.usedBy).toBe("guest-C");
    // 没被用过的那条**必须**是 null——否则「谁用的」这一列在讲一个没发生过的故事。
    expect(byId.get(b.linkId)?.usedBy).toBeNull();

    // 时间与使用者一起动或都不动（迁移里的 CHECK 也钉着这一条）。
    expect(byId.get(a.linkId)?.usedAt).toBeInstanceOf(Date);
    expect(byId.get(b.linkId)?.usedAt).toBeNull();
  });

  it("按使用者反查：他用掉的是哪一条", async () => {
    const a = await issueOnce("member");
    const b = await issueOnce("observer");
    await consumeInviteLink({ repo }, { token: b.token, principalId: "guest-Z" });

    const rows = await listInviteLinks({ repo, ids }, asHost());
    const usedByZ = rows.filter((r) => r.usedBy === "guest-Z").map((r) => r.linkId);
    expect(usedByZ).toEqual([b.linkId]);
    expect(usedByZ).not.toContain(a.linkId);
  });

  it("⚠ 使用者记录含令牌明文 ⇒ 只有本项目的引导师读得到", async () => {
    const a = await issueOnce();
    await consumeInviteLink({ repo }, { token: a.token, principalId: "guest-A" });

    // 组员：在项目里，但不是引导师。
    await expect(
      listInviteLinks(
        { repo, ids },
        readerCtx({ orgId: ORG, projectId: PROJECT, actorId: MEMBER, projectRole: "member" }),
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });

    // 不在项目里的人：另一个码，因为要他做的事不同。
    await expect(
      listInviteLinks(
        { repo, ids },
        readerCtx({ orgId: ORG, projectId: PROJECT, actorId: "u-x", projectRole: null }),
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });

    // 组织外的人：第三个码。两层交集的组织层那一半。
    await expect(
      listInviteLinks(
        { repo, ids },
        readerCtx({
          orgId: ORG,
          projectId: PROJECT,
          actorId: "u-outsider",
          orgRole: null,
          projectRole: "facilitator",
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_ORG_MEMBERSHIP" });

    // 而引导师读得到——少了这一条，一个全盘拒绝的实现会让上面三条全绿。
    const rows = await listInviteLinks({ repo, ids }, asHost());
    expect(rows.find((r) => r.linkId === a.linkId)?.usedBy).toBe("guest-A");
  });

  it("已撤销的链接，它的使用者记录**不被抹掉**（撤销是写标记不是删行）", async () => {
    const a = await issueOnce();
    await consumeInviteLink({ repo }, { token: a.token, principalId: "guest-A" });
    await revokeInviteLinks(
      { repo },
      { orgId, projectId: PROJECT, linkId: null, ...facilitator(HOST) },
    );

    const rows = await listInviteLinks({ repo, ids }, asHost());
    const row = rows.find((r) => r.linkId === a.linkId);
    expect(row?.usedBy).toBe("guest-A");
    expect(row?.revokedAt).toBeInstanceOf(Date);
  });
});
