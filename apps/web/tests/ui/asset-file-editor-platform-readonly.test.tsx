/**
 * 平台官方 skill（如截图里报的 `skill-platform-xlsx-create`）在 Skill 编辑器里的只读态。
 *
 * ## 这条测试挡的是什么
 *
 * 修复前：`PgAssetFileRepository`（后端）按调用方自己的 `orgId` 单独查平台 skill，永远
 * 查不到 ⇒ `getDirectory` 折叠成 `null` ⇒ 控制器返回裸 404 ⇒ 前端 `Editor` 的
 * `getAssetDirectory().catch()` 把这当成"接口失败"回退成 mock，显示
 * 「接口错误：HTTP 404（已回退 mock）」——用户报的正是这个现象。
 *
 * 后端修复后，`getAssetDirectory` 对平台 skill 会真的返回目录（不是 404），并在
 * `readOnly: true` 里如实说明"这份数据来自平台，只读"。这份前端测试挡的是修复的
 * **另一半**：`readOnly: true` 到达之后，界面必须真的表现成只读——不是读到了却仍然
 * 显示一个点了会 404 的可编辑框/保存按钮，那只是把同一个用户困惑换了个地方发生。
 *
 * ## 反空转
 * ① 装置自检：对照组（`readOnly: false`，组织自己的 skill）走一遍同一套断言，
 *    确认这次改动没有让"所有 skill 都变只读"——只有平台行才只读。
 * ② 断言的是 Monaco 替身实际收到的 `readOnly` 选项 + 保存按钮的 `disabled`，
 *    不是"组件渲染没报错"这种弱断言。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@monaco-editor/react", () => import("@/tests/support/monaco-editor-stub"));

const { getAssetDirectory, readAssetFile, writeAssetFile, getStoredSessionToken } = vi.hoisted(() => ({
  getAssetDirectory: vi.fn(),
  readAssetFile: vi.fn(),
  writeAssetFile: vi.fn(),
  getStoredSessionToken: vi.fn(),
}));

vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory, readAssetFile, writeAssetFile }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  getStoredSessionToken,
}));

import { AgSkillEditor } from "@/components/asset-governance/ag-screens";

const PLATFORM_SKILL_BODY = "---\nname: Excel 表格生成\n---\n\n# Excel 表格生成\n";

function directory(path: string, readOnly: boolean) {
  return { files: [{ path, sizeBytes: 42, badge: "MD" }], currentVersionId: "sv-platform-1", readOnly };
}

async function renderLiveEditor() {
  const view = render(<AgSkillEditor state="default" view="admin" assetId="skill-platform-xlsx-create" assetLabel="Excel 表格生成" />);
  await waitFor(() => {
    within(screen.getByTestId("ag-skill-code")).getByTestId("monaco-mock-editor");
  });
  return view;
}

function codeBox(): HTMLTextAreaElement {
  return within(screen.getByTestId("ag-skill-code")).getByTestId("monaco-mock-editor") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getStoredSessionToken.mockReturnValue("token-platform-readonly");
  readAssetFile.mockResolvedValue({ body: PLATFORM_SKILL_BODY, sizeBytes: 42 });
});

afterEach(() => cleanup());

describe("平台官方 skill：readOnly=true 时界面真的只读", () => {
  it("不再显示「接口错误…已回退 mock」——目录真的读到了，走的是真实数据态徽标", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md", true));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(PLATFORM_SKILL_BODY));

    expect(screen.queryByTestId("ag-skill-live-error")).toBeNull();
    expect(screen.getByText("真实数据 · GetAssetDirectory")).toBeTruthy();
  });

  it("显示「平台官方 skill · 全组织只读」徽标", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md", true));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(PLATFORM_SKILL_BODY));

    expect(screen.getByTestId("ag-skill-readonly")).toBeTruthy();
  });

  it("代码编辑区本身是只读的（Monaco 收到 readOnly:true，不是只有保存按钮被挡）", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md", true));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(PLATFORM_SKILL_BODY));

    expect(codeBox().readOnly).toBe(true);
  });

  it("「保存并发布」的确认按钮被禁用，且从不发出写请求", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md", true));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(PLATFORM_SKILL_BODY));

    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    const confirm = screen.getByTestId("ag-skill-publish-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(writeAssetFile).toHaveBeenCalledTimes(0);
  });
});

describe("对照组：组织自己的 skill（readOnly=false）不受这次改动影响——不是所有 skill 都变只读", () => {
  it("代码编辑区可写，保存按钮在有改动后可点，会真的发出写请求", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md", false));
    writeAssetFile.mockResolvedValue({ sizeBytes: 99, dirty: true });
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(PLATFORM_SKILL_BODY));

    expect(codeBox().readOnly).toBe(false);
    expect(screen.queryByTestId("ag-skill-readonly")).toBeNull();

    const nextBody = `${PLATFORM_SKILL_BODY}改过了\n`;
    fireEvent.change(codeBox(), { target: { value: nextBody } });
    expect(screen.getByTestId("ag-skill-dirty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    const confirm = screen.getByTestId("ag-skill-publish-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(writeAssetFile).toHaveBeenCalledTimes(1));
  });
});
