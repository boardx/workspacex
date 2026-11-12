/** #6405 replaces the retired member-list reviewer-function controls (#852). */
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MembersTab } from "@/components/org-admin/org-admin-screen";

afterEach(() => vi.unstubAllGlobals());
for (const isAdmin of [true, false]) {
  it(`keeps only organization membership controls, admin=${isAdmin}`, async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ members: [{
      userId: "u-member", displayName: "Member", email: "member@example.test", orgRole: "consultant",
      teamId: null, joinedAt: "2026-01-01", status: "active",
    }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MembersTab orgId="org-simple" isAdmin={isAdmin} />);
    const row = await screen.findByTestId("org-admin-member-u-member");
    await waitFor(() => expect(row).toHaveTextContent("成员"));
    expect(row.querySelector('[data-testid*="reviewer-function"]')).toBeNull();
    expect(fetchMock.mock.calls.every(call => !String(call[0]).includes("skill-reviewer"))).toBe(true);
    if (isAdmin) {
      fireEvent.keyDown(screen.getByTestId("org-admin-member-u-member-org-role"), { key: "Enter" });
      const menu = await screen.findByRole("menu");
      expect(within(menu).getAllByRole("menuitemradio").map(option => option.textContent).sort())
        .toEqual(["成员", "管理员"].sort());
    } else {
      expect(screen.queryByTestId("org-admin-member-u-member-org-role")).toBeNull();
    }
  });
}
