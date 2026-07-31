/**
 * F50 · 停用二选一 (D-U5, `usecases.md` `disableModel`): `interrupt`(立即中断) 与
 * `drain`(跑完当前一轮) 是唯一两条路径, 各自的效果必须可断言、互不混淆。
 *
 * ## Why both directions get their own assertion
 *
 * A gate that only tested "interrupt actually interrupts" could still ship a `drain` that
 * secretly also interrupts everything (same code path, mode ignored) -- that would look
 * identical from the interrupt-side test alone. So every scenario below is run through BOTH
 * modes on the SAME snapshot and the two outcomes are asserted to differ exactly where the
 * contract says they must.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateDisableCascade,
  type ModelReferenceSnapshot,
} from "../../../src/domain/model/disable";
import { disableModel } from "../../../src/application/model/disable-model";
import type {
  ModelDisableWriter,
  ModelKindStatusReader,
  ModelReferenceReader,
} from "../../../src/application/model/ports";

const SNAPSHOT_WITH_INFLIGHT: ModelReferenceSnapshot = {
  referenceSnapshotId: "snap-1",
  agents: ["agent-a"],
  skills: [],
  blueprintPolicies: [],
  activeProjects: ["proj-1"],
  inFlightCalls: 7,
};

describe("evaluateDisableCascade — the two-way choice is total and distinct", () => {
  it("interrupt: interruptedCalls === the snapshot's in-flight count", () => {
    const result = evaluateDisableCascade({ kind: "closed-api" }, 0, "interrupt", SNAPSHOT_WITH_INFLIGHT);
    if (!result.ok) throw new Error("wrong branch");
    expect(result.interruptedCalls).toBe(7);
  });

  it("drain: interruptedCalls === 0, ALWAYS, however many calls are in flight", () => {
    const result = evaluateDisableCascade({ kind: "closed-api" }, 0, "drain", SNAPSHOT_WITH_INFLIGHT);
    if (!result.ok) throw new Error("wrong branch");
    expect(result.interruptedCalls).toBe(0);
  });

  it("with ZERO in-flight calls, interrupt and drain produce the same number (0) for a different reason", () => {
    const idle: ModelReferenceSnapshot = { ...SNAPSHOT_WITH_INFLIGHT, inFlightCalls: 0 };
    const interrupted = evaluateDisableCascade({ kind: "closed-api" }, 0, "interrupt", idle);
    const drained = evaluateDisableCascade({ kind: "closed-api" }, 0, "drain", idle);
    if (!interrupted.ok || !drained.ok) throw new Error("wrong branch");
    expect(interrupted.interruptedCalls).toBe(0);
    expect(drained.interruptedCalls).toBe(0);
  });

  it("neither mode changes the affected agent/skill/project lists -- the choice is ONLY about in-flight calls", () => {
    const interrupted = evaluateDisableCascade({ kind: "closed-api" }, 0, "interrupt", SNAPSHOT_WITH_INFLIGHT);
    const drained = evaluateDisableCascade({ kind: "closed-api" }, 0, "drain", SNAPSHOT_WITH_INFLIGHT);
    if (!interrupted.ok || !drained.ok) throw new Error("wrong branch");
    expect(interrupted.affectedAgentIds).toEqual(drained.affectedAgentIds);
    expect(interrupted.affectedProjectIds).toEqual(drained.affectedProjectIds);
  });

  it("the last-self-hosted refusal fires identically regardless of mode -- refusal is not a mode-dependent choice", () => {
    const interrupted = evaluateDisableCascade({ kind: "self-hosted" }, 0, "interrupt", SNAPSHOT_WITH_INFLIGHT);
    const drained = evaluateDisableCascade({ kind: "self-hosted" }, 0, "drain", SNAPSHOT_WITH_INFLIGHT);
    expect(interrupted).toEqual({ ok: false, code: "LAST_SELF_HOSTED_MODEL" });
    expect(drained).toEqual({ ok: false, code: "LAST_SELF_HOSTED_MODEL" });
  });
});

/* ─────────────────────── through the use case: the WRITER decides mode, and reports it truthfully ─────────────────────── */

function fakeDeps(input: {
  readonly snapshot: ModelReferenceSnapshot;
  /** What the ACTUAL apply-policy write reports back -- see disable-model.ts header on why
   * this, and not the snapshot's `inFlightCalls`, is what the use case returns. */
  readonly writerReports: (mode: "interrupt" | "drain") => number;
}) {
  const appliedModes: ("interrupt" | "drain")[] = [];
  const models: ModelKindStatusReader = {
    read: () => Promise.resolve({ kind: "closed-api" as const, version: "v1" }),
    countOtherEnabledSelfHosted: () => Promise.resolve(0),
  };
  const references: ModelReferenceReader = {
    snapshot: () => Promise.resolve(input.snapshot),
  };
  const writer: ModelDisableWriter = {
    disable: () => Promise.resolve(),
    markDependencyFailed: () => Promise.resolve(),
    applyCallPolicy: (_orgId, _modelId, mode) => {
      appliedModes.push(mode);
      return Promise.resolve(input.writerReports(mode));
    },
  };
  return { deps: { models, references, writer }, appliedModes };
}

describe("disableModel — the mode reaches the writer unchanged, and the writer's mode is what runs", () => {
  it("mode: interrupt is passed through to applyCallPolicy verbatim", async () => {
    const f = fakeDeps({
      snapshot: SNAPSHOT_WITH_INFLIGHT,
      writerReports: (mode) => (mode === "interrupt" ? 7 : 0),
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "紧急下线", expectedVersion: "v1" },
      f.deps,
    );
    expect(f.appliedModes).toEqual(["interrupt"]);
    if (!result.ok) throw new Error("wrong branch");
    expect(result.interruptedCalls).toBe(7);
  });

  it("mode: drain is passed through to applyCallPolicy verbatim, and reports 0", async () => {
    const f = fakeDeps({
      snapshot: SNAPSHOT_WITH_INFLIGHT,
      writerReports: (mode) => (mode === "interrupt" ? 7 : 0),
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "drain", reason: "计划维护", expectedVersion: "v1" },
      f.deps,
    );
    expect(f.appliedModes).toEqual(["drain"]);
    if (!result.ok) throw new Error("wrong branch");
    expect(result.interruptedCalls).toBe(0);
  });

  it("interruptedCalls in the result is the WRITER's actual count, not a copy of the stale snapshot", async () => {
    // Some in-flight calls finished on their own between the snapshot read and the write --
    // the use case must report what really happened, not re-state the number the confirm
    // dialog showed a moment earlier.
    const f = fakeDeps({
      snapshot: SNAPSHOT_WITH_INFLIGHT, // said 7
      writerReports: () => 3, // only 3 were still running by the time the write landed
    });
    const result = await disableModel(
      "org-1",
      { modelId: "m-1", referenceSnapshotId: "snap-1", mode: "interrupt", reason: "紧急下线", expectedVersion: "v1" },
      f.deps,
    );
    if (!result.ok) throw new Error("wrong branch");
    expect(result.interruptedCalls).toBe(3);
  });
});
