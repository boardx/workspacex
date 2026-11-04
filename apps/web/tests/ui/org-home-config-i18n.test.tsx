import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { homeConfig as C } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";

const api = vi.hoisted(() => ({
  get: vi.fn(), save: vi.fn(), banner: vi.fn(), avatar: vi.fn(), orgUpdate: vi.fn(), agents: vi.fn(), skills: vi.fn(), palette: vi.fn(),
  role: "admin" as "admin" | "consultant",
}));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-home-i18n" }, identity: { orgRole: api.role, displayName: "成员原文 {name}", org: { avatarUrl: null } } }),
  useOptionalSession: () => null,
}));
vi.mock("@/components/shell/org-menu", () => ({ useOrgAvatarUrl: () => null, invalidateOrgAvatar: vi.fn() }));
vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: () => ({ src: null, failed: false }) }));
vi.mock("@/lib/live-home-config", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/live-home-config")>()), getHomeConfig: api.get, updateHomeConfig: api.save, uploadHomeBanner: api.banner,
}));
vi.mock("@/lib/live-org-admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/live-org-admin")>()), uploadOrgAvatar: api.avatar, updateOrganization: api.orgUpdate,
}));
vi.mock("@/lib/home-theme", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/home-theme")>()), paletteFromImage: api.palette,
}));
vi.mock("@/lib/agent-directory", () => ({ listAgentDirectory: api.agents }));
vi.mock("@/lib/live-skill", () => ({ listSkills: api.skills }));
vi.mock("@/components/home/use-home-work", () => ({
  useHomeWork: () => ({
    threads: { status: "ready", items: [] }, projects: { status: "ready", items: [] },
    research: { status: "ready", items: [] }, interviews: { status: "ready", items: [] }, surveys: { status: "ready", items: [] },
  }),
  useHomeTasks: () => ({ status: "ready", items: null }),
}));
vi.mock("@/components/feedback/feedback-provider", () => ({ useOptionalFeedback: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { HomeConfigScreen, HomePreviewPane } from "@/components/org-admin/home-config-screen";
import { BannerSection } from "@/components/org-admin/home-config-appearance-section";
import { HomeThemeSection } from "@/components/org-admin/home-config-theme-section";
import { RecommendedAgentsSection, RecommendedSkillsSection } from "@/components/org-admin/home-config-recommend-sections";
import { toFormState, validateForm, type HomeConfigFormState } from "@/components/org-admin/home-config-form-model";
import type { HomeConfig } from "@/lib/live-home-config";

const config: HomeConfig = {
  orgId: "org-home-i18n", title: "品牌原文 {name}", tagline: "品牌简介原文", bannerHeadline: "横幅原文 {count}", bannerTagline: "横幅副标题原文",
  bannerPreset: "ocean", bannerColor: null, bannerImageUrl: null, themeColors: { ...C.DEFAULT_HOME_THEME },
  quickActions: [{ key: "chat", enabled: true, order: 0 }], recommendedAgents: [], recommendedCapabilities: [],
  sections: { currentTasks: true, recentWork: true }, updatedAt: "2026-09-30T00:00:00.000Z", updatedBy: null,
};
let latest: HomeConfigFormState;
function Switch() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Switch locale</button>;
}
function Locale({ children }: { children: React.ReactNode }) {
  return <I18nProvider initialLocale="en"><Switch />{children}</I18nProvider>;
}
function Form({ children }: { children: (form: HomeConfigFormState, change: (next: HomeConfigFormState) => void) => React.ReactNode }) {
  const [form, change] = React.useState(() => toFormState(config)); latest = form;
  return <>{children(form, change)}</>;
}
const switchLocale = () => fireEvent.click(screen.getByRole("button", { name: "Switch locale" }));
const pickBanner = (file: File) => fireEvent.change(screen.getByTestId("home-config-banner-file-input"), { target: { files: [file] } });
const NativeURL = globalThis.URL;
beforeEach(() => {
  vi.resetAllMocks(); api.role = "admin";
  api.get.mockResolvedValue(config); api.save.mockImplementation(async (_org: string, input: Record<string, unknown>) => ({ ...config, ...input }));
  api.agents.mockResolvedValue([]); api.skills.mockResolvedValue([]); api.palette.mockResolvedValue({ ...C.DEFAULT_HOME_THEME });
  api.orgUpdate.mockResolvedValue({ name: config.title, description: null, avatarUrl: null });
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL() { return "blob:home-config-test"; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("switches all tabs without replacing authored inputs, selected tab or config read", async () => {
  render(<HomeConfigScreen />, { wrapper: Locale });
  const title = await screen.findByTestId("home-config-title");
  expect(screen.getByRole("heading", { name: "Home configuration" })).toBeVisible();
  expect(screen.getByLabelText("Brand title (up to 24 characters)")).toBe(title);
  fireEvent.change(title, { target: { value: "编辑原文 {title}" } });
  switchLocale(); switchLocale(); expect(screen.getByTestId("home-config-title")).toBe(title);
  expect(title).toHaveValue("编辑原文 {title}");
  fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
  expect(screen.getByTestId("home-config-quick-action-chat")).toHaveAccessibleName(/Chat/);
  switchLocale(); switchLocale();
  expect(screen.getByRole("tab", { name: "Layout" })).toHaveAttribute("aria-selected", "true");
  expect(api.get).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled();
});

it("saves original fields and stable settings once and retranslates saved feedback", async () => {
  render(<HomeConfigScreen />, { wrapper: Locale });
  const title = await screen.findByTestId("home-config-title");
  fireEvent.change(title, { target: { value: " 原始品牌 {name} " } });
  switchLocale(); switchLocale(); fireEvent.click(screen.getByTestId("home-config-save"));
  await waitFor(() => expect(screen.getByTestId("saved")).toHaveTextContent("Saved"));
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save.mock.calls[0]![0]).toBe(config.orgId);
  expect(api.save.mock.calls[0]![1]).toMatchObject({
    title: "原始品牌 {name}", bannerHeadline: config.bannerHeadline, bannerTagline: config.bannerTagline,
    themeColors: config.themeColors, recommendedAgents: [], recommendedCapabilities: [], sections: config.sections,
  });
  switchLocale(); expect(screen.getByTestId("saved")).toHaveTextContent("已保存"); expect(api.get).toHaveBeenCalledTimes(1);
});

it("keeps the submitted validation failures translatable without saving or reloading", async () => {
  render(<HomeConfigScreen />, { wrapper: Locale });
  fireEvent.change(await screen.findByTestId("home-config-title"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("home-config-save"));
  expect(screen.getByText("Title is required", { exact: true })).toBeVisible();
  switchLocale(); expect(screen.getByText("标题不能为空", { exact: true })).toBeVisible();
  switchLocale(); expect(screen.getByText("Title is required", { exact: true })).toBeVisible();
  expect(api.save).not.toHaveBeenCalled(); expect(api.get).toHaveBeenCalledTimes(1);
});

it("retranslates retained service failure using the existing canonical error helper", async () => {
  api.get.mockRejectedValue(new ApiError(403, "FORBIDDEN", {}));
  render(<HomeConfigScreen />, { wrapper: Locale });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only organization administrators can edit the home configuration."));
  switchLocale(); expect(screen.getByRole("alert")).not.toHaveTextContent("Only organization administrators");
  expect(api.get).toHaveBeenCalledTimes(1);
});

it("keeps the ordinary-member denial without reading administrator configuration", () => {
  api.role = "consultant"; render(<HomeConfigScreen />, { wrapper: Locale });
  expect(screen.getByRole("alert")).toHaveTextContent("Only organization administrators can configure the home page.");
  switchLocale(); expect(screen.getByRole("alert")).toHaveTextContent("首页配置仅组织管理员可进");
  expect(screen.queryByTestId("home-config-form")).not.toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
});

it("localizes presets and color validation without changing selected preset or raw color", () => {
  render(<Form>{(form, onChange) => <BannerSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  expect(screen.getByRole("button", { name: "Ocean" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByTestId("home-config-banner-color-input"), { target: { value: "#12" } });
  expect(screen.getByTestId("home-config-banner-color-error")).toHaveTextContent(/color/i);
  switchLocale(); switchLocale();
  expect(latest.bannerPreset).toBe("custom"); expect(latest.bannerColorInput).toBe("#12");
  expect(screen.getByTestId("home-config-banner-color-input")).toHaveValue("#12");
});

it("retains an in-flight banner upload and original File across locale changes", async () => {
  let finish!: (value: { bannerImageArtifactId: string; bannerImageUrl: string }) => void;
  api.banner.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Form>{(form, onChange) => <BannerSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  const file = new File(["original bytes"], "横幅原名 {file}.png", { type: "image/png" }); pickBanner(file);
  await waitFor(() => expect(api.banner).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("home-config-banner-upload")).toHaveTextContent("Uploading");
  switchLocale(); switchLocale(); expect(api.banner).toHaveBeenCalledTimes(1);
  expect(api.banner).toHaveBeenCalledWith({ orgId: config.orgId, file });
  await act(async () => finish({ bannerImageArtifactId: "raw-artifact-id", bannerImageUrl: "/raw/banner.png" }));
  expect(latest.bannerImageArtifactId).toBe("raw-artifact-id"); expect(latest.title).toBe(config.title);
});

it("retranslates a server banner rejection without resubmitting the file", async () => {
  api.banner.mockRejectedValue(new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", {}));
  render(<Form>{(form, onChange) => <BannerSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  pickBanner(new File(["raw"], "original.png", { type: "image/png" }));
  await waitFor(() => expect(screen.getByTestId("home-config-banner-upload-error")).toHaveTextContent("Only PNG, JPEG, and WebP images are supported."));
  switchLocale(); expect(screen.getByTestId("home-config-banner-upload-error")).not.toHaveTextContent("Only PNG");
  expect(api.banner).toHaveBeenCalledTimes(1);
});

it("localizes theme controls while preserving raw color values", () => {
  render(<Form>{(form, onChange) => <HomeThemeSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  const color = screen.getByLabelText("Primary color value");
  fireEvent.change(color, { target: { value: "#1a2b3c" } }); switchLocale(); switchLocale();
  expect(screen.getByLabelText("Primary color value")).toBe(color);
  expect(color).toHaveValue("#1a2b3c"); expect(latest.themeColors.primary).toBe("#1a2b3c");
  expect(api.orgUpdate).not.toHaveBeenCalled();
});

it("keeps pending logo upload and retranslates its immediate-update success notice", async () => {
  let finish!: (value: { orgAvatarArtifactId: string }) => void;
  api.avatar.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Form>{(form, onChange) => <HomeThemeSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  const file = new File(["raw"], "Logo原文 {file}.png", { type: "image/png" });
  fireEvent.change(screen.getByTestId("home-logo-file"), { target: { files: [file] } });
  await waitFor(() => expect(api.avatar).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
  switchLocale(); switchLocale(); expect(api.avatar).toHaveBeenCalledWith({ orgId: config.orgId, file });
  await act(async () => finish({ orgAvatarArtifactId: "original-avatar-id" }));
  expect(api.orgUpdate).toHaveBeenCalledWith({ orgId: config.orgId, avatarArtifactId: "original-avatar-id" });
  expect(screen.getByText("Organization logo updated; generated theme colors apply after saving.", { exact: true })).toBeVisible();
  switchLocale(); expect(screen.getByText("组织 Logo 已更新；自动生成的主题颜色在保存后生效。", { exact: true })).toBeVisible();
  expect(api.avatar).toHaveBeenCalledTimes(1);
});

it("preserves picker selection, raw agent snapshots and notes without refetching", async () => {
  const name = "数字人原名 {name}";
  api.agents.mockResolvedValue([{ agentId: "raw-agent-id", name, roleLabel: "角色原文", avatar: { key: "robot" } }]);
  render(<Form>{(form, onChange) => <RecommendedAgentsSection form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
  await screen.findByTestId("home-config-picker-agent-raw-agent-id");
  fireEvent.click(screen.getByTestId("home-config-picker-agent-raw-agent-id"));
  expect(latest.recommendedAgents).toEqual([{ agentId: "raw-agent-id", name, roleLabel: "角色原文", avatarKey: "robot", note: null }]);
  const note = screen.getByTestId("home-config-agent-note-raw-agent-id");
  fireEvent.change(note, { target: { value: "备注原文 {count}" } });
  switchLocale(); switchLocale(); expect(api.agents).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("home-config-picker-agent-raw-agent-id")).toBeDisabled();
  expect(screen.getByTestId("home-config-picker-agent-raw-agent-id")).toHaveTextContent("Added · " + name);
  expect(note).toHaveValue("备注原文 {count}");
  expect(screen.getByRole("button", { name: "Remove " + name })).toBeVisible();
});

it("retains a pending skill catalog and localizes empty state without refetch", async () => {
  let finish!: (value: []) => void;
  api.skills.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Form>{(form, onChange) => <RecommendedSkillsSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  expect(screen.getByTestId("home-config-picker")).toHaveTextContent("Loading catalog");
  switchLocale(); switchLocale(); expect(api.skills).toHaveBeenCalledTimes(1);
  await act(async () => finish([]));
  expect(screen.getByTestId("home-config-picker")).toHaveTextContent("This organization has no enabled skills.");
});

it("keeps the real preview inert and authored draft visible across locale changes", () => {
  const form = toFormState(config); form.title = "预览原文 {title}";
  render(<HomePreviewPane form={form} orgId={config.orgId} displayName="成员原名" dirty invalid={false} saving={false} status={null} onBack={vi.fn()} onSave={vi.fn()} />, { wrapper: Locale });
  expect(screen.getByRole("button", { name: "Back to editing" })).toBeVisible();
  expect(screen.getByTestId("home-config-preview")).toHaveTextContent("Preview includes unsaved changes. Personal data comes from your account");
  expect(screen.getByTestId("home-config-preview-frame")).toHaveAttribute("inert");
  expect(screen.getByTestId("home-config-preview-frame")).toHaveAttribute("aria-label", "Home page preview");
  expect(screen.getByTestId("home-config-preview")).toHaveTextContent("预览原文 {title}");
  switchLocale(); switchLocale();
  expect(screen.getByTestId("home-config-preview-frame")).toHaveAttribute("inert");
  expect(api.save).not.toHaveBeenCalled();
});

it("keeps pure validator guards/default copy while offering localized violations", () => {
  const form = toFormState(config); form.title = ""; form.bannerHeadline = "";
  expect(validateForm(form)).toMatchObject({ title: "标题不能为空", bannerHeadline: "横幅主标题不能为空" });
  expect(validateForm(form, "en")).toMatchObject({ title: "Title is required", bannerHeadline: "Banner headline is required" });
});

it("retranslates a logo upload rejection while keeping its original authorized call", async () => {
  api.avatar.mockRejectedValue(new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", {}));
  render(<Form>{(form, onChange) => <HomeThemeSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  const file = new File(["raw"], "logo.png", { type: "image/png" });
  fireEvent.change(screen.getByTestId("home-logo-file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("Only PNG, JPEG, and WebP images are supported.", { exact: true })).toBeVisible());
  switchLocale(); switchLocale(); expect(api.avatar).toHaveBeenCalledTimes(1);
  expect(api.avatar).toHaveBeenCalledWith({ orgId: config.orgId, file }); expect(api.orgUpdate).not.toHaveBeenCalled();
});

it("localizes catalog failures without reopening or refetching the picker", async () => {
  api.skills.mockRejectedValue(new TypeError("offline"));
  render(<Form>{(form, onChange) => <RecommendedSkillsSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  await waitFor(() => expect(screen.getByTestId("home-config-picker")).toHaveTextContent("Could not load the catalog. Please try again later."));
  switchLocale(); expect(screen.getByTestId("home-config-picker")).toHaveTextContent("目录加载失败");
  expect(api.skills).toHaveBeenCalledTimes(1);
});

it("retains original skill identifiers, snapshots and notes after switching locale", async () => {
  const name = "Skill原名 {name}";
  api.skills.mockResolvedValue([{ skillId: "raw-skill-id", name, status: "已启用" }]);
  render(<Form>{(form, onChange) => <RecommendedSkillsSection orgId={config.orgId} form={form} onChange={onChange} />}</Form>, { wrapper: Locale });
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  fireEvent.click(await screen.findByTestId("home-config-picker-skill-raw-skill-id"));
  expect(latest.recommendedCapabilities).toEqual([{ kind: "skill", refId: "raw-skill-id", name, note: null }]);
  const note = screen.getByTestId("home-config-recommendation-note-skill-raw-skill-id");
  fireEvent.change(note, { target: { value: "Skill备注原文 {count}" } });
  switchLocale(); switchLocale(); expect(note).toHaveValue("Skill备注原文 {count}");
  expect(screen.getByTestId("home-config-picker-skill-raw-skill-id")).toHaveTextContent("Added · " + name);
  expect(screen.getByRole("button", { name: "Remove " + name })).toBeVisible(); expect(api.skills).toHaveBeenCalledTimes(1);
});
