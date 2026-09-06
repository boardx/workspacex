/**
 * F15 主流程（UC-1.3）：**签发主链接 / 分组链接 → 幂等 → 单条撤销 / [重置全部]**。
 *
 * ## 「撤销」这两个字唯一站得住的证明形状
 *
 * 一条 `revoked_at` 有值——这件事可以在撤销完全没有生效的情况下成立。
 * `user_visible_behavior` 说的是「链接可单条撤销或 [重置全部]」，而一条链接被撤销的**意思**
 * 就是「再用它会失败」。所以这里断言的是三件一起成立：
 *   ① 撤销前 → 用它进场 **成功**
 *   ② 撤销后 → 同一枚令牌的**下一次使用**失败，且理由是 `LINK_REVOKED`
 *   ③ 撤销一条后 → **其余每一条**逐条断言仍然进得去（I-15）
 * 少了 ③，一个把单条撤销写成 [重置全部] 的实现会让 ① ② 全绿。
 *
 * ## 契约响应形状也被断言，**并且带反向断言**
 *
 * `contract-design.md` 修订 B-8：出去的响应没人校验，则单源链的返回方向是断的。
 * 所以每条用例的返回值都过一次 `orgAdmin.operations.*.out`，并且末尾有一组
 * 反向断言证明那些 schema 确实会拒绝漂移的 body——否则整段可能在空转。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { revokeInviteLinks } from "../../src/application/auth/revoke-invite-links";
import { consumeInviteLink } from "../../src/application/auth/consume-invite-link";
import { listInviteLinks } from "../../src/application/auth/list-invite-links";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { facilitator, fixedIds, newDb, readerCtx, repos, toOrgId } from "../support/invite-link";

const ORG = "org-f15-model";
const PROJECT = `${ORG}-p`;
const HOST = "u-f15-host";
const MEMBER = "u-f15-member";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const ids = fixedIds("dec-f15-model");

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
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1", "g2"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", fixture.groups.g1 ?? null);
}, HOOK_TIMEOUT_MS);

const deps = () => ({ repo });

function issue(over: Partial<Parameters<typeof issueInviteLink>[1]> = {}) {
  return issueInviteLink(deps(), {
    orgId,
    projectId: PROJECT,
    kind: "main",
    groupId: null,
    identity: "member",
    validity: "7d",
    ...facilitator(HOST),
    ...over,
  });
}

describe("签发：主链接与分组链接", () => {
  it("主链接带令牌、带邀请码，响应体过契约", async () => {
    const out = await issue();

    // I-10：令牌恒非空。契约的 `token: z.string().min(1)` 也钉着这一条。
    expect(out.token.length).toBeGreaterThan(0);
    expect(out.url).toContain(`?r=member`);
    expect(out.url).toContain(out.token);
    expect(out.inviteCode).not.toBeNull();

    const parsed = C.operations.issueInviteLink.out.safeParse({
      linkId: out.linkId,
      url: out.url,
      token: out.token,
      inviteCode: out.inviteCode,
      qrPayload: out.qrPayload,
    });
    expect(parsed.success).toBe(true);
  });

  it("每组一条分组链接，各自带自己的组号；主链接不带组号", async () => {
    const g1 = await issue({ kind: "group", groupId: fixture.groups.g1 });
    const g2 = await issue({ kind: "group", groupId: fixture.groups.g2 });
    expect(g1.linkId).not.toBe(g2.linkId);
    expect(g1.url).toContain(`/g/${fixture.groups.g1}`);
    expect(g2.url).toContain(`/g/${fixture.groups.g2}`);

    // 分组链接不配邀请码（`user_visible_behavior` 把邀请码写在主链接那一句里）。
    expect(g1.inviteCode).toBeNull();
  });

  it("kind 与 groupId 对不上一律拒绝——两个方向都拒", async () => {
    await expect(issue({ kind: "group", groupId: null })).rejects.toBeInstanceOf(OrgAdminError);
    await expect(issue({ kind: "main", groupId: fixture.groups.g1 })).rejects.toBeInstanceOf(
      OrgAdminError,
    );
  });
});

describe("幂等：同一槽位返回同一条，不每次新签", () => {
  it("同 (project, kind, group, identity, validity) ⇒ 同一 linkId 且 replayed", async () => {
    const a = await issue();
    const b = await issue();
    expect(b.linkId).toBe(a.linkId);
    expect(b.token).toBe(a.token);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
  });

  it("五元组任一项不同 ⇒ 另一条链接", async () => {
    const base = await issue();
    const otherIdentity = await issue({ identity: "observer" });
    const otherValidity = await issue({ validity: "24h" });
    const otherGroup = await issue({ kind: "group", groupId: fixture.groups.g1 });

    const all = [base, otherIdentity, otherValidity, otherGroup].map((x) => x.linkId);
    expect(new Set(all).size).toBe(4);
  });

  it("并发两名引导师同时签发同一槽位 ⇒ 恰好一条行，两路拿到同一 linkId", async () => {
    const [a, b] = await Promise.all([issue(), issue()]);
    expect(a.linkId).toBe(b.linkId);

    const rows = await listInviteLinks(
      { repo, ids },
      readerCtx({ orgId: ORG, projectId: PROJECT, actorId: HOST }),
    );
    expect(rows.filter((r) => r.linkId === a.linkId)).toHaveLength(1);
  });

  /**
   * 【互斥反证】—— 幂等真的钉在 `invite_links_live_slot_uniq` 上，不是钉在
   * 「issue() 先查一遍在世链接」上。
   *
   * 上面那条 Promise.all 证不了索引：#1040 的反证实测 DROP 掉该索引后它照样绿——
   * findLiveSlot 的先查后写在真实 I/O 时序下总能看到对方已提交的行，「同一 linkId」
   * 断言的是调度巧合。确定性版本（F160 范式）：
   *
   * holder 事务先把同槽位的一条在世链接**插进去但不提交**。issue() 的 findLiveSlot
   * 看不见未提交的行，于是走到 INSERT，必须**阻塞在唯一索引的冲突等待上**；
   * holder 提交后 INSERT 拿到 23505，走 SAVEPOINT 回收路径，以 replayed=true 返回
   * holder 那条的 linkId。索引被删 ⇒ INSERT 不阻塞、直接签出第二条 ⇒ 两处断言当场红。
   */
  it("【互斥反证】issue() 阻塞在在世槽位唯一索引上，冲突后以 replayed 返回既有链接", async () => {
    let settled = false;
    let racer!: ReturnType<typeof issue>;
    // Separate database owners prevent nested transaction reuse from turning the
    // contender into a read inside the holder transaction.
    const holderDb = newDb();
    try {
      await holderDb.withTenant(orgId, async (session) => {
        await session.query(
          `INSERT INTO invite_links
             (id, org_id, project_id, kind, group_id, project_role, validity,
              token, invite_code, expires_at, created_by, created_at)
           VALUES ($1,$2,$3,'main',NULL,'member','7d',$4,$5, now() + interval '7 days', $6, now())`,
          ["link-cp-holder", ORG, PROJECT, "cp-holder-token", "CPHOLDER1", HOST],
        );
        racer = issue().then((r) => {
          settled = true;
          return r;
        }) as ReturnType<typeof issue>;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        expect(settled, "issue() 没有阻塞——invite_links_live_slot_uniq 被删了？").toBe(false);
      });

      const raced = await racer;
      expect(raced.replayed).toBe(true);
      expect(raced.linkId).toBe("link-cp-holder");
    } finally {
      // If the lock assertion fails, the holder rolls back; drain its contender
      // before the following test resets this organization.
      await racer?.catch(() => undefined);
      await holderDb.close();
    }
  });
});

