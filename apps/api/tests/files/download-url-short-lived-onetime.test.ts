/**
 * F32 -- 短时效 · 一次性 · 绑定 principal · 写审计, each with its REVERSE assertion.
 *
 * ## The four properties and the failure each one is about
 *
 *   1. **短时效**   the same link, after `expiresAt`, fails -- `DOWNLOAD_URL_EXPIRED`
 *   2. **一次性**   the same link, used twice, fails -- `DOWNLOAD_URL_CONSUMED`
 *   3. **不可转发** the same link, redeemed by anyone else, fails -- and says nothing about
 *                   whether the link is real (a forwarded link must gain the holder nothing,
 *                   including information)
 *   4. **写审计**   after a download there is a record of 谁 / 什么时候 / 下了哪个, and it
 *                   cannot be missing while the download succeeded
 *
 * ## 🔴 The one assertion that separates this file from theatre
 *
 * (2) is asserted CONCURRENTLY. A sequential 「用两次，第二次报错」 test passes for the broken
 * implementation as well as the correct one:
 *
 *     SELECT ... WHERE token_hash = $1;         -- 还没用过吧？
 *     if (row.consumed_at !== null) throw ...;  -- application decides
 *     UPDATE ... SET consumed_at = now() ...;
 *
 * That shape is green sequentially and stops nobody in production: two requests both read
 * NULL, both pass the check, both update, both download -- silently, no exception, nothing in
 * the logs. F15's agent found exactly this in the invite redemption path. So the assertion is
 * `Promise.all` of two redemptions with a required 1-winner / 1-loser split, which only the
 * single-statement WHERE can satisfy.
 *
 * ⚠ Counter-proof performed and recorded on the issue: removing `AND consumed_at IS NULL` from
 *   `pg-download-grant-repository.ts` turns the concurrency test red (2 winners). Removing the
 *   audit `expect` turns the audit test red. Both were run and restored.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { files as C } from "@repo/contracts";
import {
  addBinding, addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce,
  resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDownloadGrantRepository } from "../../src/infrastructure/files/pg-download-grant-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { IsolatedDownloadUrlBuilder } from "../../src/infrastructure/files/isolated-download-url-builder";
import {
  FilesDeliveryError, issueDownloadUrl, redeemDownloadUrl, type DeliveryDeps,
} from "../../src/application/files/deliver-artifact";
import {
  DOWNLOAD_URL_TTL_SECONDS, hashDownloadToken,
} from "../../src/domain/files/download-grant";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f32-dl";
const OTHER = "org-f32-dl-other";
const PROJECT = "proj-f32-dl";

class SeqIds {
  private n = 0;
  next(): string { return `dec-${++this.n}`; }
}
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${++this.n}`; }
}
const STORE_UP = { available: async () => true };
/**
 * F34: every fixture's `content_hash` is the all-zero placeholder `addBrowserArtifact` writes
 * (a syntactically valid SHA-256 the fixture never actually hashes bytes against). A fake
 * that always answers "ok" keeps this file about F32's concerns -- expiry / one-time /
 * unforwardable / audited -- rather than re-deriving F34's integrity check here too.
 */
const INTEGRITY_OK = { verify: async () => "ok" as const };

let db: PgDatabase;
let deps: DeliveryDeps;
let teams: Record<string, string>;
/** Moves when a test needs the clock somewhere else. Injected, so nothing sleeps. */
let clock = new Date();

const v = (artifactId: string): string => `${artifactId}-v1`;

const issue = (userId: string, versionId = v("f32dl-open"), purpose: "download" | "export" = "download") =>
  issueDownloadUrl(deps, { userId, orgId: toOrgId(ORG), versionId, purpose });

/** The URL carries the raw token; the redeeming route hashes it. Same path as the controller. */
const tokenOf = (url: string): string => decodeURIComponent(url.split("/").pop()!);

