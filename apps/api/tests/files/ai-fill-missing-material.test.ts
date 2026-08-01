/**
 * F39 -- `[让 AI 补齐缺料]`（uc-22-2 A4 / V13）against in-memory doubles (issue #74).
 *
 * V13 asserts, structurally:
 *   ① `source_type == "generated"` -- this feature's `source: "ai-generated"` +
 *      `materializeArtifact`'s own derivation of `synthesized` from that source (never taken
 *      from the caller, so a request cannot ask for "generated but not synthesized").
 *   ② `synthesized` 标记 -- same derivation.
 *   ③ `provenance.json`（含 prompt/model/run）-- asserted here as the FULL seven-key shape
 *      `review-panel.tsx`'s `files-review-synth` block promises the user, not just three.
 *   ④ 状态为 REVIEW_PENDING 而非 READY -- `MaterializeInput.ingestionStatus` passthrough.
 *   ⑤ 在人接受之前不召回 -- structural proxy: `ingestion-visibility.retrievable("REVIEW_PENDING")`
 *      is `false` (the SAME fact `resolveReviewPending`'s own accept path is what flips), so
 *      "not retrievable while REVIEW_PENDING" is asserted against the one function that
 *      decides retrievability everywhere else in this codebase, not re-invented here.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { retrievable } from "../../src/domain/files/ingestion-visibility";
import {
  FakeArtifactRepository,
  FakeObjectStore,
  SequentialIdFactory,
} from "../support/artifact-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { requestAiFillMissingMaterial } from "../../src/application/files/ai-fill-missing-material";

const ORG = toOrgId("org-f39-aifill");
const PROJECT = "proj-f39-aifill";

function harness() {
  const repo = new FakeArtifactRepository();
  const store = new FakeObjectStore();
  const ids = new SequentialIdFactory();
  const provenance = new FakeProvenanceWriter();
  return { repo, store, ids, provenance };
}

describe("requestAiFillMissingMaterial -- V13 五条结构性断言", () => {
  it("产物 source=ai-generated ⇒ synthesized 恒真，且状态恒为 REVIEW_PENDING", async () => {
    const { repo, store, ids, provenance } = harness();

    const result = await requestAiFillMissingMaterial(
      { store, repo, ids, provenance, now: () => "2026-08-01T09:00:00Z" },
      {
        orgId: ORG,
        projectId: PROJECT,
        agendaSegmentId: "seg-workshop-1",
        requirement: "现场共识工作坊的分组讨论记录（含反对意见与行动项）",
        actorId: "facilitator-1",
      },
    );

    expect(result.state).toBe("REVIEW_PENDING"); // ④ 恒为 REVIEW_PENDING

    const artifact = repo.artifacts.get(result.artifactId);
    expect(artifact?.source).toBe("ai-generated"); // ① source_type == "generated"（本仓词表 ai-generated）
    expect(artifact?.synthesized).toBe(true); // ② synthesized 标记
    expect(artifact?.ingestionStatus).toBe("REVIEW_PENDING");
    expect(artifact?.agendaSegmentId).toBe("seg-workshop-1");
    expect(artifact?.confidential).toBe(false); // 🔴 agent 不得自行把机密标记勾为否 -- 显式 false，非未声明

    // ⑤ 接受前不召回：REVIEW_PENDING 不在可召回集合里（与 resolveReviewPending 共享同一判定）。
    expect(retrievable("REVIEW_PENDING")).toBe(false);
  });

  it("provenance.json 含七键（prompt/model/model_version/run_id/context pack/生成时间/触发者）", async () => {
    const { repo, store, ids, provenance } = harness();

    const result = await requestAiFillMissingMaterial(
      { store, repo, ids, provenance, now: () => "2026-08-01T09:00:00Z" },
      {
        orgId: ORG,
        projectId: PROJECT,
        agendaSegmentId: "seg-survey-2",
        requirement: "问卷题号 Q7-Q9 缺失的开放题回答摘要",
        actorId: "lead-2",
        model: "claude-test",
        modelVersion: "v3",
        contextPackId: "ctxpack-77",
      },
    );

    const version = repo.versions.get(result.ingestionRunId);
    expect(version).toBeTruthy();
    const key = `org/${result.artifactId}/versions/${version!.versionNumber}/provenance.json`;
    // 真实 storage key 由 domain/artifact/materialization.ts 的 storageKey() 决定；不重算它，
    // 直接从 store 里找出这一条 provenance.json 对象来读。
    const provenanceObjectKey = [...(store as unknown as { objects: Map<string, unknown> }).objects.keys()].find(
      (k) => k.includes(result.artifactId) && k.endsWith("provenance.json"),
    );
    expect(provenanceObjectKey, "provenance.json 必须作为独立对象写入").toBeTruthy();

    const bytes = await store.get(provenanceObjectKey!);
    expect(bytes).toBeTruthy();
    const parsed = JSON.parse(new TextDecoder().decode(bytes!));

    expect(parsed).toMatchObject({
      prompt: "问卷题号 Q7-Q9 缺失的开放题回答摘要",
      model: "claude-test",
      modelVersion: "v3",
      contextPackId: "ctxpack-77",
      generatedAt: "2026-08-01T09:00:00Z",
      triggeredBy: "lead-2",
    });
    expect(typeof parsed.runId).toBe("string");
    expect(parsed.runId.length).toBeGreaterThan(0);
    // 七键：显式列出，而不是 Object.keys().length === 7 -- 长度相等的漂移（多一个少一个
    // 但同数量）正是这个仓库最常见的漏网形状。
    for (const key2 of ["prompt", "model", "modelVersion", "runId", "contextPackId", "generatedAt", "triggeredBy"]) {
      expect(Object.prototype.hasOwnProperty.call(parsed, key2), `missing key ${key2}`).toBe(true);
    }
  });

  it("写入 generated 类型的 provenance_events，detail 标注 synthesized:true 且指向该 artifact", async () => {
    const { repo, store, ids, provenance } = harness();

    const result = await requestAiFillMissingMaterial(
      { store, repo, ids, provenance },
      {
        orgId: ORG,
        projectId: PROJECT,
        agendaSegmentId: "seg-3",
        requirement: "补一份现场照片的视觉描述",
        actorId: "u-9",
      },
    );

    const event = provenance.appended.find((e) => e.type === "generated");
    expect(event).toBeTruthy();
    expect(event?.target).toEqual({ kind: "artifact", id: result.artifactId });
    expect(event?.detail.synthesized).toBe(true);
    expect(event?.detail.agendaSegmentId).toBe("seg-3");
  });

  it("默认值：未传 model/modelVersion/contextPackId 时仍产出完整七键（contextPackId 显式 null）", async () => {
    const { repo, store, ids, provenance } = harness();

    const result = await requestAiFillMissingMaterial(
      { store, repo, ids, provenance },
      {
        orgId: ORG,
        projectId: PROJECT,
        agendaSegmentId: "seg-4",
        requirement: "补一份访谈提纲的候选材料",
        actorId: "u-10",
      },
    );

    const provenanceObjectKey = [...(store as unknown as { objects: Map<string, unknown> }).objects.keys()].find(
      (k) => k.includes(result.artifactId) && k.endsWith("provenance.json"),
    );
    const bytes = await store.get(provenanceObjectKey!);
    const parsed = JSON.parse(new TextDecoder().decode(bytes!));
    expect(parsed.contextPackId).toBeNull(); // 显式 null，不是 undefined/缺省
    expect(typeof parsed.model).toBe("string");
    expect(typeof parsed.modelVersion).toBe("string");
  });
});
