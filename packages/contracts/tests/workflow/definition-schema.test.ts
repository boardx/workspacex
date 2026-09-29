import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionVersionInput,
  WorkflowDefinitionVersionStatus,
  WorkflowDefinitionVersionView,
} from "../../src/workflow-runtime";

function stage(stageId: string, extra: Record<string, unknown> = {}) {
  return {
    stageId,
    title: stageId,
    skills: [{ stableId: "skill.research", versionRange: "^1.0.0" }],
    capabilityCategories: [],
    sideEffect: "none",
    humanGate: null,
    maxAttempts: 3,
    ...extra,
  };
}

function def(extra: Record<string, unknown> = {}) {
  return {
    key: "research-to-brief",
    version: 1,
    graphRef: "research-to-brief:1",
    title: "Research to brief",
    inputSchema: { type: "object" },
    stages: [stage("collect"), stage("draft")],
    ...extra,
  };
}

describe("WF01 WorkflowDefinitionVersionInput schema", () => {
  it("accepts a well-formed definition", () => {
    expect(WorkflowDefinitionVersionInput.safeParse(def()).success).toBe(true);
  });

  it("requires graphRef to equal key:version (it is the checkpoint_ns)", () => {
    const r = WorkflowDefinitionVersionInput.safeParse(def({ graphRef: "research-to-brief:2" }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.join(".") === "graphRef")).toBe(true);
  });

  it("rejects duplicate stage ids", () => {
    const r = WorkflowDefinitionVersionInput.safeParse(def({ stages: [stage("collect"), stage("collect")] }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.join(".") === "stages.1.stageId")).toBe(true);
  });

  it("rejects humanGate.onDenyStageId pointing outside the definition", () => {
    const gate = { approverRoles: ["admin"], approverUserIds: [], allowSelfApproval: false, onDenyStageId: "ghost" };
    const r = WorkflowDefinitionVersionInput.safeParse(def({ stages: [stage("collect"), stage("send", { humanGate: gate })] }));
    expect(r.success).toBe(false);
    const ok = WorkflowDefinitionVersionInput.safeParse(
      def({ stages: [stage("collect"), stage("send", { humanGate: { ...gate, onDenyStageId: "collect" } })] }),
    );
    expect(ok.success).toBe(true);
  });

  it("rejects gates without approvers, empty stage lists and unknown fields", () => {
    const noApprover = { approverRoles: [], approverUserIds: [], allowSelfApproval: false, onDenyStageId: null };
    expect(WorkflowDefinitionVersionInput.safeParse(def({ stages: [stage("a", { humanGate: noApprover })] })).success).toBe(false);
    expect(WorkflowDefinitionVersionInput.safeParse(def({ stages: [] })).success).toBe(false);
    expect(WorkflowDefinitionVersionInput.safeParse({ ...def(), extra: 1 }).success).toBe(false);
  });

  it("view carries a closed status set and the same refinements", () => {
    expect(new Set(WorkflowDefinitionVersionStatus.options)).toEqual(new Set(["draft", "published", "retired"]));
    expect(WorkflowDefinitionVersionView.safeParse({ ...def(), status: "published", publishedAt: "2026-01-01T00:00:00Z" }).success).toBe(true);
    expect(WorkflowDefinitionVersionView.safeParse({ ...def(), status: "archived", publishedAt: null }).success).toBe(false);
    expect(
      WorkflowDefinitionVersionView.safeParse({ ...def({ graphRef: "other:1" }), status: "draft", publishedAt: null }).success,
    ).toBe(false);
  });
});
