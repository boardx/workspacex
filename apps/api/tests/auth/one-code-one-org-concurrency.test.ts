/**
 * Invariant I-4, the concurrency half: **two people using the same code produce EXACTLY ONE
 * organization** (UC-1.5 V7, coverage V3).
 *
 * ## Why this file is shaped the way it is
 *
 * Getting this wrong does not throw. It creates two organizations, both of which behave
 * normally, and nothing reports anything. So the assertion has to be a COUNT taken from
 * outside, and the transactions have to be genuinely simultaneous -- two sequential calls
 * prove only that the second one sees the first one's committed row, which is true of even
 * the broken implementation.
 *
 * Three layers, because each one can be right while the next is wrong:
 *
 *   1. the STATEMENT. Two transactions, an explicit barrier, no application code. This is
 *      deterministic: B's UPDATE blocks on A's row lock, and there is no timing to get
 *      lucky with.
 *   2. the same barrier with SELECT-then-UPDATE, demonstrating that the forbidden shape
 *      really does let both through. This is a permanent counter-proof: it cannot go
 *      vacuous, because it fails the moment the hazard stops existing.
 *   3. the REPOSITORY. N simultaneous real registrations, asserting one organization.
 *      Layer 1 proves the statement is safe; only this proves the code uses it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { InviteCodeInvalidError } from "../../src/application/auth/errors";
import { registerWithInvite } from "../../src/application/auth/register-with-invite";
import { PgRegistrationRepository } from "../../src/infrastructure/auth/pg-registration-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { newOrgId, newUserId, newVerificationToken } from "../../src/domain/auth/registration";
import { ensureDatabase, migrateOnce } from "../support/db";
import {
  countOrganizations,
  issueInviteCode,
  makeCode,
  orgsOwnedBy,
  personalLocalOrgsOwnedBy,
  readInviteCode,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

const EMAIL_DOMAIN = "f19race.test";
const BARRIER_CODE = makeCode("RACEBARRIER");
const BAD_SHAPE_CODE = makeCode("RACEBADSHAP");
/** One per round, so a round never inherits the previous round's spent code. */
const RACE_CODES = Array.from({ length: 5 }, (_, i) => makeCode(`RACEROUND${i}`));
const ALL_CODES = [BARRIER_CODE, BAD_SHAPE_CODE, ...RACE_CODES];

/**
 * How many attempts fight over one code.
 *
 * `PgDatabase` caps its pool at 5, so more than five simultaneous registrations would queue
 * on connections rather than on the invite-code row -- the queueing is invisible and the
 * test would look concurrent while being partly sequential. Five is the largest number that
 * is genuinely simultaneous through one pool.
 */
const RACERS = 5;

let db: PgDatabase;
let repo: PgRegistrationRepository;
const created: string[] = [];

/**
 * A fixed, pre-computed bcrypt hash.
 *
 * ⚠ Deliberately NOT calling the real hasher here. A cost-12 hash takes most of a second,
 * and five of them in one single-threaded process finish hundreds of milliseconds apart --
 * which would spread the racers out and make the window this test exists to close mostly
 * absent. The hash's CORRECTNESS is asserted in `password-hash-invariant.test.ts`; what
 * this file needs is for all five transactions to arrive at the same moment.
 *
 * It is a real bcrypt cost-12 hash (of the string "not-a-real-password"), so the schema's
 * I-2 CHECK still applies -- the shortcut skips the computation, not the constraint.
 */
const FIXED_HASH = "$2b$12$x5CA9Z/lWHcowxlNAkJj3.i7AoEfDtg74od.kgXvYoTERqGC6JRnW";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgRegistrationRepository(db);
});

afterAll(async () => {
  await resetOrgsOwnedBy(created);
  await resetAuthFixtures({ codes: ALL_CODES, emailLike: `%@${EMAIL_DOMAIN}` });
  await db.close();
});

beforeEach(async () => {
  await resetOrgsOwnedBy(created);
  created.length = 0;
  await resetAuthFixtures({ codes: ALL_CODES, emailLike: `%@${EMAIL_DOMAIN}` });
});

/** Two app-role connections with manual transaction control -- the barrier needs both open. */
async function withTwoClients<T>(fn: (a: pg.Client, b: pg.Client) => Promise<T>): Promise<T> {
  const a = new pg.Client(appConfig());
  const b = new pg.Client(appConfig());
  await a.connect();
  await b.connect();
  try {
    return await fn(a, b);
  } finally {
    await a.query("ROLLBACK").catch(() => undefined);
    await b.query("ROLLBACK").catch(() => undefined);
    await a.end();
    await b.end();
  }
}

