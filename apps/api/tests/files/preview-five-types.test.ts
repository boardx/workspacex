/**
 * F32 -- the five previewers, the refusal, and the visibility gate they all sit behind.
 *
 * ## What this file has to establish
 *
 *   1. each of the FIVE previewers is reachable from a real MIME type -- non-vacuously, so a
 *      mapping that answered `unsupported` for everything cannot pass;
 *   2. an unsupported type is answered `unsupported` + `isolated-attachment` and never
 *      inlined -- including `image/svg+xml`, which the `image/` prefix would otherwise sweep
 *      up and render as a picture that can run scripts;
 *   3. the response conforms to the SIGNED contract, and the contract really rejects drift;
 *   4. 🔴 the version lookup goes through F31's `wsx_visible_artifacts()` and that predicate is
 *      LOAD-BEARING -- neutered, a version the requester may not see becomes previewable;
 *   5. the D13 divergence (contract 6 values vs view 8) is pinned where it actually bites.
 *
 * ## Why (1) is written as "every kind is reachable" rather than a list of cases
 *
 * A per-MIME table of expectations is satisfied by a mapping that happens to agree with the
 * table and by nothing else -- including by a table that forgot a previewer. The invariant
 * that matters is 「五类预览器」: five kinds, all reachable, none invented. So the corpus is
 * driven through and the SET of kinds produced is compared with the contract enum. Adding a
 * seventh contract value fails this file; silently dropping a previewer fails it too.
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
  FilesDeliveryError, previewArtifactVersion, type DeliveryDeps,
} from "../../src/application/files/deliver-artifact";
import { decidePreview, PREVIEWABLE_KINDS } from "../../src/domain/files/preview-kind";
import { toOrgId } from "../../src/domain/org-id";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";

const ORG = "org-f32-prev";
const PROJECT = "proj-f32-prev";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
const NEVER_CALLED = { next: (p: string) => `${p}-unused` };
/** Preview does not touch the store; the probe is only in `deps` because the type says so. */
const STORE_UP = { available: async () => true };
/** F34: preview does not run the integrity check either (see `deliver-artifact.ts`'s header) -- only in `deps` because the type says so. */
const INTEGRITY_OK = { verify: async () => "ok" as const };

let db: PgDatabase;
let deps: DeliveryDeps;
let teams: Record<string, string>;

/** `<id>-v1` is `addBrowserArtifact`'s head-version id. Written once, here. */
const v = (artifactId: string): string => `${artifactId}-v1`;

const preview = (userId: string, versionId: string) =>
  previewArtifactVersion(deps, { userId, orgId: toOrgId(ORG), versionId });

/**
 * The corpus. One entry per BEHAVIOUR, not one per file extension.
 *
 * ⚠ `image/svg+xml` and `text/csv` are the two that matter. The first is the security case;
 * the second is D13, live. See the assertions below.
 */
