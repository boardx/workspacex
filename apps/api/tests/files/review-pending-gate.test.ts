/**
 * F39 -- REVIEW_PENDING 人工复核（uc-22-2 R3 步骤 11 / R7 / R8）.
 *
 * Two things this feature adds, both asserted here against in-memory doubles (issue #74: no
 * local Postgres):
 *
 *   1. `StructuralReviewGate` -- the real implementation of the `ReviewGate` port
 *      `ingestion-worker.ts` (F36) left as a structural stand-in (`NEVER_NEEDS_REVIEW`).
 *      Structural on the two DECIDED legs (confidential, PII five-class); conservative on
 *      the undecided one (parse quality, `[待定 T-9]`).
 *   2. `resolveReviewPending` -- the reviewer-facing use case `ingestion-worker.ts`'s own
 *      comment named and deferred: accept enqueues+drives the `READY` step synchronously,
 *      reject records a permanent disposition without touching the ingestion status.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import {
  FakeArtifactRepository,
  FakeObjectStore,
  SequentialIdFactory,
} from "../support/artifact-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { InMemoryIngestionOutbox } from "../support/ingestion-outbox-fakes";
import {
  FakeConfidentialityLookup,
  FakeReviewDispositionRepository,
} from "../support/review-fakes";
import { StructuralReviewGate } from "../../src/application/files/review-gate";
import {
  resolveReviewPending,
  ReviewNoteRequiredError,
  ReviewNotRequiredError,
} from "../../src/application/files/resolve-review-pending";
import { runIngestionWorkerTick } from "../../src/application/files/ingestion-worker";

const ORG = toOrgId("org-f39-review");

function harness() {
  const repo = new FakeArtifactRepository();
  const store = new FakeObjectStore();
  const ids = new SequentialIdFactory();
  const outbox = new InMemoryIngestionOutbox();
  const provenance = new FakeProvenanceWriter();
  const confidentiality = new FakeConfidentialityLookup();
  const dispositions = new FakeReviewDispositionRepository();
  const gate = new StructuralReviewGate({ artifacts: repo, confidentiality, store });
  return { repo, store, ids, outbox, provenance, confidentiality, dispositions, gate };
}

async function seedVersion(
  repo: FakeArtifactRepository,
  ids: SequentialIdFactory,
  artifactId: string,
): Promise<string> {
  await repo.createArtifact({
    id: artifactId,
    orgId: ORG,
    projectId: "proj-1",
    source: "upload",
    title: "material.pdf",
    createdBy: "u-1",
    synthesized: false,
  });
  const versionId = ids.next("ver");
  await repo.createVersion({
    id: versionId,
    orgId: ORG,
    artifactId,
    versionNumber: 1,
    objectStorageKey: `org/${artifactId}/v1/original`,
    contentHash: "a".repeat(64),
    mime: "application/octet-stream",
    sizeBytes: 10,
    pinnedBy: "u-1",
    contextPackId: null,
    derivedFrom: null,
  });
  return versionId;
}

describe("StructuralReviewGate -- 机密 ∨ PII 五类 ∨ 解析质量低（T-9 待定，结构性断言）", () => {
  it("机密标记为 true ⇒ needsReview 恒真，不看 PII", async () => {
    const { repo, ids, confidentiality, gate } = harness();
    const versionId = await seedVersion(repo, ids, "art-confidential");
    confidentiality.setConfidential("art-confidential", true);

    expect(await gate.needsReview({ orgId: ORG, artifactVersionId: versionId })).toBe(true);
  });

  it("非机密但派生文本命中 PII（手机号）⇒ needsReview 为真", async () => {
    const { repo, ids, store, gate } = harness();
    const artifactId = "art-pii";
    const versionId = await seedVersion(repo, ids, artifactId);

    const key = `org/${artifactId}/derived/parsed-text/extracted.txt`;
    await store.putOnce(key, new TextEncoder().encode("联系电话 13812342049，请尽快回复。"), "text/plain");
    await repo.createDerived({
      id: ids.next("drv"),
      orgId: ORG,
      derivedFrom: versionId,
      kind: "parsed-text",
      objectStorageKey: key,
      generatorModel: "stub",
      generatorVersion: "1",
      pipelineVersion: "1",
    });

    expect(await gate.needsReview({ orgId: ORG, artifactVersionId: versionId })).toBe(true);
  });

  it("非机密且派生文本不含 O-39 任一类 ⇒ needsReview 为假", async () => {
    const { repo, ids, store, gate } = harness();
    const artifactId = "art-clean";
    const versionId = await seedVersion(repo, ids, artifactId);

    const key = `org/${artifactId}/derived/parsed-text/extracted.txt`;
    await store.putOnce(key, new TextEncoder().encode("这是一份普通的会议纪要，没有敏感信息。"), "text/plain");
    await repo.createDerived({
      id: ids.next("drv"),
      orgId: ORG,
      derivedFrom: versionId,
      kind: "parsed-text",
      objectStorageKey: key,
      generatorModel: "stub",
      generatorVersion: "1",
      pipelineVersion: "1",
    });

    expect(await gate.needsReview({ orgId: ORG, artifactVersionId: versionId })).toBe(false);
  });

  it("未知版本（version === null）⇒ 保守返回假，不抛错", async () => {
    const { gate } = harness();
    expect(await gate.needsReview({ orgId: ORG, artifactVersionId: "no-such-version" })).toBe(false);
  });
});

describe("端到端：INDEXED → REVIEW_PENDING（经由 StructuralReviewGate）→ resolveReviewPending 接受 → READY", () => {
  it("机密材料在 INDEXED 完成后 fork 到 REVIEW_PENDING，接受后同步转 READY 且写审计", async () => {
    const { repo, store, ids, outbox, provenance, confidentiality, dispositions, gate } = harness();
    const artifactId = "art-e2e-accept";
    const versionId = await seedVersion(repo, ids, artifactId);
    confidentiality.setConfidential(artifactId, true);

    await outbox.enqueue({
      id: ids.next("outbox"),
      orgId: ORG,
      artifactId,
      artifactVersionId: versionId,
      step: "INDEXED",
    });

    const tick = await runIngestionWorkerTick({ outbox, artifacts: repo, ids, store }, ORG, "w-1", gate);
    expect(tick).toEqual({ claimed: true, step: "INDEXED", artifactVersionId: versionId });
    // 完成的是 INDEXED 这一步；fork 出的下一个 job 才是 step="REVIEW_PENDING"（尚待处置）。
    expect(outbox.history.get(versionId)).toEqual(["INDEXED"]);

    const job = await outbox.findByVersion(ORG, versionId);
    expect(job?.step).toBe("REVIEW_PENDING");

    const result = await resolveReviewPending(
      { outbox, dispositions, provenance, ids },
      {
        orgId: ORG,
        artifactId,
        artifactVersionId: versionId,
        decision: "accept",
        note: "机密材料已确认由客户授权入库。",
        actorId: "reviewer-1",
      },
    );

    expect(result.state).toBe("READY");
    expect(outbox.history.get(versionId)).toEqual(["INDEXED", "REVIEW_PENDING", "READY"]);
    expect(await outbox.findByVersion(ORG, versionId)).toBeNull();

    const disposition = await dispositions.find(ORG, artifactId);
    expect(disposition?.decision).toBe("accept");

    const event = provenance.appended.find((e) => e.type === "review-accepted");
    expect(event).toBeTruthy();
    expect(event?.target).toEqual({ kind: "artifact", id: artifactId });
  });

  it("拒绝：不推进 ingestion 状态，写 review-rejected 审计，且不得重复处置同一 artifact", async () => {
    const { repo, ids, outbox, provenance, dispositions } = harness();
    const artifactId = "art-e2e-reject";
    const versionId = await seedVersion(repo, ids, artifactId);

    await outbox.enqueue({
      id: ids.next("outbox"),
      orgId: ORG,
      artifactId,
      artifactVersionId: versionId,
      step: "REVIEW_PENDING",
    });

    const result = await resolveReviewPending(
      { outbox, dispositions, provenance, ids },
      {
        orgId: ORG,
        artifactId,
        artifactVersionId: versionId,
        decision: "reject",
        note: "疑似 PII 未获授权，退回上传者。",
        actorId: "reviewer-2",
      },
    );

    expect(result.state).toBe("rejected");
    expect(provenance.appended.some((e) => e.type === "review-rejected")).toBe(true);
    // 拒绝不产生 READY 转移 -- 没有新的 history 记录（拒绝本身不经由 outbox 完成通道）。
    expect(outbox.history.get(versionId) ?? []).toEqual([]);

    await expect(
      resolveReviewPending(
        { outbox, dispositions, provenance, ids },
        {
          orgId: ORG,
          artifactId,
          artifactVersionId: versionId,
          decision: "accept",
          note: "试图二次处置同一材料。",
          actorId: "reviewer-3",
        },
      ),
    ).rejects.toBeInstanceOf(ReviewNotRequiredError);
  });

  it("处置理由少于 4 字 ⇒ 拒绝写审计（PROVENANCE_MISSING 的结构性一侧）", async () => {
    const { repo, ids, outbox, provenance, dispositions } = harness();
    const artifactId = "art-note-required";
    const versionId = await seedVersion(repo, ids, artifactId);
    await outbox.enqueue({
      id: ids.next("outbox"),
      orgId: ORG,
      artifactId,
      artifactVersionId: versionId,
      step: "REVIEW_PENDING",
    });

    await expect(
      resolveReviewPending(
        { outbox, dispositions, provenance, ids },
        { orgId: ORG, artifactId, artifactVersionId: versionId, decision: "accept", note: "ok", actorId: "r" },
      ),
    ).rejects.toBeInstanceOf(ReviewNoteRequiredError);
    expect(provenance.appended).toHaveLength(0);
  });

  it("非 REVIEW_PENDING 的版本调用 resolve ⇒ REVIEW_REQUIRED（无事可处置）", async () => {
    const { repo, ids, outbox, provenance, dispositions } = harness();
    const artifactId = "art-nothing-pending";
    const versionId = await seedVersion(repo, ids, artifactId);
    // 没有 enqueue 任何 job -- 这份材料从未进入 REVIEW_PENDING。

    await expect(
      resolveReviewPending(
        { outbox, dispositions, provenance, ids },
        {
          orgId: ORG,
          artifactId,
          artifactVersionId: versionId,
          decision: "accept",
          note: "误触发的处置尝试。",
          actorId: "r",
        },
      ),
    ).rejects.toBeInstanceOf(ReviewNotRequiredError);
  });
});
