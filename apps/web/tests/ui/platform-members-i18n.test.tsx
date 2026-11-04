/** Component evidence only: real SDK and fetch boundary, no authorization/persistence claim. */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlatformMembersScreen } from "@/components/admin/platform-members-screen";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { translate } from "@/lib/i18n/messages";
import type { PlatformMemberRow, PlatformMembershipRow } from "@/lib/live-platform-members";

const viewer = vi.hoisted(() => ({ id: "ops" }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { userId: viewer.id } }),
}));
const rawName = "林可 {previous} {next}";
const rawOrg = "远洋 {name}";
type RosterFixture = {
  members: [PlatformMemberRow, Omit<PlatformMemberRow, "memberships"> & {
    memberships: [PlatformMembershipRow, PlatformMembershipRow];
  }];
};
const roster: RosterFixture = { members: [
  { userId: "ops", displayName: "Ops", email: "ops@example.test", emailVerified: true, createdAt: "2026-01-01T00:00:00Z", platformSuperuser: true, platformAdmin: false, memberships: [] },
  { userId: "target", displayName: rawName, email: "raw+{name}@example.test", emailVerified: false, createdAt: "2026-02-01T00:00:00Z", platformSuperuser: false, platformAdmin: false, memberships: [
    { orgId: "a", orgName: rawOrg, orgRole: "consultant", teamId: null, joinedAt: "2026-02-02T00:00:00Z" },
    { orgId: "b", orgName: "Other", orgRole: "admin", teamId: null, joinedAt: "2026-03-02T00:00:00Z" },
  ] },
] };
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}
function route(action?: (method: string) => Response | Promise<Response>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && String(url).endsWith("/platform/members")) return Promise.resolve(json(roster));
    if (action) return Promise.resolve(action(method));
    const body = JSON.parse(String(init?.body));
    return Promise.resolve(json(method === "PATCH"
      ? { userId: "target", orgId: "a", orgRole: body.orgRole, previousOrgRole: "consultant" }
      : { userId: "target", platformAdmin: method === "POST" }));
  });
}
function Language() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>;
}
function show() { return render(<I18nProvider initialLocale="en"><Language /><PlatformMembersScreen state="default" /></I18nProvider>); }
const switchTo = (locale: "en" | "zh-CN") => fireEvent.click(screen.getByText(locale === "en" ? "EN test" : "ZH test"));
const roleId = (org = "a") => `admin-platform-member-target-org-${org}-role`;
async function choose(role: string, org = "a") {
  fireEvent.click(await screen.findByTestId(roleId(org)));
  fireEvent.click(await screen.findByTestId(`${roleId(org)}-option-${role}`));
}
function requests() { return fetchMock.mock.calls.map(([url, init]) => ({ path: new URL(String(url), "http://localhost").pathname.replace(/^\/api/, ""), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined })); }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
beforeEach(() => { viewer.id = "ops"; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("platform members complete localization", () => {
  it("renders the complete English page, raw authored braces, shared roles and locale dates", async () => {
    route(); show();
    const list = await screen.findByTestId("admin-platform-members-list");
    expect(screen.getByRole("heading", { name: "Platform members" })).toBeTruthy();
    expect(screen.getByTestId("admin-platform-members-count")).toHaveTextContent(/\b2\b/);
    expect(screen.getByTestId("admin-platform-members-count")).toHaveTextContent(/accounts/i);
    expect(screen.getByTestId("admin-platform-member-ops-superuser")).toHaveTextContent(/platform superuser/i);
    expect(screen.getByTestId("admin-platform-member-ops-no-org")).toHaveTextContent(/not.*joined|no.*organization/i);
    expect(within(list).getByText(/email.*unverified|unverified.*email/i)).toBeTruthy();
    expect(screen.getByTestId(roleId())).toHaveTextContent(translate("en", "role.consultant"));
    expect(screen.getByTestId(roleId("b"))).toHaveTextContent(translate("en", "role.admin"));
    expect(list).toHaveTextContent(new Date(roster.members[1].createdAt).toLocaleDateString("en-US"));
    expect(list).toHaveTextContent(new Date(roster.members[1].memberships[0].joinedAt).toLocaleDateString("en-US"));
    expect(screen.getByText(rawName)).toBeTruthy(); expect(screen.getByText(rawOrg)).toBeTruthy();
    expect(screen.getByText("raw+{name}@example.test")).toBeTruthy();
    expect(screen.getByTestId("admin-platform-member-target-admin-toggle")).toHaveTextContent(/grant|make|set as/i);
    const member = screen.getByTestId("admin-platform-member-target");
    const avatar = within(member).getByText(rawName.slice(0, 1), { exact: true });
    expect(avatar).toHaveTextContent(rawName.slice(0, 1));
    const authoredNodes = [screen.getByText(rawName), screen.getByText(rawOrg), screen.getByText("raw+{name}@example.test"), avatar];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => authoredNodes.some((authored) => authored.contains(node)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let copy = "";
    while (walker.nextNode()) copy += walker.currentNode.textContent;
    expect(copy).not.toMatch(/[\u3400-\u9fff]/);
  });

  it("switches an open role popover and dates without losing its selection or making any request", async () => {
    route(); show(); fireEvent.click(await screen.findByTestId(roleId()));
    expect(screen.getByRole("option", { name: translate("en", "role.consultant") })).toHaveAttribute("aria-selected", "true");
    switchTo("zh-CN");
    expect(screen.getByRole("option", { name: translate("zh-CN", "role.consultant") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(roleId())).toHaveAccessibleName(new RegExp(rawOrg.replace(/[{}]/g, "\\$&")));
    expect(screen.getByTestId("admin-platform-members-list")).toHaveTextContent(new Date(roster.members[1].createdAt).toLocaleDateString("zh-CN"));
    switchTo("en");
    for (const role of ["consultant", "lead", "compliance", "admin"] as const) expect(screen.getByRole("option", { name: translate("en", `role.${role}`) })).toBeTruthy();
    expect(requests()).toEqual([{ path: "/platform/members", method: "GET", body: undefined }]);
  });

  it("keeps a deferred list request owned across language switches and exposes localized loading", async () => {
    const list = deferred(); fetchMock.mockReturnValue(list.promise); show();
    const loading = screen.getByTestId("admin-platform-members-loading");
    expect(loading).toHaveAccessibleName(/loading/i);
    switchTo("zh-CN"); expect(loading).toHaveAccessibleName(/加载/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => list.resolve(json(roster)));
    expect(await screen.findByTestId(roleId())).toHaveTextContent("顾问");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a pending PATCH and only updates its returned membership without restarting the 4000ms notice", async () => {
    const pending = deferred(); route(() => pending.promise); show();
    await screen.findByTestId(roleId());
    await choose("lead");
    vi.useFakeTimers();
    expect(screen.getByTestId(roleId())).toHaveAttribute("aria-disabled", "true");
    switchTo("zh-CN"); fireEvent.click(screen.getByTestId(roleId()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(json({ userId: "target", orgId: "a", orgRole: "lead", previousOrgRole: "consultant" })));
    await flush();
    expect(screen.getByTestId(roleId())).toHaveTextContent("项目负责人");
    expect(screen.getByTestId(roleId("b"))).toHaveTextContent("管理员");
    expect(screen.getByTestId("admin-platform-members-banner")).toHaveTextContent(`${rawName} · ${rawOrg}`);
    act(() => vi.advanceTimersByTime(2000)); switchTo("en");
    expect(screen.getByTestId("admin-platform-members-banner")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("admin-platform-members-banner")).toHaveTextContent("Consultant → Project lead");
    act(() => vi.advanceTimersByTime(1999)); expect(screen.getByTestId("admin-platform-members-banner")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1)); expect(screen.queryByTestId("admin-platform-members-banner")).toBeNull();
    expect(requests()).toEqual([
      { path: "/platform/members", method: "GET", body: undefined },
      { path: "/platform/members/target/organizations/a/role", method: "PATCH", body: { userId: "target", orgId: "a", orgRole: "lead" } },
    ]);
  });

  it("keeps grant/revoke pending across switches, translates each success and sends canonical bodies once", async () => {
    let reply = deferred(); route(() => reply.promise); show();
    const toggle = await screen.findByTestId("admin-platform-member-target-admin-toggle");
    fireEvent.click(toggle); switchTo("zh-CN"); expect(toggle).toBeDisabled(); fireEvent.click(toggle);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => reply.resolve(json({ userId: "target", platformAdmin: true })));
    expect(await screen.findByTestId("admin-platform-member-target-admin-badge")).toHaveTextContent("平台管理员");
    switchTo("en"); expect(screen.getByTestId("admin-platform-members-banner")).toHaveTextContent(/platform administrator/i);
    expect(toggle).toHaveTextContent(/revoke/i);
    reply = deferred(); fireEvent.click(toggle); switchTo("zh-CN"); expect(toggle).toBeDisabled();
    await act(async () => reply.resolve(json({ userId: "target", platformAdmin: false })));
    switchTo("en"); expect(screen.queryByTestId("admin-platform-member-target-admin-badge")).toBeNull();
    expect(screen.getByTestId("admin-platform-members-banner")).toHaveTextContent(/revoked|removed/i);
    expect(requests().slice(1)).toEqual(["POST", "DELETE"].map((method) => ({ path: "/platform/members/target/platform-admin", method, body: { userId: "target" } })));
  });

  it.each([
    ["LAST_ADMIN", 409, /last.*administrator/i, /最后.*管理员/, "b", "consultant"],
    ["MEMBER_NOT_FOUND", 404, /membership.*(no longer|exist)|no longer.*member/i, /成员.*不存在/, "a", "lead"],
    ["NOT_PLATFORM_SUPERUSER", 403, /platform superuser.*platform administrator|platform administrator.*platform superuser/i, /平台.*管理员/, "a", "lead"],
  ] as const)("retranslates PATCH %s with next steps and preserves the existing role", async (reasonCode, status, english, chinese, org, next) => {
    route(() => json({ reasonCode }, status)); show(); await choose(next, org);
    const error = await screen.findByTestId(`${roleId(org)}-error`);
    expect(error).toHaveAttribute("role", "alert"); expect(error).toHaveTextContent(english);
    switchTo("zh-CN"); expect(error).toHaveTextContent(chinese);
    expect(screen.getByTestId(roleId(org))).toHaveTextContent(org === "b" ? "管理员" : "顾问");
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(screen.queryByTestId("admin-platform-members-banner")).toBeNull();
  });

  it.each(["POST", "DELETE"])("renders operation-specific %s 403 as superuser-only and preserves admin state", async (method) => {
    const data = structuredClone(roster); data.members[1].platformAdmin = method === "DELETE";
    route(() => json({ reasonCode: "NOT_PLATFORM_SUPERUSER" }, 403));
    fetchMock.mockImplementationOnce(() => Promise.resolve(json(data))); show();
    fireEvent.click(await screen.findByTestId("admin-platform-member-target-admin-toggle"));
    const error = await screen.findByTestId("admin-platform-member-target-admin-error");
    expect(error).toHaveTextContent(/only.*platform superuser/i);
    switchTo("zh-CN"); expect(error).toHaveTextContent(/只有平台超管/);
    expect(Boolean(screen.queryByTestId("admin-platform-member-target-admin-badge"))).toBe(method === "DELETE");
    expect(requests()[1].method).toBe(method); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("describes a removed account separately from a removed organization membership", async () => {
    route(() => json({ reasonCode: "MEMBER_NOT_FOUND" }, 404)); show();
    fireEvent.click(await screen.findByTestId("admin-platform-member-target-admin-toggle"));
    const error = await screen.findByTestId("admin-platform-member-target-admin-error");
    expect(error).toHaveTextContent(/account.*(no longer|exist)|no longer.*account/i);
    expect(error).toHaveTextContent(/refresh/i);
    switchTo("zh-CN"); expect(error).toHaveTextContent(/账号.*不存在/);
    expect(screen.queryByTestId("admin-platform-member-target-admin-badge")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets a platform operator edit organization roles without superuser grant/revoke controls", async () => {
    viewer.id = "target"; const data = structuredClone(roster); data.members[1].platformAdmin = true;
    route(); fetchMock.mockImplementationOnce(() => Promise.resolve(json(data))); show();
    expect(await screen.findByTestId("admin-platform-member-target-admin-badge")).toHaveTextContent(/platform administrator/i);
    expect(screen.queryByTestId("admin-platform-member-target-admin-toggle")).toBeNull();
    await choose("lead"); await waitFor(() => expect(screen.getByTestId(roleId())).toHaveTextContent("Project lead"));
  });

  it("shows ordinary organization administrator roster denial, never empty or retry", async () => {
    viewer.id = "ordinary-org-admin"; fetchMock.mockResolvedValue(json({ reasonCode: "NOT_PLATFORM_SUPERUSER" }, 403)); show();
    const denial = await screen.findByTestId("admin-platform-members-forbidden");
    expect(denial).toHaveTextContent(/platform superuser.*platform administrator/i);
    expect(denial).toHaveTextContent(/organization/i); switchTo("zh-CN"); expect(denial).toHaveTextContent(/组织管理/);
    expect(screen.queryByTestId("admin-platform-members-empty")).toBeNull();
    expect(screen.queryByTestId("admin-platform-members-failed")).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "server", "unknown"])("keeps %s list failure distinct from empty/denied and hides private diagnostics on retry", async (kind) => {
    const privateDetail = "PRIVATE_DATABASE_TOKEN_xyz";
    if (kind === "network") fetchMock.mockRejectedValue(new Error(privateDetail));
    else fetchMock.mockResolvedValue(json({ reasonCode: kind === "unknown" ? privateDetail : "DEPENDENCY_UNAVAILABLE", message: privateDetail }, 503));
    show(); const failed = await screen.findByTestId("admin-platform-members-failed");
    expect(failed).toHaveTextContent(/could not (?:load|read|retrieve).*?(?:roster|member|account)|(?:roster|member list|account list).*?(?:unavailable|failed)/i); expect(document.body).not.toHaveTextContent(privateDetail);
    if (kind === "server") expect(failed).not.toHaveTextContent("DEPENDENCY_UNAVAILABLE");
    expect(screen.queryByTestId("admin-platform-members-empty")).toBeNull(); expect(screen.queryByTestId("admin-platform-members-forbidden")).toBeNull();
    switchTo("zh-CN"); expect(failed).toHaveTextContent(/失败|没能|不可用/); expect(fetchMock).toHaveBeenCalledTimes(1);
    if (kind === "server") expect(failed).not.toHaveTextContent("DEPENDENCY_UNAVAILABLE");
    fetchMock.mockResolvedValue(json({ members: [] })); fireEvent.click(within(failed).getByRole("button"));
    expect(await screen.findByTestId("admin-platform-members-empty")).toHaveTextContent(/没有.*账号/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "unknown"])("hides %s mutation diagnostics and retranslates an actionable failure", async (kind) => {
    route(() => kind === "network" ? Promise.reject(new Error("PRIVATE_STACK_xyz")) : json({ reasonCode: "PRIVATE_STACK_xyz", message: "PRIVATE_STACK_xyz" }, 503));
    show(); await choose("lead"); const error = await screen.findByTestId(`${roleId()}-error`);
    expect(error).toHaveTextContent(/failed|try again|unavailable/i); expect(error).not.toHaveTextContent("PRIVATE_STACK_xyz");
    switchTo("zh-CN");
    expect(error).toHaveTextContent(kind === "network" ? /请求没成功/ : /服务器出错/);
    expect(error).toHaveTextContent(/稍后再试/);
    expect(error).not.toHaveTextContent("PRIVATE_STACK_xyz");
    expect(screen.getByTestId(roleId())).toHaveTextContent("顾问"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
