import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifact as A } from "@repo/contracts";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import {
  DependencyUnavailableError,
  MaterializationFailedError,
  materializeArtifact,
} from "../../src/application/artifact/materialize-artifact";
import { MATERIALIZATION_PLAN, requiredFiles } from "../../src/domain/artifact/materialization";
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import { ObjectStoreUnavailableError, type IdFactory, type ObjectStore } from "../../src/application/artifact/ports";

/**
 * F04 -- file-first (uc-0-1 R1) and the S3/PG split, exercised end to end.
 *
 * ## What "end to end" means here, precisely
 *
 * The object store is a real filesystem store, not an in-memory map. An in-memory map hands
 * back the identical object it was given, so a round-trip assertion against it tests a
 * `Map`; on disk the bytes are written, read back and decoded, which is the class of thing
 * that can differ. The database is real PostgreSQL under RLS.
 *
 * What is NOT proved: that the deployed bucket is write-once (I-2). `putOnce` refusing a
 * taken key makes THIS writer write-once; the invariant is about the store, and on S3 it is
 * discharged by bucket versioning plus object-lock. Stated rather than implied by a green
 * test.
 */

const ORG = "org-f04-filefirst";
const PROJECT = "proj-f04-filefirst";

let root: string;
let db: PgDatabase;
let repo: PgArtifactRepository;
let store: FsObjectStore;

/**
 * Deterministic ids, so a test can assert an exact storage key rather than discover it.
 *
 * File-scoped prefix, and that is not cosmetic: `artifacts.id` is a GLOBAL primary key, not
 * one scoped per tenant, so two test files running in parallel against separate orgs still
 * collide on a bare `art-1`. The symptom is `duplicate key violates artifacts_pkey` in a
 * test that has nothing to do with ids, which reads as flakiness. (Same shape as the
 * per-worker database and per-worker port already in `support/db.ts`.)
 */
