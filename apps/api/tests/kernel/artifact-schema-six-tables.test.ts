import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { artifact as A } from "@repo/contracts";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  addSegment,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { CANONICAL_FACTS, PG_MUST_NOT_HOLD } from "../../src/domain/artifact/canonical";

/**
 * F04 -- the six-table model and the invariants that are properties of the DATA (uc-0-1 R1).
 *
 * ## Why so much of this is asserted against the database and not against a use case
 *
 * An invariant enforced in a use case holds until the second use case. F05 through F08, the
 * ingestion pipeline, the file browser, an admin script and whatever restores a backup all
 * write these tables. "A version is never rewritten" is only true if the thing that would
 * rewrite it cannot.
 *
 * So each assertion below names the mechanism it is testing, and the ones that matter are
 * paired with a counter-proof -- the write that must be refused AND the write that must
 * succeed. A schema that rejects everything satisfies half of these perfectly.
 */

const ORG = "org-f04-schema";
const ORG_B = "org-f04-schema-b";
const PROJECT = "proj-f04-schema";

/** The five tables F04 adds. `provenance_events` is the sixth and belongs to 0005. */
const F04_TABLES = ["artifacts", "artifact_versions", "segments", "anchors", "derived_representations"];

let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

beforeEach(async () => {
  await resetOrgs(ORG, ORG_B);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
});

/** A version row that is valid in every respect, so a test can vary exactly one thing. */
function versionValues(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "f04s-ver-1",
    org_id: ORG,
    artifact_id: "f04s-art-1",
    version_number: 1,
    object_storage_key: `${ORG}/artifacts/f04s-art-1/v1/original`,
    content_hash: "a".repeat(64),
    mime: "application/pdf",
    size_bytes: 128,
    pinned_by: "u-pin",
    ...over,
  };
}

async function insertVersion(over: Partial<Record<string, unknown>> = {}): Promise<void> {
  const v = versionValues(over);
  const cols = Object.keys(v);
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO artifact_versions (${cols.join(",")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      cols.map((k) => v[k]),
    ),
  );
}

describe("the six tables exist, and there is exactly one of each", () => {
  it("all six are present", async () => {
    const names = await asOwner(async (c) => {
      const r = await c.query<{ relname: string }>(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
      );
      return r.rows.map((x) => x.relname);
    });
    for (const t of [...F04_TABLES, "provenance_events"]) expect(names, `${t} is missing`).toContain(t);
  });

  it("there is exactly ONE audit trail, found by its shape and not by its name", async () => {
    // Coherence X-2 ruled that provenance_events is one table with one query surface shared
    // by the identity and artifact bundles. The failure this guards against is not a wrong
    // name -- it is two audit trails, after which "was that action logged" has two answers.
    //
    // ⚠ Rewritten in F08, and the rewrite makes it STRICTER rather than looser. The previous
    // version matched `relname LIKE '%provenance%'` and asserted the list was exactly
    // `['provenance_events']`. That has the failure mode this project keeps finding: a
    // second trail called `audit_log` or `activity_events` passed it silently, while a
    // NON-trail whose name happens to contain the word failed it. F08 adds exactly such a
    // table -- `provenance_notifications` holds `(recipient, event id)` and no event data at
    // all -- so the guard now looks for the SHAPE of a trail: who did what to which object.
    const trailShaped = await asOwner(async (c) => {
      const r = await c.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'actor_id')
            AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'target_kind')
          ORDER BY 1`,
      );
      return r.rows.map((x) => x.relname);
    });
    expect(trailShaped).toEqual(["provenance_events"]);

    // ...and the notification table cannot become the second trail by accretion: it may
    // point at an event, it may not describe one.
    const notificationColumns = await asOwner(async (c) => {
      const r = await c.query<{ attname: string }>(
        `SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = 'provenance_notifications'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY 1`,
      );
      return r.rows.map((x) => x.attname);
    });
    expect(notificationColumns).toEqual([
      "created_at", "id", "org_id", "provenance_event_id", "recipient_id",
    ]);
  });

  it("granularity reaches Segment -- acl_bindings can name one, and the row is real", async () => {
    // identity domain.md: "granularity MUST reach Segment. Coarser than that and the
    // permission-travels-along-the-data-path rule cannot be expressed at all." Until F04
    // that object kind had no referent at all.
    await addOrgMember(ORG, "u-a", "consultant", fx.teams.energy!);
    await addSegment({ orgId: ORG, segmentId: "f04s-seg-bindable", artifactId: "f04s-art-bindable" });
    await addBinding({
      orgId: ORG,
      subject: { kind: "user", id: "u-a" },
      object: { kind: "segment", id: "f04s-seg-bindable" },
      scope: "org-wide",
    });
    const n = await asApp(ORG, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM acl_bindings WHERE object_kind='segment' AND object_id='f04s-seg-bindable'`,
      );
      return r.rows[0]!.n;
    });
    expect(n).toBe("1");
  });
});

