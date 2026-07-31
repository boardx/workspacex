/**
 * F16 · I-12「令牌被撤销后 ≤5 秒，用该令牌发起的新访问被拒」。
 *
 * ## 这条不变量为什么可以在**没有任何 5 秒逻辑**的情况下成立
 *
 * 撤销（`revokeInviteLinks` → `invite_links.revoked_at`）与核销
 * （`consumeInviteLink` → 同一行的条件 UPDATE）读写的是**同一份记录、同一个数据库**，
 * 没有缓存、没有只读副本、没有异步传播。所以「新访问被拒」这件事在撤销提交的
 * 那一刻就已经成立，不需要等任何毫秒数——`domain/auth/live-session.ts` 文件头写着
 * 「立即失效 ⊂ 5 秒内失效」。5 秒是契约给外部缓存场景预留的 SLA 上限
 * （domain.md `[待定 G]`：「5 秒出自 [Backlog]，原型无任何时限」），不是本实现
 * 需要新造一列去满足的宽限期。
 *
 * 本文件因此断言的是**这条更强的性质**：撤销后，在 0 秒、1 秒、4.999 秒、5 秒、
 * 5.001 秒的任意时刻发起新访问，**全部**被拒——用注入的 `now` 模拟时间流逝，
 * 不必真的等待。少了任何一个采样点，一个「撤销后有个短暂窗口仍可用」的实现
 * 完全可能只在某一个采样点被抓到。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { revokeInviteLinks } from "../../src/application/auth/revoke-invite-links";
import { consumeInviteLink } from "../../src/application/auth/consume-invite-link";
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
import { facilitator, newDb, repos, toOrgId } from "../support/invite-link";

const ORG = "org-f16-5s";
const PROJECT = `${ORG}-p`;
const HOST = "u-f16-5s-host";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];
let liveSessions: ReturnType<typeof repos>["liveSessions"];

const orgId = toOrgId(ORG);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  const r = repos(db);
  repo = r.links;
  liveSessions = r.liveSessions;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

describe("I-12：撤销后新访问在 0s / 1s / 4.999s / 5s / 5.001s 全部被拒", () => {
  it("每一个采样点都被拒——不是只在撤销那一刻恰好被抓到", async () => {
    const issued = await issueInviteLink(
      { repo },
      { orgId, projectId: PROJECT, kind: "main", groupId: null, identity: "member", validity: "7d", ...facilitator(HOST) },
    );

    // 撤销前：确实能用（不然「撤销」这个动作本身就没有对照）。
    const before = await consumeInviteLink({ repo }, { token: issued.token, principalId: "p-before" });
    expect(before.linkId).toBe(issued.linkId);

    const revokedAt = new Date("2026-07-31T10:00:00.000Z");
    await revokeInviteLinks(
      { repo, liveSessions, now: () => revokedAt },
      { orgId, projectId: PROJECT, linkId: issued.linkId, ...facilitator(HOST) },
    );

    const offsetsMs = [0, 1_000, 4_999, 5_000, 5_001, 30_000];
    for (const offsetMs of offsetsMs) {
      const now = new Date(revokedAt.getTime() + offsetMs);
      await expect(
        consumeInviteLink({ repo, now: () => now }, { token: issued.token, principalId: `p-after-${offsetMs}` }),
      ).rejects.toMatchObject({ reasonCode: "LINK_REVOKED" });
    }
  });

  it("[重置全部] 同样在全部采样点被拒", async () => {
    const issued = await issueInviteLink(
      { repo },
      { orgId, projectId: PROJECT, kind: "main", groupId: null, identity: "member", validity: "7d", ...facilitator(HOST) },
    );
    const revokedAt = new Date("2026-07-31T11:00:00.000Z");
    await revokeInviteLinks(
      { repo, liveSessions, now: () => revokedAt },
      { orgId, projectId: PROJECT, linkId: null, ...facilitator(HOST) },
    );

    for (const offsetMs of [0, 2_500, 5_000]) {
      const now = new Date(revokedAt.getTime() + offsetMs);
      await expect(
        consumeInviteLink({ repo, now: () => now }, { token: issued.token, principalId: `p-${offsetMs}` }),
      ).rejects.toBeInstanceOf(OrgAdminError);
    }
  });
});
