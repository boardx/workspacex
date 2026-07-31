/**
 * ADR-101 -- the two closed provenance enums have ONE source, and it is checked BOTH ways.
 *
 * ## Why this file exists at all
 *
 * `packages/contracts/src/provenance.ts` declares two closed enums; migration 0005 (as amended
 * by 0027) declares the SAME two as SQL CHECKs. That is a copy, and this repository has
 * drifted from copies six times. `admin-audit-access-visible-to-lead.test.ts` already
 * reconciles the `type` one; nothing reconciled `target_kind`, which is exactly the enum F80
 * reported as missing a member -- i.e. the ungated one is the one that was already wrong.
 *
 * ## The assertions are DIRECTIONAL, and both directions are here
 *
 * A single `toEqual` would do it, but it is one assertion whose failure message says
 * "arrays differ" and leaves the reader to diff two twenty-element lists. Worse, the tempting
 * cheap version -- `expect(inSql).toHaveLength(contract.length)` -- is satisfied by any
 * mismatch that happens to swap one member for another, which is precisely how a RENAME slips
 * through. So:
 *
 *   * contract -> SQL: every contract member is accepted by the CHECK
 *                      (a member added to the contract and forgotten in the migration writes
 *                       nothing at runtime -- the audit event simply fails to insert)
 *   * SQL -> contract: every CHECK value is a contract member
 *                      (a value the database accepts but the contract does not know is a row
 *                       nobody can parse back out, so `queryProvenance` throws on read)
 *
 * Neither direction implies the other, and the two failures look nothing alike in production.
 *
 * ## ⚠ This is not vacuous, and that is asserted too
 *
 * A regex that matched nothing would make both directions pass over empty sets. So the
 * extracted sets are required to contain the members ADR-101 actually added -- which is also
 * the assertion that goes red if a human REJECTS ADR-101 and the members are rolled back
 * without this file being updated.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { provenance as P } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f32-provenum";
const PROJECT = "proj-f32-provenum";

/** Pull a CHECK's quoted literals straight out of pg_catalog. */
async function checkValues(constraintName: string): Promise<string[]> {
  const def = await asOwner(async (c) =>
    (await c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
        WHERE t.relname = 'provenance_events' AND con.conname = $1`,
      [constraintName],
    )).rows[0]?.def ?? "",
  );
  expect(def, `constraint ${constraintName} does not exist`).not.toBe("");
  return [...def.matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]!).sort();
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
});

afterAll(async () => {
  await resetOrgs(ORG);
});

describe("provenance_events.type <-> provenance.ProvenanceEventType", () => {
  it("contract -> SQL: the CHECK accepts every member the contract declares", async () => {
    const inSql = new Set(await checkValues("provenance_events_type_check"));
    const missing = P.ProvenanceEventType.options.filter((t) => !inSql.has(t));
    // A member added to the contract and forgotten in the migration does not fail loudly --
    // the audit INSERT is simply refused at write time, i.e. exactly when it matters.
    expect(missing, `declared in the contract, rejected by the database: ${missing.join(", ")}`).toEqual([]);
  });

  it("SQL -> contract: every value the CHECK accepts is a contract member", async () => {
    const inSql = await checkValues("provenance_events_type_check");
    const extra = inSql.filter((t) => !P.ProvenanceEventType.safeParse(t).success);
    // A value the database accepts but the contract does not know is a row that cannot be
    // parsed back out -- it is written, and then `queryProvenance` throws on it.
    expect(extra, `accepted by the database, unknown to the contract: ${extra.join(", ")}`).toEqual([]);
  });

  it("NON-VACUITY: the extracted set really contains ADR-101's additions", async () => {
    const inSql = new Set(await checkValues("provenance_events_type_check"));
    // If the regex matched nothing, both directions above would pass over empty sets.
    // These eight are also the assertion that goes red if ADR-101 is REJECTED and rolled back
    // (the two directional checks above would stay green through a rollback -- they only say
    // the two sides AGREE, and a rollback that touches both sides agrees perfectly).
    for (const t of [
      "downloaded",                                                            // F32 · files
      "project-created", "project-archived", "project-unarchived",             // 代 F117 · project
      "agenda-segment-state-changed",
      "thread-created", "thread-renamed", "thread-deleted",                    // 代 F109 · chat
    ]) {
      expect(inSql, `ADR-101 member "${t}" is not in the CHECK`).toContain(t);
      expect(P.ProvenanceEventType.safeParse(t).success, t).toBe(true);
    }
    expect(inSql.size).toBeGreaterThan(15);
  });
});

describe("provenance_events.target_kind <-> provenance.ProvenanceTargetKind", () => {
  it("contract -> SQL: the CHECK accepts every target kind the contract declares", async () => {
    const inSql = new Set(await checkValues("provenance_events_target_kind_check"));
    const missing = P.ProvenanceTargetKind.options.filter((t) => !inSql.has(t));
    expect(missing, `declared in the contract, rejected by the database: ${missing.join(", ")}`).toEqual([]);
  });

  it("SQL -> contract: every target kind the CHECK accepts is a contract member", async () => {
    const inSql = await checkValues("provenance_events_target_kind_check");
    const extra = inSql.filter((t) => !P.ProvenanceTargetKind.safeParse(t).success);
    expect(extra, `accepted by the database, unknown to the contract: ${extra.join(", ")}`).toEqual([]);
  });

  it("NON-VACUITY: `interview` (F80) and `thread` (F109) are on both sides", async () => {
    const inSql = new Set(await checkValues("provenance_events_target_kind_check"));
    // Without it, `queryProvenance` (which filters only by target) cannot answer
    // 「这一场访谈被谁探过」 -- F80 had to record target as `organization` and bury the
    // interviewId in `detail`. See get-interview.ts's header.
    expect(inSql).toContain("interview");
    expect(P.ProvenanceTargetKind.safeParse("interview").success).toBe(true);
    // ...and `thread` (F109), for the same reason: 「这条线程发生过什么」 is what delete
    // traceability has to answer, and F109 could only record target as `project`.
    expect(inSql).toContain("thread");
    expect(P.ProvenanceTargetKind.safeParse("thread").success).toBe(true);
  });
});

describe("the target-kind list has ONE declaration site in the contract too", () => {
  it("`queryProvenance.in.targetKind` and `ProvenanceEvent.target.kind` are the same enum", () => {
    /**
     * They used to be two hand-written copies of one list, which is a live hazard rather than
     * an aesthetic one: `queryProvenance` can only filter by target, so a drift between the
     * two shows up as 「某类事件写得进去、查不出来」 -- and each side reads as self-consistent.
     * ADR-101 collapsed them into `ProvenanceTargetKind`; this pins that.
     */
    const onEvent = P.ProvenanceEvent.shape.target.shape.kind.options as readonly string[];
    const onQuery = P.operations.queryProvenance.in.shape.targetKind.unwrap().options as readonly string[];
    expect([...onEvent].sort()).toEqual([...onQuery].sort());
    expect([...onEvent].sort()).toEqual([...P.ProvenanceTargetKind.options].sort());
  });
});

describe("🔴 ADR-101 decision B is UNRULED -- the target dimension hole, pinned open", () => {
  it("`queryProvenance` still cannot filter by project, so 「本项目下的某类审计」 has no column", () => {
    /**
     * Adding the enum members does NOT close this. `queryProvenance.in` filters by
     * `(targetKind, targetId)` and nothing else -- no join, no `detail` predicate. So the
     * moment a target becomes a concrete object (`interview` / `thread` / an artifact
     * version), 「列出本项目下的全部对话审计」 loses its column: `projectId` lives only inside
     * `detail`, which is `z.record(z.unknown())`.
     *
     * ⇒ Four features will each stash a `projectId` in their own `detail` as a workaround.
     *   That is the fourth, fifth and sixth declaration of one fact -- the failure AGENTS.md
     *   names and this repository has hit nine times.
     *
     * This assertion is a TRIPWIRE, not a preference. ADR-101 lists three ways out and rules
     * none of them; when a human picks A (a filterable project dimension), this goes red and
     * sends them to the ADR rather than letting the workaround quietly become the design.
     */
    const filters = Object.keys(P.operations.queryProvenance.in.shape).sort();
    expect(filters).toEqual([
      "actorId", "cursor", "limit", "orgId", "since", "targetId", "targetKind", "types", "until",
    ]);
    // Specifically: no project dimension, and `detail` is not among the filters at all.
    expect(filters).not.toContain("projectId");
    expect(filters).not.toContain("detail");
    // ...and `detail` on the event really is an unindexable open bag, which is why stashing
    // the id there is a workaround rather than a fix.
    expect(P.ProvenanceEvent.shape.detail.safeParse({ anything: 1, at: "all" }).success).toBe(true);
  });
});

describe("the CHECKs are LIVE, not merely present", () => {
  it("a near-miss spelling of an ADR-101 member is refused at the database", async () => {
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO provenance_events (org_id, type, actor_id, target_kind, target_id)
           VALUES ($1, 'download', 'u-x', 'artifact-version', 'v-1')`,
          [ORG],
        ),
      ),
      // `download` vs `downloaded` -- the shape a rename takes.
    ).rejects.toThrow(/provenance_events_type_check|violates check constraint/i);
  });

  it("a target kind outside the enum is refused at the database", async () => {
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO provenance_events (org_id, type, actor_id, target_kind, target_id)
           VALUES ($1, 'downloaded', 'u-x', 'interviews', 'i-1')`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/provenance_events_target_kind_check|violates check constraint/i);
  });

  it("...and the correct spellings DO insert -- refusal and paralysis are distinguishable", async () => {
    // Without this, a CHECK that refused everything would satisfy both tests above.
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO provenance_events (org_id, type, actor_id, target_kind, target_id)
         VALUES ($1, 'downloaded', 'u-x', 'interview', 'i-1')`,
        [ORG],
      ),
    );
    const n = await asApp(ORG, async (c) =>
      Number((await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM provenance_events WHERE org_id = $1 AND target_kind = 'interview'",
        [ORG],
      )).rows[0]!.n));
    expect(n).toBe(1);
  });
});
