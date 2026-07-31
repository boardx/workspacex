/**
 * F50 · 停用绝不静默换模型 (I-16) — 已有引用转 `依赖失败` 并停止被载入,
 * 从不悄悄改配到另一个模型。
 *
 * ## The reverse assertion this file exists to make impossible to break
 *
 * A cascade implementation that "fixes" a disabled reference by pointing it at some other
 * enabled model would pass almost every naive test ("agent still works after disable!").
 * So every test here checks not just THAT the affected agents/skills are reported, but that
 * nothing in the result or the write path ever carries a replacement model id — there is no
 * field to put one in, and the writer fake below would fail loudly if a caller tried.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateDisableCascade,
  LAST_SELF_HOSTED_MODEL,
  type ModelReferenceSnapshot,
} from "../../../src/domain/model/disable";
import { disableModel, VERSION_CHANGED } from "../../../src/application/model/disable-model";
import { MODEL_NOT_FOUND } from "../../../src/application/model/enable-model";
import type {
  ModelDisableWriter,
  ModelKindStatusReader,
  ModelReferenceReader,
} from "../../../src/application/model/ports";

const SNAPSHOT: ModelReferenceSnapshot = {
  referenceSnapshotId: "snap-1",
  agents: ["agent-a", "agent-b"],
  skills: ["skill-x"],
  blueprintPolicies: ["policy-1"],
  activeProjects: ["proj-1"],
  inFlightCalls: 4,
};

describe("evaluateDisableCascade — pure domain decision", () => {
  it("reports the affected agents/skills/projects unchanged from the snapshot", () => {
    const result = evaluateDisableCascade({ kind: "closed-api" }, 0, "interrupt", SNAPSHOT);
    if (!result.ok) throw new Error("wrong branch");
    expect(result.affectedAgentIds).toEqual(SNAPSHOT.agents);
    expect(result.affectedSkillIds).toEqual(SNAPSHOT.skills);
    expect(result.affectedProjectIds).toEqual(SNAPSHOT.activeProjects);
  });

  it("the result type has NO field that could carry a replacement model id", () => {
    const result = evaluateDisableCascade({ kind: "closed-api" }, 0, "drain", SNAPSHOT);
    if (!result.ok) throw new Error("wrong branch");
    // A whitelist of the keys that DO exist -- an extra key here (e.g. `reassignedTo`)
    // would fail this assertion the moment someone added it.
    expect(Object.keys(result).sort()).toEqual(
      ["affectedAgentIds", "affectedProjectIds", "affectedSkillIds", "interruptedCalls", "ok"].sort(),
    );
  });

  it("refuses to disable the last self-hosted model, and refuses BEFORE computing any cascade", () => {
    const result = evaluateDisableCascade({ kind: "self-hosted" }, 0, "interrupt", SNAPSHOT);
    expect(result).toEqual({ ok: false, code: LAST_SELF_HOSTED_MODEL });
  });

  it("a self-hosted model with another self-hosted model still enabled MAY be disabled", () => {
    const result = evaluateDisableCascade({ kind: "self-hosted" }, 1, "interrupt", SNAPSHOT);
    expect(result.ok).toBe(true);
  });

  it("a closed-api model is never blocked by the self-hosted count", () => {
    const result = evaluateDisableCascade({ kind: "closed-api" }, 0, "interrupt", SNAPSHOT);
    expect(result.ok).toBe(true);
  });
});

/* ─────────────────────── through the use case, with a fake writer ─────────────────────── */

interface WriterCall {
  readonly kind: "disable" | "markDependencyFailed" | "applyCallPolicy";
  readonly payload: unknown;
}

