import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listOwnActivity: vi.fn(), updateOwnProfile: vi.fn(),
}));
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
  listOwnActivity: api.listOwnActivity,
  updateOwnProfile: api.updateOwnProfile, uploadOwnAvatar: vi.fn(), changeOwnPassword: vi.fn(),
}));
import { ProfileScreen } from "@/components/profile/profile-screen";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { StateShell } from "@/components/state/state-shell";
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("zh-CN")}>中文</button><button onClick={() => setLocale("en")}>English</button></>;
}
function show(children: React.ReactNode = <ProfileScreen />) {
  return render(<I18nProvider initialLocale="en"><SwitchLanguage />{children}</I18nProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  api.listOwnActivity.mockResolvedValue({ events: [], nextCursor: null });
  api.updateOwnProfile.mockImplementation(async (input) => input);
});
afterEach(cleanup);

it("shows English profile controls while preserving the original display name", async () => {
  show();
  expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
  expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("原文 Alice");
  expect(screen.getByRole("button", { name: "Change avatar" })).toBeTruthy();
  expect(screen.getByLabelText("Current password")).toBeTruthy();
  expect(await screen.findByText("No activity yet.")).toBeTruthy();
});

it("preserves edited input and API payload when switching language", async () => {
  show();
  fireEvent.change(screen.getByTestId("profile-display-name-input"), { target: { value: "自定义 Alice" } });
  fireEvent.click(screen.getByText("中文", { exact: true }));
  expect((screen.getByLabelText("显示名") as HTMLInputElement).value).toBe("自定义 Alice");
  fireEvent.click(screen.getByText("English", { exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateOwnProfile).toHaveBeenCalledWith({ displayName: "自定义 Alice" }));
  expect(await screen.findByText("Saved", { exact: true })).toBeTruthy();
});
it("updates validation text without clearing passwords or reloading activity", async () => {
  show();
  await screen.findByText("No activity yet.");
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
  fireEvent.submit(screen.getByTestId("profile-password-form"));
  expect(screen.getByText("New password must contain at least 12 characters")).toBeTruthy();
  fireEvent.click(screen.getByText("中文", { exact: true }));
  expect(screen.getByText("新密码至少需要 12 个字符")).toBeTruthy();
  expect((screen.getByLabelText("新密码") as HTMLInputElement).value).toBe("short");
  expect(api.listOwnActivity).toHaveBeenCalledTimes(1);
});
it("keeps server activity text while formatting time for the selected locale", async () => {
  const occurredAt = "2026-11-03T03:00:00Z";
  api.listOwnActivity.mockResolvedValue({ events: [{ eventId: "e1", summary: "原文 activity", occurredAt }], nextCursor: null });
  show();
  const event = await screen.findByText("原文 activity");
  expect(event).toBeTruthy();
  expect(screen.getByText(new Date(occurredAt).toLocaleString("en", { hour12: false }))).toBeTruthy();
  fireEvent.click(screen.getByText("中文", { exact: true }));
  expect(screen.getByText("原文 activity")).toBeTruthy();
  expect(api.listOwnActivity).toHaveBeenCalledTimes(1);
});
it("localizes shared failure and permission states and preserves supplied reasons", () => {
  const retry = vi.fn();
  const view = show(<StateShell state="dep-failed" depFailure={{ what: "custom 原文", retry }}>body</StateShell>);
  expect(screen.getByText("Service unavailable")).toBeTruthy();
  expect(screen.getByText("custom 原文")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  view.unmount();
  show(<StateShell state="denied" denial={{ layer: "organization", reason: "原文 reason" }}>body</StateShell>);
  expect(screen.getByText("Organization restriction: 原文 reason")).toBeTruthy();
});

it("translates a stored API failure on language change without issuing a second request", async () => {
  api.listOwnActivity.mockRejectedValue(new ApiError(401, "SESSION_EXPIRED", null));
  show();
  expect(await screen.findByText("Your session has expired (HTTP 401). Please sign in again.")).toBeTruthy();
  fireEvent.click(screen.getByText("中文", { exact: true }));
  expect(screen.getByText("登录已失效（HTTP 401），请重新登录。")).toBeTruthy();
  expect(api.listOwnActivity).toHaveBeenCalledTimes(1);
});
it("translates an existing avatar validation error after a language switch", async () => {
  show();
  await screen.findByText("No activity yet.");
  fireEvent.change(screen.getByTestId("profile-avatar-file-input"), {
    target: { files: [new File(["text"], "原文.txt", { type: "text/plain" })] },
  });
  expect(screen.getByText("Unsupported file type (text/plain). Only PNG / JPEG / WebP are supported.")).toBeTruthy();
  fireEvent.click(screen.getByText("中文", { exact: true }));
  expect(screen.getByText("不支持的文件类型（text/plain）——只支持 PNG / JPEG / WebP。")).toBeTruthy();
});
it.each([
  ["loading", "Loading"], ["empty", "No content yet"],
  ["invalid", "Please check your input"], ["success", "Saved"],
] as const)("localizes the shared %s state", (state, text) => {
  show(<StateShell state={state}>body</StateShell>);
  expect(screen.getByText(text)).toBeTruthy();
});

it("localizes the structured system template while preserving embedded user text", async () => {
  const name = '原文 {name} Alice';
  api.listOwnActivity.mockResolvedValue({ events: [{ eventId: "structured", kind: "profile-renamed", occurredAt: "2026-11-03T00:00:00Z", summary: 'legacy summary ' + name, display: { code: "profile-renamed", params: { displayName: name } } }], nextCursor: null });
  show();
  expect(await screen.findByText(`Display name changed to "${name}"`)).toBeTruthy();
  fireEvent.click(screen.getByText("中文", { exact: true }));
  expect(screen.getByText(`显示名改为"${name}"`)).toBeTruthy();
  expect(api.listOwnActivity).toHaveBeenCalledTimes(1);
});
it.each([
  undefined,
  { code: "future-code", params: {} },
  { code: "profile-renamed", params: { displayName: 42 } },
])("preserves source summary when display metadata is missing or unsupported %#", async (display) => {
  api.listOwnActivity.mockResolvedValue({ events: [{ eventId: "legacy", kind: "profile-renamed", occurredAt: "2026-11-03T00:00:00Z", summary: "保留 source 原文", display }], nextCursor: null });
  show();
  expect(await screen.findByText("保留 source 原文")).toBeTruthy();
});
