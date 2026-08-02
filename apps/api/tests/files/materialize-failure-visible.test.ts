/**
 * F43 -- uc-22-3 R7/V9: "物化失败不阻断业务但在文件浏览器对应位置出现「物化失败，内容未
 * 入库」记录带原因与重试出口".
 *
 * Asserted at `materializeSourceGated`: a materialization failure (missing required bytes, or
 * the object store being unavailable) must
 *   1. NOT throw past this call (the business action that triggered it keeps going), and
 *   2. leave a durable, findable `MaterializationFailureRecord` with a human-readable reason
 *      and `retryable: true` (the "重试出口"), and
 *   3. be resolvable: a subsequent call for the SAME source_ref that succeeds clears it from
 *      the open list, so a real fix does not leave a stale failure marker forever.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { materializeSourceGated } from "../../src/application/files/materialize-source-gated";
import { SEVEN_SOURCE_FILE_PLAN } from "../../src/domain/files/seven-source-plan";
import { ObjectStoreUnavailableError, type ObjectStore } from "../../src/application/artifact/ports";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { FakeMaterializationFailureRepository, FakeSourceRefIndex } from "../support/materialize-ready-fakes";

const ORG = toOrgId("org-f43-failure-visible");

function harness(store: ObjectStore = new FakeObjectStore()) {
  return {
    store,
    repo: new FakeArtifactRepository(),
    ids: new SequentialIdFactory(),
    index: new FakeSourceRefIndex(),
    failures: new FakeMaterializationFailureRepository(),
    provenance: new FakeProvenanceWriter(),
  };
}

function fullPartsFor(sourceType: "survey"): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const f of SEVEN_SOURCE_FILE_PLAN[sourceType]) {
    parts[f.name] = bytesFor(`f43-failure:${sourceType}:${f.name}`);
  }
  return parts;
}

/** Rejects every write, as `no-orphan-version.test.ts` / `file-first-materialization.test.ts`
 *  already model an unavailable store (simulated ENOSPC), then heals on `unfail()` so the
 *  same test can prove a later retry succeeds. */
class FlakyObjectStore implements ObjectStore {
  private readonly real = new FakeObjectStore();
  failing = true;

  async putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (this.failing) throw new ObjectStoreUnavailableError("simulated ENOSPC");
    return this.real.putOnce(key, bytes, mime);
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.real.get(key);
  }
  async head(key: string): Promise<{ sizeBytes: number; mime: string } | null> {
    return this.real.head(key);
  }
}

describe("F43 materialize-failure-visible -- 失败不阻断业务，记录带原因与重试出口", () => {
  it("a required file missing its bytes: does not throw, records an open, retryable failure with a reason", async () => {
    const deps = harness();
    const parts = fullPartsFor("survey");
    delete parts["schema.json"];

    const result = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "survey",
      sourceRef: "ref-survey-missing-file",
      actorId: "user-1",
      parts,
    });

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain("schema.json");

    const open = await deps.failures.listOpen(ORG);
    expect(open).toHaveLength(1);
    expect(open[0]?.sourceRef).toBe("ref-survey-missing-file");
    expect(open[0]?.reason).toContain("schema.json");
    expect(open[0]?.retryable).toBe(true);

    // No artifact/version was left behind for the failed attempt -- "缺文件的静默态" (an
    // object silently half-materialized) is exactly what this must not produce.
    expect(deps.repo.artifacts.size).toBe(0);
  });

  it("object store unavailable: recorded as an open failure; business flow (this call) returns normally", async () => {
    const store = new FlakyObjectStore();
    const deps = harness(store);

    await expect(
      materializeSourceGated(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType: "survey",
        sourceRef: "ref-survey-store-down",
        actorId: "user-1",
        parts: fullPartsFor("survey"),
      }),
    ).resolves.toMatchObject({ kind: "failed", retryable: true });

    const open = await deps.failures.listOpen(ORG);
    expect(open).toHaveLength(1);
    expect(open[0]?.reason).toContain("依赖不可用");
  });

  it("retrying the same source_ref after the dependency recovers succeeds and resolves the open failure", async () => {
    const store = new FlakyObjectStore();
    const deps = harness(store);
    const parts = fullPartsFor("survey");

    const first = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "survey",
      sourceRef: "ref-survey-retry",
      actorId: "user-1",
      parts,
    });
    expect(first.kind).toBe("failed");
    expect(await deps.failures.listOpen(ORG)).toHaveLength(1);

    store.failing = false;
    const retried = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "survey",
      sourceRef: "ref-survey-retry",
      actorId: "user-1",
      parts,
    });

    expect(retried.kind).toBe("materialized");
    expect(await deps.failures.listOpen(ORG)).toHaveLength(0);
  });
});