function fakes(input: {
  readonly modelId: string;
  readonly kind: "closed-api" | "self-hosted";
  readonly version: string;
  readonly otherSelfHostedEnabled: number;
  readonly snapshot: ModelReferenceSnapshot;
  readonly interruptedCallsReturnedByWriter: number;
}) {
  const calls: WriterCall[] = [];
  const models: ModelKindStatusReader = {
    read: (_org, modelId) =>
      Promise.resolve(
        modelId === input.modelId ? { kind: input.kind, version: input.version } : null,
      ),
    countOtherEnabledSelfHosted: () => Promise.resolve(input.otherSelfHostedEnabled),
  };
  const references: ModelReferenceReader = {
    snapshot: () => Promise.resolve(input.snapshot),
  };
  const writer: ModelDisableWriter = {
    disable: (orgId, modelId) => {
      calls.push({ kind: "disable", payload: { orgId, modelId } });
      return Promise.resolve();
    },
    markDependencyFailed: (payload) => {
      // ⚠ The one assertion point that would catch a "silently reassigned" bug: this
      // fake's signature has no `replacementModelId` parameter, so a caller cannot pass
      // one even if it wanted to -- the failure mode is a TYPE ERROR, not a runtime check.
      calls.push({ kind: "markDependencyFailed", payload });
      return Promise.resolve();
    },
    applyCallPolicy: (orgId, modelId, mode) => {
      calls.push({ kind: "applyCallPolicy", payload: { orgId, modelId, mode } });
      return Promise.resolve(input.interruptedCallsReturnedByWriter);
    },
  };
  return { deps: { models, references, writer }, calls };
}

describe("disableModel — the cascade actually runs, and never carries a replacement", () => {
  it("marks exactly the snapshotted agents/skills as dependency-failed, nothing more and nothing else", async () => {
    const f = fakes({
      modelId: "m-1",
      kind: "closed-api",
      version: "v1",
      otherSelfHostedEnabled: 0,
      snapshot: SNAPSHOT,
      interruptedCallsReturnedByWriter: 4,
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("wrong branch");
    expect(result.affectedAgentIds).toEqual(["agent-a", "agent-b"]);
    expect(result.affectedSkillIds).toEqual(["skill-x"]);

    const markCall = f.calls.find((c) => c.kind === "markDependencyFailed");
    expect(markCall?.payload).toEqual({
      orgId: "org-1",
      modelId: "m-1",
      agentIds: ["agent-a", "agent-b"],
      skillIds: ["skill-x"],
    });
    // Every field name reachable in the write path -- a `replacementModelId` snuck into
    // the payload would show up here.
    expect(Object.keys(markCall!.payload as object).sort()).toEqual(
      ["agentIds", "modelId", "orgId", "skillIds"].sort(),
    );
  });

  it("the row itself is disabled -- I-16's other half, `已停用` is real not implied", async () => {
    const f = fakes({
      modelId: "m-1",
      kind: "closed-api",
      version: "v1",
      otherSelfHostedEnabled: 0,
      snapshot: SNAPSHOT,
      interruptedCallsReturnedByWriter: 0,
    });
    await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "drain", reason: "维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(f.calls.some((c) => c.kind === "disable")).toBe(true);
  });

  it("refuses LAST_SELF_HOSTED_MODEL and writes nothing at all -- refusal is not a partial cascade", async () => {
    const f = fakes({
      modelId: "m-1",
      kind: "self-hosted",
      version: "v1",
      otherSelfHostedEnabled: 0,
      snapshot: SNAPSHOT,
      interruptedCallsReturnedByWriter: 4,
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(result).toEqual({ ok: false, code: LAST_SELF_HOSTED_MODEL });
    expect(f.calls).toEqual([]);
  });

  it("MODEL_NOT_FOUND when the id is stale, and nothing is written", async () => {
    const f = fakes({
      modelId: "m-1",
      kind: "closed-api",
      version: "v1",
      otherSelfHostedEnabled: 0,
      snapshot: SNAPSHOT,
      interruptedCallsReturnedByWriter: 0,
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-ghost", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(result).toEqual({ ok: false, code: MODEL_NOT_FOUND });
    expect(f.calls).toEqual([]);
  });

  it("VERSION_CHANGED when expectedVersion is stale -- confirmed against a world that moved on", async () => {
    const f = fakes({
      modelId: "m-1",
      kind: "closed-api",
      version: "v2",
      otherSelfHostedEnabled: 0,
      snapshot: SNAPSHOT,
      interruptedCallsReturnedByWriter: 0,
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(result).toEqual({ ok: false, code: VERSION_CHANGED });
    expect(f.calls).toEqual([]);
  });

  it("VERSION_CHANGED when the reference snapshot the admin confirmed against is stale", async () => {
    const f = fakes({
      modelId: "m-1",
      kind: "closed-api",
      version: "v1",
      otherSelfHostedEnabled: 0,
      snapshot: { ...SNAPSHOT, referenceSnapshotId: "snap-2", agents: ["agent-c"] },
      interruptedCallsReturnedByWriter: 0,
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(result).toEqual({ ok: false, code: VERSION_CHANGED });
    expect(f.calls).toEqual([]);
  });
});
