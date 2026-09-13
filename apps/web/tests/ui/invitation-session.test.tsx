import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const state = vi.hoisted(() => ({
  token: null as string | null,
  session: null as null | { userId: string; orgIds: string[] },
  apiRequest: vi.fn(), startSession: vi.fn(), navigate: vi.fn(),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(),
  apiRequest: state.apiRequest, getStoredSessionToken: () => state.token,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: state.session, startSession: state.startSession }),
}));
import { InviteActivation } from "@/components/entry/invite-activation";
import { LinkActivation } from "@/components/entry/link-activation";

const session = { sessionToken: "new-bearer", userId: "new-user", orgs: ["invited-org"], expiresAt: "2099-01-01T00:00:00Z" };
const response = { sessionId: "not-a-bearer", userId: session.userId, orgId: "invited-org", orgRole: "consultant", teamId: "", session };
beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  state.session = null;
  state.apiRequest.mockReset().mockResolvedValue(response);
  state.startSession.mockReset().mockImplementation(async (next: typeof session) => { state.token = next.sessionToken; });
  vi.stubGlobal("location", { ...window.location, assign: state.navigate });
});

for (const kind of ["single", "shared"] as const) {
  const prefix = kind === "single" ? "activate" : "link-activate";
  function submit() {
    render(kind === "single" ? <InviteActivation token="test-invitation" /> : <LinkActivation token="test-invitation" />);
    if (kind === "shared") fireEvent.change(screen.getByTestId(`${prefix}-email`), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByTestId(`${prefix}-name`), { target: { value: "New User" } });
    fireEvent.change(screen.getByTestId(`${prefix}-pwd`), { target: { value: "long-enough-password" } });
    fireEvent.submit(screen.getByTestId(`${prefix}-form`));
  }
  describe(`${kind} invitation session`, () => {
    it("starts the returned bearer session before entering projects", async () => {
      submit();
      await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/projects"));
      expect(state.startSession).toHaveBeenCalledTimes(1);
      expect(state.startSession).toHaveBeenCalledWith(session, { expectedToken: null });
      expect(state.token).toBe("new-bearer");
      expect(state.navigate).not.toHaveBeenCalledWith("/login");
    });
    it("does not replace an already signed-in account", async () => {
      state.token = "existing-bearer";
      submit();
      await screen.findByTestId(`${prefix}-success`);
      expect(state.startSession).not.toHaveBeenCalled();
      expect(state.token).toBe("existing-bearer");
      expect(screen.getByText(/当前登录账号已保留/)).toBeTruthy();
    });
    it("does not replace another tab's login while activation was pending", async () => {
      state.apiRequest.mockImplementation(async () => { state.token = "other-tab-bearer"; return response; });
      submit();
      await screen.findByTestId(`${prefix}-success`);
      expect(state.startSession).not.toHaveBeenCalled();
      expect(state.token).toBe("other-tab-bearer");
    });
    it("completed activation with failed hydration offers login, never activation retry", async () => {
      state.startSession.mockRejectedValue(new Error("identity unavailable"));
      submit();
      await screen.findByText(/自动登录未完成/);
      expect(screen.queryByTestId(`${prefix}-retry`)).toBeNull();
      expect(state.apiRequest).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId(`${prefix}-success-continue`));
      expect(state.navigate).toHaveBeenCalledWith("/login");
    });
    it("known issuance failure offers password-login recovery without resubmission", async () => {
      state.apiRequest.mockRejectedValue(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}));
      submit();
      await screen.findByText(/自动登录未完成/);
      expect(screen.queryByTestId(`${prefix}-retry`)).toBeNull();
      expect(state.startSession).not.toHaveBeenCalled();
    });
  });
}

it("existing-account activation retains old organizations and enters the invited organization", async () => {
  state.token = "existing-bearer";
  state.session = { userId: session.userId, orgIds: ["old-org"] };
  render(<InviteActivation token="test-invitation" />);
  fireEvent.click(screen.getByTestId("activate-mode-existing"));
  fireEvent.submit(screen.getByTestId("activate-form"));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/projects"));
  expect(state.apiRequest.mock.calls[0]![1].sessionToken).toBe("existing-bearer");
  expect(state.startSession).toHaveBeenCalledWith({ ...session, orgs: ["invited-org", "old-org"] }, { expectedToken: "existing-bearer" });
});


it.each(["changed-token", "different-user"])("existing-account %s response cannot replace the current session", async (kind) => {
  state.token = "existing-bearer";
  state.session = { userId: session.userId, orgIds: ["old-org"] };
  state.apiRequest.mockImplementation(async () => {
    if (kind === "changed-token") state.token = "other-tab-bearer";
    return { ...response, session: { ...session, userId: kind === "different-user" ? "different-user" : session.userId } };
  });
  render(<InviteActivation token="test-invitation" />);
  fireEvent.click(screen.getByTestId("activate-mode-existing"));
  fireEvent.submit(screen.getByTestId("activate-form"));
  await screen.findByText(/当前登录账号已保留/);
  expect(state.startSession).not.toHaveBeenCalled();
  expect(state.navigate).not.toHaveBeenCalled();
});
