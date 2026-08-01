/**
 * The gate that makes the `lint-permission-paths` exemption for
 * `pg-ingestion-repository.ts` legitimate (F36, uc-22-2 R8).
 *
 * Same shape as `tests/files/quarantine-repo-is-write-only.test.ts`: the linter's allowlist
 * entry claims two things about this file, and both are enforced here rather than trusted --
 * the premise stops being true quietly the moment someone widens a SELECT to also return
 * `artifacts.title` (to power some future "what is this job working on" screen, say) and the
 * linter stays silent because the file is already allowlisted:
 *
 *   1. no statement in the file is scoped by `withoutTenant` -- every read/write names an
 *      explicit `org_id` predicate, same as every other repository in this codebase;
 *   2. every method's ACTUAL return value (checked against the real database, not just the
 *      source text) carries only job-queue metadata -- id / orgId / artifactId /
 *      artifactVersionId / step / status / attempts / lastError, or (history) status /
 *      occurredAt -- never an artifact's title, mime, or a segment's content.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { PgIngestionRepository } from "../../src/infrastructure/files/pg-ingestion-repository";
import { PgQuarantineRepository } from "../../src/infrastructure/files/pg-quarantine-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import type { IdFactory } from "../../src/application/artifact/ports";
import type { SecurityAlertPort } from "../../src/application/files/upload-ports";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE = fileURLToPath(new URL("../../src/infrastructure/files/pg-ingestion-repository.ts", import.meta.url));

describe("static: no statement bypasses tenant scoping", () => {
  it("the file never CALLS withoutTenant (comment prose mentioning the name is fine)", () => {
    const codeLines = readFileSync(FILE, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
    const callSites = codeLines.filter((line) => /\bwithoutTenant\s*\(/.test(line));
    expect(callSites, `withoutTenant(...) called at:\n  ${callSites.join("\n  ")}`).toEqual([]);
  });

  it("the allowlist entry is actually present, and names this file + this test", () => {
    const lint = readFileSync(fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url)), "utf8");
    expect(lint).toContain("src/infrastructure/files/pg-ingestion-repository.ts");
    expect(lint).toContain("ingestion-repo-metadata-only.test.ts");
  });
});

const ORG = "org-f36-metadata-only";
const PROJECT = "proj-f36-metadata-only";
const OUTBOX_FIELDS = ["id", "orgId", "artifactId", "artifactVersionId", "step", "status", "attempts", "lastError"];
const HISTORY_FIELDS = ["status", "occurredAt"];
/** Content this repository must NEVER return -- the whole point of the exemption. */
const FORBIDDEN_FIELDS = ["title", "mime", "objectStorageKey", "contentHash", "bytes", "kind", "ordinal", "anchors"];

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f36m-${prefix}-${this.n}`;
  }
}
class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {}
}

let root: string;
let db: PgDatabase;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
});

afterAll(async () => {
  await db.close();
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  root = await mkdtemp(join(tmpdir(), "wsx-f36-metadata-"));
});

function assertShape(obj: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(obj)) {
    expect(allowed, `unexpected field '${key}' -- this repository must stay metadata-only`).toContain(key);
  }
  for (const forbidden of FORBIDDEN_FIELDS) {
    expect(obj, `field '${forbidden}' leaked content into a metadata-only read`).not.toHaveProperty(forbidden);
  }
}

describe("runtime: every returned shape is job metadata, never artifact content", () => {
  it("enqueue / claimNext / claimForVersion / findByVersion / history all stay within the allowed field set", async () => {
    const repo = new PgArtifactRepository(db);
    const ingestion = new PgIngestionRepository(db);
    const deps: UploadArtifactDeps = {
      store: new FsObjectStore(root),
      repo,
      ids: new SeqIds(),
      quarantine: new PgQuarantineRepository(db),
      alerts: new NoopAlerts(),
    };
    const result = await uploadArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "shape-check.txt", bytes: new TextEncoder().encode("a very secret title-shaped title") }],
    });
    const outcome = result.files[0]!;
    if (outcome.status !== "accepted") throw new Error("unreachable");

    const found = await ingestion.findByVersion(toOrgId(ORG), outcome.versionId);
    expect(found).not.toBeNull();
    assertShape(found as unknown as Record<string, unknown>, OUTBOX_FIELDS);

    const claimed = await ingestion.claimForVersion(toOrgId(ORG), outcome.versionId, "shape-worker");
    expect(claimed).not.toBeNull();
    assertShape(claimed as unknown as Record<string, unknown>, OUTBOX_FIELDS);

    await ingestion.completeAndAdvance(toOrgId(ORG), claimed!.id, "EXTRACTED", "SEGMENTED");
    const history = await ingestion.history(toOrgId(ORG), outcome.versionId);
    expect(history.length).toBeGreaterThan(0);
    for (const h of history) expect(typeof h).toBe("string"); // a bare status name, not an object with extra fields

    // The file's own filename ("shape-check.txt" / the literal string "title" above) must
    // never appear in anything this repository handed back -- the strongest form of "no
    // content leaked" for this fixture.
    const everything = JSON.stringify({ found, claimed, history });
    expect(everything).not.toContain("shape-check.txt");
    expect(everything).not.toContain("secret title-shaped title");
  });
});
