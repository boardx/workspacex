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
import { PgIngestionRepository } from "../../src/infrastructure/files/pg-ingestion-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import { runIngestionWorkerTick } from "../../src/application/files/ingestion-worker";
import { originalDownloadable, retrievable, type IngestionStatus } from "../../src/domain/files/ingestion-visibility";
import type { IdFactory } from "../../src/application/artifact/ports";
import type { SecurityAlertPort } from "../../src/application/files/upload-ports";

/**
 * F36 -- uc-22-2 R8 / N-7, driven end to end through the REAL worker rather than asserted
 * about the pipeline table alone (that is `nine-state-visible-exits.test.ts`).
 *
 * The property under test: `STORED` makes the original downloadable IMMEDIATELY, and it
 * stays downloadable all the way through `EXTRACTED`/`SEGMENTED`/`ENRICHED`/`INDEXED`/`READY`.
 * `retrievable` is the DIFFERENT boolean: it stays false through `EXTRACTED`/`SEGMENTED`/
 * `ENRICHED` and only flips at `INDEXED` -- one step BEFORE `READY`, not at the same
 * instant. Collapsing the two into one "done" flag is exactly the bug N-7 exists to rule
 * out, so this walks the REAL sequence of states a real upload passes through and checks
 * both booleans at every single one of them, not just at the two endpoints.
 */

const ORG = "org-f36-visible-before-ready";
const PROJECT = "proj-f36-visible-before-ready";

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f36v-${prefix}-${this.n}`;
  }
}

class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {
    /* not exercised -- this file uploads a clean, small text file */
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
  root = await mkdtemp(join(tmpdir(), "wsx-f36-visible-"));
});

async function ingestionStatusOf(artifactId: string): Promise<string> {
  const r = await asApp(ORG, (c) =>
    c.query<{ ingestion_status: string }>(`SELECT ingestion_status FROM artifacts WHERE org_id = $1 AND id = $2`, [
      ORG,
      artifactId,
    ]),
  );
  return r.rows[0]!.ingestion_status;
}

describe("F36 -- STORED 之后原件即可下载，READY 之前不进检索召回（N-7 端到端）", () => {
  it("走完整条流水线，逐态断言 originalDownloadable / retrievable", async () => {
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
      files: [{ filename: "notes.txt", bytes: new TextEncoder().encode("plain text, nothing exotic") }],
    });

    const outcome = result.files[0]!;
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") throw new Error("unreachable");
    const { artifactId } = outcome;

    // Freshly materialized: STORED, exactly what F35 promises (uc-22-2 R3 step 6).
    expect(await ingestionStatusOf(artifactId)).toBe("STORED");
    expect(originalDownloadable("STORED")).toBe(true);
    expect(retrievable("STORED")).toBe(false);

    const workerDeps = { outbox: ingestion, artifacts: repo, ids: new SeqIds() };
    const expectedSequence = ["EXTRACTED", "SEGMENTED", "ENRICHED", "INDEXED", "READY"] as const;

    for (const expected of expectedSequence) {
      const tick = await runIngestionWorkerTick(workerDeps, toOrgId(ORG), "worker-1");
      expect(tick.claimed, `expected a job advancing to ${expected}`).toBe(true);

      const status = (await ingestionStatusOf(artifactId)) as IngestionStatus;
      expect(status).toBe(expected);

      // The one non-monotonic fact this whole feature exists to get right: downloadable
      // flips to true at STORED and never flips back. Retrievable is the DIFFERENT
      // boolean (N-7, `ingestion-visibility.ts`): it flips at `INDEXED` (FTS/pgvector
      // rows go live there), one step BEFORE `READY` -- not at the same instant.
      expect(originalDownloadable(status)).toBe(true);
      if (status === "INDEXED" || status === "READY") {
        expect(retrievable(status)).toBe(true);
      } else {
        expect(retrievable(status), `${status} must not be retrievable yet`).toBe(false);
      }
    }

    // The pipeline is drained: nothing left in the outbox for this version.
    const drained = await runIngestionWorkerTick(workerDeps, toOrgId(ORG), "worker-1");
    expect(drained.claimed).toBe(false);
  });

  it("COUNTER-PROOF：把两者当一个布尔就会把 EXTRACTED 误判成不可下载", () => {
    // If somebody collapses N-7 into `status === "READY"`, EXTRACTED (which the test above
    // proves the original IS downloadable at) would wrongly report false here -- this is the
    // assertion that would catch that regression even without running the rest of the file.
    const collapsedIntoOneFlag = (status: string) => status === "READY";
    expect(collapsedIntoOneFlag("EXTRACTED")).toBe(false);
    expect(originalDownloadable("EXTRACTED")).toBe(true);
    expect(collapsedIntoOneFlag("EXTRACTED")).not.toBe(originalDownloadable("EXTRACTED"));
  });
});
