/**
 * F16 -- "本地组织对任何他人不可见，包括组织管理员与平台运营".
 *
 * ## This is a STRONGER claim than UC-0.3 R7, and the difference is the audit door
 *
 * R7 says an administrator cannot see the CONTENT of somebody's personal layer, but keeps one
 * door open: `purpose: "audit"` reads are allowed and are recorded (R5 A1). F16's notes state
 * that this door does NOT apply to a personal-local organization -- the data is not merely
 * screened from the administrator, it belongs to an organization they are not in.
 *
 * So the audit purpose is exercised here explicitly. A test that only tried the ordinary read
 * path would pass while the one deliberate exception was wide open.
 *
 * ## The storage layer is asserted from the catalog, not from a list
 *
 * `kernel_tenant_table_audit()` (migration 0004) derives which tables carry tenant data from
 * pg_catalog. Walking THAT is what makes "no table leaks the local organization" survive a
 * table added next month -- a hand-written list is missing exactly the table somebody just
 * created, which is the one nobody has thought about yet.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  addContentItem, addOrgMember, addSegment, asApp, asOwner, ensureDatabase, migrateOnce,
  resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const LOCAL_ORG = "org-f16-hidden";
const REAL_ORG = "org-f16-watchers";
const OWNER = "u-f16-hidden-owner";
const ADMIN = "u-f16-hidden-admin";
const COMPLIANCE = "u-f16-hidden-compliance";
const PRIVATE_ITEM = "item-f16-private";

let BASE: string;
let app: NestExpressApplication;

const authFor = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(LOCAL_ORG, REAL_ORG);
});

beforeEach(async () => {
  await resetOrgs(LOCAL_ORG, REAL_ORG);
  await seedOrg({ orgId: LOCAL_ORG, kind: "personal-local", ownerUserId: OWNER, projectId: `${LOCAL_ORG}-p` });
  await seedOrg({ orgId: REAL_ORG, projectId: `${REAL_ORG}-p` });
  await addOrgMember(LOCAL_ORG, OWNER, "admin", null);
  // The two most privileged roles in the product, in a DIFFERENT organization. Both are
  // members of the same real organization the owner also belongs to, so "they have no
  // relationship" is not what is doing the work here.
  await addOrgMember(REAL_ORG, ADMIN, "admin", null);
  await addOrgMember(REAL_ORG, COMPLIANCE, "compliance", null);
  await addOrgMember(REAL_ORG, OWNER, "consultant", null);

  await addContentItem({
    orgId: LOCAL_ORG, id: PRIVATE_ITEM, ownerUserId: OWNER,
    body: "the most private thing this person owns", layer: "personal",
  });
  await addSegment({ orgId: LOCAL_ORG, segmentId: "seg-f16-private", artifactId: "art-f16-private" });
});

/* ─────────────────── the storage layer: nothing crosses, table by table ─────────────────── */

