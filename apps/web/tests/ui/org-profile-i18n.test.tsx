import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";

const api = vi.hoisted(() => ({
  update: vi.fn(), upload: vi.fn(), listGrants: vi.fn(), revoke: vi.fn(), getExtraction: vi.fn(), setExtraction: vi.fn(),
  rename: vi.fn(), role: "admin" as "admin" | "consultant",
}));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-profile-i18n" }, identity: { orgRole: api.role }, updateOrgName: api.rename }),
  useOptionalSession: () => null,
}));
vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: () => ({ src: null }) }));
vi.mock("@/components/shell/org-menu", () => ({ invalidateOrgAvatar: vi.fn() }));
vi.mock("@/lib/live-org-admin", async () => {
  const original = await vi.importActual<typeof import("@/lib/live-org-admin")>("@/lib/live-org-admin");
  return { ...original, updateOrganization: api.update, uploadOrgAvatar: api.upload,
    listStandingToolGrants: api.listGrants, revokeStandingToolGrant: api.revoke,
    getKnowledgeExtractionSetting: api.getExtraction, setKnowledgeExtractionSetting: api.setExtraction };
});
import { OrgProfileScreen } from "@/components/org-admin/org-admin-screen";
import { StandingToolGrantsSection } from "@/components/org-admin/standing-tool-grants";
import { KnowledgeExtractionToggleSection } from "@/components/org-admin/knowledge-extraction-toggle";

function Switch() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Switch locale</button>;
}
function Harness({ children }: { children: React.ReactNode }) {
  return <I18nProvider initialLocale="en"><Switch />{children}</I18nProvider>;
}
const source = { orgId: "org-profile-i18n", name: "组织原文 {name}", description: "简介原文 {count}", avatarUrl: null, avatarArtifactId: null };
beforeEach(() => {
  vi.resetAllMocks(); api.role = "admin";
  api.update.mockResolvedValue(source); api.listGrants.mockResolvedValue([]);
  api.getExtraction.mockResolvedValue({ orgEnabled: true, deploymentCapable: true });
  api.setExtraction.mockImplementation(async (enabled: boolean) => ({ orgEnabled: enabled, deploymentCapable: true }));
});
afterEach(cleanup);

it("translates the full profile while keeping raw drafts and all three reads stable", async () => {
  render(<OrgProfileScreen />, { wrapper: Harness });
  const name = await screen.findByTestId("org-admin-name-input");
  expect(screen.getByRole("heading", { name: "Organization profile" })).toBeVisible();
  expect(screen.getByLabelText("Organization name")).toBe(name);
  const description = screen.getByLabelText("Organization description");
  fireEvent.change(name, { target: { value: "草稿 {name} 未保存" } });
  fireEvent.change(description, { target: { value: "原文 {count} remains" } });
  fireEvent.click(screen.getByText("Switch locale"));
  expect(screen.getByLabelText("组织名称")).toBe(name);
  expect(name).toHaveValue("草稿 {name} 未保存");
  expect(description).toHaveValue("原文 {count} remains");
  expect(api.update).toHaveBeenCalledTimes(1); expect(api.update).toHaveBeenCalledWith({ orgId: source.orgId });
  expect(api.listGrants).toHaveBeenCalledTimes(1); expect(api.getExtraction).toHaveBeenCalledTimes(1);
  expect(api.setExtraction).not.toHaveBeenCalled();
});

it("retranslates visible name validation without submitting or resetting the invalid form", async () => {
  render(<OrgProfileScreen />, { wrapper: Harness });
  const name = await screen.findByTestId("org-admin-name-input");
  fireEvent.change(name, { target: { value: "" } });
  fireEvent.submit(screen.getByTestId("org-admin-profile-form"));
  expect(screen.getByText("Organization name is required")).toBeVisible();
  fireEvent.click(screen.getByText("Switch locale"));
  expect(screen.getByText("组织名称不能为空")).toBeVisible();
  expect(api.update).toHaveBeenCalledTimes(1);
});

