/**
 * F46 -- 待删除队列（合规角色）+ legal hold 施加/解除 (uc-22-4 R3.d 点 15 / R5).
 *
 * Per issue #74 (no local Postgres-backed test runs for this worker), this file exercises
 * the application layer against in-memory fakes (`tests/support/trash-compliance-fakes.ts`)
 * rather than a real database -- the same dispensation F73/F78's own test files already
 * document.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyLegalHold, ApplyLegalHoldError } from "../../src/application/files/apply-legal-hold";
import { releaseLegalHold, ReleaseLegalHoldError } from "../../src/application/files/release-legal-hold";
import { listTrashQueue, ListTrashQueueError } from "../../src/application/files/list-trash-queue";
import {
  FACILITATOR,
  FakeDeleteImpactRepository,
  FakeIdentityRepository,
  FakeLegalHoldRepository,
  FakeProvenanceWriter,
  FakeTrashQueueRepository,
  MEMBER,
  ORG,
  PROJECT,
  SeqDecisionIds,
  SeqIdFactory,
} from "../support/trash-compliance-fakes";

const ARTIFACT = "artifact-trash-1";

describe("F46 · applyLegalHold / releaseLegalHold", () => {
  let repo: FakeIdentityRepository;
  let ids: SeqDecisionIds;
  let impact: FakeDeleteImpactRepository;
  let holds: FakeLegalHoldRepository;
  let provenance: FakeProvenanceWriter;
  let idFactory: SeqIdFactory;
  const now = () => new Date("2026-08-02T00:00:00.000Z");

  beforeEach(() => {
    repo = new FakeIdentityRepository();
    ids = new SeqDecisionIds();
    impact = new FakeDeleteImpactRepository();
    impact.add({ artifactId: ARTIFACT, projectId: PROJECT, title: "interview recording" });
    holds = new FakeLegalHoldRepository();
    provenance = new FakeProvenanceWriter();
    idFactory = new SeqIdFactory();
  });

  it("facilitator (合规负责人 stand-in, FS9) can apply a hold; the hold is then reported active", async () => {
    const out = await applyLegalHold(
      { repo, ids, impact, holds, provenance, idFactory, now },
      { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "监管调查" },
    );
    expect(out.appliedBy).toBe(FACILITATOR);
    expect(out.appliedAt).toBe(now().toISOString());
    expect(await holds.isActive(ORG, ARTIFACT)).toBe(true);
    // 🔴 全程留痕: applying writes provenance, not just the legal_holds row.
    expect(provenance.events).toHaveLength(1);
    expect(provenance.events[0]!.type).toBe("legal-hold-applied");
  });

  it("member (non-facilitator) is refused PROJECT_ROLE_INSUFFICIENT -- FS9's stand-in still gates non-compliance callers", async () => {
    await expect(
      applyLegalHold(
        { repo, ids, impact, holds, provenance, idFactory, now },
        { userId: MEMBER, orgId: ORG, artifactId: ARTIFACT, reason: "监管调查" },
      ),
    ).rejects.toThrow(ApplyLegalHoldError);
  });

  it("applying a hold on an artifact that already has an active one is refused", async () => {
    await applyLegalHold(
      { repo, ids, impact, holds, provenance, idFactory, now },
      { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "first hold" },
    );
    await expect(
      applyLegalHold(
        { repo, ids, impact, holds, provenance, idFactory, now },
        { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "second hold" },
      ),
    ).rejects.toThrow(ApplyLegalHoldError);
  });

  it("unknown artifact -> ARTIFACT_NOT_FOUND", async () => {
    await expect(
      applyLegalHold(
        { repo, ids, impact, holds, provenance, idFactory, now },
        { userId: FACILITATOR, orgId: ORG, artifactId: "nope", reason: "监管调查" },
      ),
    ).rejects.toThrow(ApplyLegalHoldError);
  });

  it("release: 解除比施加更需要问责 -- releasing writes its OWN provenance event, distinct from applying's", async () => {
    await applyLegalHold(
      { repo, ids, impact, holds, provenance, idFactory, now },
      { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "监管调查" },
    );
    const out = await releaseLegalHold(
      { repo, ids, impact, holds, provenance, now },
      { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "调查结束" },
    );
    expect(out.releasedBy).toBe(FACILITATOR);
    expect(await holds.isActive(ORG, ARTIFACT)).toBe(false);
    expect(provenance.events.map((e) => e.type)).toEqual(["legal-hold-applied", "legal-hold-released"]);
  });

  it("release with no active hold is refused, not silently a no-op", async () => {
    await expect(
      releaseLegalHold(
        { repo, ids, impact, holds, provenance, now },
        { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "调查结束" },
      ),
    ).rejects.toThrow(ReleaseLegalHoldError);
  });

  it("member cannot release a hold either", async () => {
    await applyLegalHold(
      { repo, ids, impact, holds, provenance, idFactory, now },
      { userId: FACILITATOR, orgId: ORG, artifactId: ARTIFACT, reason: "监管调查" },
    );
    await expect(
      releaseLegalHold(
        { repo, ids, impact, holds, provenance, now },
        { userId: MEMBER, orgId: ORG, artifactId: ARTIFACT, reason: "调查结束" },
      ),
    ).rejects.toThrow(ReleaseLegalHoldError);
  });
});

describe("F46 · listTrashQueue -- compliance-only visibility", () => {
  let repo: FakeIdentityRepository;
  let ids: SeqDecisionIds;
  let trashQueue: FakeTrashQueueRepository;

  beforeEach(() => {
    repo = new FakeIdentityRepository();
    ids = new SeqDecisionIds();
    trashQueue = new FakeTrashQueueRepository();
    trashQueue.seed(PROJECT, "task-1", "running");
    trashQueue.seed(PROJECT, "task-2", "partial-failure");
    trashQueue.seed(PROJECT, "task-3", "done");
  });

  it("facilitator (合规负责人 stand-in) sees every task when status is unfiltered", async () => {
    const out = await listTrashQueue(
      { repo, ids, trashQueue },
      { userId: FACILITATOR, orgId: ORG, projectId: PROJECT, status: null },
    );
    expect(out.taskIds.sort()).toEqual(["task-1", "task-2", "task-3"]);
  });

  it("status filter narrows the list -- e.g. only 'partial-failure' (the most dangerous state, N-17)", async () => {
    const out = await listTrashQueue(
      { repo, ids, trashQueue },
      { userId: FACILITATOR, orgId: ORG, projectId: PROJECT, status: "partial-failure" },
    );
    expect(out.taskIds).toEqual(["task-2"]);
  });

  it("a project member (not facilitator) cannot see the trash queue at all -- E6/R5's 'only compliance sees this'", async () => {
    await expect(
      listTrashQueue({ repo, ids, trashQueue }, { userId: MEMBER, orgId: ORG, projectId: PROJECT, status: null }),
    ).rejects.toThrow(ListTrashQueueError);
  });

  it("a caller with no project role at all gets NO_PROJECT_ROLE, not PROJECT_ROLE_INSUFFICIENT", async () => {
    try {
      await listTrashQueue(
        { repo, ids, trashQueue },
        { userId: "user-nobody", orgId: ORG, projectId: PROJECT, status: null },
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ListTrashQueueError);
      expect((e as ListTrashQueueError).reasonCode).toBe("NO_PROJECT_ROLE");
    }
  });
});
