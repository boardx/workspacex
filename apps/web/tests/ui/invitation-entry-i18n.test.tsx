import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { orgAdmin } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";
import { I18nProvider } from "@/lib/i18n/provider";
const state = vi.hoisted(() => ({ token: null as string | null, request: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: state.request, getStoredSessionToken: () => state.token }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: null, startSession: state.start }) }));
import { InviteActivation } from "@/components/entry/invite-activation";
import { LinkActivation } from "@/components/entry/link-activation";
const enteredText = "original-input-phrase";
const claims = { org: "original-org", role: "original-role", team: "original-team" };
function locale(value: "en" | "zh-CN") { fireEvent.change(screen.getByTestId("language-switcher"), { target: { value } }); }
function show(kind: "single" | "shared") {
  return render(<I18nProvider initialLocale="en">{kind === "single" ? <InviteActivation token="original-invite" claims={claims} /> : <LinkActivation token="original-link" />}</I18nProvider>);
}
function fill(kind: "single" | "shared") {
  const prefix = kind === "single" ? "activate" : "link-activate";
  if (kind === "shared") fireEvent.change(screen.getByTestId(`${prefix}-email`), { target: { value: "person@example.test" } });
  fireEvent.change(screen.getByTestId(`${prefix}-name`), { target: { value: "原文 Alice" } });
  fireEvent.change(screen.getByTestId(`${prefix}-pwd`), { target: { value: enteredText } });
  return prefix;
}
beforeEach(() => { state.token = null; state.request.mockReset(); state.start.mockReset(); localStorage.clear(); });
afterEach(cleanup);
for (const kind of ["single", "shared"] as const) {
  it(`${kind}: preserves original credentials, claims and stored invalid-link failure across locale changes`, async () => {
    state.request.mockRejectedValueOnce(new ApiError(400, "INVITE_NOT_FOUND", {}));
    show(kind);
    expect(screen.getByRole("heading", { name: kind === "single" ? "Activate organization invitation" : "Join organization" })).toBeTruthy();
    const prefix = fill(kind);
    locale("zh-CN");
    expect((screen.getByTestId(`${prefix}-name`) as HTMLInputElement).value).toBe("原文 Alice");
    expect((screen.getByTestId(`${prefix}-pwd`) as HTMLInputElement).value).toBe(enteredText);
    locale("en");
    fireEvent.submit(screen.getByTestId(`${prefix}-form`));
    expect(await screen.findByText(/This invitation link is invalid or no longer valid/)).toBeTruthy();
    expect(state.request).toHaveBeenCalledWith(kind === "single" ? orgAdmin.operations.activateOrgMember.path : orgAdmin.operations.activateViaOrgInviteLink.path, expect.objectContaining(kind === "single" ? {
      query: claims, sessionToken: null, body: { token: "original-invite", mode: "new-account", profile: { name: "原文 Alice", password: enteredText }, sessionId: null },
    } : { sessionToken: null, body: { token: "original-link", email: "person@example.test", profile: { name: "原文 Alice", password: enteredText } } }));
    locale("zh-CN");
    expect(screen.getByText(/链接无效或已失效/)).toBeTruthy();
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(state.start).not.toHaveBeenCalled();
  });
  it(`${kind}: translates preserved-account completion without replacing the session or repeating activation`, async () => {
    state.token = "existing-account-session";
    const output = (kind === "single" ? orgAdmin.operations.activateOrgMember : orgAdmin.operations.activateViaOrgInviteLink).out.parse({
      userId: "new-user", orgId: "new-org", orgRole: "consultant", teamId: "", sessionId: "new-session-id",
      session: { sessionToken: "new-session", userId: "new-user", orgs: ["new-org"], expiresAt: "2099-01-01T00:00:00Z" },
    });
    state.request.mockResolvedValueOnce(output);
    show(kind);
    fireEvent.click(screen.getByTestId(`${kind === "single" ? "activate" : "link-activate"}-mode-new`));
    const prefix = fill(kind);
    fireEvent.submit(screen.getByTestId(`${prefix}-form`));
    expect(await screen.findByText(/Your current signed-in account has been preserved/)).toBeTruthy();
    locale("zh-CN");
    expect(screen.getByText(/当前登录账号已保留/)).toBeTruthy();
    expect(state.token).toBe("existing-account-session");
    expect(state.start).not.toHaveBeenCalled();
    expect(state.request).toHaveBeenCalledTimes(1);
  });
}
it("preserves existing-account invitation mode and original session token while translating its unavailable result", async () => {
  state.token = "existing-account-session";
  state.request.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  show("single");
  fireEvent.click(screen.getByTestId("activate-mode-existing"));
  locale("zh-CN"); locale("en");
  fireEvent.submit(screen.getByTestId("activate-form"));
  expect(await screen.findByText(/The service is temporarily unavailable/)).toBeTruthy();
  expect(state.request).toHaveBeenCalledWith(orgAdmin.operations.acceptOrgInvite.path, expect.objectContaining({ query: claims, sessionToken: state.token, body: { token: "original-invite" } }));
  locale("zh-CN");
  expect(screen.getByText(/服务暂时不可用/)).toBeTruthy();
  expect(state.request).toHaveBeenCalledTimes(1);
});
