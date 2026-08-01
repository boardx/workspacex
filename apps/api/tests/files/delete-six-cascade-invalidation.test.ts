/**
 * F45 -- V5·22-4 / architecture 首批门槛第 4 条: the SIX-category cascade, asserted ONE
 * CATEGORY AT A TIME against a baseline recorded before deletion (V5's own prescription:
 * "删除前先建立基线... 删除后 ≤5 分钟断言六项全部成立").
 *
 * ⚠ Cascade ⑤ (`ontology-edges`) is, in phase-01, ALWAYS `"failed"` -- `invalidateOntologyEdges`
 * is a contract stub (F47) that never returns success (`files-outbound-stubs.ts`'s own rule).
 * This file proves TWO things about that, not one:
 *   (a) with the REAL phase-01 stub, the overall task is `"partial-failure"`, no receipt is
 *       issued (N-17), and the OTHER five categories are still genuinely, individually true --
 *       a four-category implementation would fail every one of the five `it`s below;
 *   (b) with a FAKE "phase-02 arrived" outbound port substituted in, all six categories read
 *       `"ok"` and the task reaches `"running"` (not `"partial-failure"`) -- proving the
 *       orchestration itself is not hardwired to fail, only that today's real dependency is.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { addEdge, addEmbedding, registerEmbeddingModel } from "../support/retrieval-fixtures";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import {
  PgCascadeInvalidationRepository, PgDeleteImpactRepository, PgDeletionTaskRepository, PgLegalHoldGate,
} from "../../src/infrastructure/files/pg-deletion-repository";
import { PgArtifactBrowserRepository } from "../../src/infrastructure/files/pg-artifact-browser-repository";
import { PgDownloadGrantRepository } from "../../src/infrastructure/files/pg-download-grant-repository";
import { listProjectArtifacts } from "../../src/application/files/browse-artifacts";
import { requestDeletion, type RequestDeletionDeps } from "../../src/application/files/request-deletion";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f45-cascade";
const PROJECT = "proj-f45-cascade";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
// Namespaced with ORG (unique per test FILE) -- see the same class in
// `delete-impact-preview-confirm.test.ts` for why a bare counter collides across files.
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${ORG}-${++this.n}`; }
}
const alwaysAvailable = { available: async () => true };

let db: PgDatabase;
let deps: RequestDeletionDeps;
let browseDeps: { repo: PgIdentityRepository; ids: SeqIds; browser: PgArtifactBrowserRepository; objectStore: typeof alwaysAvailable };
let grants: PgDownloadGrantRepository;

async function seedTarget(id: string) {
  await addBrowserArtifact({ orgId: ORG, id, projectId: PROJECT, title: `${id}.pdf` });
  const versionId = `${id}-v1`;
  const segmentId = `${id}-s1`;

  await registerEmbeddingModel("f45-fake", "v1", 3);
  await addEmbedding({ orgId: ORG, segmentId, model: "f45-fake", modelVersion: "v1", vector: [0.1, 0.2, 0.3] });

  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO derived_representations (id, org_id, derived_from, kind, object_storage_key, model, model_version)
       VALUES ($1,$2,$3,'ocr',$4,'m','v1')`,
      [`${id}-ocr`, ORG, versionId, `${ORG}/derived/${id}/ocr.txt`],
    ),
  );

  await addEdge({
    orgId: ORG, id: `${id}-edge`,
    src: { kind: "segment", id: segmentId }, dst: { kind: "decision", id: `${id}-decision` },
    relation: "supports",
  });

  // Pack A: pinned directly to this artifact's version (I-7 snapshot path).
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO context_packs (run_id, org_id, status, recorded, content_hash, threshold_used,
                                   pinned_snapshot_id, pinned_at, frozen_item_count)
       VALUES ($1,$2,'assembled',$3,$4,0.5,$5, now(), 1)`,
      [`${id}-pack-pinned`, ORG, JSON.stringify({ candidates: [] }), "a".repeat(64), versionId],
    ),
  );
  // Pack B: not pinned, but its recorded candidates cite this artifact's segment.
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO context_packs (run_id, org_id, status, recorded, content_hash, threshold_used)
       VALUES ($1,$2,'assembled',$3,$4,0.5)`,
      [`${id}-pack-candidate`, ORG, JSON.stringify({ candidates: [{ segmentId }] }), "b".repeat(64)],
    ),
  );

  return { versionId, segmentId };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);

  db = new PgDatabase(appConfig());
  const identity = new PgIdentityRepository(db);
  const impact = new PgDeleteImpactRepository(db);
  const legalHold = new PgLegalHoldGate(db);
  grants = new PgDownloadGrantRepository(db);
  deps = {
    repo: identity, ids: new SeqIds(), impact, legalHold,
    cascades: new PgCascadeInvalidationRepository(db),
    tasks: new PgDeletionTaskRepository(db),
    provenance: new PgProvenanceRepository(db),
    idFactory: new SeqRowIds(),
    now: () => new Date(),
    trashGraceDays: async () => 30,
  };
  browseDeps = { repo: identity, ids: new SeqIds(), browser: new PgArtifactBrowserRepository(db), objectStore: alwaysAvailable };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

describe("V5·22-4 with the REAL phase-01 stub: five categories genuinely ok, ⑤ genuinely failed", () => {
  const ARTIFACT = "f45casc-real";
  let versionId: string;
  let segmentId: string;
  let taskId: string;

  beforeAll(async () => {
    ({ versionId, segmentId } = await seedTarget(ARTIFACT));

    // Baseline, per V5's own prescription -- recorded BEFORE deletion.
    const beforeList = await listProjectArtifacts(browseDeps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, filters: null, cursor: null, pageSize: null,
    });
    expect(beforeList.nodes.map((n) => n.artifactId)).toContain(ARTIFACT);

    const out = await requestDeletion(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), artifactId: ARTIFACT,
      reason: "V5 six-category acceptance", scope: null, confirmedImpact: true, actorKind: "user",
    });
    taskId = out.taskId;
  });

  it("① browser-entry: gone from the list, and its download URL resolves to nothing (404-equivalent)", async () => {
    const after = await listProjectArtifacts(browseDeps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, filters: null, cursor: null, pageSize: null,
    });
    expect(after.nodes.map((n) => n.artifactId)).not.toContain(ARTIFACT);

    const visible = await grants.findVisibleVersion({ orgId: toOrgId(ORG), versionId, requesterTeamId: `${ORG}-team-energy` });
    expect(visible).toBeNull();
  });

  it("② derived-files: the task's cascade result records the derived representation as queued", async () => {
    const task = await deps.tasks.getTask(toOrgId(ORG), taskId);
    const derivedResult = task!.cascadeResults.find((r) => r.kind === "derived-files");
    expect(derivedResult?.result).toBe("ok");
    expect(derivedResult?.detail).toMatch(/1 derived representation/);
  });

  it("③ pgvector: the embedding row is gone -- immediate zero-recall, not eventual", async () => {
    const rows = await asApp(ORG, (c) => c.query("SELECT 1 FROM segment_embeddings WHERE segment_id = $1", [segmentId]));
    expect(rows.rows.length).toBe(0);
  });

  it("④ fts-segments: the segment_text row is gone -- zero recall on the FTS channel", async () => {
    const rows = await asApp(ORG, (c) => c.query("SELECT 1 FROM segment_text WHERE segment_id = $1", [segmentId]));
    expect(rows.rows.length).toBe(0);
  });

  it("⑤ ontology-edges: recorded FAILED (phase-01 stub never succeeds) -- and the edge is honestly still live, not silently invalidated", async () => {
    const task = await deps.tasks.getTask(toOrgId(ORG), taskId);
    const edgeResult = task!.cascadeResults.find((r) => r.kind === "ontology-edges");
    expect(edgeResult?.result).toBe("failed");
    expect(edgeResult?.detail).toMatch(/CASCADE_TARGET_UNAVAILABLE|not implemented in phase-01/);

    const stillLive = await asApp(ORG, (c) => c.query("SELECT 1 FROM ontology_edges WHERE id = $1", [`${ARTIFACT}-edge`]));
    expect(stillLive.rows.length).toBe(1);
  });

  it("⑥ context-pack-cache: BOTH the pinned pack and the candidate-citing pack are invalidated (annotated NEXT TO the frozen row, per I-7)", async () => {
    const rows = await asApp(ORG, (c) =>
      c.query<{ pack_id: string }>(
        "SELECT pack_id FROM context_pack_invalidations WHERE pack_id = ANY($1::text[])",
        [[`${ARTIFACT}-pack-pinned`, `${ARTIFACT}-pack-candidate`]],
      ),
    );
    expect(rows.rows.map((r) => r.pack_id).sort()).toEqual(
      [`${ARTIFACT}-pack-pinned`, `${ARTIFACT}-pack-candidate`].sort(),
    );
  });

  it("🔴 N-17: six categories, one FAILED -> the WHOLE task is partial-failure, never done, and NO receipt", async () => {
    const task = await deps.tasks.getTask(toOrgId(ORG), taskId);
    expect(task!.status).toBe("partial-failure");
    expect(task!.status).not.toBe("done");
    expect(task!.receiptId).toBeNull();
  });

  it("all six CascadeKind members are reported -- never fewer (R11: the easiest failure is claiming 'done' having only run four)", async () => {
    const task = await deps.tasks.getTask(toOrgId(ORG), taskId);
    const kinds = task!.cascadeResults.map((r) => r.kind).sort();
    expect(kinds).toEqual(
      ["browser-entry", "context-pack-cache", "derived-files", "fts-segments", "ontology-edges", "pgvector"].sort(),
    );
  });
});

describe("COUNTER-PROOF: with a fake 'phase-02 arrived' ontology port, all six read ok and the task is NOT partial-failure", () => {
  const ARTIFACT = "f45casc-fakeok";

  it("proves the orchestration itself is not hardwired to fail -- only today's real stub is", async () => {
    await seedTarget(ARTIFACT);
    const fakePhase02: RequestDeletionDeps["invalidateOntologyEdges"] = async (input) => {
      const { versionIds } = input as { versionIds: string[] };
      return { invalidatedEdgeIds: versionIds.map((v) => `edge-of-${v}`) };
    };
    const out = await requestDeletion(
      { ...deps, invalidateOntologyEdges: fakePhase02 },
      {
        userId: "u-fac", orgId: toOrgId(ORG), artifactId: ARTIFACT,
        reason: "counter-proof with a real 09-kg", scope: null, confirmedImpact: true, actorKind: "user",
      },
    );
    const task = await deps.tasks.getTask(toOrgId(ORG), out.taskId);
    expect(task!.cascadeResults.every((r) => r.result === "ok")).toBe(true);
    expect(task!.status).toBe("running");
    expect(task!.status).not.toBe("partial-failure");
  });
});