describe("the enum vocabularies have one source", () => {
  // Same technique 0005 uses for provenance_events.type: the SQL CHECK is a copy of a zod
  // enum, and a copy is what this project has drifted from six times -- so it is reconciled
  // mechanically. Add a source to the contract, forget the migration, and this goes red
  // naming the missing value.
  const cases: [string, string, readonly string[]][] = [
    ["artifacts", "source", A.ArtifactSource.options],
    ["segments", "kind", A.SegmentKind.options],
    ["anchors", "kind", A.AnchorKind.options],
    ["derived_representations", "kind", A.DerivedKind.options],
  ];

  for (const [table, column, options] of cases) {
    it(`${table}.${column} enumerates exactly the contract's values`, async () => {
      const def = await asOwner(async (c) => {
        const r = await c.query<{ def: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS def
             FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
            WHERE t.relname = $1 AND c.contype = 'c' AND a.attname = $2
              AND pg_get_constraintdef(c.oid) LIKE '%ANY %'`,
          [table, column],
        );
        return r.rows[0]?.def ?? "";
      });
      expect(def, `no enum CHECK found on ${table}.${column}`).not.toBe("");
      const inSql = [...def.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1]!).sort();
      expect(inSql).toEqual([...options].sort());
    });
  }

  it("a value outside the enum is refused -- the CHECKs are live, not decorative", async () => {
    await addArtifact({ orgId: ORG, id: "f04s-art-1" });
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
           VALUES ('f04s-art-x',$1,NULL,'telepathy','t','u',false)`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/violates check constraint/i);
  });
});

describe("I-4: PostgreSQL holds pointers, never bytes (S3/PG dual canonical)", () => {
  it("no artifact table has a binary column", async () => {
    // The claim "the original is canonical in object storage" is falsified the moment a blob
    // column appears -- and it would appear for a good local reason (caching a thumbnail,
    // storing a small file "just this once"), at which point restores stop being symmetric
    // and nobody notices until one is attempted.
    const binary = await asOwner(async (c) => {
      const r = await c.query<{ t: string; col: string; ty: string }>(
        `SELECT table_name AS t, column_name AS col, udt_name AS ty
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name = ANY($1::text[]) AND udt_name = ANY($2::text[])`,
        [F04_TABLES, PG_MUST_NOT_HOLD],
      );
      return r.rows.map((x) => `${x.t}.${x.col}:${x.ty}`);
    });
    expect(binary).toEqual([]);
  });

  it("the canonical table is not vacuous and covers both stores", () => {
    // Guards the assertion above from passing because the list it consults is empty.
    expect(PG_MUST_NOT_HOLD.length).toBeGreaterThan(0);
    expect(CANONICAL_FACTS.some((f) => f.canonicalIn === "object-storage")).toBe(true);
    expect(CANONICAL_FACTS.some((f) => f.canonicalIn === "postgres")).toBe(true);
  });
});

describe("I-1 / I-11: a written version is never rewritten", () => {
  beforeEach(async () => {
    await addArtifact({ orgId: ORG, id: "f04s-art-1", projectId: PROJECT });
    await insertVersion();
  });

  it("the runtime role cannot UPDATE a version -- it has no privilege to", async () => {
    await expect(
      asApp(ORG, (c) => c.query(`UPDATE artifact_versions SET mime = 'text/plain' WHERE id = 'f04s-ver-1'`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the runtime role cannot DELETE a version either", async () => {
    await expect(
      asApp(ORG, (c) => c.query(`DELETE FROM artifact_versions WHERE id = 'f04s-ver-1'`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("even the OWNER cannot UPDATE one -- the revoke alone would leave 'fix it in psql'", async () => {
    await expect(
      asOwner((c) => c.query(`UPDATE artifact_versions SET content_hash = $1 WHERE id = 'f04s-ver-1'`, ["b".repeat(64)])),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
  });

  it("and the row is untouched afterwards", async () => {
    // The pair to the three refusals. Each of them would also be satisfied by a table that
    // had silently lost the row.
    const row = await asApp(ORG, async (c) => {
      const r = await c.query<{ content_hash: string; mime: string }>(
        `SELECT content_hash, mime FROM artifact_versions WHERE id = 'f04s-ver-1'`,
      );
      return r.rows[0]!;
    });
    expect(row.content_hash).toBe("a".repeat(64));
    expect(row.mime).toBe("application/pdf");
  });

  it("the runtime role CAN insert a new version -- immutability, not paralysis", async () => {
    await insertVersion({
      id: "f04s-ver-2", version_number: 2, object_storage_key: `${ORG}/artifacts/f04s-art-1/v2/original`,
    });
    const n = await asApp(ORG, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM artifact_versions WHERE artifact_id='f04s-art-1'`,
      );
      return r.rows[0]!.n;
    });
    expect(n).toBe("2");
  });
});

describe("I-10: version numbers are unique within an artifact", () => {
  beforeEach(async () => {
    await addArtifact({ orgId: ORG, id: "f04s-art-1", projectId: PROJECT });
    await insertVersion();
  });

  it("a second v1 is refused -- this is what makes concurrent pinning produce ONE version", async () => {
    await expect(
      insertVersion({ id: "f04s-ver-1b", object_storage_key: `${ORG}/artifacts/f04s-art-1/v1/other` }),
    ).rejects.toThrow(/artifact_versions_uniq_number|duplicate key/i);
  });

  it("two versions cannot share an object storage key (the PG-side shadow of I-2)", async () => {
    // Same key from two rows means one version's bytes were overwritten by another's. I-2
    // proper is a bucket guarantee; this is the part the database can see.
    await expect(insertVersion({ id: "f04s-ver-1c", version_number: 2 })).rejects.toThrow(
      /artifact_versions_uniq_key|duplicate key/i,
    );
  });
});

describe("I-5: a version that has no bytes is not a version", () => {
  beforeEach(async () => {
    await addArtifact({ orgId: ORG, id: "f04s-art-1", projectId: PROJECT });
  });

  it("size_bytes = 0 is refused", async () => {
    // A zero-byte object is what a failed materialization looks like when nobody checks.
    await expect(insertVersion({ size_bytes: 0 })).rejects.toThrow(/violates check constraint/i);
  });

  it("an empty storage key is refused", async () => {
    await expect(insertVersion({ object_storage_key: "" })).rejects.toThrow(/violates check constraint/i);
  });

  it("a content_hash that is not a SHA-256 is refused", async () => {
    await expect(insertVersion({ content_hash: "deadbeef" })).rejects.toThrow(/violates check constraint/i);
  });
});

describe("I-6: a derivative is a separate file and never overwrites its original", () => {
  beforeEach(async () => {
    await addArtifact({ orgId: ORG, id: "f04s-art-1", projectId: PROJECT });
    await insertVersion();
  });

  it("writing a derivative leaves the original's hash untouched", async () => {
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO derived_representations (id, org_id, derived_from, kind, object_storage_key, model, model_version)
         VALUES ('f04s-d1',$1,'f04s-ver-1','ocr',$2,'tesseract','5.3')`,
        [ORG, `${ORG}/derived/ver-1/ocr/text.txt`],
      ),
    );
    const hash = await asApp(ORG, async (c) => {
      const r = await c.query<{ content_hash: string }>(
        `SELECT content_hash FROM artifact_versions WHERE id='f04s-ver-1'`,
      );
      return r.rows[0]!.content_hash;
    });
    expect(hash).toBe("a".repeat(64));
  });

  it("a derivative pointed at the ORIGINAL'S key is refused", async () => {
    // The concrete failure: an OCR step that emits to the key it read from. Afterwards the
    // version row still claims hash X while the object hashes to something else, and only a
    // verification pass finds it -- long after the original is gone.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO derived_representations (id, org_id, derived_from, kind, object_storage_key)
           VALUES ('f04s-d2',$1,'f04s-ver-1','ocr',$2)`,
          [ORG, versionValues().object_storage_key],
        ),
      ),
    ).rejects.toThrow(/invariant I-6/);
  });

  it("a derivative of a version that does not exist is refused", async () => {
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO derived_representations (id, org_id, derived_from, kind, object_storage_key)
           VALUES ('f04s-d3',$1,'f04s-ver-nope','summary',$2)`,
          [ORG, `${ORG}/derived/ver-nope/summary/s.md`],
        ),
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("derived rows cannot be updated or deleted by the runtime role either", async () => {
    // "Re-running ingestion only produces a new derived version, it does not modify old
    // results" (domain.md). Enforced by the grant, not by the pipeline remembering.
    await expect(
      asApp(ORG, (c) => c.query(`UPDATE derived_representations SET model = 'x'`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("AI output cannot pass as first-hand evidence", () => {
  it("source='ai-generated' with synthesized=false is not representable", async () => {
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
           VALUES ('f04s-art-lie',$1,NULL,'ai-generated','t','u',false)`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/artifacts_ai_is_synthesized/);
  });

  it("with synthesized=true it inserts -- the constraint targets the disguise, not the source", async () => {
    await addArtifact({ orgId: ORG, id: "f04s-art-honest", source: "ai-generated" });
    const n = await asApp(ORG, async (c) => {
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM artifacts WHERE id='f04s-art-honest'`);
      return r.rows[0]!.n;
    });
    expect(n).toBe("1");
  });
});

describe("closing 0003's declared gap: acl_bindings on artifacts and segments", () => {
  beforeEach(async () => {
    await addOrgMember(ORG, "u-a", "consultant", fx.teams.energy!);
  });

  it("a binding naming an artifact that does not exist is refused", async () => {
    // Not merely untidy: object ids are caller-supplied, so a stale binding sits there until
    // an artifact IS created with that id -- a reused external id, a restored backup, a
    // Studio that mints ids from titles -- and then arrives pre-granted.
    await expect(
      addBinding({
        orgId: ORG,
        subject: { kind: "user", id: "u-a" },
        object: { kind: "artifact", id: "f04s-art-ghost" },
        scope: "org-wide",
      }),
    ).rejects.toThrow(/invariant I-1/);
  });

  it("a binding naming a segment that does not exist is refused", async () => {
    await expect(
      addBinding({
        orgId: ORG,
        subject: { kind: "user", id: "u-a" },
        object: { kind: "segment", id: "f04s-seg-ghost" },
        scope: "org-wide",
      }),
    ).rejects.toThrow(/invariant I-1/);
  });

  it("a binding naming ANOTHER TENANT'S artifact is refused", async () => {
    await seedOrg({ orgId: ORG_B, projectId: "proj-f04-b" });
    await addArtifact({ orgId: ORG_B, id: "f04s-art-of-b" });
    await expect(
      addBinding({
        orgId: ORG,
        subject: { kind: "user", id: "u-a" },
        object: { kind: "artifact", id: "f04s-art-of-b" },
        scope: "org-wide",
      }),
    ).rejects.toThrow(/invariant I-1/);
  });

  it("a binding naming an artifact that DOES exist in this org is accepted", async () => {
    // The counter-proof. Every refusal above is also satisfied by a trigger that refuses
    // every artifact binding, which would silently disable artifact-level ACLs entirely.
    await addArtifact({ orgId: ORG, id: "f04s-art-real", projectId: PROJECT });
    await addBinding({
      orgId: ORG,
      subject: { kind: "user", id: "u-a" },
      object: { kind: "artifact", id: "f04s-art-real" },
      scope: "org-wide",
    });
    const n = await asApp(ORG, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM acl_bindings WHERE object_kind='artifact' AND object_id='f04s-art-real'`,
      );
      return r.rows[0]!.n;
    });
    expect(n).toBe("1");
  });
});

describe("the new tables are governed like every other tenant table", () => {
  it("the catalog-derived audit finds all five and passes them", async () => {
    // kernel_tenant_table_audit() (0004) discovers new tables rather than being told about
    // them, so this is a check that 0006's RLS block ran -- not a restatement of the list.
    const rows = await asOwner(async (c) => {
      const r = await c.query<{ table_name: string; verdict: string }>(
        `SELECT table_name, verdict FROM kernel_tenant_table_audit() WHERE table_name = ANY($1::text[])`,
        [F04_TABLES],
      );
      return r.rows;
    });
    expect(rows.map((r) => r.table_name).sort()).toEqual([...F04_TABLES].sort());
    expect(rows.filter((r) => r.verdict !== "ok")).toEqual([]);
  });

  it("another tenant's artifact is invisible, and one's own is visible", async () => {
    await seedOrg({ orgId: ORG_B, projectId: "proj-f04-b" });
    await addArtifact({ orgId: ORG, id: "f04s-art-mine", projectId: PROJECT });
    await addArtifact({ orgId: ORG_B, id: "f04s-art-theirs" });
    const seen = await asApp(ORG, async (c) => {
      const r = await c.query<{ id: string }>(`SELECT id FROM artifacts ORDER BY id`);
      return r.rows.map((x) => x.id);
    });
    // Both halves in one assertion: isolation and paralysis are otherwise indistinguishable.
    expect(seen).toContain("f04s-art-mine");
    expect(seen).not.toContain("f04s-art-theirs");
  });
});

/**
 * A-1 (2026-07-29): ids stay unguessable.
 *
 * `artifacts.id` is a GLOBAL primary key, not tenant-scoped -- the same as `projects`,
 * `content_items` and every other existing table, so it is systemic rather than something
 * F04 introduced. Making it `(org_id, id)` would mean changing five tables at once.
 *
 * The risk it leaves is narrow and real: a caller can probe another tenant's id space via
 * primary-key violation, even though RLS keeps the rows themselves invisible. What closes
 * that is not the key shape, it is UNGUESSABILITY -- and UUIDs already provide it.
 *
 * So the ruling is "keep the global key, assert the ids are UUIDs". This test IS that
 * ruling. Without it, someone switching to a readable sequential id for debugging would
 * reopen the hole silently, and every other test would stay green.
 */
describe("A-1: 生成的 id 不可猜（UUID），否则主键冲突会变成跨租户探测通道", () => {
  it("id factory 产出 <前缀>-<UUID> 而非序列或时间戳", async () => {
    const { UuidIdFactory } = await import("../../src/infrastructure/artifact/uuid-id-factory");
    const f = new UuidIdFactory();
    // 前缀是刻意的（见该文件注释）：裸 UUID 出现在存储键 / acl_bindings.object_id /
    // provenance target 里，读者看不出它指什么，而类型传错会变成静默查不到而非报错。
    const ids = Array.from({ length: 20 }, () => f.next("art"));
    const PREFIXED_UUID =
      /^art-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const id of ids) expect(id, `${id} 不是 <前缀>-UUID`).toMatch(PREFIXED_UUID);
    // 不可猜：排序后的顺序不应等于生成顺序（序列型 id 会相等）
    expect([...ids].sort().join()).not.toBe(ids.join());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