describe("no tenant table leaks the local organization to another tenant", () => {
  it("every catalog-derived tenant table returns zero local-org rows under another tenant's context", async () => {
    // Tables come from the catalog, not from a list here: a table added next month is in
    // scope without anyone remembering to add it, which is the only version of this check
    // that keeps working.
    const tables = await asOwner((c) =>
      c.query<{ table_name: string }>(
        "SELECT table_name FROM kernel_tenant_table_audit() WHERE verdict = 'ok'",
      ),
    );
    expect(tables.rows.length, "the audit found no tenant tables -- this test would be idle")
      .toBeGreaterThan(8);

    for (const { table_name } of tables.rows) {
      // `organizations` keys off `id`; everything else off `org_id`.
      const col = table_name === "organizations" ? "id" : "org_id";
      const n = await asApp(REAL_ORG, (c) =>
        c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table_name} WHERE ${col} = $1`,
          [LOCAL_ORG],
        ),
      );
      expect(n.rows[0]?.n, `${table_name} leaked local-org rows to ${REAL_ORG}`).toBe("0");
    }
  });

  it("counter-proof: the owner's own tenant context DOES see them", async () => {
    // Without this, the assertion above is satisfied by a database in which the rows do not
    // exist at all -- and a local organization whose data was never written is not private,
    // it is missing.
    const n = await asApp(LOCAL_ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM content_items WHERE org_id = $1", [LOCAL_ORG]),
    );
    expect(Number(n.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("the local organization's objects live under the local-only key prefix, and only its objects do", async () => {
    // Guarantee 3, as an addressable fact: `local/<orgId>/` is the set of bytes that may not
    // leave the machine, and the trigger keeps both directions true.
    const keys = await asApp(LOCAL_ORG, (c) =>
      c.query<{ object_storage_key: string }>(
        "SELECT object_storage_key FROM artifact_versions WHERE org_id = $1", [LOCAL_ORG],
      ),
    );
    expect(keys.rows.length).toBeGreaterThan(0);
    for (const k of keys.rows) {
      expect(k.object_storage_key.startsWith(C.localObjectKeyPrefix(LOCAL_ORG))).toBe(true);
    }

    // COUNTER-PROOF a: a local-org version written OUTSIDE the prefix is refused.
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query(
          `INSERT INTO artifact_versions
             (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime, size_bytes, pinned_by)
           VALUES ($1,$2,'art-f16-private',9,$3,$4,'application/octet-stream',1,'u-seed')`,
          [`v-f16-escape`, LOCAL_ORG, `${LOCAL_ORG}/artifacts/escaped`, "0".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/no-shared-storage/);

    // COUNTER-PROOF b: a REAL organization writing INTO the prefix is refused too. Without
    // this half the prefix would stop being a reliable answer to "is this object one of the
    // protected ones".
    await asApp(REAL_ORG, (c) =>
      c.query(
        `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
         VALUES ($1,$2,NULL,'upload','squatter','u-seed',false)`,
        [`art-f16-squat`, REAL_ORG],
      ),
    );
    await expect(
      asApp(REAL_ORG, (c) =>
        c.query(
          `INSERT INTO artifact_versions
             (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime, size_bytes, pinned_by)
           VALUES ($1,$2,'art-f16-squat',1,$3,$4,'application/octet-stream',1,'u-seed')`,
          [`v-f16-squat`, REAL_ORG, `local/${LOCAL_ORG}/artifacts/stolen`, "1".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/local-only prefix/);
  });
});

/* ─────────────────── the API layer: no route answers for a stranger ─────────────────── */

describe("no route hands a local organization to anybody but its owner", () => {
  it("an org admin reading a local-org item gets 404 -- existence is not disclosed", async () => {
    const r = await fetch(`${BASE}/identity/content/read`, {
      method: "POST",
      headers: { ...authFor(ADMIN, LOCAL_ORG), "content-type": "application/json" },
      body: JSON.stringify({
        orgId: LOCAL_ORG, projectId: `${LOCAL_ORG}-p`, itemId: PRIVATE_ITEM, purpose: "work",
      }),
    });
    // 404, not 403: a 403 would confirm that this organization and this item exist.
    expect(r.status).toBe(404);
  });

  it("...and the AUDIT purpose does not open the door either", async () => {
    // The one deliberate exception in UC-0.3 R5 A1 -- an administrator may read personal-layer
    // content for a stated audit purpose, with a provenance row. F16's notes say that door
    // does not reach a personal-local organization, because the claim here is not "screened
    // from you" but "not in your organization at all".
    const r = await fetch(`${BASE}/identity/content/read`, {
      method: "POST",
      headers: { ...authFor(ADMIN, LOCAL_ORG), "content-type": "application/json" },
      body: JSON.stringify({
        orgId: LOCAL_ORG, projectId: `${LOCAL_ORG}-p`, itemId: PRIVATE_ITEM, purpose: "audit",
      }),
    });
    expect(r.status).toBe(404);

    // ...and no audit trail was written, because nothing was read. A provenance row here
    // would mean the read happened and only the response was withheld.
    const events = await asApp(LOCAL_ORG, (c) =>
      c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM provenance_events WHERE org_id = $1 AND actor_id = $2",
        [LOCAL_ORG, ADMIN],
      ),
    );
    expect(events.rows[0]?.n).toBe("0");
  });

  it("compliance -- the role that reads everything -- is refused as well", async () => {
    const r = await fetch(
      `${BASE}/identity/personal-layer/summary?orgId=${LOCAL_ORG}&userId=${OWNER}`,
      { headers: authFor(COMPLIANCE, LOCAL_ORG) },
    );
    // Not even the COUNT. In a real organization a count is what an admin legitimately gets
    // (I-8); here the organization itself is not theirs to enumerate.
    expect(r.status).toBe(404);
  });

  it("/identity/me refuses too -- membership is what fails, and it fails closed", async () => {
    const r = await fetch(`${BASE}/identity/me?orgId=${LOCAL_ORG}`, {
      headers: authFor(ADMIN, LOCAL_ORG),
    });
    expect(r.status).toBe(404);
  });

  it("counter-proof: the OWNER can read their own item -- this is isolation, not a dead org", async () => {
    // The assertions above are all satisfied by an organization nothing can read. This is the
    // one that says the data is there and reachable by exactly one person.
    const r = await fetch(`${BASE}/identity/content/read`, {
      method: "POST",
      headers: { ...authFor(OWNER, LOCAL_ORG), "content-type": "application/json" },
      body: JSON.stringify({
        orgId: LOCAL_ORG, projectId: `${LOCAL_ORG}-p`, itemId: PRIVATE_ITEM, purpose: "work",
      }),
    });
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await r.json()) as { body: string }).toMatchObject({
      body: "the most private thing this person owns",
    });
  });

  it("GET /identity/local-org cannot be pointed at somebody else's", async () => {
    // The route takes no organization parameter at all (contract: `in` is an empty object).
    // Supplying one anyway must change nothing -- otherwise a future handler that started
    // reading the query string would silently become a lookup by id.
    const r = await fetch(`${BASE}/identity/local-org?orgId=${LOCAL_ORG}&userId=${OWNER}`, {
      headers: authFor(ADMIN, REAL_ORG),
    });
    expect(r.status).toBe(404);

    const own = await fetch(`${BASE}/identity/local-org`, { headers: authFor(OWNER, LOCAL_ORG) });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { org: { id: string } }).org.id).toBe(LOCAL_ORG);
  });

  it("the contract has no operation that takes an organization id AND returns a local org", () => {
    // Structural, because the risk is a future endpoint rather than today's code: the moment
    // some admin console needs "show me this user's local organization", the shape it would
    // need is an org-id or user-id parameter on this operation. There is none, by design.
    expect(Object.keys(C.operations.getLocalOrg.in.shape)).toEqual([]);
  });
});

/* ─────────────────── the single-source rule for the judgement itself ─────────────────── */

describe("the local-org judgement exists exactly once in the backend", () => {
  it("no backend source compares against the literal kind string", async () => {
    // Five previous drifts in this project came from the same fact living in two places. This
    // one decides whether data leaves a machine, so the literal is allowed in exactly one
    // file -- the contract -- and everything else calls `isLocalOrgKind` / `isLocalOrg`.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const SRC = fileURLToPath(new URL("../../src", import.meta.url));

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
      }
      return out;
    };

    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // comments explain the rule, not break it
        if (/["']personal-local["']/.test(line)) offenders.push(`${relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `these compare against the literal instead of calling isLocalOrg():\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);

    // Non-vacuity: the scan really read the backend.
    expect(walk(SRC).length).toBeGreaterThan(50);
  });

  it("the contract's predicate and the constant agree, and reject everything else", () => {
    expect(C.isLocalOrgKind(C.LOCAL_ORG_KIND)).toBe(true);
    expect(C.isLocalOrgKind("organization")).toBe(false);
    expect(C.isLocalOrgKind("Personal-Local")).toBe(false);
    expect(C.isLocalOrgKind(null)).toBe(false);
  });
});
