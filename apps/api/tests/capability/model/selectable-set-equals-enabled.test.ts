/**
 * F50 · **可选范围过滤器（唯一实现，三处复用）** — 候选集恒等于 `已启用` 集合（I-2），
 * 组合任一成员停用即自动退出（I-5，不降级为单模型静默运行），`confidential` 时再收窄到
 * `self-hosted`（与 `routeModelCall` 同一判据）。
 *
 * ## The load-bearing assertion
 *
 * The candidate SET returned by `selectableModels` must be exactly the `已启用` subset —
 * not "roughly", not "minus the ones someone remembered to exclude". So every test below
 * constructs a pool with all four statuses present and asserts the surviving id set,
 * rather than asserting one row in isolation (which a filter that accidentally lets
 * `待测试` through could still pass).
 */
import { describe, expect, it } from "vitest";
import { selectableModels, type SelectableCandidateRow } from "../../../src/domain/model/selectable";
import { listSelectableModels, type SelectablePoolReader } from "../../../src/application/model/list-selectable-models";
import { MODEL_STATUSES, type ModelStatus } from "../../../src/domain/model/registry";

function row(
  modelId: string,
  status: ModelStatus,
  overrides: Partial<SelectableCandidateRow> = {},
): SelectableCandidateRow {
  return {
    modelId,
    kind: "closed-api",
    shape: "single",
    status,
    complianceAttrs: [],
    members: [],
    ...overrides,
  };
}

describe("candidate set === 已启用 set", () => {
  it("all four statuses present -> only 已启用 survives, as a SET not a count", () => {
    // ⚠ Deliberately covers every value of the closed enum, not just "enabled vs one other
    // status" -- a filter that special-cased only `待测试` could still leak `依赖失败`.
    expect(MODEL_STATUSES).toEqual(["待测试", "已启用", "已停用", "依赖失败"]);
    const pool = MODEL_STATUSES.map((status, i) => row(`m-${i}-${status}`, status));
    const result = selectableModels(pool, null);
    expect(result.map((r) => r.modelId)).toEqual([`m-1-已启用`]);
  });

  it("an empty pool is an empty candidate set, not a default", () => {
    expect(selectableModels([], null)).toEqual([]);
  });

  it("空池不会因 purpose 而变出候选", () => {
    expect(selectableModels([], "confidential")).toEqual([]);
  });
});

describe("组合成员任一停用 ⇒ 组合自动退出，不降级为单模型（I-5）", () => {
  const wholeChainEnabled = (whisperStatus: ModelStatus, sonnetStatus: ModelStatus) =>
    row("m-combo", "已启用", {
      shape: "composite",
      members: [
        { modelId: "m-whisper", role: "transcribe", kind: "self-hosted", status: whisperStatus, complianceAttrs: [] },
        { modelId: "m-sonnet", role: "write", kind: "closed-api", status: sonnetStatus, complianceAttrs: [] },
      ],
    });

  it("both members 已启用 -> composite selectable", () => {
    const pool = [wholeChainEnabled("已启用", "已启用")];
    expect(selectableModels(pool, null).map((r) => r.modelId)).toEqual(["m-combo"]);
  });

  it("one member 已停用 -> composite DISAPPEARS entirely (not shown disabled, not replaced)", () => {
    const pool = [wholeChainEnabled("已停用", "已启用")];
    const result = selectableModels(pool, null);
    expect(result).toEqual([]);
    // Not present under ANY guise -- there is no "downgraded" row with a different shape.
    expect(result.some((r) => r.modelId === "m-combo")).toBe(false);
  });

  it("composite row itself says 已启用 but a member is 依赖失败 -> still excluded", () => {
    const pool = [wholeChainEnabled("依赖失败", "已启用")];
    expect(selectableModels(pool, null)).toEqual([]);
  });
});

describe("purpose = confidential 收窄到 self-hosted（与 routeModelCall 同一判据）", () => {
  it("closed-api dropped, self-hosted kept", () => {
    const pool = [
      row("m-closed", "已启用", { kind: "closed-api" }),
      row("m-self", "已启用", { kind: "self-hosted" }),
    ];
    expect(selectableModels(pool, "confidential").map((r) => r.modelId)).toEqual(["m-self"]);
  });

  it("non-confidential purposes (including null) leave both kinds eligible", () => {
    const pool = [
      row("m-closed", "已启用", { kind: "closed-api" }),
      row("m-self", "已启用", { kind: "self-hosted" }),
    ];
    for (const purpose of [null, "onsite", "post"] as const) {
      expect([...selectableModels(pool, purpose).map((r) => r.modelId)].sort()).toEqual(
        ["m-closed", "m-self"].sort(),
      );
    }
  });

  it("a composite with any closed-api member is dropped under confidential (I-4 + this filter)", () => {
    // effectiveKind would call this chain closed-api; this test only needs the composite's
    // OWN declared kind to already reflect that, since `selectable.ts` reads `row.kind`
    // rather than re-deriving it -- re-deriving `effectiveKind` here would be the
    // same-fact-twice failure the domain layer exists to avoid.
    const pool = [
      row("m-combo", "已启用", {
        kind: "closed-api",
        shape: "composite",
        members: [
          { modelId: "m-whisper", role: "transcribe", kind: "self-hosted", status: "已启用", complianceAttrs: [] },
          { modelId: "m-sonnet", role: "write", kind: "closed-api", status: "已启用", complianceAttrs: [] },
        ],
      }),
    ];
    expect(selectableModels(pool, "confidential")).toEqual([]);
  });
});

describe("through the use case: 三处复用同一份实现", () => {
  function poolOf(rows: readonly SelectableCandidateRow[]): SelectablePoolReader {
    return { listCandidates: () => Promise.resolve(rows) };
  }

  it("agent / skill / blueprint-policy consumers all get the identical set for the same pool+purpose", async () => {
    const pool = [
      row("m-a", "已启用"),
      row("m-b", "待测试"),
      row("m-c", "已启用", { kind: "self-hosted" }),
    ];
    const reader = poolOf(pool);
    const consumers = ["agent", "skill", "blueprint-policy"] as const;
    const results = await Promise.all(
      consumers.map((c) => listSelectableModels("org-1", c, null, reader)),
    );
    const [first, ...rest] = results;
    for (const r of rest) {
      expect(r.map((row_) => row_.modelId)).toEqual(first!.map((row_) => row_.modelId));
    }
    expect(first!.map((r) => r.modelId).sort()).toEqual(["m-a", "m-c"].sort());
  });

  it("empty pool -> empty result through the use case too (no default seeding)", async () => {
    const result = await listSelectableModels("org-1", "agent", null, poolOf([]));
    expect(result).toEqual([]);
  });
});