it("keeps the exact save payload and re-renders saved feedback in the current locale", async () => {
  render(<OrgProfileScreen />, { wrapper: Harness });
  const name = await screen.findByTestId("org-admin-name-input");
  const description = screen.getByTestId("org-admin-description-input");
  const saved = { ...source, name: "保存原文 {name}", description: "保存简介 {count}" };
  api.update.mockResolvedValueOnce(saved);
  fireEvent.change(name, { target: { value: saved.name } });
  fireEvent.change(description, { target: { value: saved.description } });
  fireEvent.submit(screen.getByTestId("org-admin-profile-form"));
  await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
  expect(api.update).toHaveBeenLastCalledWith({ orgId: source.orgId, name: saved.name, description: saved.description });
  await waitFor(() => expect(screen.getByText("Saved", { exact: true })).toBeVisible());
  fireEvent.click(screen.getByText("Switch locale"));
  expect(screen.getByText("已保存", { exact: true })).toBeVisible();
  expect(name).toHaveValue(saved.name); expect(description).toHaveValue(saved.description);
  expect(api.rename).toHaveBeenCalledWith(source.orgId, saved.name);
  expect(api.update).toHaveBeenCalledTimes(2);
});

it("retranslates the server avatar rejection without another upload or profile read", async () => {
  api.upload.mockRejectedValueOnce(new ApiError(413, "FILE_TOO_LARGE", {}));
  render(<OrgProfileScreen />, { wrapper: Harness });
  await screen.findByTestId("org-admin-name-input");
  const file = new File(["raw-bytes"], "原文头像{name}.png", { type: "image/png" });
  fireEvent.change(screen.getByTestId("org-admin-avatar-file-input"), { target: { files: [file] } });
  const error = await screen.findByTestId("org-admin-avatar-error");
  expect(error).toHaveTextContent("The image exceeds the 5 MB limit");
  fireEvent.click(screen.getByText("Switch locale"));
  expect(error).toHaveTextContent("图片超过 5MB 上限");
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.upload).toHaveBeenCalledWith({ orgId: source.orgId, file });
  expect(api.update).toHaveBeenCalledTimes(1);
});

it("keeps raw tool and approver identifiers while translating dates and stale-revoke feedback", async () => {
  const row = { grantId: "grant-raw", toolName: "工具原文 {tool}", grantedByUserId: "user-{who}", grantedAt: "2026-09-13T12:00:00Z" };
  api.listGrants.mockResolvedValue([row]); api.revoke.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", {}));
  render(<StandingToolGrantsSection />, { wrapper: Harness });
  expect(await screen.findByText(row.toolName, { exact: true })).toBeVisible();
  expect(screen.getByText(/Approved by user-\{who\}/)).toHaveTextContent("9/13/2026");
  fireEvent.click(screen.getByTestId("standing-tool-grant-revoke"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This grant no longer exists"));
  fireEvent.click(screen.getByText("Switch locale"));
  expect(screen.getByRole("alert")).toHaveTextContent("这条授权已经不存在了");
  expect(screen.getByText(/由 user-\{who\} 批准/)).toHaveTextContent("2026/9/13");
  expect(screen.getByText(row.toolName, { exact: true })).toBeVisible();
  expect(api.revoke).toHaveBeenCalledTimes(1); expect(api.revoke).toHaveBeenCalledWith(row.grantId); expect(api.listGrants).toHaveBeenCalledTimes(2);
});

it("translates deployment incapability without changing the stored organization setting", async () => {
  api.getExtraction.mockResolvedValue({ orgEnabled: true, deploymentCapable: false });
  render(<KnowledgeExtractionToggleSection isAdmin />, { wrapper: Harness });
  const toggle = await screen.findByRole("switch", { name: "Enable memory extraction for this organization" });
  expect(toggle).toBeDisabled(); expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("knowledge-extraction-not-capable")).toHaveTextContent("Not active");
  fireEvent.click(screen.getByText("Switch locale"));
  expect(toggle).toHaveAccessibleName("为本组织开启记忆抽取");
  expect(screen.getByTestId("knowledge-extraction-not-capable")).toHaveTextContent("未生效");
  expect(api.getExtraction).toHaveBeenCalledTimes(1); expect(api.setExtraction).not.toHaveBeenCalled();
});

it("preserves the admin toggle boolean and re-renders a server403 without reconnecting on locale", async () => {
  api.setExtraction.mockRejectedValueOnce(new ApiError(403, "KG_NOT_ORG_ADMIN", {}));
  render(<KnowledgeExtractionToggleSection isAdmin />, { wrapper: Harness });
  const toggle = await screen.findByRole("switch", { name: "Enable memory extraction for this organization" });
  fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only organization administrators can change this setting"));
  expect(api.setExtraction).toHaveBeenCalledTimes(1); expect(api.setExtraction).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByText("Switch locale"));
  expect(screen.getByRole("alert")).toHaveTextContent("只有组织管理员可以修改这项设置");
  expect(api.getExtraction).toHaveBeenCalledTimes(2); expect(api.setExtraction).toHaveBeenCalledTimes(1);
});