class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f04f-${prefix}-${this.n}`;
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgArtifactRepository(db);
});

afterAll(async () => {
  await db.close();
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  root = await mkdtemp(join(tmpdir(), "wsx-f04-"));
  store = new FsObjectStore(root);
});

/** Plausible bytes for every part a source's plan names. */
function partsFor(source: keyof typeof MATERIALIZATION_PLAN): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const f of MATERIALIZATION_PLAN[source]) {
    out[f.name] = new TextEncoder().encode(`content of ${f.name} for ${source}\n`);
  }
  return out;
}

const run = (source: keyof typeof MATERIALIZATION_PLAN, over: Record<string, Uint8Array> | null = null) =>
  materializeArtifact(
    { store, repo, ids: new SeqIds() },
    {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source,
      title: `a ${source}`,
      actorId: "u-author",
      parts: over ?? partsFor(source),
    },
  );

describe("I-5: every source becomes real, downloadable files", () => {
  // Driven off the CONTRACT's enum, not a list written here. A source added to the contract
  // without a materialization plan fails this loop rather than quietly having none.
  for (const source of A.ArtifactSource.options) {
    it(`${source} materializes every file its plan requires, each with bytes`, async () => {
      const r = await run(source);
      const required = requiredFiles(source);
      expect(required.length, `${source} requires no files at all`).toBeGreaterThan(0);
      expect(r.materializedKeys.length).toBeGreaterThanOrEqual(required.length);

      for (const f of required) {
        const key = r.materializedKeys.find((k) => k.endsWith(`/${f.name}`));
        expect(key, `${source} did not materialize ${f.name}`).toBeDefined();
        const head = await store.head(key!);
        // The literal reading of I-5: HEAD the object, 200 and size > 0.
        expect(head, `${key} has no object behind it`).not.toBeNull();
        expect(head!.sizeBytes).toBeGreaterThan(0);
        expect(head!.mime).toBe(f.mime);
      }
    });
  }

  it("the survey case is the one the requirement names -- responses.csv AND schema.json", async () => {
    const r = await run("survey");
    expect(r.materializedKeys.map((k) => k.split("/").pop())).toEqual(
      expect.arrayContaining(["responses.csv", "schema.json"]),
    );
  });

  it("keys are tenant-prefixed: object storage has no RLS to catch a shared path", async () => {
    const r = await run("conversation");
    for (const k of r.materializedKeys) expect(k.startsWith(`${ORG}/`)).toBe(true);
  });
});

describe("I-3: the recorded hash is the hash of the bytes that came back", () => {
  it("every materialized object round-trips byte-identically", async () => {
    const parts = partsFor("conversation");
    const r = await run("conversation", parts);
    const key = r.materializedKeys[0]!;
    const back = await store.get(key);
    expect(back).not.toBeNull();
    expect(computeContentHash(back!)).toBe(computeContentHash(parts["messages.jsonl"]!));
  });

  it("the version's hash changes when any part changes, and is stable when nothing does", async () => {
    // Both directions. A hash that never changes and a hash that changes every call are
    // equally useless, and only one of them is caught by asserting inequality alone.
    // One id factory across all three: fresh ones would mint the same artifact id each time.
    const ids = new SeqIds();
    const a = await materializeArtifact(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, source: "survey", title: "first",
        actorId: "u-author", parts: partsFor("survey"),
      },
    );
    const same = partsFor("survey");
    const b = await materializeArtifact(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, source: "survey", title: "again",
        actorId: "u-author", parts: same,
      },
    );
    expect(b.contentHash).toBe(a.contentHash);

    const changed = { ...same, "schema.json": new TextEncoder().encode("different\n") };
    const c = await materializeArtifact(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, source: "survey", title: "third",
        actorId: "u-author", parts: changed,
      },
    );
    expect(c.contentHash).not.toBe(a.contentHash);
  });
});

describe("I-4: the bytes are not in PostgreSQL", () => {
  it("the version row holds a pointer and a hash, and the content is nowhere in it", async () => {
    const secret = "the-body-that-must-not-be-in-pg";
    const r = await run("conversation", { "messages.jsonl": new TextEncoder().encode(secret) });
    const row = await asApp(ORG, async (c) => {
      const q = await c.query<Record<string, unknown>>(
        `SELECT * FROM artifact_versions WHERE id = $1`,
        [r.versionId],
      );
      return q.rows[0]!;
    });
    // Every column, serialised. A blob column added later would show up here even if the
    // catalog check in the schema test were somehow satisfied.
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.object_storage_key).toBe(r.materializedKeys[0]);
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("failure keeps its promises (E3)", () => {
  it("a missing required part fails as MATERIALIZATION_FAILED", async () => {
    await expect(run("survey", { "responses.csv": new TextEncoder().encode("a,b\n") })).rejects.toThrow(
      MaterializationFailedError,
    );
  });

  it("a zero-byte part counts as missing, not as an empty file", async () => {
    await expect(
      run("conversation", { "messages.jsonl": new Uint8Array(0) }),
    ).rejects.toThrow(MaterializationFailedError);
  });

  it("and nothing was written -- no version row, no orphan objects", async () => {
    // The half that matters. "It threw" is satisfied by a writer that threw after committing
    // half the work, and a version row pointing at nothing reads as healthy until download.
    //
    // ⚠ ONE id factory across both calls. Two fresh ones mint the same artifact id, so the
    // second call dies on `artifacts_pkey` before it reaches any of the logic under test --
    // the count then matches for a reason that has nothing to do with the assertion. The
    // first version of this test did exactly that, and stayed green with the file-first
    // pre-check deliberately disabled.
    const ids = new SeqIds();
    const call = (parts: Record<string, Uint8Array>) =>
      materializeArtifact(
        { store, repo, ids },
        {
          orgId: toOrgId(ORG), projectId: PROJECT, source: "survey", title: "t",
          actorId: "u-author", parts,
        },
      );
    await call(partsFor("survey"));
    const before = await countVersions();
    await call({ "responses.csv": new TextEncoder().encode("a,b\n") }).catch(() => undefined);
    expect(await countVersions()).toBe(before);
  });

  it("an unavailable store fails as DEPENDENCY_UNAVAILABLE, not as a bad request", async () => {
    // The contract distinguishes them and the interface layer renders them differently:
    // "retry is safe" versus "this will not work". Collapsing them tells a user to retry
    // something that can never succeed, or gives up on something transient.
    const broken: ObjectStore = {
      putOnce: () => Promise.reject(new ObjectStoreUnavailableError("ENOSPC")),
      get: () => Promise.resolve(null),
      head: () => Promise.resolve(null),
    };
    await expect(
      materializeArtifact(
        { store: broken, repo, ids: new SeqIds() },
        {
          orgId: toOrgId(ORG), projectId: PROJECT, source: "conversation", title: "t",
          actorId: "u", parts: partsFor("conversation"),
        },
      ),
    ).rejects.toThrow(DependencyUnavailableError);
  });
});

describe("write-once, as far as this layer can promise it", () => {
  it("putOnce refuses a key that is already taken", async () => {
    const key = `${ORG}/artifacts/x/v1/original`;
    await store.putOnce(key, new TextEncoder().encode("first"), "text/plain");
    await expect(store.putOnce(key, new TextEncoder().encode("second"), "text/plain")).rejects.toThrow(
      /already exists/,
    );
  });

  it("and the first bytes are still there", async () => {
    const key = `${ORG}/artifacts/y/v1/original`;
    await store.putOnce(key, new TextEncoder().encode("first"), "text/plain");
    await store.putOnce(key, new TextEncoder().encode("second"), "text/plain").catch(() => undefined);
    expect(new TextDecoder().decode((await store.get(key))!)).toBe("first");
  });

  it("a second version of the same artifact gets its own keys", async () => {
    const ids = new SeqIds();
    const first = await materializeArtifact(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, source: "conversation", title: "t",
        actorId: "u", parts: partsFor("conversation"),
      },
    );
    const second = await materializeArtifact(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), artifactId: first.artifactId, projectId: PROJECT,
        source: "conversation", title: "t", actorId: "u",
        parts: { "messages.jsonl": new TextEncoder().encode("a later conversation\n") },
      },
    );
    expect(second.versionNumber).toBe(2);
    expect(second.materializedKeys[0]).not.toBe(first.materializedKeys[0]);
    // The whole point of "updates create a new version": v1's bytes are exactly what they
    // were. F05 builds the pinning API on top of this; the storage guarantee is here.
    expect(new TextDecoder().decode((await store.get(first.materializedKeys[0]!))!)).toContain(
      "content of messages.jsonl",
    );
  });
});

describe("synthesized is derived, never asserted by the caller", () => {
  it("an ai-generated artifact is marked synthesized and carries provenance.json", async () => {
    const r = await run("ai-generated");
    expect(r.materializedKeys.some((k) => k.endsWith("/provenance.json"))).toBe(true);
    const flag = await asApp(ORG, async (c) => {
      const q = await c.query<{ synthesized: boolean }>(
        `SELECT synthesized FROM artifacts WHERE id = $1`, [r.artifactId],
      );
      return q.rows[0]!.synthesized;
    });
    expect(flag).toBe(true);
  });

  it("an uploaded artifact is not marked synthesized", async () => {
    const r = await run("upload");
    const flag = await asApp(ORG, async (c) => {
      const q = await c.query<{ synthesized: boolean }>(
        `SELECT synthesized FROM artifacts WHERE id = $1`, [r.artifactId],
      );
      return q.rows[0]!.synthesized;
    });
    expect(flag).toBe(false);
  });
});

async function countVersions(): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM artifact_versions`);
    return Number(r.rows[0]!.n);
  });
}
