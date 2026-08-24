/**
 * F16 -- "新注册用户立即拥有一个「我的本地」组织，无需任何配置动作" (invariants I-2 / I-3).
 *
 * ## What is asserted, and against what
 *
 *   I-2  exactly ONE personal-local organization per user
 *        · created by the registration transaction, not by a later call
 *        · a second one is refused BY THE DATABASE, not by an application check
 *        · `ensurePersonalLocalOrg` is idempotent: same organization, never a second
 *   I-3  the organization has exactly one member, forever
 *        · a second member is refused
 *        · a member who is not the owner is refused
 *        · there is no invite route, and `canInvite` is `z.literal(false)` in the contract
 *
 * ## Every assertion carries its counter-proof
 *
 * The database-level ones are the important half: "the application refuses to add a member"
 * would be satisfied by an application that simply has no code to add one, which says nothing
 * about the state the database can hold. So each refusal is attempted as the OWNER role --
 * the most privileged path there is -- and asserted to fail there too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg, addOrgMember } from "../support/db";
import { ensureRedis } from "../support/auth";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const OWNER = "u-f16-owner";
const STRANGER = "u-f16-stranger";
const LOCAL_ORG = "org-f16-local";
const REAL_ORG = "org-f16-real";

/** Registration fixture -- its own ids, because vitest runs files in parallel. */
const REG_CODE = "F16AUTOCREATE1"; // 14 chars (UC-1.5)
const REG_EMAIL = "f16-autocreate@example.com";
const REG_ORG = "org-f16-registered";

let BASE: string;
let app: NestExpressApplication;

const authFor = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  ensureRedis();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await cleanRegistration();
  await resetOrgs(LOCAL_ORG, REAL_ORG);
});

/**
 * Remove everything the registration case creates.
 *
 * ⚠ The credential is deleted BY EMAIL, not by user id: the id is minted inside the server
 * and this test never learns it if the previous run failed halfway. Cleaning by the id alone
 * left the address taken, and the next run got a 409 EMAIL_TAKEN -- a failure that reads as
 * "registration is broken" rather than "the fixture did not clean up".
 *
 * Both organizations go too (the invited one and the personal-local one), because a leftover
 * local organization would collide with the I-2 unique index on the next run.
 */
async function cleanRegistration(): Promise<void> {
  const orgs = await asOwner((c) =>
    c.query<{ id: string }>(
      `SELECT o.id FROM organizations o
         JOIN credentials c ON c.user_id = o.owner_user_id
        WHERE c.email = $1`,
      [REG_EMAIL],
    ),
  );
  await asOwner((c) => c.query("DELETE FROM invite_codes WHERE code = $1", [REG_CODE]));
  await resetOrgs(REG_ORG, ...orgs.rows.map((r) => r.id));
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email = $1", [REG_EMAIL]));
}

beforeEach(async () => {
  await resetOrgs(LOCAL_ORG, REAL_ORG);
  await seedOrg({ orgId: LOCAL_ORG, kind: "personal-local", ownerUserId: OWNER, projectId: `${LOCAL_ORG}-p` });
  await seedOrg({ orgId: REAL_ORG, projectId: `${REAL_ORG}-p` });
  await addOrgMember(LOCAL_ORG, OWNER, "admin", null);
  await addOrgMember(REAL_ORG, OWNER, "consultant", null);
  await addOrgMember(REAL_ORG, STRANGER, "admin", null);
});

/* ─────────────────────── I-2: one, and exactly one ─────────────────────── */