const CORPUS: readonly (readonly [mime: string, kind: string])[] = [
  ["application/pdf", "pdf"],
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["audio/mpeg", "audio"],
  ["audio/wav", "audio"],
  ["text/plain", "text"],
  ["text/plain; charset=utf-8", "text"],
  ["application/jsonl", "jsonl"],
  ["application/x-ndjson", "jsonl"],
  ["application/octet-stream", "unsupported"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "unsupported"],
  ["text/html", "text"],
  ["image/svg+xml", "unsupported"],
  ["text/markdown", "text"],
  ["text/csv", "unsupported"],
];

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);

  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy", "platform"] });
  teams = fixture.teams;

  await addOrgMember(ORG, "u-fac", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-other", "consultant", teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "u-other", "member", null);

  // One artifact per corpus entry, named after its index so a failure names the MIME.
  for (const [i, [mime]] of CORPUS.entries()) {
    await addBrowserArtifact({
      orgId: ORG, id: `f32prev-${i}`, projectId: PROJECT, title: `corpus ${mime}`, mime,
    });
  }
  // The visibility case: a PDF (so it would preview fine) owned by a team the requester is
  // not on. Its refusal must come from the predicate, not from the MIME.
  await addBrowserArtifact({
    orgId: ORG, id: "f32prev-teamonly", projectId: PROJECT, title: "platform only pdf",
    mime: "application/pdf",
  });
  // Mid-pipeline: bytes are stored, derived work is not done. E5·22-1's 「生成中」 case.
  await addBrowserArtifact({
    orgId: ORG, id: "f32prev-stored", projectId: PROJECT, title: "still extracting",
    mime: "application/pdf", ingestionStatus: "EXTRACTED",
  });
  await addBinding({
    orgId: ORG,
    subject: { kind: "team", id: teams.platform! },
    object: { kind: "artifact", id: "f32prev-teamonly" },
    scope: "team-only",
    ownerTeamId: teams.platform!,
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
    idFactory: NEVER_CALLED,
    now: () => new Date(),
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

describe("the MIME mapping: five previewers, and a closed refusal", () => {
  it("every corpus entry maps to the kind it should", () => {
    for (const [mime, kind] of CORPUS) {
      expect(decidePreview(mime).kind, mime).toBe(kind);
    }
  });

  it("NON-VACUITY: all five previewers are reachable, and nothing outside the enum is produced", () => {
    const produced = new Set(CORPUS.map(([m]) => decidePreview(m).kind));
    // A mapping that answered `unsupported` for everything satisfies "output ⊆ enum" perfectly.
    // What it cannot satisfy is that each of the five is REACHED.
    for (const k of PREVIEWABLE_KINDS) {
      expect([...produced], `no MIME in the corpus reaches the ${k} previewer`).toContain(k);
    }
    expect(PREVIEWABLE_KINDS).toHaveLength(5);
    for (const k of produced) expect(C.PreviewKind.options as readonly string[]).toContain(k);
  });

  it("🔴 an unsupported type is NEVER inlined, and svg is unsupported despite being an image", () => {
    // The `image/` prefix would answer `image` + `inline` for an SVG. An SVG is an image by
    // MIME and a script host by capability -- 「防 SVG 脚本注入」 is the contract's own wording.
    expect(decidePreview("image/svg+xml")).toEqual({
      kind: "unsupported", renderMode: "isolated-attachment", anchorSupport: false,
    });
    // ...and the rule is general, not a special case for svg.
    for (const [mime] of CORPUS) {
      const d = decidePreview(mime);
      if (d.kind === "unsupported") expect(d.renderMode, mime).toBe("isolated-attachment");
      else expect(d.renderMode, mime).toBe("inline");
    }
  });

  it("anchor support is per previewer, and it is not claimed where nothing can honour it", () => {
    // page number / timecode / message id -- the three anchors uc-22-1 names.
    expect(decidePreview("application/pdf").anchorSupport).toBe(true);
    expect(decidePreview("audio/mpeg").anchorSupport).toBe(true);
    expect(decidePreview("application/jsonl").anchorSupport).toBe(true);
    // No locator the citation layer can address today. `true` here would be a promise nothing keeps.
    expect(decidePreview("image/png").anchorSupport).toBe(false);
    expect(decidePreview("text/plain").anchorSupport).toBe(false);
  });
});

describe("🔴 D13 -- contract SIX values vs the view's EIGHT, pinned where it bites", () => {
  it("markdown previews as `text` and csv is refused -- both FORCED by the signed enum", () => {
    // `apps/web/lib/contract-divergences.ts` D13: the view type additionally has `markdown`
    // and `csv`. Neither exists in `files.PreviewKind`, so neither can be answered here.
    expect(C.PreviewKind.options as readonly string[]).not.toContain("markdown");
    expect(C.PreviewKind.options as readonly string[]).not.toContain("csv");

    // ⚠ THE USER-VISIBLE DIFFERENCE D13 NAMES, as an executable assertion:
    // under the contract a .csv shows 「此类型不支持预览，请下载查看」, while the prototype
    // (`apps/web/components/files/file-preview.tsx`, testid `files-preview-csv`) renders it as
    // a table. Same file, two definitions, two different screens. NOT resolved here.
    expect(decidePreview("text/csv").kind).toBe("unsupported");
    // markdown goes to `text` because the AUTHORITATIVE feature_list says the fourth previewer
    // is 「文本Markdown」. `unsupported` would contradict the feature being implemented.
    expect(decidePreview("text/markdown").kind).toBe("text");
  });

  it("this file does not widen the enum on D13's behalf", () => {
    // If someone rules 「csv 有独立预览器」 and adds the value, this goes red and they are
    // sent here to update the mapping deliberately, rather than the mapping quietly
    // continuing to answer `unsupported` for a type the contract now previews.
    expect([...C.PreviewKind.options].sort()).toEqual(
      ["audio", "image", "jsonl", "pdf", "text", "unsupported"],
    );
  });
});

describe("the endpoint, end to end", () => {
  it("returns the contract shape for every corpus entry, and the contract rejects drift", async () => {
    for (const [i, [mime, kind]] of CORPUS.entries()) {
      const r = await preview("u-fac", v(`f32prev-${i}`));
      expect(r.kind, mime).toBe(kind);
      expect(r.meta.mime, mime).toBe(mime);
      const parsed = C.operations.previewArtifactVersion.out.safeParse(r);
      expect(parsed.success ? null : parsed.error.issues, `${mime}: ${JSON.stringify(r)}`).toBeNull();
    }
    // Reverse assertion: without it, a schema that accepted anything would make the loop pass
    // for a body that is completely wrong.
    const one = await preview("u-fac", v("f32prev-0"));
    expect(
      C.operations.previewArtifactVersion.out.safeParse({ ...one, previewUrl: "x" }).success,
      "the out schema is not strict -- an extra field would ship unnoticed",
    ).toBe(false);
  });

  it("a version the requester may not see is refused, indistinguishably from one that does not exist", async () => {
    const denied = await preview("u-fac", v("f32prev-teamonly")).catch((e: unknown) => e);
    const missing = await preview("u-fac", "no-such-version").catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(FilesDeliveryError);
    expect(missing).toBeInstanceOf(FilesDeliveryError);
    expect((denied as FilesDeliveryError).reasonCode).toBe("ARTIFACT_NOT_FOUND");
    // Same code. The contract tightens `ARTIFACT_NOT_FOUND` to 「与真的不存在逐字节同响应」.
    expect((denied as FilesDeliveryError).reasonCode).toBe((missing as FilesDeliveryError).reasonCode);
  });

  it("...and the person who MAY see it can preview it -- refusal and paralysis are distinguishable", async () => {
    // Without this half, a lookup that returned null for everything would pass the test above.
    const r = await preview("u-other", v("f32prev-teamonly"));
    expect(r.kind).toBe("pdf");
  });
});

describe("🔴 the version lookup is behind F31's SQL predicate, and it is load-bearing", () => {
  /**
   * Break `wsx_visible_artifacts` for real, then roll back.
   *
   * Same technique as `artifacts-list-rls.test.ts`: DDL is transactional in PostgreSQL, so the
   * damage exists only inside this transaction and no other test file can see it.
   *
   * ⚠ The repository is pointed at the BROKEN transaction through a one-off `DatabasePort`
   *   adapter, so the SQL under test is the production SQL -- not a copy of it retyped into
   *   the assertion, which would prove nothing about the code that ships.
   * ⚠ `SET LOCAL ROLE app_rw` before reading: the migration identity is a superuser and a
   *   superuser bypasses RLS even on a FORCEd table. The first version of the equivalent
   *   assertion in F31 "passed" while measuring nothing for exactly this reason.
   */
  const withBroken = async <T>(ddl: readonly string[], fn: (port: DatabasePort) => Promise<T>): Promise<T> =>
    asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        for (const s of ddl) await c.query(s);
        await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
        await c.query("SET LOCAL ROLE app_rw");
        const port: DatabasePort = {
          withTenant: async (_org, f) => f({ query: (sql, params) => c.query(sql, params as never) } as TenantSession),
          withoutTenant: async (f) => f({ query: (sql, params) => c.query(sql, params as never) } as TenantSession),
          close: async () => undefined,
        };
        return await fn(port);
      } finally {
        await c.query("ROLLBACK");
      }
    });

  const lookup = (port: DatabasePort, team: string | null) =>
    new PgDownloadGrantRepository(port).findVisibleVersion({
      orgId: toOrgId(ORG), versionId: v("f32prev-teamonly"), requesterTeamId: team,
    });

  it("baseline: with the real predicate, the energy team cannot resolve the platform-only version", async () => {
    await withBroken([], async (port) => {
      expect(await lookup(port, teams.energy!)).toBeNull();
      // ...and the platform team can, so the baseline is not measuring a dead query.
      expect(await lookup(port, teams.platform!)).not.toBeNull();
    });
  });

  it("COUNTER-PROOF: neuter the predicate and the forbidden version becomes resolvable", async () => {
    const found = await withBroken(
      [
        `CREATE OR REPLACE FUNCTION wsx_visible_artifacts(p_project_id text, p_requester_team_id text)
         RETURNS TABLE (artifact_id text, scope text, owner_team_id text)
         LANGUAGE sql STABLE AS $f$
           SELECT a.id, 'org-wide', NULL::text FROM artifacts a WHERE a.project_id = p_project_id
         $f$`,
      ],
      (port) => lookup(port, teams.energy!),
    );
    // If this were null, the predicate would not be what decides -- something else would be,
    // and neither this file nor F31's could tell you what.
    expect(found, "the SQL predicate is not what gates the preview lookup").not.toBeNull();
  });
});

