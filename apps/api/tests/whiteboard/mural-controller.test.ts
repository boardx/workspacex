import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";
import { MuralDirectImport } from "../../src/application/whiteboard/mural-direct-import";
import { MuralImportError } from "../../src/application/whiteboard/mural-ports";
import { WhiteboardMuralController } from "../../src/interface/controllers/whiteboard-mural.controller";
const principal: Principal = { orgId: toOrgId("org-a"), userId: "user-a" };
const service = (
  values: Partial<Record<keyof MuralDirectImport, unknown>> = {},
) =>
  ({
    connection: vi.fn(async () => ({
      connected: false,
      scopes: [],
      connectedAt: null,
    })),
    start: vi.fn(),
    callback: vi.fn(),
    listWorkspaces: vi.fn(),
    listMurals: vi.fn(),
    preview: vi.fn(),
    disconnect: vi.fn(),
    ...values,
  }) as unknown as MuralDirectImport;
describe("Whiteboard Mural controller boundary", () => {
  it("requires a principal before listing or preview", async () => {
    const target = service(),
      controller = new WhiteboardMuralController(target);
    await expect(
      controller.workspaces(null as unknown as Principal, {}),
    ).rejects.toThrow("principal is empty");
    await expect(
      controller.preview(null as unknown as Principal, {
        muralId: "m",
        packageBoardId: "57d83843-21e2-40ae-8c1c-571d0ad63c80",
      }),
    ).rejects.toThrow("principal is empty");
    expect(target.listWorkspaces).not.toHaveBeenCalled();
    expect(target.preview).not.toHaveBeenCalled();
  });
  it("returns only a validated relative callback target", async () => {
    const good = service({
      callback: vi.fn(async () => ({
        returnTo: "/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80",
      })),
    });
    await expect(
      new WhiteboardMuralController(good).callback(principal, {
        state: "s",
        code: "c",
      }),
    ).resolves.toEqual({
      returnTo: "/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80",
    });
    const forged = service({
      callback: vi.fn(async () => ({ returnTo: "https://evil.test" })),
    });
    await expect(
      new WhiteboardMuralController(forged).callback(principal, {
        state: "s",
        code: "c",
      }),
    ).rejects.toThrow();
  });
  it("maps typed failures without returning remote details", async () => {
    const target = service({
      listWorkspaces: vi.fn(async () => {
        throw new MuralImportError("REMOTE_RATE_LIMITED");
      }),
    });
    await expect(
      new WhiteboardMuralController(target).workspaces(principal, {}),
    ).rejects.toMatchObject({
      status: 429,
      response: { reasonCode: "REMOTE_RATE_LIMITED" },
    });
  });
});
