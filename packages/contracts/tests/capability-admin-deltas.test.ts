import { describe, expect, it } from "vitest";
import { operations } from "../src/capability-admin-deltas";
import { operations as existing } from "../src/agent-runtime";

describe("proposed administration operation deltas", () => {
  it("requires mapping on single models and forbids it on composite models", () => {
    const base = { kind: existing.registerModel.in.shape.kind.options[0], shape: "single", vendor: "demo", displayName: "Demo", capabilityTags: [], contextWindow: 1000, unitPrice: 0, complianceAttrs: [], credential: null, endpoint: null, members: [] };
    expect(operations.registerModel.in.safeParse(base).success).toBe(false);
    expect(operations.registerModel.in.safeParse({ ...base, providerKey: "demo", upstreamModelId: "upstream-1" }).success).toBe(true);
    expect(operations.registerModel.in.safeParse({ ...base, shape: "composite", providerKey: "demo", upstreamModelId: "upstream-1" }).success).toBe(false);
  });
  it("requires an explicit configuration revision for probes and keeps failure reasons coherent", () => {
    expect(operations.probeConnectivity.in.safeParse({ modelId: "pool-1" }).success).toBe(false);
    expect(operations.probeConnectivity.in.safeParse({ modelId: "pool-1", configRevision: "cfg-1" }).success).toBe(true);
    const response = { reachable: false, latencyMs: 2, failureKind: "credential", modelConfigRef: { capabilityModelId: "pool-1", configRevision: "cfg-1" } };
    expect(operations.probeConnectivity.out.safeParse(response).success).toBe(true);
    expect(operations.probeConnectivity.out.safeParse({ ...response, failureKind: null }).success).toBe(false);
    expect(operations.probeConnectivity.out.safeParse({ ...response, reachable: true }).success).toBe(false);
  });
  it("does not accept empty configuration changes or a client shape override", () => {
    const request = { modelId: "pool-1", expectedVersion: "cfg-1", patch: { upstreamModelId: "upstream-2" } };
    expect(operations.configureModel.in.safeParse(request).success).toBe(true);
    expect(operations.configureModel.in.safeParse({ ...request, patch: {} }).success).toBe(false);
    expect(operations.configureModel.in.safeParse({ ...request, patch: { ...request.patch, shape: "single" } }).success).toBe(false);
    expect(operations.configureModel.err).not.toContain("RETEST_REQUIRED");
  });
  it("uses explicit credential mutation and CAS while leaving existing production input untouched", () => {
    const request = { serverId: "mcp-1", endpoint: "https://example.test/mcp", credentialMutation: { action: "clear" }, expectedConfigRevision: "cfg-1" };
    expect(operations.discoverRemoteMcpTools.in.safeParse(request).success).toBe(true);
    expect(operations.discoverRemoteMcpTools.in.safeParse({ ...request, credential: null }).success).toBe(false);
    expect(operations.discoverRemoteMcpTools.in.safeParse({ ...request, expectedConfigRevision: undefined }).success).toBe(false);
    expect(existing.discoverRemoteMcpTools.in.safeParse(request).success).toBe(false);
  });
});
