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
import { replayIngestionRun, runIngestionWorkerTick } from "../../src/application/files/ingestion-worker";
import type { IdFactory } from "../../src/application/artifact/ports";
import type { SecurityAlertPort } from "../../src/application/files/upload-ports";

/**
 * F36 -- uc-22-2 V12: a worker that crashes AFTER writing a step's durable side effect but
 * BEFORE the transaction that advances the outbox/status commits must be replayable without
 * producing a duplicate Segment.
 *
 * ## How the crash is simulated
 *
 * `runStep`'s SEGMENTED write (`ArtifactRepository.addSegments`) and `completeAndAdvance`
 * (status/history/outbox advance) are each their own PostgreSQL transaction -- that IS the
 * crash window this feature has to survive, and it is not a testing artifact: a real worker
 * process dying between those two calls leaves exactly this state on disk. This test
 * reproduces it directly: run the SEGMENTED step's write once by hand (simulating "worker
 * died right after this committed"), leave the job `processing` with nothing advanced, then
 * invoke the SAME worker entry point again (`replayIngestionRun`, the explicit V12 path) and
 * assert the segment count is still exactly one, and the version still advances correctly.
 */

const ORG = "org-f36-replay";
const PROJECT = "proj-f36-replay";

class SeqIds implements IdFactory {
  private n = 0;
  constructor(private readonly prefix = "f36r") {}
  next(p: string): string {
    this.n += 1;
    return `${this.prefix}-${p}-${this.n}`;
  }
}

class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {
    /* not exercised */
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
  root = await mkdtemp(join(tmpdir(), "wsx-f36-replay-"));
});

async function segmentCount(versionId: string): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query<{ n: string }>(`SELECT count(*)::text AS n FROM segments WHERE org_id = $1 AND artifact_version_id = $2`, [
      ORG,
      versionId,
    ]),
  );
  return Number(r.rows[0]!.n);
}

async function ingestionStatusOf(artifactId: string): Promise<string> {
  const r = await asApp(ORG, (c) =>
    c.query<{ ingestion_status: string }>(`SELECT ingestion_status FROM artifacts WHERE org_id = $1 AND id = $2`, [
      ORG,
      artifactId,
    ]),
  );
  return r.rows[0]!.ingestion_status;
}

