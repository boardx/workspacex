import { describe, expect, it } from "vitest";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import { DocumentGenerationAutoApproveController } from "../../src/interface/controllers/document-generation-auto-approve.controller";
import { ToolPermissionGrantController } from "../../src/interface/controllers/tool-permission-grant.controller";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";

const principal = { orgId: "org-doc-default", userId: "user-doc-default" } as Principal;
describe("document generation approval default", () => {
  it("starts enabled without a prior browser write, and supports explicit disable and re-enable", async () => {
    const controller = new DocumentGenerationAutoApproveController(createInMemoryToolPermissionGrantStore());
    expect(await controller.get(principal)).toEqual({ enabled: true });
    expect(await controller.set({ enabled: false }, principal)).toEqual({ enabled: false });
    expect(await controller.get(principal)).toEqual({ enabled: false });
    expect(await controller.set({ enabled: true }, principal)).toEqual({ enabled: true });
    expect(await controller.get({ ...principal, orgId: "org-other" } as Principal)).toEqual({ enabled: true });
  });
});


it("keeps the opt-out out of ordinary grant listing and prevents direct revocation of its id", async () => {
  const store = createInMemoryToolPermissionGrantStore();
  const policy = new DocumentGenerationAutoApproveController(store);
  const grants = new ToolPermissionGrantController(store, {
    findOrgMembership: async () => ({ orgRole: "admin" }),
  } as unknown as IdentityRepository);
  const org = toOrgId(principal.orgId);
  await policy.set({ enabled: false }, principal);
  const [optOut] = await store.listStanding(org);
  await store.grantStanding(org, "normal-tool", principal.userId);
  const visible = await grants.list(principal);
  expect(visible.map((row) => row.toolName)).toEqual(["normal-tool"]);
  await expect(grants.revoke(optOut!.grantId, principal)).rejects.toMatchObject({ status: 404 });
  expect(await policy.get(principal)).toEqual({ enabled: false });
  const normal = visible[0]!;
  expect(await grants.revoke(normal.grantId, principal)).toEqual({ grantId: normal.grantId });
  expect(await grants.list(principal)).toEqual([]);
  expect(await policy.get(principal)).toEqual({ enabled: false });
});


it("rejects a policy-marker id through the generic revoke API even if the caller already knows it", async () => {
  const store = createInMemoryToolPermissionGrantStore();
  const policy = new DocumentGenerationAutoApproveController(store);
  const grants = new ToolPermissionGrantController(store, {
    findOrgMembership: async () => ({ orgRole: "admin" }),
  } as unknown as IdentityRepository);
  await policy.set({ enabled: false }, principal);
  const [optOut] = await store.listStanding(toOrgId(principal.orgId));
  await expect(grants.revoke(optOut!.grantId, principal)).rejects.toMatchObject({ status: 404 });
  expect(await policy.get(principal)).toEqual({ enabled: false });
});
