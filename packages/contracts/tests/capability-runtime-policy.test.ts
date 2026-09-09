import { describe, expect, it } from "vitest";
import { operations as agentRuntimeOperations } from "../src/agent-runtime";
import {
  CAPABILITY_RUNTIME_POLICY_DESIGN_DELTAS,
  CapabilityModelRuntimeBinding,
  CapabilityTrialRunDependencySnapshot,
  McpCredentialMutation,
  RuntimeFailureAttributionRefs,
} from "../src/capability-runtime-policy";
import { operations as skillOperations } from "../src/skills";
import { MCP_EXECUTION_LIMITS } from "../src/mcp-runtime-snapshot";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";
const DIGEST = "a".repeat(64);

const modelBinding = {
  capabilityModelId: "mdl-1",
  providerKey: "deep-agent",
  upstreamModelId: "gpt-5.6",
  configRevision: "cfg-7",
};

describe("capability runtime policy proposal", () => {
  it("requires all three model identities and an exact config revision", () => {
    expect(CapabilityModelRuntimeBinding.parse(modelBinding)).toEqual(modelBinding);
    expect(
      CapabilityModelRuntimeBinding.safeParse({
        capabilityModelId: "mdl-1",
        upstreamModelId: "gpt-5.6",
        configRevision: "cfg-7",
      }).success,
    ).toBe(false);
    expect(CapabilityModelRuntimeBinding.safeParse({ ...modelBinding, providerKey: "Deep Agent" }).success).toBe(false);
    expect(CapabilityModelRuntimeBinding.safeParse({ ...modelBinding, status: "已启用" }).success).toBe(false);
  });

  it("pins a trial run to one draft revision, model config, and existing MCP snapshot ref", () => {
    const snapshot = {
      dependencySnapshotId: UUID_A,
      subject: {
        kind: "skill-draft" as const,
        skillId: "skill-1",
        draftId: "draft-1",
        draftRevision: 3,
        snapshotDigest: DIGEST,
      },
      modelBinding,
      mcpSnapshotRef: { snapshotId: UUID_B, digest: DIGEST },
      capturedAt: "2026-09-09T12:00:00.000Z",
    };

    expect(CapabilityTrialRunDependencySnapshot.parse(snapshot)).toEqual(snapshot);
    expect(
      CapabilityTrialRunDependencySnapshot.safeParse({
        ...snapshot,
        subject: { ...snapshot.subject, draftRevision: "" },
      }).success,
    ).toBe(false);
    expect(
      CapabilityTrialRunDependencySnapshot.safeParse({
        ...snapshot,
        mcpSnapshotRef: { snapshotId: UUID_B, digest: "not-a-digest" },
      }).success,
    ).toBe(false);
  });

  it("makes MCP credential keep, replace, and clear mutually exclusive", () => {
    expect(McpCredentialMutation.safeParse({ action: "keep" }).success).toBe(true);
    expect(McpCredentialMutation.safeParse({ action: "clear" }).success).toBe(true);
    expect(McpCredentialMutation.safeParse({ action: "replace", credential: "test-only" }).success).toBe(true);
    expect(McpCredentialMutation.safeParse({ action: "replace" }).success).toBe(false);
    expect(McpCredentialMutation.safeParse({ action: "keep", credential: "ambiguous" }).success).toBe(false);
    expect(McpCredentialMutation.safeParse({ action: "clear", credential: "ambiguous" }).success).toBe(false);
    expect(McpCredentialMutation.safeParse({ action: "replace", credential: "密".repeat(Math.floor(MCP_EXECUTION_LIMITS.maxCredentialBytes / 3) + 1) }).success).toBe(false);
  });

  it("validates the server response shape without claiming to authenticate its origin", () => {
    const attribution = {
      runId: "run-1",
      agentId: "agent-1",
      agentVersionId: "agent-version-2",
      skillVersionIds: ["skill-version-3"],
      modelConfigRef: { capabilityModelId: "mdl-1", configRevision: "cfg-7" },
      mcpSnapshotRef: { snapshotId: UUID_B, digest: DIGEST },
      failureCode: "MODEL_CALL_FAILED" as const,
    };

    expect(RuntimeFailureAttributionRefs.parse(attribution)).toEqual(attribution);
    expect(
      RuntimeFailureAttributionRefs.safeParse({
        ...attribution,
        skillVersionIds: ["skill-version-3", "skill-version-3"],
      }).success,
    ).toBe(false);
    expect(RuntimeFailureAttributionRefs.safeParse({ ...attribution, credential: "must-not-pass" }).success).toBe(false);
    expect(RuntimeFailureAttributionRefs.safeParse({ ...attribution, failureCode: "NEW_UNREVIEWED_ERROR" }).success).toBe(false);
  });

  it("keeps proposed fields out of the existing signed operations", () => {
    expect(
      agentRuntimeOperations.configureModel.in.safeParse({
        modelId: "mdl-1",
        patch: {},
        expectedVersion: "v1",
        runtimeBinding: modelBinding,
      }).success,
    ).toBe(false);
    expect(
      skillOperations.runTrialRun.in.safeParse({
        versionId: "skill-version-1",
        sampleInput: "deterministic sample",
        dependencySnapshotId: UUID_A,
      }).success,
    ).toBe(false);
    expect(CAPABILITY_RUNTIME_POLICY_DESIGN_DELTAS.mcpCredentialMutation.existingOperations).toContain(
      "agent-runtime.discoverRemoteMcpTools",
    );
  });
});
