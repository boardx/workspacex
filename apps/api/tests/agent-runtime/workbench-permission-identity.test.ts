import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/application/chat/resolve-visibility", () => ({ resolveVisibility: async () => ({ kind: "allow", actor: {}, thread: {}, base: {} }) }));
vi.mock("../../src/application/security/permission-filter", () => ({ discloseDecided: (payload: unknown) => ({ payload }), isDisclosed: () => true }));
import { decideToolPermission, type DecideToolPermissionDeps } from "../../src/application/agent-run/decide-tool-permission";
import { toOrgId } from "../../src/domain/org-id";
const request = "12345678-1234-4234-8234-123456789abc";
function fixture(consumed = true) {
  const atomic = vi.fn(async () => consumed);
  const kick = vi.fn();
  const grants = { grantStanding: vi.fn(), grantForRun: vi.fn() };
  const deps = { runs: { findLocator: async () => ({ projectId: "p", threadId: "t" }),
    readRun: async () => ({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: request, toolName: "call_skill" } }),
    decidePermissionRequest: atomic }, grants, kick } as unknown as DecideToolPermissionDeps;
  return { deps, atomic, kick, grants };
}
const input = { orgId: toOrgId("org"), userId: "user", runId: "run", permissionRequestId: request, decision: "forever" as const };
describe("permission request identity", () => {
  it("rejects a stale decision before consuming or writing grants", async () => {
    const f = fixture();
    await expect(decideToolPermission(f.deps, { ...input, permissionRequestId: "old" })).rejects.toThrow("stale_permission_request");
    expect(f.atomic).not.toHaveBeenCalled();
    expect(f.grants.grantStanding).not.toHaveBeenCalled();
    expect(f.kick).not.toHaveBeenCalled();
  });
  it("passes identity and grant scope to one atomic operation", async () => {
    const f = fixture();
    await decideToolPermission(f.deps, input);
    expect(f.atomic).toHaveBeenCalledWith(input.orgId, "run", request, "forever", "user");
    expect(f.grants.grantStanding).not.toHaveBeenCalled();
    expect(f.kick).toHaveBeenCalledOnce();
  });
  it("does not kick or grant when another decision wins the atomic race", async () => {
    const f = fixture(false);
    await expect(decideToolPermission(f.deps, input)).rejects.toThrow("stale_permission_request");
    expect(f.kick).not.toHaveBeenCalled();
    expect(f.grants.grantStanding).not.toHaveBeenCalled();
  });
});

import { validateInterruptDecision } from "../../src/application/agent-run/validate-interrupt-decision";
import { RestorableInterrupt } from "@repo/contracts/agent-interrupts";
describe("restored virtual form boundary", () => {
  it("rejects arbitrary tools and strips unknown fields from the public form", () => {
    expect(RestorableInterrupt.safeParse({ toolName: "call_skill", args: { api_key: "secret" } }).success).toBe(false);
    const value = RestorableInterrupt.parse({ toolName: "confirm_task_intent", args: {
      requestId: "q", understanding: "task", assumptions: ["a", "b"], api_key: "hidden" } });
    expect(value.args).not.toHaveProperty("api_key");
  });
  it("rejects selecting an option not present in the original request", () => {
    const form = RestorableInterrupt.parse({ toolName: "choose_execution_option", args: { requestId: "q",
      options: ["a", "b"].map((optionId) => ({ optionId, title: optionId, effort: "低", timeToValue: "soon", expectedReturn: "value" })) } });
    expect(validateInterruptDecision(form, { decision: "approve" })).toBe(false);
    expect(validateInterruptDecision(form, { decision: "edit", editedArgs: { selectedOptionId: "outside" } })).toBe(false);
    expect(validateInterruptDecision(form, { decision: "edit", editedArgs: { selectedOptionId: "b" } })).toBe(true);
  });
});