describe("1. the statement: conditional UPDATE admits exactly one winner", () => {
  it("B's redemption returns zero rows once A has committed, with no application coordination", async () => {
    await issueInviteCode(BARRIER_CODE);

    const { aRows, bRows } = await withTwoClients(async (a, b) => {
      await a.query("BEGIN");
      await b.query("BEGIN");

      const ra = await a.query(
        `UPDATE invite_codes SET redeemed_by_user_id = 'u-A', redeemed_at = now()
          WHERE code = $1 AND redeemed_by_user_id IS NULL RETURNING code`,
        [BARRIER_CODE],
      );

      // B issues the same statement while A still holds the row lock. It BLOCKS here --
      // that is the whole mechanism -- so the promise is deliberately not awaited yet.
      const pending = b.query(
        `UPDATE invite_codes SET redeemed_by_user_id = 'u-B', redeemed_at = now()
          WHERE code = $1 AND redeemed_by_user_id IS NULL RETURNING code`,
        [BARRIER_CODE],
      );

      // Prove B really is blocked rather than merely slow: give it a generous head start
      // and assert it has NOT resolved. Without this, a B that had already returned zero
      // rows for some unrelated reason would look like a pass.
      const raced = await Promise.race([
        pending.then(() => "resolved" as const),
        new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 300)),
      ]);
      expect(raced, "B did not block on A's row lock -- the race this test models is absent").toBe(
        "blocked",
      );

      await a.query("COMMIT");
      const rb = await pending;
      await b.query("COMMIT");
      return { aRows: ra.rowCount, bRows: rb.rowCount };
    });

    expect(aRows, "the first redeemer did not win").toBe(1);
    // The assertion the whole feature rests on.
    expect(bRows, "the second redeemer ALSO redeemed -- two organizations would exist").toBe(0);

    const code = await readInviteCode(BARRIER_CODE);
    expect(code!.redeemed_by_user_id).toBe("u-A");
  });
});

describe("2. counter-proof: SELECT-then-UPDATE really does let both through", () => {
  /**
   * ⚠ This test asserts the BUG, on purpose.
   *
   * `usecases.md` says "不要先 SELECT 再 UPDATE，那中间有窗口". A comment saying so is not
   * evidence. This reproduces the forbidden shape against the same database, with the same
   * barrier, and shows both transactions committing a redemption -- which is what "two
   * organizations, both of which log in fine, and nothing reports anything" looks like at
   * the SQL level.
   *
   * It is also the permanent counter-proof for the test above: if this one ever starts
   * failing, the hazard has changed (a different isolation level, a new constraint) and the
   * test above may be passing for a reason that no longer holds.
   */
  it("both transactions commit a redemption when the check and the write are separate", async () => {
    await issueInviteCode(BAD_SHAPE_CODE);

    const { aWrote, bWrote } = await withTwoClients(async (a, b) => {
      await a.query("BEGIN");
      await b.query("BEGIN");

      // Both LOOK first. Neither takes a lock -- a plain SELECT does not.
      const seenA = await a.query(
        `SELECT redeemed_by_user_id FROM invite_codes WHERE code = $1`,
        [BAD_SHAPE_CODE],
      );
      const seenB = await b.query(
        `SELECT redeemed_by_user_id FROM invite_codes WHERE code = $1`,
        [BAD_SHAPE_CODE],
      );
      // This is the window. Both are convinced the code is free.
      expect(seenA.rows[0]!.redeemed_by_user_id).toBeNull();
      expect(seenB.rows[0]!.redeemed_by_user_id).toBeNull();

      // ...and then both act on what they saw. Note the WHERE clause has no condition on
      // `redeemed_by_user_id` -- that is exactly what "I already checked" means in code.
      const wa = await a.query(
        `UPDATE invite_codes SET redeemed_by_user_id = 'u-A', redeemed_at = now() WHERE code = $1`,
        [BAD_SHAPE_CODE],
      );
      await a.query("COMMIT");
      const wb = await b.query(
        `UPDATE invite_codes SET redeemed_by_user_id = 'u-B', redeemed_at = now() WHERE code = $1`,
        [BAD_SHAPE_CODE],
      );
      await b.query("COMMIT");
      return { aWrote: wa.rowCount, bWrote: wb.rowCount };
    });

    // BOTH succeeded. In the real implementation each of these would have carried an
    // organization insert with it, and there would now be two.
    expect(aWrote).toBe(1);
    expect(
      bWrote,
      "the SELECT-then-UPDATE window has closed on its own -- if so, the test above may now be passing for a reason that no longer holds, and this file needs revisiting",
    ).toBe(1);
  });
});

