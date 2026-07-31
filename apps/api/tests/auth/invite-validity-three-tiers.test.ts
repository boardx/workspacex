/**
 * F15 有效期三档（24h / 7天 / 一次性）。
 *
 * ## 这个文件的第一件事：证明**三档的数值没有第二份副本**
 *
 * `24h` 与 `7d` 的时长写在契约枚举的**成员名字本身**里，
 * `domain/auth/invite-link.ts` 直接解析那个字面量。所以这里的断言不是
 * 「24 小时等于 86400000 毫秒」（那会是第二份副本，且和实现抄的是同一个数），
 * 而是「**从枚举成员名字算出来的时长**，与库里落下的 `expires_at` 一致」——
 * 一份手写映射表要漂移，这条会当场红。
 *
 * ⚠ 一起断言的是「未知档不得被默认成永不过期」：一个 `?? null` 的兜底
 * 会让契约新增的 `30d` 悄悄变成一条**永不失效**的链接，而所有已有测试全绿。
 *
 * ## 第二件事：一次性档没有时间语义，这是**缺席不是裁定**
 *
 * `once` 的失效条件是「被用过」。「一次性链接是否另有时间上限」在需求里没有出处
 * ⇒ 已登记 `KNOWN_CONTRACT_GAPS.OA8`（见契约）。这里断言的是当前实现的形状
 * （`expires_at IS NULL`，且库层有 CHECK 钉着），不是断言那个缺口已经被裁掉。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { consumeInviteLink } from "../../src/application/auth/consume-invite-link";
import {
  isSingleUse,
  linkExpiresAt,
  linkUsability,
  validityDurationMs,
  type InviteLinkValidity,
} from "../../src/domain/auth/invite-link";
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
import { facilitator, newDb, repos, toOrgId } from "../support/invite-link";

const ORG = "org-f15-validity";
const PROJECT = `${ORG}-p`;
const HOST = "u-f15v-host";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];

const orgId = toOrgId(ORG);
const TIERS = C.InviteLinkValidity.options as readonly InviteLinkValidity[];

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
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

function issue(validity: InviteLinkValidity, now: Date, identity: "member" | "observer" = "member") {
  return issueInviteLink(
    { repo, now: () => now },
    {
      orgId,
      projectId: PROJECT,
      kind: "main",
      groupId: null,
      identity,
      validity,
      ...facilitator(HOST),
    },
  );
}

describe("枚举封闭性（集合 + 未声明值不能通过，不写 toHaveLength）", () => {
  it("契约的三档每一档都有时长语义，且未声明的档被拒", () => {
    for (const t of TIERS) {
      // 不抛 = 每一档都被显式处置过。
      expect(() => validityDurationMs(t)).not.toThrow();
    }
    expect(C.InviteLinkValidity.safeParse("48h").success).toBe(false);
    expect(C.InviteLinkValidity.safeParse("forever").success).toBe(false);
    expect(C.InviteLinkValidity.safeParse("7D").success).toBe(false);
  });

  it("⚠ 无法从名字算出时长的档**抛错**，而不是默默变成永不过期", () => {
    // 一个 `?? null` 的兜底会让新增的档悄悄变成永不失效的链接，而全部已有测试仍然绿。
    expect(() => validityDurationMs("forever" as InviteLinkValidity)).toThrow(/拒绝猜/);
    expect(() => validityDurationMs("" as InviteLinkValidity)).toThrow();
    expect(() => validityDurationMs("7 days" as InviteLinkValidity)).toThrow();
  });

  it("契约新增一档 `<数字><h|d>` 时**不需要改任何映射表**——这是不写第二份数值的收益", () => {
    // 这条不是在测一个不存在的档，是在证明「时长从名字算出来」这件事成立：
    // 有第二份手写映射表的实现，这里会抛「未知档」。
    expect(validityDurationMs("30d" as InviteLinkValidity)).toBe(30 * 86_400_000);
    expect(validityDurationMs("48h" as InviteLinkValidity)).toBe(48 * 3_600_000);
  });
});

describe("时长来自枚举字面量本身，不是第二份数值表", () => {
  it("24h / 7d：库里落下的 expires_at = 签发时刻 + 从成员名字算出来的时长", async () => {
    const now = new Date("2026-07-31T09:00:00.000Z");
    for (const t of TIERS) {
      if (t === "once") continue;
      // 期望值**由成员名字算出**：`"7d"` → 7 × 一天。与实现共享的是解析规则，
      // 不是一张两边各抄一遍的数值表。
      const m = /^(\d+)([hd])$/.exec(t);
      const unitMs = m?.[2] === "h" ? 3_600_000 : 86_400_000;
      const expected = new Date(now.getTime() + Number(m?.[1]) * unitMs);

      const link = await issue(t, now, t === "24h" ? "member" : "observer");
      const rows = await asApp(ORG, (c) =>
        c.query<{ expires_at: Date }>("SELECT expires_at FROM invite_links WHERE id = $1", [
          link.linkId,
        ]),
      );
      expect(rows.rows[0]?.expires_at?.toISOString()).toBe(expected.toISOString());
      expect(linkExpiresAt(now, t)?.toISOString()).toBe(expected.toISOString());
    }
  });

  it("once：不按时间失效 —— expires_at 恒为 NULL，且库层 CHECK 钉着", async () => {
    const now = new Date("2026-07-31T09:00:00.000Z");
    const link = await issue("once", now);
    const rows = await asApp(ORG, (c) =>
      c.query<{ expires_at: Date | null }>("SELECT expires_at FROM invite_links WHERE id = $1", [
        link.linkId,
      ]),
    );
    expect(rows.rows[0]?.expires_at).toBeNull();
    expect(linkExpiresAt(now, "once")).toBeNull();
    expect(isSingleUse("once")).toBe(true);
    expect(isSingleUse("7d")).toBe(false);

    // ⚠ 反向：一条 validity='once' 却带 expires_at 的行，意味着某条路径把两种失效条件
    //   混起来了，而那条路径本身不会报错。库层拒绝它。
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO invite_links
             (id, org_id, project_id, kind, group_id, project_role, validity, token, expires_at, created_by)
           VALUES ('il-mixed', $1, $2, 'main', NULL, 'member', 'once', 'tok-mixed', now(), $3)`,
          [ORG, PROJECT, HOST],
        ),
      ),
    ).rejects.toThrow();

    // 反向的另一半：带时限的档**必须**有 expires_at，否则那条链接永不失效。
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO invite_links
             (id, org_id, project_id, kind, group_id, project_role, validity, token, expires_at, created_by)
           VALUES ('il-noexp', $1, $2, 'main', NULL, 'member', '24h', 'tok-noexp', NULL, $3)`,
          [ORG, PROJECT, HOST],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("到点即失效 —— 用注入的时钟断言，不等 24 小时", () => {
  it("24h：档内进得去，过点后同一令牌被拒且理由是 LINK_EXPIRED", async () => {
    const issuedAt = new Date("2026-07-31T09:00:00.000Z");
    const link = await issue("24h", issuedAt);

    const justBefore = new Date(issuedAt.getTime() + 24 * 3_600_000 - 1_000);
    const grant = await consumeInviteLink(
      { repo, now: () => justBefore },
      { token: link.token, principalId: "p-in" },
    );
    expect(grant.linkId).toBe(link.linkId);

    const justAfter = new Date(issuedAt.getTime() + 24 * 3_600_000 + 1_000);
    await expect(
      consumeInviteLink({ repo, now: () => justAfter }, { token: link.token, principalId: "p-out" }),
    ).rejects.toMatchObject({ reasonCode: "LINK_EXPIRED" });
  });

  it("边界：expires_at **等于**当下即算过期（<=，不是 <）", () => {
    const t = new Date("2026-07-31T09:00:00.000Z");
    expect(
      linkUsability({ revokedAt: null, expiresAt: t, usedAt: null, singleUse: false }, t),
    ).toEqual({ usable: false, reason: "expired" });
    expect(
      linkUsability(
        { revokedAt: null, expiresAt: t, usedAt: null, singleUse: false },
        new Date(t.getTime() - 1),
      ),
    ).toEqual({ usable: true });
  });

  it("撤销优先于过期：既过期又被撤销的链接，管理面看到的是「已撤销」", () => {
    const t = new Date("2026-07-31T09:00:00.000Z");
    expect(
      linkUsability({ revokedAt: t, expiresAt: t, usedAt: null, singleUse: false }, t),
    ).toEqual({ usable: false, reason: "revoked" });
  });

  it("过期后重新签发：拿到**一条新链接**，旧的是 superseded 而不是 revoked", async () => {
    const issuedAt = new Date("2026-07-31T09:00:00.000Z");
    const first = await issue("24h", issuedAt);
    const later = new Date(issuedAt.getTime() + 25 * 3_600_000);
    const second = await issue("24h", later);

    expect(second.linkId).not.toBe(first.linkId);
    expect(second.replayed).toBe(false);

    const rows = await asApp(ORG, (c) =>
      c.query<{ id: string; revoked_at: Date | null; superseded_at: Date | null }>(
        "SELECT id, revoked_at, superseded_at FROM invite_links WHERE id = $1",
        [first.linkId],
      ),
    );
    // ⚠ 让位 ≠ 撤销：合成一列的话，「重新签发一条链接」在审计里长得像
    //   「引导师撤销了一条链接」。
    expect(rows.rows[0]?.superseded_at).not.toBeNull();
    expect(rows.rows[0]?.revoked_at).toBeNull();
  });

  it("未过期时重新签发**不**让位：拿回同一条（幂等，见 model 测试）", async () => {
    const issuedAt = new Date("2026-07-31T09:00:00.000Z");
    const first = await issue("7d", issuedAt);
    const second = await issue("7d", new Date(issuedAt.getTime() + 3_600_000));
    expect(second.linkId).toBe(first.linkId);
    expect(second.replayed).toBe(true);
  });
});
