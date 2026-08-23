/**
 * issue #1941 —— skill 试跑（`ag-screens.tsx` 的 `Editor.runTrialRun`）撞到 401 时，
 * 此前 `describeAssetError` 的通用兜底会把它展示成裸 `HTTP 401`/reasonCode，不是
 * "登录已过期，请重新登录"这种可行动文案。同 issue #1819/PR #1820 里
 * `chat-live-message-panel.tsx` 对 `runObservation.authExpired` 的同一条纪律：
 * 401 单独识别出来，渲染明确的重新登录提示，且标出 `data-trial-run-auth-expired`。
 *
 * ## 反空转
 * ① 装置自检：非 401 失败（如 503）仍然走通用的 `describeAssetError` 兜底，
 *    不应被误判成 auth-expired（不能为了让 401 用例过而把所有失败都当 401 处理）。
 * ② 断言的是真实渲染出的 DOM 文案与属性，不是 mock 掉 `pollSkillTrialRun` 本身
 *    再断言"我调用了它"——那只证明测试调了自己 mock 的函数。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

vi.mock("@monaco-editor/react", () => import("@/tests/support/monaco-editor-stub"));

const { getAssetDirectory, readAssetFile, getStoredSessionToken, runSkillTrialRun } = vi.hoisted(() => ({
  getAssetDirectory: vi.fn(),
  readAssetFile: vi.fn(),
  getStoredSessionToken: vi.fn(),
  runSkillTrialRun: vi.fn(),
}));

vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory, readAssetFile, writeAssetFile: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  getStoredSessionToken,
}));
vi.mock("@/lib/skill-trial-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/skill-trial-run")>()),
  runSkillTrialRun,
}));

import { AgSkillEditor } from "@/components/asset-governance/ag-screens";

function directory(path: string) {
  return { files: [{ path, sizeBytes: 42, badge: "MD" }], currentVersionId: "sv-1941" };
}

async function renderLiveEditorOnTrialRunTab() {
  render(<AgSkillEditor state="default" view="admin" />);
  await waitFor(() => {
    expect(screen.getByTestId("ag-skill-editortab-trialrun")).toBeTruthy();
  });
  fireEvent.click(screen.getByTestId("ag-skill-editortab-trialrun"));
  await waitFor(() => expect(screen.getByTestId("ag-skill-trialrun-panel")).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  getStoredSessionToken.mockReturnValue("token-1941");
  readAssetFile.mockResolvedValue({ body: "# SKILL.md\n", sizeBytes: 42 });
  getAssetDirectory.mockResolvedValue(directory("SKILL.md"));
});

afterEach(() => cleanup());

describe("issue #1941 · skill 试跑撞 401 → 明确的重新登录提示", () => {
  it("提交撞 401：渲染『登录已失效，请重新登录』，且标出 data-trial-run-auth-expired", async () => {
    runSkillTrialRun.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", undefined));
    await renderLiveEditorOnTrialRunTab();

    fireEvent.change(screen.getByTestId("ag-skill-trialrun-input"), { target: { value: "样例输入" } });
    fireEvent.click(screen.getByTestId("ag-skill-trialrun-run"));

    const error = await screen.findByTestId("ag-skill-trialrun-error");
    expect(error.textContent).toContain("登录已失效");
    expect(error.textContent).toContain("请重新登录");
    // ⛔ 不能出现裸 HTTP 状态码或 reasonCode——那是没翻译过的兜底文案。
    expect(error.textContent).not.toContain("HTTP 401");
    expect(error.textContent).not.toContain("UNAUTHORIZED");
    expect(error).toHaveAttribute("data-trial-run-auth-expired", "true");
  });

  it("非 401 失败（如 503）：仍走通用兜底展示 reasonCode，不误判成 auth-expired", async () => {
    runSkillTrialRun.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", undefined));
    await renderLiveEditorOnTrialRunTab();

    fireEvent.change(screen.getByTestId("ag-skill-trialrun-input"), { target: { value: "样例输入" } });
    fireEvent.click(screen.getByTestId("ag-skill-trialrun-run"));

    const error = await screen.findByTestId("ag-skill-trialrun-error");
    expect(error.textContent).toContain("DEPENDENCY_UNAVAILABLE");
    expect(error.textContent).not.toContain("登录已失效");
    expect(error).not.toHaveAttribute("data-trial-run-auth-expired");
  });
});