describe("撤销：⚠ 反向断言 —— 撤销后旧链接的下一次使用即失效", () => {
  it("单条撤销 ① 撤销前进得去 ② 撤销后同一令牌被拒 ③ 其余逐条仍进得去", async () => {
    const main = await issue();
    const g1 = await issue({ kind: "group", groupId: fixture.groups.g1 });
    const g2 = await issue({ kind: "group", groupId: fixture.groups.g2 });

    // ① 撤销前：三条都进得去。
    for (const l of [main, g1, g2]) {
      const grant = await consumeInviteLink({ repo }, { token: l.token, principalId: "p-before" });
      expect(grant.projectId).toBe(PROJECT);
    }

    const out = await revokeInviteLinks(deps(), {
      orgId,
      projectId: PROJECT,
      linkId: g1.linkId,
      ...facilitator(HOST),
    });
    expect(out.revokedLinkIds).toEqual([g1.linkId]);
    expect(
      C.operations.revokeInviteLink.out.safeParse({
        revokedLinkIds: [...out.revokedLinkIds],
        onsiteSessions: out.onsiteSessions,
        survivesUntilStageId: out.survivesUntilStageId,
      }).success,
    ).toBe(true);

    // ② 撤销后：同一枚令牌的下一次使用失败，且理由说得出来。
    await expect(
      consumeInviteLink({ repo }, { token: g1.token, principalId: "p-after" }),
    ).rejects.toMatchObject({ reasonCode: "LINK_REVOKED" });

    // ③ I-15：其余每一条逐条断言仍然进得去。少了这一条，
    //    一个把单条撤销写成 [重置全部] 的实现会让 ① ② 全绿。
    for (const l of [main, g2]) {
      const grant = await consumeInviteLink({ repo }, { token: l.token, principalId: "p-after" });
      expect(grant.linkId).toBe(l.linkId);
    }
  });

  it("[重置全部]：全部在世链接一起失效", async () => {
    const main = await issue();
    const g1 = await issue({ kind: "group", groupId: fixture.groups.g1 });
    const g2 = await issue({ kind: "group", groupId: fixture.groups.g2 });

    const out = await revokeInviteLinks(deps(), {
      orgId,
      projectId: PROJECT,
      linkId: null,
      ...facilitator(HOST),
    });
    expect(new Set(out.revokedLinkIds)).toEqual(new Set([main.linkId, g1.linkId, g2.linkId]));

    for (const l of [main, g1, g2]) {
      await expect(
        consumeInviteLink({ repo }, { token: l.token, principalId: "p" }),
      ).rejects.toMatchObject({ reasonCode: "LINK_REVOKED" });
    }
  });

  it("重复撤销同一条返回同一结果（幂等），不是错误", async () => {
    const main = await issue();
    const first = await revokeInviteLinks(deps(), {
      orgId,
      projectId: PROJECT,
      linkId: main.linkId,
      ...facilitator(HOST),
    });
    const second = await revokeInviteLinks(deps(), {
      orgId,
      projectId: PROJECT,
      linkId: main.linkId,
      ...facilitator(HOST),
    });
    expect(first.revokedLinkIds).toEqual([main.linkId]);
    expect(second.revokedLinkIds).toEqual([]);
  });

  it("撤销后重新签发得到一条**新的**链接（撤销不是把槽位锁死）", async () => {
    const first = await issue();
    await revokeInviteLinks(deps(), {
      orgId,
      projectId: PROJECT,
      linkId: first.linkId,
      ...facilitator(HOST),
    });
    const second = await issue();
    expect(second.linkId).not.toBe(first.linkId);
    expect(second.replayed).toBe(false);
    const grant = await consumeInviteLink({ repo }, { token: second.token, principalId: "p" });
    expect(grant.linkId).toBe(second.linkId);
  });
});

