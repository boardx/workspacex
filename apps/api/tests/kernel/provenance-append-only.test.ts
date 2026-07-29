import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";
import {
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F08 obligation 1 -- I-9: `provenance_events` is append-only. No UPDATE, no DELETE.
 *
 * ## What this file refuses to accept as evidence
 *
 * "The repository class has no update method" and "the route table has no PUT" are both
 * true and both worthless on their own: they say the convenient path does not offer a
 * mutation, not that a mutation is impossible. 0005 went one better and wrote a GRANT --
 * and the GRANT was measured, before this feature, to be guarding a door with an open one
 * beside it:
 *
 *   app_rw: UPDATE provenance_events            -> permission denied
 *   app_rw: DELETE FROM provenance_events       -> permission denied
 *   app_rw: DELETE FROM organizations WHERE ... -> DELETE 1, and every event row was GONE
 *
 * A referential action is performed by the system WITHOUT a privilege check on the child
 * table, so `ON DELETE CASCADE` from `organizations` walked straight past the REVOKE. That
 * is the shape 0007 documented for `artifact_versions`; it was still live here.
 *
 * So every assertion below attacks the table from the OUTSIDE, in SQL, as the role that
 * serves traffic -- and the last two attack it from inside the cascade, which is the only
 * one that was ever actually open.
 */

const ORG = "org-f08-append";
const OTHER = "org-f08-append-other";
const PROJECT = "proj-f08-append";

let db: PgDatabase;
let repo: PgProvenanceRepository;

/** Run a statement as app_rw and return the error message, or null when it SUCCEEDED. */
async function appDenies(orgId: string, sql: string, params: unknown[] = []): Promise<string | null> {
  const c = new pg.Client(appConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    await c.query(sql, params);
    await c.query("ROLLBACK");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  } finally {
    await c.end();
  }
}

/** Same, as the OWNER -- the role a migration or a psql session runs as. */
async function ownerDenies(sql: string, params: unknown[] = []): Promise<string | null> {
  const c = new pg.Client(migrationConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    await c.query("ROLLBACK");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  } finally {
    await c.end();
  }
}

const countEvents = async (orgId: string): Promise<number> =>
  asApp(orgId, async (c) => {
    const r = await c.query<{ n: string }>("SELECT count(*) AS n FROM provenance_events");
    return Number(r.rows[0]!.n);
  });

let eventId: string;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProvenanceRepository(db);
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG, OTHER);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  // Written through the real writer, not a raw INSERT: the row under attack has to be one
  // the production path produces, or the assertions are about a row nothing creates.
  eventId = await repo.append({
    orgId: toOrgId(ORG),
    type: "pinned",
    actorId: "u-author",
    target: { kind: "artifact", id: "art-append-only" },
    detail: { versionNumber: 1 },
  });
});

describe("I-9: nothing serving traffic can rewrite history", () => {
  it("app_rw cannot UPDATE an event", async () => {
    const err = await appDenies(ORG, "UPDATE provenance_events SET actor_id = 'u-forged'");
    // `?? "<SUCCEEDED>"` and not a bare `err`: a null here means the attack WORKED, and a
    // failure message reading "expected object, got string" describes the assertion rather
    // than the breach.
    expect(err ?? "<SUCCEEDED>", "the UPDATE succeeded -- the audit trail is editable").toMatch(
      /permission denied/i,
    );
    expect(await countEvents(ORG)).toBe(1);
  });

  it("app_rw cannot DELETE an event", async () => {
    const err = await appDenies(ORG, "DELETE FROM provenance_events WHERE id = $1", [eventId]);
    expect(
      err ?? "<SUCCEEDED>",
      "the DELETE succeeded -- refusals can be erased by whoever was refused",
    ).toMatch(/permission denied/i);
    expect(await countEvents(ORG)).toBe(1);
  });

  /**
   * The two above are GRANTs, and a grant is exactly what failed before. These two are the
   * trigger, which fires for the owner as well -- i.e. for a migration, for a psql session,
   * and (critically) for a referential action.
   */
  it("not even the OWNER can UPDATE an event", async () => {
    const err = await ownerDenies("UPDATE provenance_events SET actor_id = 'u-forged' WHERE id = $1", [
      eventId,
    ]);
    expect(err ?? "<SUCCEEDED>", "the owner rewrote an audit row").toMatch(/AUDIT_APPEND_ONLY/);
  });

  it("not even the OWNER can DELETE a single event", async () => {
    const err = await ownerDenies("DELETE FROM provenance_events WHERE id = $1", [eventId]);
    expect(
      err ?? "<SUCCEEDED>",
      "the owner deleted an audit row while its organization still existed",
    ).toMatch(/AUDIT_APPEND_ONLY/);
  });
});

