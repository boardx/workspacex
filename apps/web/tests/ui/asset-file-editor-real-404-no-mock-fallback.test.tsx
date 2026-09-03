/**
 * 2026-09-03 —— 真实数据态下 `getAssetDirectory` 真的失败（比如打开一个只有
 * `skill_contracts` 行、没有对应 `skills` 行的模型 B skill），编辑器不再悄悄回退
 * 成 `/asset-governance` 原型的固定演示目录/正文。
 *
 * ## 挡的是什么
 *
 * 修复前：`liveDir` 为 `null` 就无条件回退到 `mockTree`/`main.body`——不管是
 * "从没登录、压根没发起过真实请求"（预期内的回退），还是"真的发了请求、真的
 * 404 了"（这次要挡的情形），两者共用同一份看起来完整可点的假文件树与假正文，
 * 唯一的破绽只有一行不起眼的红字。头部的 skill 名字/id 却是真的——用户很容易
 * 把这份假内容当成这个 skill 的真实内容来读甚至照着改（虽然保存按钮确实被禁用）。
 *
 * ## 反空转
 * ① 对照组：未登录（没有 token，从未发起真实请求）时，`mockTree` 回退行为必须
 *    原样保留——这不是把"预览态 mock"这整条路径也删掉。
 * ② 断言的是真实 DOM 内容不包含原型样本文本（"MECE 假设拆解"），而不是弱断言
 *    "组件没崩"。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@monaco-editor/react", () => import("@/tests/support/monaco-editor-stub"));

const { getAssetDirectory, readAssetFile, getStoredSessionToken } = vi.hoisted(() => ({
  getAssetDirectory: vi.fn(),
  readAssetFile: vi.fn(),
  getStoredSessionToken: vi.fn(),
}));

vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory, readAssetFile, writeAssetFile: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  getStoredSessionToken,
}));

import { AgSkillEditor } from "@/components/asset-governance/ag-screens";

const PROTOTYPE_SAMPLE_MARKER = "MECE 假设拆解"; // AG_SKILL_MAIN 原型样本内容的可识别片段

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("真实数据态：getAssetDirectory 真的 404 时，不回退成原型演示内容", () => {
  it("不显示原型样本文本；显示明确的『无法编辑』说明，而不是一份看起来完整的假文件树", async () => {
    getStoredSessionToken.mockReturnValue("token-real-404");
    getAssetDirectory.mockRejectedValue(new Error("SKILL_NOT_FOUND"));

    render(<AgSkillEditor state="default" view="admin" assetId="skill-contract-only" assetLabel="只有契约、没有源码的 skill" />);

    await waitFor(() => expect(screen.getByTestId("ag-skill-unavailable")).toBeInTheDocument());

    expect(screen.queryByText(new RegExp(PROTOTYPE_SAMPLE_MARKER))).toBeNull();
    expect(screen.getByTestId("ag-skill-unavailable").textContent).toContain("无法在这里编辑");
    // 不再说"已回退 mock"——那句话此前描述的正是这里被修掉的行为。
    expect(screen.getByTestId("ag-skill-live-error").textContent).not.toContain("已回退 mock");
  });
});

describe("对照组：未登录（从未发起真实请求）时，预览态 mock 回退保持不变", () => {
  it("不打 getAssetDirectory；仍然显示原型演示样本内容", async () => {
    getStoredSessionToken.mockReturnValue(null);

    render(<AgSkillEditor state="default" view="admin" />);

    await waitFor(() => expect(screen.getByTestId("ag-skill-code")).toBeInTheDocument());
    expect(getAssetDirectory).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId("ag-skill-code").textContent).toContain(PROTOTYPE_SAMPLE_MARKER);
    expect(screen.queryByTestId("ag-skill-unavailable")).toBeNull();
  });
});