describe("3. the repository: N simultaneous registrations create ONE organization", () => {
  /**
   * Runs the ROUNDS separately rather than as one big batch: five racers on five different
   * codes at once would mostly contend on connections, and each round would be a weaker
   * race than a round run alone.
   */
  for (let round = 0; round < RACE_CODES.length; round++) {
    it(`round ${round}: exactly one of ${RACERS} wins, and the losers leave nothing`, async () => {
      const code = RACE_CODES[round]!;
      await issueInviteCode(code);

      const candidates = Array.from({ length: RACERS }, (_, i) => ({
        userId: newUserId(),
        orgId: newOrgId(),
        email: `racer${round}-${i}@${EMAIL_DOMAIN}`,
      }));
      created.push(...candidates.map((c) => c.userId));

      // Fired without awaiting in between -- every one of them is in flight before the
      // first resolves. `allSettled`, not `all`: four of five are SUPPOSED to fail.
      const settled = await Promise.allSettled(
        candidates.map((c) =>
          repo.redeemAndCreateOrg({
            code,
            email: c.email,
            displayName: `racer ${c.email}`,
            passwordHash: FIXED_HASH,
            userId: c.userId,
            orgId: c.orgId,
            orgName: `Contested Org ${round}`,
            verificationToken: newVerificationToken(),
            verificationExpiresAt: new Date(Date.now() + 3600_000),
          }),
        ),
      );

      // No attempt may crash. A rejected promise here would mean the loser hit an
      // unhandled constraint violation instead of the contracted failure -- which is a
      // 500 for a perfectly ordinary race.
      const crashed = settled.filter((s) => s.status === "rejected");
      expect(crashed, JSON.stringify(crashed)).toHaveLength(0);

      const results = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof repo.redeemAndCreateOrg>>>).value);
      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);

      // ⚠ THE assertion, and it comes FIRST on purpose.
      //
      // Counted from the database, over every org id that was ATTEMPTED -- including the
      // four that were rolled back. Asserting the winner count first would be a true
      // assertion about a weaker property, and when the counter-proof was run (redemption
      // rewritten as SELECT-then-UPDATE) it was the winner count that failed, so the
      // failure message named "not exactly one winner" rather than the thing that actually
      // went wrong. Ordering it this way makes a broken implementation report the invariant
      // it broke.
      const attemptedOrgIds = candidates.map((c) => c.orgId);
      expect(
        await countOrganizations(attemptedOrgIds),
        "more than one organization survived a contested invite code -- this is the failure I-4 exists to prevent, and nothing else would have reported it",
      ).toBe(1);

      expect(winners, "not exactly one winner").toHaveLength(1);
      expect(losers).toHaveLength(RACERS - 1);
      for (const l of losers) {
        expect(l.ok).toBe(false);
        if (!l.ok) expect(l.reason).toBe("invite-code-invalid");
      }

      // ...and it is the winner's.
      const winner = winners[0]!;
      if (winner.ok) {
        expect(await orgsOwnedBy([winner.userId])).toEqual([winner.orgId]);
        // F16: exactly ONE personal-local organization for the winner, even though N
        // transactions raced. This is I-2 under the same concurrency that V3 is about -- and
        // the interesting direction, because the local org is created without a contended
        // invite-code row to serialise on: it is the unique index doing the work.
        expect(await personalLocalOrgsOwnedBy([winner.userId])).toHaveLength(1);
        const row = await readInviteCode(code);
        expect(row!.redeemed_by_user_id).toBe(winner.userId);
        expect(row!.created_org_id).toBe(winner.orgId);
      }

      // The losers left no membership either -- an admin row pointing at a rolled-back org
      // is the "half organization" in its most confusing form.
      const loserUserIds = candidates.map((c) => c.userId).filter((u) => u !== winner.userId);
      expect(await orgsOwnedBy(loserUserIds)).toEqual([]);
      // ...and no loser left a personal-local organization behind either. That row would be
      // unreachable (its owner has no account) and would only surface much later, as an I-2
      // unique-index violation on a retry.
      expect(await personalLocalOrgsOwnedBy(loserUserIds)).toEqual([]);
    });
  }

  it("the full use case behaves the same way end to end (real hashing, contracted errors)", async () => {
    // One round through `registerWithInvite` rather than the repository, so the wiring --
    // normalization, hashing, error mapping -- is covered by the race too. Two racers only,
    // because each one really does compute a cost-12 hash.
    const code = RACE_CODES[0]!;
    await issueInviteCode(code);

    const { BcryptPasswordHasher } = await import(
      "../../src/infrastructure/auth/bcrypt-password-hasher"
    );
    const hasher = new BcryptPasswordHasher();
    const settled = await Promise.allSettled(
      ["ua", "ub"].map((who) =>
        registerWithInvite(
          { repo, hasher },
          {
            code,
            email: `${who}@${EMAIL_DOMAIN}`,
            password: "correct-horse-battery-staple",
            displayName: who,
            orgName: "Use Case Race",
          },
        ),
      ),
    );

    const ok = settled.filter((s) => s.status === "fulfilled");
    const failed = settled.filter((s) => s.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(InviteCodeInvalidError);

    const winner = (ok[0] as PromiseFulfilledResult<{ userId: string; orgId: string }>).value;
    created.push(winner.userId);
    expect(await countOrganizations([winner.orgId])).toBe(1);
  });
});