const redeem = (userId: string, url: string, orgId = ORG) =>
  redeemDownloadUrl(deps, { userId, orgId: toOrgId(orgId), tokenHash: hashDownloadToken(tokenOf(url)) });

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e, "expected a FilesDeliveryError, got success").toBeInstanceOf(FilesDeliveryError);
  return (e as FilesDeliveryError).reasonCode;
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, OTHER);

  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy", "platform"] });
  teams = fixture.teams;

  await addOrgMember(ORG, "u-fac", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-colleague", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-outsider", "consultant", teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "u-colleague", "member", null);
  await addProjectMember(ORG, PROJECT, "u-outsider", "member", null);

  await addBrowserArtifact({
    orgId: ORG, id: "f32dl-open", projectId: PROJECT, title: "open deck", mime: "application/pdf",
  });
  await addBrowserArtifact({
    orgId: ORG, id: "f32dl-teamonly", projectId: PROJECT, title: "energy only deck",
    mime: "application/pdf",
  });
  await addBinding({
    orgId: ORG,
    subject: { kind: "team", id: teams.energy! },
    object: { kind: "artifact", id: "f32dl-teamonly" },
    scope: "team-only",
    ownerTeamId: teams.energy!,
  });

  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    grants: new PgDownloadGrantRepository(db),
    objectStore: STORE_UP,
    integrity: INTEGRITY_OK,
    urls: new IsolatedDownloadUrlBuilder(),
    provenance: new PgProvenanceRepository(db),
    idFactory: new SeqRowIds(),
    now: () => clock,
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG, OTHER);
});