describe("the cascade -- the door the GRANT was not guarding", () => {
  it("app_rw cannot delete the parent organization at all", async () => {
    const err = await appDenies(ORG, "DELETE FROM organizations WHERE id = $1", [ORG]);
    expect(
      err ?? "<SUCCEEDED>",
      "app_rw deleted an organization; every event of that tenant went with it, and the REVOKE on provenance_events had no bearing on it",
    ).toMatch(/permission denied/i);
    expect(await countEvents(ORG)).toBe(1);
  });

  /**
   * ...and the trigger holds WITHOUT that grant being the thing that stops it.
   *
   * This is the assertion the whole file exists for. Removing the DELETE privilege is a
   * grant, and this project's record on grants is that they guard one door. So: hand the
   * privilege back, attack again, and require the refusal to come from the trigger. If
   * somebody later restores `GRANT ALL ... TO app_rw` in an identity migration -- which is
   * precisely how the hole appeared, 0003 grants all four verbs in a loop -- the previous
   * test goes red and THIS one stays green, which is the correct outcome: the trail is
   * still safe, and the narrower barrier is reported as missing.
   */
  it("and if the DELETE grant ever comes back, the trigger still refuses the cascade", async () => {
    await asOwner((c) => c.query("GRANT DELETE ON organizations TO app_rw"));
    try {
      const err = await appDenies(ORG, "DELETE FROM organizations WHERE id = $1", [ORG]);
      expect(
        err ?? "<SUCCEEDED>",
        "app_rw wiped the audit trail through ON DELETE CASCADE -- the referential action skips the child table's privilege check, which is exactly what makes this reachable",
      ).toMatch(/AUDIT_APPEND_ONLY/);
      expect(await countEvents(ORG)).toBe(1);
    } finally {
      await asOwner((c) => c.query("REVOKE DELETE ON organizations FROM app_rw"));
    }
  });

  /**
   * The residual hole, asserted rather than described.
   *
   * Tearing down a whole tenant is owner-side and must keep working -- `resetOrgs` is built
   * on it and so is every future retention job. Stating the limit in a comment and never
   * exercising it is how a "documented residual" turns out to have been closed by accident,
   * with the teardown path failing the first time anyone needs it.
   */
  it("the OWNER can still remove a whole tenant, and that is the only way a trail goes away", async () => {
    await seedOrg({ orgId: OTHER, projectId: `${OTHER}-proj` });
    await repo.append({
      orgId: toOrgId(OTHER),
      type: "unauthorized-attempt",
      actorId: "u-prober",
      target: { kind: "artifact", id: "art-other" },
      detail: { action: "bindToProjectStep", reasonCode: "NO_PROJECT_ROLE" },
    });
    expect(await countEvents(OTHER)).toBe(1);

    await asOwner((c) => c.query("DELETE FROM organizations WHERE id = $1", [OTHER]));
    expect(await countEvents(OTHER)).toBe(0);
    // The OTHER tenant went; this one did not. A teardown that took both would be a far
    // worse bug than the one this file closes.
    expect(await countEvents(ORG)).toBe(1);
  });
});

describe("append-only is monotonic", () => {
  /**
   * ⚠ A SUPPORTING assertion, not a barrier, and saying so matters: both helpers roll their
   * transaction back, so a count that did not move is consistent with "refused" AND with
   * "allowed, then rolled back". The barriers are the six assertions above, which read the
   * refusal itself. What this one adds is the other half -- that the table is still WRITABLE.
   * A migration that made the trail read-only would satisfy every assertion above by
   * removing the feature instead of protecting it.
   */
  it("attacks leave the row count where it was, and appending still works", async () => {
    const before = await countEvents(ORG);
    await appDenies(ORG, "UPDATE provenance_events SET actor_id = 'u-forged'");
    await appDenies(ORG, "DELETE FROM provenance_events");
    await appDenies(ORG, "DELETE FROM organizations WHERE id = $1", [ORG]);
    await ownerDenies("DELETE FROM provenance_events WHERE id = $1", [eventId]);
    await ownerDenies("UPDATE provenance_events SET type = 'bound' WHERE id = $1", [eventId]);
    expect(await countEvents(ORG)).toBe(before);

    // ...and appending still works. A table nobody can write to would satisfy every
    // assertion above while making the feature useless -- the failure mode that turns a
    // gate green by removing the behaviour instead of protecting it.
    await repo.append({
      orgId: toOrgId(ORG),
      type: "bound",
      actorId: "u-author",
      target: { kind: "artifact", id: "art-append-only" },
      detail: { mode: "live" },
    });
    expect(await countEvents(ORG)).toBe(before + 1);
  });

  it("the writer port cannot even EXPRESS a mutation", async () => {
    // Structural, and deliberately last: it is the weakest assertion here, and on its own
    // it proves only that this class is polite. It earns its place as a tripwire -- adding
    // `update()` to the repository is a design change, and it should have to delete a test.
    const methods = Object.getOwnPropertyNames(PgProvenanceRepository.prototype);
    expect(methods.filter((m) => /update|delete|remove|purge/i.test(m))).toEqual([]);
  });
});