describe("derivedGenerating is derived from the ingestion state machine, not from a second list", () => {
  it("a STORED-but-not-READY version says its derived work is still coming", async () => {
    const r = await preview("u-fac", v("f32prev-stored"));
    // E5·22-1: 「派生物未就绪时标『生成中』，并如实说明检索侧尚未可召回」.
    expect(r.derivedGenerating).toBe(true);
    // ...and a READY one does not, so the flag is not simply always true.
    expect((await preview("u-fac", v("f32prev-0"))).derivedGenerating).toBe(false);
  });
});

describe("the preview route does not touch the object store", () => {
  it("metadata comes from PostgreSQL, so a store outage does not break preview metadata (V7·22-1)", async () => {
    const withDeadStore: DeliveryDeps = { ...deps, objectStore: { available: async () => false } };
    // The list endpoint stays 200 when the store is down and only download degrades. Preview
    // metadata is in the same position: mime and size are PG columns.
    const r = await previewArtifactVersion(withDeadStore, {
      userId: "u-fac", orgId: toOrgId(ORG), versionId: v("f32prev-0"),
    });
    expect(r.kind).toBe("pdf");
  });
});

describe("fixtures really wrote what this file assumes", () => {
  it("the head versions carry the corpus MIME types", async () => {
    const rows = await asApp(ORG, async (c) =>
      (await c.query<{ id: string; mime: string }>(
        "SELECT id, mime FROM artifact_versions WHERE org_id = $1 AND id LIKE 'f32prev-%' ORDER BY id",
        [ORG],
      )).rows,
    );
    // Non-vacuity for the whole file: if the fixture silently ignored `mime`, every corpus
    // entry would be `application/octet-stream` and the end-to-end loop above would be
    // asserting one behaviour fifteen times.
    expect(new Set(rows.map((r) => r.mime)).size).toBeGreaterThan(5);
  });
});
