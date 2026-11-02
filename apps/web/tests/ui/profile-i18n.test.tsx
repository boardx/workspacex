import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-current" },
    identity: { displayName: "原文 Alice", avatarUrl: null },
    updateDisplayName: vi.fn(), updateAvatarUrl: vi.fn(), logout: vi.fn(),
  }),
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/live-identity", () => ({
  fetchAvatarObjectUrl: vi.fn(),
  listOwnActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
  updateOwnProfile: vi.fn(), uploadOwnAvatar: vi.fn(), changeOwnPassword: vi.fn(),
}));
import { ProfileScreen } from "@/components/profile/profile-screen";
afterEach(cleanup);

// 基础provider合入后，用真实I18nProvider初始en包裹；先证明旧界面无法满足英文旅程。
it("shows English profile controls while preserving the original display name", async () => {
  render(<ProfileScreen />);
  expect(screen.getByRole("heading", { name: "Profile", exact: true })).toBeTruthy();
  expect(screen.getByLabelText("Display name")).toHaveValue("原文 Alice");
  expect(screen.getByRole("button", { name: "Change avatar" })).toBeTruthy();
  expect(screen.getByLabelText("Current password")).toBeTruthy();
  expect(await screen.findByText("No activity yet.")).toBeTruthy();
});
