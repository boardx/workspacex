import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgAdminLayout from "@/app/org-admin/layout";

const viewer = vi.hoisted(() => ({ status: "authenticated", retry: vi.fn(), logout: vi.fn(), role: "consultant", pathname: "/org-admin/members", replace: vi.fn() }));
vi.mock("@/components/session/session-provider", () => {
  const useSession = () => ({
    status: viewer.status,
    identity: viewer.status === "authenticated" ? { orgRole: viewer.role } : null,
    retry: viewer.retry,
    logout: viewer.logout,
  });
  return { useSession, useOptionalSession: useSession };
});
vi.mock("next/navigation", () => ({
  usePathname: () => viewer.pathname,
  useRouter: () => ({ replace: viewer.replace }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  viewer.status = "authenticated";
  window.history.replaceState(null, "", "/");
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

  it("preserves the requested path and query while signing in", () => {
    viewer.status = "anonymous";
    viewer.pathname = "/org-admin/agent/example";
    const next = "/org-admin/agent/example?tab=history&view=compact";
    window.history.replaceState(null, "", next);
    render(<OrgAdminLayout>Administration content</OrgAdminLayout>);
    expect(screen.queryByText("Administration content")).toBeNull();
    expect(viewer.replace).toHaveBeenCalledTimes(1);
    expect(viewer.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(next)}`);
  });

  it("offers retry and sign out during an identity failure without mounting administration content", async () => {
    viewer.status = "dependency-failed";
    render(<OrgAdminLayout>Administration content</OrgAdminLayout>);
    expect(screen.queryByText("Administration content")).toBeNull();
    const recovery = screen.getByTestId("session-dependency-failed");
    const [retry, signOut] = recovery.querySelectorAll("button");
    fireEvent.click(retry!);
    expect(viewer.retry).toHaveBeenCalledTimes(1);
    fireEvent.click(signOut!);
    await waitFor(() => expect(viewer.logout).toHaveBeenCalledTimes(1));
    expect(viewer.replace).toHaveBeenCalledWith("/login");
  });

  it("renders management content for the current organization's administrator", () => {
    viewer.role = "admin";
    render(<OrgAdminLayout>Administration content</OrgAdminLayout>);
    expect(screen.getByText("Administration content")).toBeInTheDocument();
    expect(viewer.replace).not.toHaveBeenCalled();
  });
});
