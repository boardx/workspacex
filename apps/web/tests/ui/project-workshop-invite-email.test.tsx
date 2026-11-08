import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ProjectInvitePanel } from "@/components/project/project-invite-panel";
import { issueProjectInviteLink } from "@/lib/live-project-invite";
vi.mock("@/lib/live-project-invite", async (original) => ({ ...await original<typeof import("@/lib/live-project-invite")>(), issueProjectInviteLink: vi.fn() }));
afterEach(cleanup);
describe("workshop email invitation", () => {
  it("sends through the API and confirms mail submission", async () => {
    vi.mocked(issueProjectInviteLink).mockResolvedValue({ token: "t", linkId: "l", url: "/", inviteCode: null, qrPayload: null, emailDelivery: "sent" });
    render(<ProjectInvitePanel projectId="p" />);
    fireEvent.change(screen.getByTestId("project-invite-email"), { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByTestId("project-invite-send-email"));
    await waitFor(() => expect(screen.getByTestId("project-invite-email-sent")).toBeTruthy());
    expect(issueProjectInviteLink).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "p", recipientEmail: "member@example.com", identity: "member" }));
  });
  it("keeps a copyable link when mail fails", async () => {
    vi.mocked(issueProjectInviteLink).mockResolvedValue({ token: "t", linkId: "l", url: "/", inviteCode: null, qrPayload: null, emailDelivery: "failed" });
    render(<ProjectInvitePanel projectId="p" />);
    fireEvent.change(screen.getByTestId("project-invite-email"), { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByTestId("project-invite-send-email"));
    await waitFor(() => expect(screen.getByTestId("project-invite-error")).toHaveTextContent("邮件发送失败"));
    expect((screen.getByTestId("project-invite-link-url") as HTMLInputElement).value).toContain("/projects/join?t=t");
  });
});
