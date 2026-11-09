import { describe, expect, it } from "vitest";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import { DocumentGenerationAutoApproveController } from "../../src/interface/controllers/document-generation-auto-approve.controller";
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
