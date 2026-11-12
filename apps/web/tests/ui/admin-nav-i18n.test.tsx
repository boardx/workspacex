import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ADMIN_NAV, ADMIN_SCOPE_META, type AdminModuleKey } from "@/lib/admin-nav-metadata";
import { LIVE_COUNT_KEYS } from "@/lib/live-admin-nav-counts";
import type { AdminNavCountSource } from "@/lib/admin-nav-counts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { QueryClientTestWrapper } from "../render-with-query";

const navSession = vi.hoisted(() => ({ orgId: null as string | null }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => navSession.orgId ? { session: { currentOrgId: navSession.orgId } } : null,
}));
afterEach(() => { cleanup(); navSession.orgId = null; vi.unstubAllGlobals(); window.localStorage.clear(); });
function Switch() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>Switch Chinese</button>;
}
function Harness({ children }: { children: React.ReactNode }) {
  return <QueryClientTestWrapper><I18nProvider initialLocale="en"><Switch />{children}</I18nProvider></QueryClientTestWrapper>;
}
function sources(brokenMcp = false) {
  return Object.fromEntries(ADMIN_NAV.flatMap((group) => group.items.map((item) => [item.key, () => {
    if (brokenMcp && item.key === "mcp") throw new Error("unavailable");
    return 0;
  }]))) as Record<AdminModuleKey, AdminNavCountSource>;
}

describe("shared admin navigation localization", () => {
  it("switches the organization sidebar in place while retaining canonical routes and scope", () => {
    const before = JSON.stringify({ ADMIN_NAV, ADMIN_SCOPE_META });
    render(<AdminNav active="org-members" countSources={sources()} />, { wrapper: Harness });
    const nav = screen.getByRole("navigation", { name: "Organization modules" });
    expect(nav).toHaveAttribute("data-admin-scope", "org");
    const members = screen.getByTestId("admin-nav-org-members");
    expect(members).toHaveTextContent("Members");
    expect(members).toHaveAttribute("href", "/org-admin/members");
    expect(members).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-nav-overview-count")).toHaveAccessibleName("Count for Overview: 0");
    expect(screen.queryByTestId("admin-nav-agent")).toBeNull();
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByRole("navigation", { name: "组织后台模块" })).toBe(nav);
    expect(screen.getByTestId("admin-nav-org-members")).toBe(members);
    expect(members).toHaveTextContent("成员");
    expect(members).toHaveAttribute("href", "/org-admin/members");
    expect(members).toHaveAttribute("aria-current", "page");
    expect(JSON.stringify({ ADMIN_NAV, ADMIN_SCOPE_META })).toBe(before);
  });

  it("translates platform groups and count failures while keeping unavailable distinct from zero", () => {
    render(<AdminNav active="mcp" countSources={sources(true)} />, { wrapper: Harness });
    expect(screen.getByRole("navigation", { name: "Platform modules" })).toHaveAttribute("data-admin-scope", "platform");
    expect(screen.getByText("AI capabilities", { exact: true })).toBeVisible();
    expect(screen.getByText("Operations", { exact: true })).toBeVisible();
    const agent = screen.getByTestId("admin-nav-agent");
    expect(agent).toHaveAttribute("href", "/platform-admin/agent");
    expect(agent).toHaveTextContent("Agent directory");
    const unavailable = screen.getByTestId("admin-nav-mcp-count");
    expect(unavailable).toHaveTextContent("—");
    expect(unavailable).toHaveAccessibleName("MCP count unavailable");
    expect(unavailable).toHaveAttribute("title", expect.stringContaining("not zero"));
    expect(screen.getByTestId("admin-nav-skill-count")).toHaveTextContent("0");
    expect(screen.queryByTestId("admin-nav-org-members")).toBeNull();
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByTestId("admin-nav-mcp-count")).toBe(unavailable);
    expect(unavailable).toHaveAccessibleName("MCP 计数暂不可用");
    expect(unavailable).toHaveTextContent("—");
    expect(agent).toHaveAttribute("href", "/platform-admin/agent");
  });
});

it("keeps the live count query and its result when the sidebar locale changes", async () => {
  navSession.orgId = "org-nav-locale";
  window.localStorage.setItem("wsx.sessionToken", "nav-locale-test-token");
  const requests = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname.endsWith("/feedback/drafts/count")) {
      return new Response(JSON.stringify({ count: 4 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const kind = url.searchParams.get("kind");
    const rows = kind === "agent" ? ["a1", "a2"].map(id => ({
      id, orgId: navSession.orgId, kind: "agent", name: id, scope: "org-wide", enabled: true,
      endpoint: null, disabledReason: null,
    })) : [];
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", requests);
  render(<AdminNav active="agent" />, { wrapper: Harness });
  const count = screen.getByTestId("admin-nav-feedback-drafts-count");
  await waitFor(() => expect(count).toHaveTextContent("4"));
  expect(requests).toHaveBeenCalledTimes(LIVE_COUNT_KEYS.length);
  expect(screen.getByTestId("admin-nav-skill-count")).toHaveTextContent("—");
  expect(screen.getByTestId("admin-nav-agent-count")).toHaveTextContent("—");
  expect(screen.getByTestId("admin-nav-mcp-count")).toHaveTextContent("—");
  await act(async () => { fireEvent.click(screen.getByText("Switch Chinese")); });
  expect(screen.getByRole("navigation", { name: "平台后台模块" })).toBeVisible();
  expect(screen.getByTestId("admin-nav-feedback-drafts-count")).toBe(count);
  expect(count).toHaveAccessibleName(expect.stringContaining("共 4 项"));
  expect(requests).toHaveBeenCalledTimes(LIVE_COUNT_KEYS.length);
});