async function outboxRowCount(versionId: string): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingestion_outbox WHERE org_id = $1 AND artifact_version_id = $2`,
      [ORG, versionId],
    ),
  );
  return Number(r.rows[0]!.n);
}

describe("F36 -- worker 重放不产生重复 Segment（V12）", () => {
  it("SEGMENTED 步骤重放两次：segment 只有一份，版本正常继续推进", async () => {
    const repo = new PgArtifactRepository(db);
    const ingestion = new PgIngestionRepository(db);
    const deps: UploadArtifactDeps = {
      store: new FsObjectStore(root),
      repo,
      ids: new SeqIds("upload"),
      quarantine: new PgQuarantineRepository(db),
      alerts: new NoopAlerts(),
    };

    const result = await uploadArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "replay-me.txt", bytes: new TextEncoder().encode("crash-test bytes") }],
    });
    const outcome = result.files[0]!;
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") throw new Error("unreachable");
    const { artifactId, versionId } = outcome;

    const workerDeps = { outbox: ingestion, artifacts: repo, ids: new SeqIds("worker") };

    // Drive the run to the SEGMENTED job (STORED --EXTRACTED--> then the SEGMENTED job is
    // next in the queue, not yet processed).
    const t1 = await runIngestionWorkerTick(workerDeps, toOrgId(ORG), "worker-a");
    expect(t1).toMatchObject({ claimed: true, step: "EXTRACTED" });
    expect(await ingestionStatusOf(artifactId)).toBe("EXTRACTED");

    // --- Simulate the crash ---
    // The SEGMENTED job's durable write lands (this is "worker A committed the segment,
    // then died"), but we do NOT call completeAndAdvance -- the outbox row is left claimed
    // (`processing`) with the version still reporting EXTRACTED, exactly what a real crash
    // between those two transactions leaves on disk.
    const staleJob = await ingestion.claimNext(toOrgId(ORG), "worker-a-doomed", 5 * 60 * 1000);
    expect(staleJob).toMatchObject({ step: "SEGMENTED" });
    await repo.addSegments(toOrgId(ORG), [
      {
        id: workerDeps.ids.next("seg"),
        artifactVersionId: versionId,
        kind: "text",
        ordinal: 0,
        anchors: [{ id: workerDeps.ids.next("anc"), kind: "page", locator: "1" }],
      },
    ]);
    expect(await segmentCount(versionId)).toBe(1);
    expect(await ingestionStatusOf(artifactId), "crash means status did NOT advance").toBe("EXTRACTED");
    expect(await outboxRowCount(versionId), "crash means the job row is still there, untouched").toBe(1);

    // --- Replay ---
    // A real worker restarting reclaims this exact version's job explicitly. `runStep`
    // re-attempts the SAME segment write; `segments_uniq_ordinal` throws a unique violation,
    // `ingestion-worker.ts` treats that as "already applied" and proceeds to advance.
    const replay = await replayIngestionRun(workerDeps, toOrgId(ORG), versionId, "worker-b");
    expect(replay).toMatchObject({ claimed: true, step: "SEGMENTED" });
    expect(await ingestionStatusOf(artifactId), "replay must still advance the version").toBe("SEGMENTED");

    // The critical assertion: still exactly ONE segment, not two.
    expect(await segmentCount(versionId)).toBe(1);

    // And a SECOND replay attempt (nothing left to reclaim for this step) finds no job --
    // the queue actually drained rather than being stuck re-processing the same row forever.
    const noJobLeftForThisStep = await ingestion.claimForVersion(toOrgId(ORG), versionId, "worker-c");
    expect(noJobLeftForThisStep).toMatchObject({ step: "ENRICHED" });

    // Finish the run out to READY and assert the segment count NEVER moves off one, through
    // the rest of the (non-replayed) steps either.
    await ingestion.completeAndAdvance(toOrgId(ORG), noJobLeftForThisStep!.id, "ENRICHED", "INDEXED");
    const t4 = await runIngestionWorkerTick(workerDeps, toOrgId(ORG), "worker-d");
    expect(t4).toMatchObject({ claimed: true, step: "INDEXED" });
    const t5 = await runIngestionWorkerTick(workerDeps, toOrgId(ORG), "worker-d");
    expect(t5).toMatchObject({ claimed: true, step: "READY" });
    expect(await ingestionStatusOf(artifactId)).toBe("READY");
    expect(await segmentCount(versionId)).toBe(1);
  });

  it("COUNTER-PROOF：如果 addSegments 没有唯一约束兜底，重放会产生第二条 segment", async () => {
    // This does not re-run the whole pipeline; it isolates the ONE mechanism the test above
    // depends on -- that a second write with the SAME ordinal is rejected -- so that if
    // `segments_uniq_ordinal` were ever dropped or `addSegments` grew an `ON CONFLICT DO
    // NOTHING` that silently swallowed the error INSTEAD of the worker's explicit "is this
    // exactly that conflict" check, this file would fail loudly instead of the main test
    // above just happening to still pass for an unrelated reason.
    const repo = new PgArtifactRepository(db);
    const deps: UploadArtifactDeps = {
      store: new FsObjectStore(root),
      repo,
      ids: new SeqIds("cp"),
      quarantine: new PgQuarantineRepository(db),
      alerts: new NoopAlerts(),
    };
    const result = await uploadArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "counter-proof.txt", bytes: new TextEncoder().encode("x") }],
    });
    const outcome = result.files[0]!;
    if (outcome.status !== "accepted") throw new Error("unreachable");

    const ids = new SeqIds("cp2");
    await repo.addSegments(toOrgId(ORG), [
      { id: ids.next("seg"), artifactVersionId: outcome.versionId, kind: "text", ordinal: 0, anchors: [{ id: ids.next("anc"), kind: "page", locator: "1" }] },
    ]);

    await expect(
      repo.addSegments(toOrgId(ORG), [
        { id: ids.next("seg"), artifactVersionId: outcome.versionId, kind: "text", ordinal: 0, anchors: [{ id: ids.next("anc"), kind: "page", locator: "1" }] },
      ]),
    ).rejects.toMatchObject({ code: "23505", constraint: "segments_uniq_ordinal" });
  });
});
