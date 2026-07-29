import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { provenance as P } from "@repo/contracts";
import {
  addContentItem,
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

/**
 * F03 obligation 3 -- R4 A1: an admin MAY read project content for audit, on condition
 * that every such access is recorded, the record is visible to the project lead, and the
 * admin can review their own history.
 *
 * ## What is actually at risk here
 *
 * Not "does an INSERT happen". The failure modes worth testing are the ones that leave the
 * feature looking finished:
 *
 *   * the trail is written but nobody can query it (X-2's whole point)
 *   * the trail is best-effort, so a failed write yields content with no record
 *   * the trail is mutable, so it proves nothing after the fact
 *   * `admin-project-access` is spelled one way by the writer and another by the reader
 *
 * Each has an assertion below.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const PORT = 33233;
const BASE = `http://127.0.0.1:${PORT}`;
const ORG = "org-f03-audit";
const PROJECT = "proj-f03-audit";
const ITEM = "item-f03-audit";

let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const read = (userId: string, purpose: "work" | "audit") =>
  fetch(`${BASE}/identity/content/read`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose }),
  });

const trail = (userId: string, q: Record<string, string> = {}) =>
  fetch(
    `${BASE}/provenance?${new URLSearchParams({ orgId: ORG, ...q }).toString()}`,
    { headers: as(userId) },
  );

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(PORT);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);
  // 「项目负责人」 is the ORG role `lead` in this ontology (UC-0.3 R5) -- the project roles
  // are facilitator / groupLead / member / observer. Getting this wrong would point the
  // visibility requirement at the wrong person entirely.
  await addOrgMember(ORG, "u-lead", "lead", fx.teams.energy!);
  await addOrgMember(ORG, "u-consultant", "consultant", fx.teams.energy!);
  await addContentItem({
    orgId: ORG, id: ITEM, ownerUserId: "u-lead", projectId: PROJECT,
    body: "minutes of the session",
  });
});

describe("R4 A1: an admin may read for audit, and it leaves a trail", () => {
  it("the audit read succeeds and returns a provenance event id", async () => {
    const res = await read("u-admin", "audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.body).toBe("minutes of the session");
    // Non-null means "the trail is on disk", not "we intend to write one".
    expect(typeof body.provenanceEventId).toBe("string");
  });

  it("the SAME admin reading for work is still refused -- audit is the exemption, not the default", async () => {
    const res = await read("u-admin", "work");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("ADMIN_NOT_SUPERUSER");
  });

  it("the project lead can find the access", async () => {
    await read("u-admin", "audit");
    const page = (await (
      await trail("u-lead", { targetKind: "project", targetId: PROJECT })
    ).json()) as { events: Record<string, unknown>[] };

    const access = page.events.filter((e) => e.type === "admin-project-access");
    expect(access).toHaveLength(1);
    expect(access[0]!.actorId).toBe("u-admin");
    expect((access[0]!.target as { id: string }).id).toBe(PROJECT);
    // The item is in `detail`, and the TARGET is the project: "who has been reading my
    // project" must not require the lead to first enumerate every item id.
    expect((access[0]!.detail as { itemId: string }).itemId).toBe(ITEM);
    // The response conforms to the shared contract, not to something this bundle invented.
    const parsed = P.operations.queryProvenance.out.safeParse(page);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(page)).toBeNull();
  });

  it("the admin can review their own access history", async () => {
    await read("u-admin", "audit");
    await read("u-admin", "audit");
    const page = (await (await trail("u-admin", { actorId: "u-admin" })).json()) as {
      events: unknown[];
    };
    // Two reads, two rows. One row for "the admin looked at this project at some point"
    // would make repeat access free, which is precisely what a trail is meant to price.
    expect(page.events).toHaveLength(2);
  });

  it("an ordinary consultant cannot read other people's trail", async () => {
    await read("u-admin", "audit");
    const res = await trail("u-consultant", { targetKind: "project", targetId: PROJECT });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe(
      "PROJECT_ROLE_INSUFFICIENT",
    );
  });

  it("...but can read their OWN history, which reveals nothing they did not do", async () => {
    const res = await trail("u-consultant", { actorId: "u-consultant" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { events: unknown[] }).events).toEqual([]);
  });

  it("a non-member gets 404, not an empty page", async () => {
    // An empty page is indistinguishable from "nothing to see here", and a caller outside
    // the tenant must not be told which of the two it is.
    const res = await fetch(`${BASE}/provenance?orgId=${ORG}`, {
      headers: { "x-kernel-test-principal": `u-stranger:${ORG}` },
    });
    expect(res.status).toBe(404);
  });

  it("a work-purpose read by someone with a project role leaves NO trail", async () => {
    await addProjectMember(ORG, PROJECT, "u-lead", "facilitator", null);
    await read("u-lead", "work");
    const page = (await (
      await trail("u-lead", { targetKind: "project", targetId: PROJECT })
    ).json()) as { events: unknown[] };
    // A trail that records ordinary work is a trail nobody reads, and then the admin
    // accesses hide in the noise.
    expect(page.events).toEqual([]);
  });
});

describe("append-only is enforced by the database, not by the code that writes", () => {
  it("the runtime role cannot UPDATE the trail", async () => {
    await read("u-admin", "audit");
    await expect(
      asApp(ORG, (c) => c.query("UPDATE provenance_events SET actor_id = 'someone-else'")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the runtime role cannot DELETE from the trail", async () => {
    await read("u-admin", "audit");
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM provenance_events")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("...and CAN still insert and select, so the grant is a boundary and not a lockout", async () => {
    await read("u-admin", "audit");
    const n = await asApp(ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM provenance_events"),
    );
    expect(Number(n.rows[0]!.n)).toBe(1);
  });
});

describe("the trail is a precondition of the read, not an epilogue", () => {
  it("an audit read whose trail cannot be persisted returns NO content", async () => {
    // The tempting implementation order is read, return, log -- and it is wrong: any
    // failure after the return produces an access with no record, and nothing reports it.
    // R4 A1 permits the read BECAUSE it is recorded, so a lost record has to cost the read.
    //
    // The failure is injected at the only place it can be: the grant. Wrapping the writer
    // in a mock would test a mock; taking INSERT away tests the real path.
    await asOwner((c) => c.query("REVOKE INSERT ON provenance_events FROM app_rw"));
    try {
      const res = await read("u-admin", "audit");
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain("minutes of the session");
    } finally {
      await asOwner((c) => c.query("GRANT INSERT ON provenance_events TO app_rw"));
    }
    // Restored: the next test in this file would otherwise fail for the wrong reason, and
    // a fixture that leaks state is how a suite starts depending on its own order.
    expect((await read("u-admin", "audit")).status).toBe(200);
  });
});

describe("the event vocabulary has one source", () => {
  it("the database CHECK enumerates exactly the contract's event types", async () => {
    // The SQL constraint is a copy of `ProvenanceEventType`, and this project has drifted
    // six times from copies. So the copy is reconciled mechanically: add a type to the
    // contract and forget the migration, and this fails naming the missing value.
    const def = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'provenance_events' AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) LIKE '%admin-project-access%'`,
      );
      return r.rows[0]?.def ?? "";
    });
    expect(def).not.toBe("");
    const inSql = [...def.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!).sort();
    expect(inSql).toEqual([...P.ProvenanceEventType.options].sort());
  });

  it("an event type outside the enum is rejected at the database", async () => {
    // Proves the CHECK above is live rather than merely present.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO provenance_events (org_id, type, actor_id, target_kind, target_id)
           VALUES ($1, 'admin-had-a-look', 'u-admin', 'project', $2)`,
          [ORG, PROJECT],
        ),
      ),
    ).rejects.toThrow(/provenance_events_type_check|violates check constraint/i);
  });
});