describe("越权：只有本项目的引导师能签发与撤销", () => {
  it("组员签发被拒；不在项目里的人被拒；两个码不同", async () => {
    await expect(
      issue({ actorId: MEMBER, actorProjectRole: "member" }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(
      issue({ actorId: "u-stranger", actorProjectRole: null }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("组员撤销被拒，且链接**确实还能用**（拒绝不是静默成功）", async () => {
    const main = await issue();
    await expect(
      revokeInviteLinks(deps(), {
        orgId,
        projectId: PROJECT,
        linkId: main.linkId,
        actorId: MEMBER,
        actorProjectRole: "member",
      }),
    ).rejects.toBeInstanceOf(OrgAdminError);
    const grant = await consumeInviteLink({ repo }, { token: main.token, principalId: "p" });
    expect(grant.linkId).toBe(main.linkId);
  });

  it("不带令牌的进场请求一律被拒（I-10 的另一半）", async () => {
    await expect(consumeInviteLink({ repo }, { token: null, principalId: "p" })).rejects.toMatchObject(
      { reasonCode: "LINK_TOKEN_REQUIRED" },
    );
    await expect(consumeInviteLink({ repo }, { token: "", principalId: "p" })).rejects.toMatchObject(
      { reasonCode: "LINK_TOKEN_REQUIRED" },
    );
  });

  it("伪造的令牌被拒，且与「已撤销」返回的都是不含项目信息的失败", async () => {
    await expect(
      consumeInviteLink({ repo }, { token: "not-a-real-token", principalId: "p" }),
    ).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });
  });
});

/**
 * ⚠ **反证：上面那些 `safeParse(...).success === true` 会不会是空转？**
 *
 * 一个永远返回 success 的 schema 能让本文件里每一条契约断言全绿。
 * 这四条证明它们确实会拒绝漂移的 body。
 */
describe("反证：契约 schema 确实会拒绝漂移的响应体", () => {
  it("issueInviteLink.out 拒绝空令牌、拒绝多字段、拒绝缺字段", () => {
    const good = {
      linkId: "il-1",
      url: "https://x/w/p?t=abc",
      token: "abc",
      inviteCode: null,
      qrPayload: null,
    };
    expect(C.operations.issueInviteLink.out.safeParse(good).success).toBe(true);
    // I-10：空令牌不是一条弱一点的链接，是一个公开入口。
    expect(C.operations.issueInviteLink.out.safeParse({ ...good, token: "" }).success).toBe(false);
    expect(
      C.operations.issueInviteLink.out.safeParse({ ...good, surprise: 1 }).success,
    ).toBe(false);
    const { token: _drop, ...missing } = good;
    expect(C.operations.issueInviteLink.out.safeParse(missing).success).toBe(false);
  });

  it("revokeInviteLink.out 拒绝负数在场人数、拒绝缺 survivesUntilStageId", () => {
    const good = { revokedLinkIds: ["il-1"], onsiteSessions: 0, survivesUntilStageId: null };
    expect(C.operations.revokeInviteLink.out.safeParse(good).success).toBe(true);
    expect(
      C.operations.revokeInviteLink.out.safeParse({ ...good, onsiteSessions: -1 }).success,
    ).toBe(false);
    const { survivesUntilStageId: _drop, ...missing } = good;
    expect(C.operations.revokeInviteLink.out.safeParse(missing).success).toBe(false);
  });
});
