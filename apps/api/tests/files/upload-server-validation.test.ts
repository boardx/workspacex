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
import { UPLOAD_LIMITS } from "../../src/domain/files/upload-limits";
import type { IdFactory } from "../../src/application/artifact/ports";
import type { SecurityAlertPort } from "../../src/application/files/upload-ports";

/**
 * F35 -- server-side re-validation, redone regardless of any client-side precheck
 * (uc-22-2 R3 step 1 / R7 / E1). Every assertion here would be trivially defeated by a
 * client that skips its own precheck; these calls simulate exactly that client.
 */

const ORG = "org-f35-validation";
const PROJECT = "proj-f35-validation";

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f35v-${prefix}-${this.n}`;
  }
}

class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {
    /* not exercised by this file */
  }
}

let root: string;
let db: PgDatabase;
let deps: UploadArtifactDeps;

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
  root = await mkdtemp(join(tmpdir(), "wsx-f35-validation-"));
  deps = {
    store: new FsObjectStore(root),
    repo: new PgArtifactRepository(db),
    ids: new SeqIds(),
    quarantine: new PgQuarantineRepository(db),
    alerts: new NoopAlerts(),
  };
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("F35 -- server-side upload validation is redone, not trusted from the client", () => {
  it("rejects an extension outside the whitelist -- FILE_TYPE_REJECTED", async () => {
    const result = await uploadArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "payload.exe.notarealext", bytes: bytes("whatever") }],
    });

    expect(result.files).toHaveLength(1);
    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason.kind).toBe("FILE_TYPE_REJECTED");
    }

    // Never reached the object store: no artifact was created for it.
    const rows = await asApp(ORG, (c) =>
      c.query(`SELECT count(*)::int AS n FROM artifacts WHERE org_id = $1 AND project_id = $2`, [ORG, PROJECT]),
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("rejects a single file over the per-file size cap -- FILE_TOO_LARGE, with actual+limit", async () => {
    const oversized = new Uint8Array(UPLOAD_LIMITS.maxFileSizeBytes + 1);
    const result = await uploadArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "huge.pdf", bytes: oversized }],
    });

    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected" && outcome.reason.kind === "FILE_TOO_LARGE") {
      expect(outcome.reason.actualBytes).toBe(UPLOAD_LIMITS.maxFileSizeBytes + 1);
      expect(outcome.reason.limitBytes).toBe(UPLOAD_LIMITS.maxFileSizeBytes);
    } else {
      throw new Error(`expected FILE_TOO_LARGE, got ${JSON.stringify(outcome)}`);
    }
  });

  it("rejects the whole batch when the TOTAL exceeds the batch cap -- BATCH_LIMIT_EXCEEDED", async () => {
    const perFile = Math.floor(UPLOAD_LIMITS.maxBatchSizeBytes / 2) + 1024;
    await expect(
      uploadArtifact(deps, {
        orgId: toOrgId(ORG),
        projectId: PROJECT,
        agendaSegmentId: null,
        confidential: false,
        actorId: "u-uploader",
        files: [
          { filename: "a.pdf", bytes: new Uint8Array(perFile) },
          { filename: "b.pdf", bytes: new Uint8Array(perFile) },
        ],
      }),
    ).rejects.toMatchObject({
      actualBytes: perFile * 2,
      limitBytes: UPLOAD_LIMITS.maxBatchSizeBytes,
    });

    // Batch rejection happens before any file is touched -- nothing was written.
    const rows = await asApp(ORG, (c) =>
      c.query(`SELECT count(*)::int AS n FROM artifacts WHERE org_id = $1 AND project_id = $2`, [ORG, PROJECT]),
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("accepts a real, in-whitelist, correctly-typed small file (the control case)", async () => {
    const result = await uploadArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "notes.txt", bytes: bytes("plain text notes") }],
    });
    const outcome = result.files[0]!;
    expect(outcome.status).toBe("accepted");
  });
});