describe("issuing", () => {
  it("returns the contract shape, and `oneTime` has no other possible value", async () => {
    clock = new Date();
    const r = await issue("u-fac");
    const parsed = C.operations.issueDownloadUrl.out.safeParse(r);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r)).toBeNull();
    expect(r.oneTime).toBe(true);
    // `z.literal(true)`: the contract has no value for a reusable link. Asserted rather than
    // assumed, because `oneTime: false` passing here would mean the schema is not the literal.
    expect(C.operations.issueDownloadUrl.out.safeParse({ ...r, oneTime: false }).success).toBe(false);
    // ...and drift is rejected in the other direction too.
    expect(C.operations.issueDownloadUrl.out.safeParse({ ...r, forwardable: true }).success).toBe(false);
  });

  it("the URL is on an ISOLATED origin, not the API's own", async () => {
    // 「未知类型一律 attachment + 隔离域名，不在主域内联渲染」. A default of "the API host"
    // would make local development pass through the exact configuration that is the
    // vulnerability in production.
    const r = await issue("u-fac");
    expect(new URL(r.url).host).not.toBe("localhost:3200");
    expect(r.url).toMatch(/\/downloads\//);
  });

  it("expiry is SHORT and comes from one place", async () => {
    clock = new Date("2026-08-01T10:00:00.000Z");
    const r = await issue("u-fac");
    expect(new Date(r.expiresAt).getTime() - clock.getTime()).toBe(DOWNLOAD_URL_TTL_SECONDS * 1000);
    // Non-vacuity for 「短时效」: a TTL of a day would satisfy "expiresAt is in the future".
    expect(DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
    clock = new Date();
  });

  it("`permissionDecisionId` points back at the decision that allowed it", async () => {
    const r = await issue("u-fac");
    const stored = await asApp(ORG, async (c) =>
      (await c.query<{ permission_decision_id: string; principal_user_id: string }>(
        "SELECT permission_decision_id, principal_user_id FROM download_grants WHERE token_hash = $1",
        [hashDownloadToken(tokenOf(r.url))],
      )).rows[0]!,
    );
    expect(stored.permission_decision_id).toBe(r.permissionDecisionId);
    // 绑定 principal, in the row rather than only in the comment.
    expect(stored.principal_user_id).toBe("u-fac");
  });

  it("🔴 the RAW token is never stored -- only its hash", async () => {
    const r = await issue("u-fac");
    const raw = tokenOf(r.url);
    const hits = await asOwner(async (c) =>
      (await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM download_grants WHERE token_hash = $1",
        [raw],
      )).rows[0]!.n,
    );
    // A bearer credential for bytes. With raw tokens in a column, anyone who can read a backup
    // can download every file whose link has not expired.
    expect(Number(hits)).toBe(0);
    expect(hashDownloadToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a version the requester may not see yields no link, and says nothing about why", async () => {
    expect(await codeOf(issue("u-outsider", v("f32dl-teamonly")))).toBe("ARTIFACT_NOT_FOUND");
    expect(await codeOf(issue("u-outsider", "no-such-version"))).toBe("ARTIFACT_NOT_FOUND");
    // The other half: someone who MAY see it gets a link. Otherwise the assertion above is
    // satisfied by an implementation that refuses everybody.
    expect((await issue("u-fac", v("f32dl-teamonly"))).oneTime).toBe(true);
  });

  it("an unreachable object store refuses to mint a link instead of minting a dead one", async () => {
    const down: DeliveryDeps = { ...deps, objectStore: { available: async () => false } };
    const code = await codeOf(
      issueDownloadUrl(down, {
        userId: "u-fac", orgId: toOrgId(ORG), versionId: v("f32dl-open"), purpose: "download",
      }),
    );
    // V7·22-1: a degraded download SAYS SO rather than behaving like a broken one.
    expect(code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});

describe("① 短时效 -- the same link, after expiry, fails", () => {
  it("a link that worked at issue time fails once the clock passes expiresAt", async () => {
    clock = new Date("2026-08-01T12:00:00.000Z");
    const r = await issue("u-fac");
    // The grant's expiry is a stored timestamp and PostgreSQL compares it against ITS OWN
    // now() -- so the test moves the stored value, not the process clock. Writing it as
    // "wait two minutes" would make this test take two minutes and prove the same thing.
    await asOwner((c) =>
      c.query("UPDATE download_grants SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
        [hashDownloadToken(tokenOf(r.url))]),
    );
    expect(await codeOf(redeem("u-fac", r.url))).toBe("DOWNLOAD_URL_EXPIRED");
    clock = new Date();
  });

  it("...and an unexpired link from the same code path DOES work", async () => {
    // Without this, an implementation that refused every redemption would pass the test above.
    const r = await issue("u-fac");
    const got = await redeem("u-fac", r.url);
    expect(got.versionId).toBe(v("f32dl-open"));
  });
});

describe("② 一次性 -- the same link, used twice, fails", () => {
  it("the second sequential redemption is refused with DOWNLOAD_URL_CONSUMED", async () => {
    const r = await issue("u-fac");
    const first = await redeem("u-fac", r.url);
    expect(first.objectKey).toContain("f32dl-open");
    expect(await codeOf(redeem("u-fac", r.url))).toBe("DOWNLOAD_URL_CONSUMED");
  });

  /**
   * 🔴 The assertion the sequential one cannot make.
   *
   * A read-then-write implementation passes the test above and fails this one: both callers
   * read `consumed_at IS NULL`, both pass the check, both update, both download -- with no
   * exception anywhere. The single UPDATE survives it because PostgreSQL takes a row lock and
   * RE-EVALUATES the WHERE after the first transaction commits.
   *
   * ⚠ Counter-proof run: deleting `AND consumed_at IS NULL` from the repository's UPDATE makes
   *   this test report 2 winners. Restored afterwards.
   */
  it("🔴 CONCURRENT: two simultaneous redemptions produce exactly one winner", async () => {
    const r = await issue("u-fac");
    const results = await Promise.all([
      redeem("u-fac", r.url).then(() => "won" as const).catch((e: unknown) => e as FilesDeliveryError),
      redeem("u-fac", r.url).then(() => "won" as const).catch((e: unknown) => e as FilesDeliveryError),
    ]);
    const winners = results.filter((x) => x === "won");
    const losers = results.filter((x) => x !== "won") as FilesDeliveryError[];
    expect(winners, `two callers got the same one-time link: ${JSON.stringify(results)}`).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reasonCode).toBe("DOWNLOAD_URL_CONSUMED");
  });

  it("the consumed row records WHO used it, atomically with the fact that it was used", async () => {
    const r = await issue("u-fac");
    await redeem("u-fac", r.url);
    const row = await asApp(ORG, async (c) =>
      (await c.query<{ consumed_at: Date | null; consumed_by: string | null }>(
        "SELECT consumed_at, consumed_by FROM download_grants WHERE token_hash = $1",
        [hashDownloadToken(tokenOf(r.url))],
      )).rows[0]!,
    );
    // Half of this pair missing is the state in which 「这枚链接是谁用掉的」 has no answer.
    expect(row.consumed_at).not.toBeNull();
    expect(row.consumed_by).toBe("u-fac");
  });

  it("the database itself refuses a row with only half of the consumed pair", async () => {
    // The CHECK is the guarantee; the writing code is only the convenient path.
    await expect(
      asOwner((c) =>
        c.query(
          `UPDATE download_grants SET consumed_at = now(), consumed_by = NULL
            WHERE token_hash = $1`,
          [hashDownloadToken("nothing")],
        ).then(() =>
          c.query(
            `INSERT INTO download_grants
               (id, org_id, artifact_id, version_id, object_key, principal_user_id,
                permission_decision_id, purpose, token_hash, expires_at, consumed_at, consumed_by)
             VALUES ('bad', $1, 'a', 'b', 'k', 'u', 'd', 'download', $2, now(), now(), NULL)`,
            [ORG, "f".repeat(64)],
          )),
      ),
    ).rejects.toThrow(/download_grants_consumed_is_atomic|violates check constraint/i);
  });
});

describe("③ 不可转发 -- the link is bound to the principal it was issued to", () => {
  it("a colleague holding the very same URL cannot redeem it", async () => {
    const r = await issue("u-fac");
    // Short-lived + one-time ALONE would let this succeed: the link is fresh and unused. What
    // stops it is `principal_user_id = $` in the same WHERE.
    expect(await codeOf(redeem("u-colleague", r.url))).toBe("ARTIFACT_NOT_FOUND");
    // ...and the failed attempt did not burn it, so the rightful owner is not denied service
    // by anybody who gets hold of the URL.
    expect((await redeem("u-fac", r.url)).versionId).toBe(v("f32dl-open"));
  });

  it("the refusal for a forwarded link is the same one as for a link that never existed", async () => {
    const r = await issue("u-fac");
    const forwarded = await codeOf(redeem("u-colleague", r.url));
    const fabricated = await codeOf(redeem("u-colleague", "https://x/downloads/not-a-real-token"));
    // Distinguishing them would tell the holder of a forwarded link that it is real and merely
    // not theirs -- information they did not have.
    expect(forwarded).toBe(fabricated);
  });

  it("a link cannot be redeemed from another tenant's context", async () => {
    await seedOrg({ orgId: OTHER, projectId: `${PROJECT}-x`, teamNames: ["energy"] });
    await addOrgMember(OTHER, "u-fac", "consultant", null);
    const r = await issue("u-fac");
    expect(await codeOf(redeem("u-fac", r.url, OTHER))).toBe("ARTIFACT_NOT_FOUND");
    // The grant is untouched: a cross-tenant probe must not consume it either.
    expect((await redeem("u-fac", r.url)).versionId).toBe(v("f32dl-open"));
  });
});

describe("④ 写审计 -- after a download there is a record of 谁 / 什么时候 / 下了哪个", () => {
  it("the download writes a `downloaded` provenance event naming actor, time and version", async () => {
    const r = await issue("u-fac", v("f32dl-teamonly"));
    const before = new Date();
    const got = await redeem("u-fac", r.url);

    const event = await asApp(ORG, async (c) =>
      (await c.query<{ type: string; actor_id: string; at: Date; target_kind: string; target_id: string; detail: Record<string, unknown> }>(
        `SELECT type, actor_id, at, target_kind, target_id, detail
           FROM provenance_events WHERE org_id = $1 AND id = $2`,
        [ORG, got.provenanceEventId],
      )).rows[0]!,
    );

    // 谁
    expect(event.actor_id).toBe("u-fac");
    // 什么时候
    expect(event.at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    // 下了哪个
    expect(event.target_kind).toBe("artifact-version");
    expect(event.target_id).toBe(v("f32dl-teamonly"));
    expect(event.type).toBe("downloaded");
    // 为什么给你下 -- recoverable afterwards (contract: permissionDecisionId 回指 authorize).
    expect(event.detail.permissionDecisionId).toBe(r.permissionDecisionId);
    expect(event.detail.artifactId).toBe("f32dl-teamonly");
  });

  it("a redemption that fails writes NO download event -- the trail is not padded", async () => {
    const r = await issue("u-fac");
    await redeem("u-fac", r.url);
    const countFor = async (): Promise<number> =>
      asApp(ORG, async (c) =>
        Number((await c.query<{ n: string }>(
          `SELECT count(*) AS n FROM provenance_events
            WHERE org_id = $1 AND type = 'downloaded' AND target_id = $2`,
          [ORG, v("f32dl-open")],
        )).rows[0]!.n));
    const before = await countFor();
    await codeOf(redeem("u-fac", r.url)); // already consumed
    await codeOf(redeem("u-colleague", r.url)); // forwarded
    // N-19 depends on this number being TRUE: a receipt that over-reports what left the
    // organization is one nobody can act on.
    expect(await countFor()).toBe(before);
  });

  it("the audit row and the consumption are ONE atom -- a failing audit write rolls the download back", async () => {
    const r = await issue("u-fac");
    const exploding: DeliveryDeps = {
      ...deps,
      provenance: {
        append: async () => { throw new Error("audit sink down"); },
        appendWithin: async () => { throw new Error("audit sink down"); },
      },
    };
    await expect(
      redeemDownloadUrl(exploding, {
        userId: "u-fac", orgId: toOrgId(ORG), tokenHash: hashDownloadToken(tokenOf(r.url)),
      }),
    ).rejects.toThrow(/audit sink down/);

    // 🔴 The point: the link is STILL GOOD. There is no path to "the bytes were released and
    // nothing recorded it" -- which is indistinguishable from a download that never happened.
    const row = await asApp(ORG, async (c) =>
      (await c.query<{ consumed_at: Date | null }>(
        "SELECT consumed_at FROM download_grants WHERE token_hash = $1",
        [hashDownloadToken(tokenOf(r.url))],
      )).rows[0]!,
    );
    expect(row.consumed_at).toBeNull();
    expect((await redeem("u-fac", r.url)).versionId).toBe(v("f32dl-open"));
  });

  it("`downloaded` is a real member of the closed contract enum, not a free string", async () => {
    // The SQL CHECK and the contract enum are reconciled member-for-member by
    // `admin-audit-access-visible-to-lead.test.ts`. This asserts the other half: the database
    // actually rejects a neighbouring spelling, so the CHECK is live rather than merely present.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO provenance_events (org_id, type, actor_id, target_kind, target_id)
           VALUES ($1, 'download', 'u-fac', 'artifact-version', $2)`,
          [ORG, v("f32dl-open")],
        ),
      ),
    ).rejects.toThrow(/provenance_events_type_check|violates check constraint/i);
  });
});

describe("the grant table is inside the tenant net and cannot be rewritten by the runtime", () => {
  it("app_rw cannot DELETE a grant -- a consumed grant is half the audit trail", async () => {
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM download_grants WHERE org_id = $1", [ORG])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("RLS is ENABLE + FORCE with a tenant policy on download_grants", async () => {
    const row = await asOwner(async (c) =>
      (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; policies: string }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'download_grants'`,
      )).rows[0]!,
    );
    expect(row.relrowsecurity).toBe(true);
    expect(row.relforcerowsecurity).toBe(true);
    // tenant + the three F22 RESTRICTIVE freeze policies. `kernel_apply_org_freeze_policies()`
    // must have been called by 0027 -- a new table it never saw has NO freeze, while F22's own
    // assertions stay green.
    expect(Number(row.policies)).toBe(4);
  });
});
