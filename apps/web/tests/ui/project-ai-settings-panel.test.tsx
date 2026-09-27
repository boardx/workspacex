/**
 * 项目中枢 B2-S5（#4429）—— 设置 tab「AI 权限」面板：哪些来源允许进入项目大脑。
 * 钉住：默认全开（服务端回全集 + updatedAt null）/ 引导师切换 + 保存发的是整体替换的 PUT 体，并以回显为准 /
 * 组员视角只读徽标、没有开关也没有保存 / 403 如实显示。只 mock 网络边界（`@/lib/live-project-ai-settings`）。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const getProjectAiSettings = vi.fn();
const updateProjectAiSettings = vi.fn();

vi.mock("@/lib/live-project-ai-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-ai-settings")>()),
  getProjectAiSettings: (...a: unknown[]) => getProjectAiSettings(...a),
  updateProjectAiSettings: (...a: unknown[]) => updateProjectAiSettings(...a),
}));

import { ProjectAiSettingsPanel } from "@/components/project/project-ai-settings-panel";

const ALL = ["chat", "transcript", "survey", "interview", "research"] as const;
const DEFAULTS = { projectId: "p1", allowedSources: [...ALL], updatedAt: null, updatedBy: null };

beforeEach(() => { getProjectAiSettings.mockReset(); updateProjectAiSettings.mockReset(); });

describe("B2-S5 AI 权限面板", () => {
  it("默认：五个来源都开，标签来自契约，说明「尚未设置过」", async () => {
    getProjectAiSettings.mockResolvedValue(DEFAULTS);
    render(<ProjectAiSettingsPanel projectId="p1" canEdit />);
    await screen.findByTestId("project-ai-source-chat");
    expect(getProjectAiSettings).toHaveBeenCalledWith("p1");
    for (const k of ALL) expect(screen.getByTestId(`project-ai-source-${k}`)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("录音转写")).toBeInTheDocument();
    expect(screen.getByText("深度研究")).toBeInTheDocument();
    expect(screen.getByTestId("project-ai-settings-meta").textContent).toContain("尚未设置过");
    expect(screen.getByTestId("project-ai-settings-save")).toBeDisabled();
    expect(screen.queryByTestId("project-settings-empty")).toBeNull();
  });

  it("引导师：关掉问卷 + 保存 ⇒ PUT 体是整体替换后的集合；成功后显示已保存并以回显为准", async () => {
    getProjectAiSettings.mockResolvedValue(DEFAULTS);
    updateProjectAiSettings.mockResolvedValue({
      projectId: "p1", allowedSources: ["chat", "transcript", "interview", "research"], updatedAt: "2026-09-27T01:02:03.000Z", updatedBy: "u-fac",
    });
    render(<ProjectAiSettingsPanel projectId="p1" canEdit />);
    fireEvent.click(await screen.findByTestId("project-ai-source-survey"));
    expect(screen.getByTestId("project-ai-source-survey")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("project-ai-settings-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("project-ai-settings-save"));
    await screen.findByTestId("project-ai-settings-saved");
    expect(updateProjectAiSettings).toHaveBeenCalledWith({
      projectId: "p1", allowedSources: ["chat", "transcript", "interview", "research"],
    });
    expect(screen.getByTestId("project-ai-settings-meta").textContent).toContain("u-fac");
    expect(screen.getByTestId("project-ai-settings-save")).toBeDisabled();
  });

  it("组员视角：只读徽标，没有开关、没有保存", async () => {
    getProjectAiSettings.mockResolvedValue({ ...DEFAULTS, allowedSources: ["chat", "research"], updatedAt: "2026-09-27T00:00:00.000Z", updatedBy: "u-fac" });
    render(<ProjectAiSettingsPanel projectId="p1" canEdit={false} />);
    const chat = await screen.findByTestId("project-ai-source-chat");
    expect(chat).toHaveAttribute("data-allowed", "true");
    expect(chat.textContent).toBe("允许");
    expect(screen.getByTestId("project-ai-source-survey")).toHaveAttribute("data-allowed", "false");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByTestId("project-ai-settings-save")).toBeNull();
  });

  it("403：越权保存如实显示，不吞", async () => {
    getProjectAiSettings.mockResolvedValue(DEFAULTS);
    updateProjectAiSettings.mockRejectedValue(new ApiError(403, "PROJECT_ROLE_INSUFFICIENT", {}));
    render(<ProjectAiSettingsPanel projectId="p1" canEdit />);
    fireEvent.click(await screen.findByTestId("project-ai-source-chat"));
    fireEvent.click(screen.getByTestId("project-ai-settings-save"));
    const err = await screen.findByTestId("project-ai-settings-error");
    expect(err.textContent).toContain("引导师");
    expect(screen.queryByTestId("project-ai-settings-saved")).toBeNull();
  });

  it("读 403（NO_PROJECT_ROLE）也如实显示", async () => {
    getProjectAiSettings.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", {}));
    render(<ProjectAiSettingsPanel projectId="p1" canEdit={false} />);
    const err = await screen.findByTestId("project-ai-settings-error");
    expect(err.textContent).toContain("不在这个项目里");
  });
});
