import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { SharedInviteLinksSection } from "@/components/org-admin/shared-invite-links";
function Switch() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>Chinese</button>; }
afterEach(() => vi.unstubAllGlobals());
it("switches shared invite labels and one-time reveal without refetching or changing original values", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ links: [{ linkId: "link-original", orgRole: "consultant", status: "active", expiry: "7d", expiresAt: "2026-12-01T00:00:00Z", usedCount: 2, maxUses: null, createdBy: "管理员 {name}", createdByUserId: "peer" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  render(<I18nProvider initialLocale="en"><Switch /><SharedInviteLinksSection orgId="org-original" currentUserId="self" reveal={{ url: "https://example.test/join?lt=original", orgRole: "consultant", kind: "created" }} onReveal={vi.fn()} /></I18nProvider>);
  const row = await screen.findByTestId("org-admin-shared-link-link-original");
  expect(row).toHaveTextContent("Member");
  expect(row).toHaveTextContent("Active");
  expect(row).toHaveTextContent("7 days");
  expect(screen.getByTestId("org-admin-shared-link-once-note")).toHaveTextContent("only once");
  fireEvent.click(screen.getByText("Chinese"));
  expect(row).toHaveTextContent("普通成员");
  expect(row).toHaveTextContent("生效中");
  expect(row).toHaveTextContent("7 天");
  expect(row).toHaveTextContent("管理员 {name}");
  expect(screen.getByTestId("org-admin-shared-link-url")).toHaveValue("https://example.test/join?lt=original");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("replaces approval with an ordinary-member link action and preserves create payload in English", async () => {
  const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(init?.method === "POST" ? { status: "active", linkToken: "original-token" } : { links: [{ linkId: "own", orgRole: "admin", status: "pending-review", expiry: "7d", expiresAt: null, usedCount: 0, maxUses: null, createdBy: "林可", createdByUserId: "self" }] }), { status: 200, headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", fetch);
  const reveal = vi.fn();
  render(<I18nProvider initialLocale="en"><Switch /><SharedInviteLinksSection orgId="org-original" currentUserId="self" reveal={null} onReveal={reveal} /></I18nProvider>);
  expect(await screen.findByTestId("org-admin-shared-link-own-replace")).toHaveTextContent("Create replacement link");
  expect(screen.queryByTestId("org-admin-shared-link-role")).toBeNull();
  expect(screen.queryByTestId("org-admin-shared-link-own-approve")).toBeNull();
  fireEvent.change(screen.getByTestId("org-admin-shared-link-max-uses"), { target: { value: "3" } });
  fireEvent.click(screen.getByTestId("org-admin-shared-link-create"));
  await screen.findByTestId("org-admin-shared-link-banner");
  const write = fetch.mock.calls.find((call) => call[1]?.method === "POST");
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ orgId: "org-original", orgRole: "consultant", expiry: "7d", maxUses: 3 });
  expect(screen.getByTestId("org-admin-shared-link-banner")).toHaveTextContent("Shared link created");
  fireEvent.click(screen.getByText("Chinese"));
  expect(screen.getByTestId("org-admin-shared-link-banner")).toHaveTextContent("共享链接已创建");
  expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("original-token"), orgRole: "consultant", kind: "created" }));
});

it("regular revoke failure reports its actual error without claiming a replacement exists", async () => {
  const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(
    init?.method === "POST" ? { reasonCode: "VERSION_CHANGED" } : { links: [{ linkId: "active", orgRole: "consultant", status: "active", expiry: "7d", expiresAt: "2026-12-01T00:00:00Z", usedCount: 0, maxUses: null, createdBy: "Admin", createdByUserId: "self" }] },
  ), { status: init?.method === "POST" ? 409 : 200, headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", fetch);
  const reveal = vi.fn();
  render(<I18nProvider initialLocale="en"><SharedInviteLinksSection orgId="org" currentUserId="self" reveal={null} onReveal={reveal} /></I18nProvider>);
  fireEvent.click(await screen.findByTestId("org-admin-shared-link-active-revoke"));
  fireEvent.click(screen.getByTestId("org-admin-shared-link-active-revoke-confirm-yes"));
  expect(await screen.findByTestId("org-admin-shared-link-banner")).toHaveTextContent(/changed|revoked|decided/i);
  expect(screen.getByTestId("org-admin-shared-link-banner")).not.toHaveTextContent("The new invitation link is shown");
  expect(reveal).not.toHaveBeenCalled();
});

it("replacement keeps the new link and reports partial failure if the old link cannot be revoked", async () => {
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const revoke = String(url).endsWith("/revoke");
    const body = init?.method === "POST" ? revoke ? { reasonCode: "AUTH_SERVICE_UNAVAILABLE" } : { status: "active", linkToken: "replacement-token" } : { links: [{ linkId: "legacy", orgRole: "admin", status: "pending-review", expiry: "7d", expiresAt: null, usedCount: 0, maxUses: null, createdBy: "Admin", createdByUserId: "self" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: revoke ? 503 : 200, headers: { "content-type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetch);
  const reveal = vi.fn();
  render(<I18nProvider initialLocale="en"><SharedInviteLinksSection orgId="org" currentUserId="self" reveal={null} onReveal={reveal} /></I18nProvider>);
  fireEvent.click(await screen.findByTestId("org-admin-shared-link-legacy-replace"));
  expect(await screen.findByTestId("org-admin-shared-link-banner")).toHaveTextContent("The new invitation link is shown, but the old link could not be revoked");
  expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("replacement-token"), orgRole: "consultant" }));
});
