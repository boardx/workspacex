import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgAdminLayout from "@/app/org-admin/layout";

const viewer = vi.hoisted(() => ({ role: "consultant", pathname: "/org-admin/members", replace: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", identity: { orgRole: viewer.role } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => viewer.pathname,
  useRouter: () => ({ replace: viewer.replace }),
}));

afterEach(() => {
  cleanup();
  viewer.replace.mockClear();
});

describe("organization administration layout", () => {
  it.each([
    ["/org-admin/members", "/home"],
    ["/org-admin/agent/agent-id", "/home"],
    ["/org-admin/agent", "/agent"],
    ["/org-admin/skill", "/skill"],
  ])("redirects ordinary members from %s without mounting management content", (pathname, destination) => {
    viewer.role = "consultant";
    viewer.pathname = pathname;
    render(<OrgAdminLayout>Administration content</OrgAdminLayout>);
    expect(screen.queryByText("Administration content")).toBeNull();
    expect(viewer.replace).toHaveBeenCalledWith(destination);
  });

  it("renders management content for the current organization's administrator", () => {
    viewer.role = "admin";
    render(<OrgAdminLayout>Administration content</OrgAdminLayout>);
    expect(screen.getByText("Administration content")).toBeInTheDocument();
    expect(viewer.replace).not.toHaveBeenCalled();
  });
});
