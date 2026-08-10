/**
 * #881 F1 —— skill 内容**编辑并保存**（此前只读，且「保存并发布」按钮不接任何写路径）。
 *
 * ## 这条 feature 修的是一个「界面在说谎」的状态
 *
 * 在这次改动之前，资产编辑器：
 *   · 正文用只读 `CodeView` 渲染 —— 根本改不了；
 *   · 却挂着一个「保存并发布」按钮，点确认只会本地显示「已执行（原型态，仅本地）」；
 *   · 还**写死**显示「有未保存改动」——一个恒真的状态指示，等于没有指示，而且是假话。
 * 起因是真实用户在后台 Skill 页问「导入以后可以编辑吗」。答案当时是「后端可以，界面点不到」。
 *
 * ## 反空转（本仓已九次「全绿但空转」）
 *
 * ① 正样本 + **装置自检**：点之前 `writeAssetFile` 必须是 0 次调用，
 *    否则「点了之后是 1 次」可能只是初始就在调。
 * ② 失败路径**单独断言**：写失败时**不显示成功**、且 dirty 不清 —— 这条挡的是
 *    「catch 掉错误照样显示已保存」这种假成功。
 * ③ 断言「已保存为新版本」这句**措辞本身**：服务端语义是追加不可变新版本，
 *    说成「已修改」会让人以为历史被改写了（F1-4）。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

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

const SERVER_BODY = "# SKILL.md\n原始正文\n";
const EDITED_BODY = "# SKILL.md\n用户改过的正文\n";

/** 真实数据态所需的最小目录响应——第一项就是编辑器默认选中的那个文件。 */
function directory(path: string) {
  return { files: [{ path, sizeBytes: 42, badge: "MD" }] };
}

async function renderLiveEditor() {
  const view = render(<AgSkillEditor state="default" view="admin" />);
  // ⚠ 必须等到**真实数据态**：mock 态下 `ag-skill-code` 是只读 `CodeView`（div），
  //   真实态才换成 textarea。早取一次会拿到那个 div，之后它被替换掉，引用就失效了
  //   （第一版测试就是这么写错的：断言 `.value` 恒为 undefined/''）。
  await waitFor(() => {
    const el = screen.getByTestId("ag-skill-code");
    expect(el.tagName).toBe("TEXTAREA");
  });
  return view;
}

/** 每次都重新取，避免持有已被替换掉的旧节点。 */
function codeBox(): HTMLTextAreaElement {
  return screen.getByTestId("ag-skill-code") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getStoredSessionToken.mockReturnValue("token-881");
  readAssetFile.mockResolvedValue({ body: SERVER_BODY, sizeBytes: 42 });
  writeAssetFile.mockResolvedValue({ sizeBytes: 99, dirty: true });
});

afterEach(() => cleanup());

describe("F1 · 真实数据态下正文可编辑并能保存", () => {
  it("读回服务端正文 → 改动 → 保存：打的是 writeAssetFile，且带的是改后的正文", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md"));
    await renderLiveEditor();

    // 装置自检①：正文确实来自服务端，不是 mock 常量。
    await waitFor(() => expect(codeBox().value).toBe(SERVER_BODY));
    // 装置自检②：还没点保存，写接口必须一次都没被调过。
    expect(writeAssetFile).toHaveBeenCalledTimes(0);

    fireEvent.change(codeBox(), { target: { value: EDITED_BODY } });
    // 改了才出现「有未保存改动」——此前这句是写死的。
    expect(screen.getByTestId("ag-skill-dirty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    fireEvent.click(screen.getByTestId("ag-skill-publish-confirm"));

    await waitFor(() => expect(writeAssetFile).toHaveBeenCalledTimes(1));
    expect(writeAssetFile).toHaveBeenCalledWith("skill", expect.any(String), "SKILL.md", EDITED_BODY);
  });

  it("保存成功后：措辞是「已保存为新版本」，且「有未保存改动」消失", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md"));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(SERVER_BODY));

    fireEvent.change(codeBox(), { target: { value: EDITED_BODY } });
    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    fireEvent.click(screen.getByTestId("ag-skill-publish-confirm"));

    const done = await screen.findByTestId("ag-skill-publish-done");
    // F1-4：服务端语义是**追加不可变新版本**，措辞必须照这个事实说。
    expect(done.textContent).toContain("已保存为新版本");
    expect(done.textContent).not.toContain("原型态");
    await waitFor(() => expect(screen.queryByTestId("ag-skill-dirty")).toBeNull());
  });

  /**
   * ⚠ 本文件最重要的一条：**写失败时绝不显示成功**。
   * 「catch 住错误照样显示已保存」是本仓最忌讳的假成功形状。
   */
  it("写失败：显示真实错误、不显示「已保存」、且未保存改动仍在", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md"));
    writeAssetFile.mockRejectedValue(new Error("ORG_SCOPE_DENIED"));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(SERVER_BODY));

    fireEvent.change(codeBox(), { target: { value: EDITED_BODY } });
    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    fireEvent.click(screen.getByTestId("ag-skill-publish-confirm"));

    expect((await screen.findByTestId("ag-skill-publish-error")).textContent).toContain("ORG_SCOPE_DENIED");
    expect(screen.queryByTestId("ag-skill-publish-done")).toBeNull();
    // 失败之后改动还在（没有被"当成保存成功"清掉）。
    expect(screen.getByTestId("ag-skill-dirty")).toBeTruthy();
  });

  it("没有改动时保存按钮不可点：不发出一次什么都没改的写请求", async () => {
    getAssetDirectory.mockResolvedValue(directory("SKILL.md"));
    await renderLiveEditor();
    await waitFor(() => expect(codeBox().value).toBe(SERVER_BODY));

    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    const confirm = screen.getByTestId("ag-skill-publish-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(writeAssetFile).toHaveBeenCalledTimes(0);
  });
});

describe("F1 · 未登录（mock 预览态）不得对着假目录发真实写请求", () => {
  it("没有 token 时保存按钮不可点，且 writeAssetFile 从不被调用", async () => {
    getStoredSessionToken.mockReturnValue(null);
    render(<AgSkillEditor state="default" view="admin" />);

    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    const confirm = screen.getByTestId("ag-skill-publish-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(writeAssetFile).toHaveBeenCalledTimes(0);
    // 装置自检：这条路径下 readAssetFile 也不该被调（没登录就不打真实接口）。
    expect(readAssetFile).toHaveBeenCalledTimes(0);
  });
});