it("keeps non-admin profile and grants denied but extraction readable and disabled", async () => {
  api.role = "consultant"; api.update.mockRejectedValue(new ApiError(403, "FORBIDDEN", {}));
  api.listGrants.mockRejectedValue(new ApiError(403, "FORBIDDEN", {}));
  render(<OrgProfileScreen />, { wrapper: Harness });
  await waitFor(() => expect(api.getExtraction).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("org-admin-profile-form")).toBeNull();
  const section = screen.getByTestId("knowledge-extraction-toggle");
  const toggle = await within(section).findByRole("switch", { name: "Enable memory extraction for this organization" });
  expect(toggle).toBeDisabled();
  fireEvent.click(toggle); fireEvent.click(screen.getByText("Switch locale"));
  expect(toggle).toHaveAccessibleName("为本组织开启记忆抽取");
  expect(api.setExtraction).not.toHaveBeenCalled();
  expect(api.update).toHaveBeenCalledTimes(1); expect(api.listGrants).toHaveBeenCalledTimes(1);
});

it("translates only the description-length violation and keeps its source limit", async () => {
  render(<OrgProfileScreen />, { wrapper: Harness });
  const description = await screen.findByTestId("org-admin-description-input");
  const max = Number(description.getAttribute("maxlength"));
  expect(max).toBeGreaterThan(0);
  fireEvent.change(description, { target: { value: "原".repeat(max + 1) } });
  fireEvent.submit(screen.getByTestId("org-admin-profile-form"));
  expect(screen.getByText("Description cannot exceed " + max + " characters")).toBeVisible();
  expect(screen.queryByText("Organization name is required")).toBeNull();
  fireEvent.click(screen.getByText("Switch locale"));
  expect(screen.getByText("简介不能超过 " + max + " 字")).toBeVisible();
  expect(api.update).toHaveBeenCalledTimes(1);
});

it("retranslates an in-flight revoke without restarting or resolving it", async () => {
  api.listGrants.mockResolvedValue([{ grantId: "grant-busy", toolName: "原文 {tool}", grantedByUserId: null, grantedAt: "2026-09-13T12:00:00Z" }]);
  let finish!: () => void;
  api.revoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<StandingToolGrantsSection />, { wrapper: Harness });
  await screen.findByText("原文 {tool}", { exact: true });
  const revoke = screen.getByTestId("standing-tool-grant-revoke");
  fireEvent.click(revoke);
  try {
    expect(revoke).toHaveTextContent("Revoking…"); expect(revoke).toBeDisabled();
    fireEvent.click(screen.getByText("Switch locale"));
    expect(revoke).toHaveTextContent("撤销中…"); expect(revoke).toBeDisabled();
    expect(api.revoke).toHaveBeenCalledTimes(1); expect(api.listGrants).toHaveBeenCalledTimes(1);
  } finally { finish(); }
  await waitFor(() => expect(api.listGrants).toHaveBeenCalledTimes(2));
});
