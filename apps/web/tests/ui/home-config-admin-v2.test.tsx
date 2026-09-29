/**
 * 后台首页配置 v2（Refs #4698）的交互：
 *   · 自定义 #RRGGBB 输入：合法/非法即时反馈，取色器与文本框双向；
 *   · 横幅图片：上传成功写进表单、超限在前端提前拦下不发请求、服务端拒绝显示人话、可移除；
 *   · 推荐数字人：从成员可读的目录里选（快照头像 key），不重复、最多 6 个。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const { uploadHomeBanner, listAgentDirectory, listSkills } = vi.hoisted(() => ({
  uploadHomeBanner: vi.fn(), listAgentDirectory: vi.fn(), listSkills: vi.fn(),
}));

vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: () => ({ src: null, failed: false }) }));
vi.mock("@/lib/live-home-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-home-config")>()),
  uploadHomeBanner,
}));
vi.mock("@/lib/agent-directory", () => ({ listAgentDirectory }));
// 预览渲染真实的 HomeView；个人数据（对话/项目…）与本文件无关，挡住网络请求。
vi.mock("@/components/home/use-home-work", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/home/use-home-work")>()),
  useHomeWork: () => ({
    threads: { status: "ready", items: [] }, projects: { status: "ready", items: [] },
    research: { status: "ready", items: [] }, interviews: { status: "ready", items: [] }, surveys: { status: "ready", items: [] },
  }),
  useHomeTasks: () => ({ status: "ready", items: null }),
}));
vi.mock("@/components/feedback/feedback-provider", () => ({ useOptionalFeedback: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/live-skill", () => ({ listSkills }));

import { BannerSection } from "@/components/org-admin/home-config-appearance-section";
import { RecommendedAgentsSection, RecommendedSkillsSection } from "@/components/org-admin/home-config-recommend-sections";
import { toFormState, type HomeConfigFormState } from "@/components/org-admin/home-config-form-model";
import { HomePreviewPane } from "@/components/org-admin/home-config-screen";
import type { HomeConfig } from "@/lib/live-home-config";

const CONFIG: HomeConfig = {
  orgId: "o1", title: "海尔法务", tagline: null, bannerHeadline: "H", bannerTagline: "T",
  bannerPreset: "ocean", bannerColor: null, bannerImageUrl: null,
  quickActions: [], recommendedCapabilities: [], recommendedAgents: [],
  sections: { recentWork: true, currentTasks: true }, updatedAt: "2026-09-30T00:00:00.000Z", updatedBy: null,
};

let latest: HomeConfigFormState;
function Harness({ children }: { children: (p: { form: HomeConfigFormState; onChange: (f: HomeConfigFormState) => void }) => React.ReactNode }) {
  const [form, setForm] = React.useState(() => toFormState(CONFIG));
  latest = form;
  return <>{children({ form, onChange: setForm })}</>;
}

beforeEach(() => {
  uploadHomeBanner.mockReset();
  listAgentDirectory.mockReset();
  listSkills.mockReset();
});
afterEach(cleanup);

function pickFile(file: File) {
  const input = screen.getByTestId("home-config-banner-file-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("横幅：自定义颜色", () => {
  it("选「自定义」后出现输入区并给一个合法初值；改成非法值即时报错，改回合法值报错消失", () => {
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    expect(screen.queryByTestId("home-config-custom-color")).toBeNull();
    fireEvent.click(screen.getByTestId("home-config-banner-preset-custom"));
    expect(latest.bannerPreset).toBe("custom");
    expect(latest.bannerColorInput).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(screen.queryByTestId("home-config-banner-color-error")).toBeNull();

    const input = screen.getByTestId("home-config-banner-color-input");
    fireEvent.change(input, { target: { value: "#12" } });
    expect(screen.getByTestId("home-config-banner-color-error").textContent).toContain("#RRGGBB");
    fireEvent.change(input, { target: { value: "#1a2b3c" } });
    expect(screen.queryByTestId("home-config-banner-color-error")).toBeNull();
    expect(latest.bannerColorInput).toBe("#1a2b3c");
  });

  it("取色器改动同步到文本框（大写）", () => {
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    fireEvent.click(screen.getByTestId("home-config-banner-preset-custom"));
    fireEvent.change(screen.getByTestId("home-config-banner-color-picker"), { target: { value: "#00ff88" } });
    expect(latest.bannerColorInput).toBe("#00FF88");
  });

  it("有 8 个预设可选，点选后表单里的预设随之变化", () => {
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    for (const k of ["ocean", "forest", "sunset", "midnight", "rose", "slate", "amber", "violet"]) {
      expect(screen.getByTestId(`home-config-banner-preset-${k}`)).toBeTruthy();
    }
    fireEvent.click(screen.getByTestId("home-config-banner-preset-violet"));
    expect(latest.bannerPreset).toBe("violet");
  });
});

describe("横幅：图片上传", () => {
  it("成功：把 artifactId 与 URL 写进表单，出现「更换/移除」；移除后清空", async () => {
    uploadHomeBanner.mockResolvedValue({ bannerImageArtifactId: "home-banner-1", bannerImageUrl: "/organizations/o1/home-banner-file/home-banner-1" });
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    pickFile(new File([new Uint8Array(10)], "b.png", { type: "image/png" }));
    await waitFor(() => expect(latest.bannerImageArtifactId).toBe("home-banner-1"));
    expect(uploadHomeBanner).toHaveBeenCalledWith({ orgId: "o1", file: expect.any(File) });
    expect(screen.getByTestId("home-config-banner-upload").textContent).toContain("更换图片");

    fireEvent.click(screen.getByTestId("home-config-banner-remove"));
    expect(latest.bannerImageArtifactId).toBeNull();
    expect(latest.bannerImageUrl).toBeNull();
  });

  it("超过 5MB：前端提前拦下，不发请求", async () => {
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    pickFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect((await screen.findByTestId("home-config-banner-upload-error")).textContent).toContain("5MB");
    expect(uploadHomeBanner).not.toHaveBeenCalled();
  });

  it("服务端拒绝（格式不符）：显示人话而不是错误码，表单不变", async () => {
    uploadHomeBanner.mockRejectedValue(new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", {}));
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    pickFile(new File([new Uint8Array(10)], "x.png", { type: "image/png" }));
    const err = await screen.findByTestId("home-config-banner-upload-error");
    expect(err.textContent).toContain("PNG / JPEG / WebP");
    expect(err.textContent).not.toContain("UNSUPPORTED_CONTENT_TYPE");
    expect(latest.bannerImageArtifactId).toBeNull();
  });

  it("上传超时：给明确反馈", async () => {
    uploadHomeBanner.mockRejectedValue(new DOMException("t", "TimeoutError"));
    render(<Harness>{(p) => <BannerSection orgId="o1" {...p} />}</Harness>);
    pickFile(new File([new Uint8Array(10)], "x.png", { type: "image/png" }));
    expect((await screen.findByTestId("home-config-banner-upload-error")).textContent).toContain("超时");
  });
});

describe("推荐数字人选择器", () => {
  const card = (id: string, name: string, key: string | null) => ({
    agentId: id, versionId: `v-${id}`, name, initials: name.slice(0, 1), roleLabel: "研究员",
    avatar: key === null ? null : { kind: "illustration", key, alt: name }, roleCategory: null, catalogSource: "org", workflows: [], readiness: "ready",
  });

  it("从目录选：快照名称/角色/头像 key；已选的不能重复选", async () => {
    listAgentDirectory.mockResolvedValue([card("a1", "小研", "robot"), card("a2", "小设", null)]);
    render(<Harness>{(p) => <RecommendedAgentsSection {...p} />}</Harness>);
    fireEvent.click(screen.getByTestId("home-config-add-agent"));
    fireEvent.click(await screen.findByTestId("home-config-picker-agent-a1"));
    expect(latest.recommendedAgents).toEqual([{ agentId: "a1", name: "小研", roleLabel: "研究员", avatarKey: "robot", note: null }]);
    expect((screen.getByTestId("home-config-picker-agent-a1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("home-config-picker-agent-a2"));
    expect(latest.recommendedAgents[1]?.avatarKey).toBeNull();
    expect(latest.recommendedAgents).toHaveLength(2);
  });

  it("最多 6 个：满了「添加」和候选都禁用", async () => {
    const many = Array.from({ length: 8 }, (_, i) => card(`a${String(i)}`, `数字人${String(i)}`, null));
    listAgentDirectory.mockResolvedValue(many);
    render(<Harness>{(p) => <RecommendedAgentsSection {...p} />}</Harness>);
    fireEvent.click(screen.getByTestId("home-config-add-agent"));
    for (let i = 0; i < 6; i++) fireEvent.click(await screen.findByTestId(`home-config-picker-agent-a${String(i)}`));
    expect(latest.recommendedAgents).toHaveLength(6);
    expect((screen.getByTestId("home-config-picker-agent-a7") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("home-config-add-agent") as HTMLButtonElement).disabled).toBe(true);
  });

  it("介绍可编辑（空串存为 null），可移除；目录为空/失败如实说明", async () => {
    listAgentDirectory.mockResolvedValue([card("a1", "小研", null)]);
    render(<Harness>{(p) => <RecommendedAgentsSection {...p} />}</Harness>);
    fireEvent.click(screen.getByTestId("home-config-add-agent"));
    fireEvent.click(await screen.findByTestId("home-config-picker-agent-a1"));
    fireEvent.change(screen.getByTestId("home-config-agent-note-a1"), { target: { value: "帮你做研究" } });
    expect(latest.recommendedAgents[0]?.note).toBe("帮你做研究");
    fireEvent.change(screen.getByTestId("home-config-agent-note-a1"), { target: { value: "" } });
    expect(latest.recommendedAgents[0]?.note).toBeNull();
    fireEvent.click(screen.getByTestId("home-config-agent-remove-a1"));
    expect(latest.recommendedAgents).toEqual([]);
  });

  it("目录加载失败：显示错误而不是空列表", async () => {
    listAgentDirectory.mockRejectedValue(new Error("x"));
    render(<Harness>{(p) => <RecommendedAgentsSection {...p} />}</Harness>);
    fireEvent.click(screen.getByTestId("home-config-add-agent"));
    expect((await screen.findByTestId("home-config-picker")).textContent).toContain("目录加载失败");
  });
});

describe("推荐 Skill 选择器", () => {
  it("只列已启用的 Skill，选中后是 skill 类型的推荐项", async () => {
    listSkills.mockResolvedValue([
      { skillId: "s1", name: "录音转写", status: "已启用" },
      { skillId: "s2", name: "草稿技能", status: "草稿" },
    ]);
    render(<Harness>{(p) => <RecommendedSkillsSection orgId="o1" {...p} />}</Harness>);
    fireEvent.click(screen.getByTestId("home-config-add-recommendation"));
    fireEvent.click(await screen.findByTestId("home-config-picker-skill-s1"));
    expect(screen.queryByTestId("home-config-picker-skill-s2")).toBeNull();
    expect(latest.recommendedCapabilities).toEqual([{ kind: "skill", refId: "s1", name: "录音转写", note: null }]);
  });
});

describe("预览首页（所见即所得）", () => {
  const base = { orgId: "o1", displayName: "管理员", dirty: false, invalid: false, saving: false, status: null, onBack: vi.fn(), onSave: vi.fn() };

  it("渲染的是表单里的值（含未保存），预览区 inert，不可点击/聚焦", () => {
    const form = { ...toFormState(CONFIG), title: "未保存的标题", bannerHeadline: "未保存的主标题", dirty: true };
    render(<HomePreviewPane {...base} form={form} dirty />);
    const frame = screen.getByTestId("home-config-preview-frame");
    expect(frame.hasAttribute("inert")).toBe(true);
    expect(frame.textContent).toContain("未保存的标题");
    expect(frame.textContent).toContain("未保存的主标题");
    expect(frame.textContent).toContain("你好，管理员");
    expect(screen.getByTestId("home-config-preview").textContent).toContain("预览包含尚未保存的更改");
  });

  it("没有改动时说明与已保存一致；关掉的板块在预览里也没有", () => {
    const form = { ...toFormState(CONFIG), sections: { recentWork: false, currentTasks: false } };
    render(<HomePreviewPane {...base} form={form} />);
    expect(screen.getByTestId("home-config-preview").textContent).toContain("与已保存的首页一致");
    expect(screen.queryByTestId("home-recent-work")).toBeNull();
    expect(screen.queryByTestId("home-current-tasks")).toBeNull();
  });

  it("入口开关、自定义色、推荐都即时体现在预览里", () => {
    const f0 = toFormState(CONFIG);
    const form = {
      ...f0, bannerPreset: "custom" as const, bannerColorInput: "#F5C518",
      quickActionEnabled: { ...f0.quickActionEnabled, interview: true, chat: false },
      recommendedAgents: [{ agentId: "a1", name: "小研", roleLabel: "研究员", avatarKey: "robot", note: null }],
      recommendedCapabilities: [{ kind: "skill" as const, refId: "s1", name: "录音转写", note: null }],
    };
    render(<HomePreviewPane {...base} form={form} />);
    expect(screen.getByTestId("home-quick-action-interview")).toBeTruthy();
    expect(screen.queryByTestId("home-quick-action-chat")).toBeNull();
    expect(screen.getByTestId("home-banner").getAttribute("data-banner-source")).toBe("custom");
    expect(screen.getByTestId("home-agent-a1")).toBeTruthy();
    expect(screen.getByTestId("home-recommended-skill-s1")).toBeTruthy();
  });

  it("表单不合法时提示并禁用保存；无改动时保存也禁用；可保存时点击触发保存", () => {
    const form = toFormState(CONFIG);
    const { rerender } = render(<HomePreviewPane {...base} form={form} invalid dirty />);
    expect(screen.getByTestId("home-config-preview-invalid")).toBeTruthy();
    expect((screen.getByTestId("home-config-preview-save") as HTMLButtonElement).disabled).toBe(true);
    rerender(<HomePreviewPane {...base} form={form} />);
    expect((screen.getByTestId("home-config-preview-save") as HTMLButtonElement).disabled).toBe(true);
    rerender(<HomePreviewPane {...base} form={form} dirty />);
    fireEvent.click(screen.getByTestId("home-config-preview-save"));
    expect(base.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("home-config-preview-back"));
    expect(base.onBack).toHaveBeenCalledTimes(1);
  });

  it("保存结果在预览栏可见：成功 / 失败（人话）/ 保存中禁用", () => {
    const form = toFormState(CONFIG);
    const { rerender } = render(<HomePreviewPane {...base} form={form} dirty status={{ ok: true, text: "已保存" }} />);
    expect(screen.getByTestId("home-config-preview-status").textContent).toBe("已保存");
    rerender(<HomePreviewPane {...base} form={form} dirty status={{ ok: false, text: "首页配置仅组织管理员可编辑" }} />);
    expect(screen.getByRole("alert").textContent).toContain("仅组织管理员");
    rerender(<HomePreviewPane {...base} form={form} dirty saving />);
    expect((screen.getByTestId("home-config-preview-save") as HTMLButtonElement).disabled).toBe(true);
  });
});
