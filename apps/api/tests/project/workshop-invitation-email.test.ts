import { describe, expect, it, vi } from "vitest";
import { orgAdmin } from "@repo/contracts";
import { ProjectInviteController } from "../../src/interface/controllers/project-invite.controller";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
vi.mock("../../src/application/auth/issue-invite-link", () => ({ issueInviteLink: vi.fn() }));
const body = { projectId: "p1", kind: "main" as const, groupId: null, identity: "member" as const, validity: "7d" as const, recipientEmail: "member@example.com" };
function setup(fails = false) {
  const send = fails ? vi.fn().mockRejectedValue(new Error("private provider failure")) : vi.fn().mockResolvedValue(undefined);
  const findProjectMembership = vi.fn().mockResolvedValue({ projectRole: "facilitator" });
  const controller = new ProjectInviteController({} as never, {} as never, { findProjectMembership } as never, { send }, { get: () => "https://app.example.com" });
  vi.mocked(issueInviteLink).mockResolvedValue({ linkId: "l1", token: "secret-token", url: "/old", inviteCode: null, qrPayload: null } as never);
  return { controller, send };
}
const principal = { userId: "u1", orgId: "o1" } as never;
describe("workshop invitation mail", () => {
  it("validates recipient email in the canonical contract", () => {
    expect(orgAdmin.operations.issueInviteLink.in.safeParse({ ...body, recipientEmail: "bad" }).success).toBe(false);
  });
  it("delivers a server constructed link after issuing with persisted project authority", async () => {
    const { controller, send } = setup();
    const result = await controller.issue(principal, "p1", body);
    expect(result.emailDelivery).toBe("sent");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: body.recipientEmail, text: expect.stringContaining("https://app.example.com/projects/join?t=secret-token") }));
    expect(issueInviteLink).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ actorProjectRole: "facilitator", projectId: "p1", orgId: "o1" }));
  });
  it("reports delivery failure while retaining the issued copyable link", async () => {
    const { controller } = setup(true);
    expect(await controller.issue(principal, "p1", body)).toMatchObject({ token: "secret-token", emailDelivery: "failed" });
  });
  it("never sends when project authorization denies issuing", async () => {
    const { controller, send } = setup();
    vi.mocked(issueInviteLink).mockRejectedValueOnce(new Error("denied"));
    await expect(controller.issue(principal, "p1", body)).rejects.toThrow("denied");
    expect(send).not.toHaveBeenCalled();
  });
});