describe("I-2: every user has exactly one personal-local organization", () => {
  it("registration creates it in the SAME transaction as the account", async () => {
    await cleanRegistration();

    // 取消注册邀请码后（issue #1929），注册走 registerNewAccount（POST /auth/register-open），
    // 不再需要先种一条 invite_codes 行。
    const r = await fetch(`${BASE}/auth/register-open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: REG_EMAIL,
        password: "a-long-enough-password-1",
        displayName: "F16 注册人",
        orgName: "F16 受邀组织",
      }),
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const body = (await r.json()) as { userId: string; orgId: string };

    // ⚠ Asserted against STORAGE, not against the response. The registration contract does
    // not mention the local organization -- and it should not, because a client cannot be
    // asked to verify an invariant. What matters is that the row is there the instant the
    // account is.
    const rows = await asOwner((c) =>
      c.query<{ id: string; kind: string; owner_user_id: string }>(
        "SELECT id, kind, owner_user_id FROM organizations WHERE owner_user_id = $1",
        [body.userId],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ kind: C.LOCAL_ORG_KIND, owner_user_id: body.userId });

    // ...and its owner is its only member, from the first moment (I-3).
    const members = await asOwner((c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [
        rows.rows[0]!.id,
      ]),
    );
    expect(members.rows[0]?.n).toBe("1");
  });

  it("COUNTER-PROOF: a second personal-local organization for the same user is refused by the DATABASE", async () => {
    // As the OWNER role -- the most privileged path in the system. An application-level check
    // would say nothing about what state the database can hold, and the state is what a
    // future feature will find.
    await expect(
      asOwner((c) =>
        c.query(
          "INSERT INTO organizations (id, name, kind, owner_user_id) VALUES ($1,$2,'personal-local',$3)",
          [`${LOCAL_ORG}-second`, "sneaky second local", OWNER],
        ),
      ),
    ).rejects.toThrow(/organizations_one_personal_local_per_user/);
  });

  it("a personal-local organization without an owner cannot exist, and a real one with an owner cannot either", async () => {
    // Both directions of the CHECK. Without the second half, a real organization could be
    // given an owner and every rule keyed on `kind` would quietly not apply to it.
    await expect(
      asOwner((c) =>
        c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'personal-local')", [
          `${LOCAL_ORG}-ownerless`, "ownerless",
        ]),
      ),
    ).rejects.toThrow(/organizations_owner_iff_personal_local/);

    await expect(
      asOwner((c) =>
        c.query(
          "INSERT INTO organizations (id, name, kind, owner_user_id) VALUES ($1,$2,'organization',$3)",
          [`${REAL_ORG}-owned`, "real org with an owner", OWNER],
        ),
      ),
    ).rejects.toThrow(/organizations_owner_iff_personal_local/);
  });

  it("GET /identity/local-org returns the caller's own, with the three guarantees", async () => {
    const r = await fetch(`${BASE}/identity/local-org`, { headers: authFor(OWNER, LOCAL_ORG) });
    expect(r.status).toBe(200);
    const body = await r.json();

    // Contract-shaped, strictly: an extra field here would be a field the frontend was never
    // told about -- and in THIS feature an undescribed field is the shape a privacy leak takes.
    const parsed = C.operations.getLocalOrg.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();

    expect(body).toMatchObject({
      memberCount: 1,
      canInvite: false,
      storagePrefix: C.localObjectKeyPrefix(LOCAL_ORG),
    });
    // The guarantees come from the contract, so the screen and the server cannot disagree.
    expect((body as { guarantees: { id: string }[] }).guarantees.map((g) => g.id)).toEqual(
      C.LOCAL_ORG_GUARANTEES.map((g) => g.id),
    );
  });

  it("COUNTER-PROOF: the response schema rejects a body that drifts", () => {
    // Otherwise the safeParse above is a check that says yes to everything.
    expect(C.operations.getLocalOrg.out.safeParse({}).success).toBe(false);
    // memberCount is `z.literal(1)`: a two-member local organization is not merely wrong, it
    // is unrepresentable -- which is the point of the literal.
    expect(
      C.operations.getLocalOrg.out.safeParse({
        org: { id: "o", name: "n", kind: C.LOCAL_ORG_KIND, team: null },
        guarantees: [], memberCount: 2, canInvite: false, storagePrefix: "local/o/",
      }).success,
    ).toBe(false);
  });

  it("a user with no local organization gets 404, not an empty object", async () => {
    // STRANGER belongs to a real organization only. "There is no local org for you" must not
    // be answered with a hollow success -- a client rendering that would show a lock icon and
    // three privacy guarantees over an organization that does not exist.
    const r = await fetch(`${BASE}/identity/local-org`, { headers: authFor(STRANGER, REAL_ORG) });
    expect(r.status).toBe(404);
  });
});

/* ─────────────────────── I-3: single member, forever ─────────────────────── */

describe("I-3: a personal-local organization is permanently single-member", () => {
  it("COUNTER-PROOF: adding a second member is refused by the DATABASE", async () => {
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query(
          "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1,$2,'consultant',NULL)",
          [STRANGER, LOCAL_ORG],
        ),
      ),
    ).rejects.toThrow(/invariant I-3/);
  });

  it("...and as the OWNER role too -- there is no privileged way in", async () => {
    await expect(
      asOwner((c) =>
        c.query(
          "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1,$2,'admin',NULL)",
          [STRANGER, LOCAL_ORG],
        ),
      ),
    ).rejects.toThrow(/invariant I-3/);
  });

  it("a member who is not the owner is refused even when the org has no members yet", async () => {
    // The subtle one: emptiness is not a licence. Without this branch, deleting the owner's
    // membership row would open a window in which anybody could be admitted.
    await asOwner((c) => c.query("DELETE FROM org_memberships WHERE org_id = $1", [LOCAL_ORG]));
    await expect(
      asOwner((c) =>
        c.query(
          "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1,$2,'admin',NULL)",
          [STRANGER, LOCAL_ORG],
        ),
      ),
    ).rejects.toThrow(/invariant I-3/);
  });

  it("counter-proof the other way: the OWNER can be (re)admitted -- this is isolation, not paralysis", async () => {
    // Without this, a trigger that refused every insert would pass every assertion above, and
    // registration itself would be broken in a way these tests could not see.
    await asOwner((c) => c.query("DELETE FROM org_memberships WHERE org_id = $1", [LOCAL_ORG]));
    await asApp(LOCAL_ORG, (c) =>
      c.query(
        "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1,$2,'admin',NULL)",
        [OWNER, LOCAL_ORG],
      ),
    );
    const n = await asApp(LOCAL_ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [LOCAL_ORG]),
    );
    expect(n.rows[0]?.n).toBe("1");
  });

  it("...and a REAL organization still admits many members", async () => {
    // The trigger must key on `kind`. If it fired everywhere, every organization in the
    // product would become single-member and these local-org tests would still pass.
    const n = await asApp(REAL_ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [REAL_ORG]),
    );
    expect(Number(n.rows[0]?.n)).toBe(2);
  });

  it("there is no invitation route in the contract at all", () => {
    // The ruling of 2026-07-28 chose "the API does not exist" over "the API always refuses"
    // (the same reasoning `no-forbidden-routes.test.ts` records for DELETE /organizations):
    // an absent endpoint has no rejection logic that can be written wrongly.
    const routes = Object.values(C.operations).map((o) => `${o.method} ${o.path}`);
    expect(routes.filter((r) => /invite|member/i.test(r))).toEqual([]);
  });
});
