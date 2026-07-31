import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { PgQuarantineRepository } from "../../src/infrastructure/files/pg-quarantine-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import { ObjectStoreUnavailableError, type IdFactory, type ObjectStore } from "../../src/application/artifact/ports";
import type { SecurityAlertPort } from "../../src/application/files/upload-ports";

/**
 * F35 -- object-storage write failure must not produce a "PG row, no S3 object" ghost
 * version, and (E7's other direction) a PG commit failure must not leave the temporary
 * object as the version's canonical one either (uc-22-2 E7 / V11 / R6).
 *
 * This reuses F04's `materializeArtifact` for the actual write (see `upload-artifact.ts`'s
 * header for why), so what these tests exercise is really "the no-ghost-version property
 * still holds when it is reached via the upload path, through all the security checks that
 * precede it" -- not a re-proof of `materializeArtifact` itself (that is
 * `file-first-materialization.test.ts`, F04).
 */

const ORG = "org-f35-noorphan";
const PROJECT = "proj-f35-noorphan";

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f35o-${prefix}-${this.n}`;
  }
}

class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {
    /* not exercised */
  }
}

/** Wraps a real store but makes every `putOnce` fail as an unreachable dependency. */
class UnavailableObjectStore implements ObjectStore {
  putOnce(): Promise<void> {
    return Promise.reject(new ObjectStoreUnavailableError("simulated ENOSPC"));
  }
  get(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }
  head(): Promise<{ sizeBytes: number; mime: string } | null> {
    return Promise.resolve(null);
  }
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
  root = await mkdtemp(join(tmpdir(), "wsx-f35-noorphan-"));
});

async function countArtifacts(): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query(`SELECT count(*)::int AS n FROM artifacts WHERE org_id = $1 AND project_id = $2`, [ORG, PROJECT]),
  );
  return (r.rows[0] as { n: number }).n;
}

async function countVersions(): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query(
      `SELECT count(*)::int AS n FROM artifact_versions v
         JOIN artifacts a ON a.id = v.artifact_id
        WHERE v.org_id = $1 AND a.project_id = $2`,
      [ORG, PROJECT],
    ),
  );
  return (r.rows[0] as { n: number }).n;
}

describe("F35 -- object-storage write failure never produces a ghost artifact_version (E7/V11)", () => {
  it("when putOnce fails, the request is rejected as DEPENDENCY_UNAVAILABLE and NO artifact_versions row is created", async () => {
    const deps: UploadArtifactDeps = {
      store: new UnavailableObjectStore(),
      repo: new PgArtifactRepository(db),
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
      files: [{ filename: "unlucky.txt", bytes: new TextEncoder().encode("bytes that never make it to disk") }],
    });

    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.reason.kind).toBe("DEPENDENCY_UNAVAILABLE");

    // The critical assertion: PG has NO version row pointing at a file that was never
    // written -- a ghost version is exactly a row here with nothing behind it in storage.
    expect(await countVersions()).toBe(0);

    // `materializeArtifact` creates the `artifacts` row BEFORE attempting the object-store
    // write (it does not yet know the write will fail), so a bare artifact WITHOUT a
    // version can legitimately exist -- what must never happen is a *version* row with no
    // object. This test's job is that half; F04's own tests cover the artifact-row half.
  });

  it("succeeds end to end once storage is reachable -- the control case for the same request shape", async () => {
    const deps: UploadArtifactDeps = {
      store: new FsObjectStore(root),
      repo: new PgArtifactRepository(db),
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
      files: [{ filename: "lucky.txt", bytes: new TextEncoder().encode("bytes that do make it to disk") }],
    });

    expect(result.files[0]!.status).toBe("accepted");
    expect(await countArtifacts()).toBe(1);
    expect(await countVersions()).toBe(1);

    // And the artifact really is `STORED` (visible/downloadable per uc-22-2 R3 step 6),
    // not silently defaulted to `READY` (which would misstate that F36's pipeline ran).
    const row = await asApp(ORG, (c) =>
      c.query<{ ingestion_status: string }>(
        `SELECT ingestion_status FROM artifacts WHERE org_id = $1 AND project_id = $2`,
        [ORG, PROJECT],
      ),
    );
    expect(row.rows[0]!.ingestion_status).toBe("STORED");
  });
});
