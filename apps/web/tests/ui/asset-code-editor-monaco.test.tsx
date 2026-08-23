/**
 * #1884 —— `AssetCodeEditor`（`asset-governance/asset-code-editor.tsx`）的两件事：
 *
 * ① 按扩展名把正确的 Monaco `language` 传下去（`.py`→python、`.json`→json……）。
 * ② 根文件（`SKILL.md`/`AGENT.md`）内联校验：复用 `@repo/contracts/asset-governance`
 *    的 `validateRootFrontmatter`（服务端 `WriteAssetFile` 用的**同一份**规则），
 *    在编辑期通过 `monaco.editor.setModelMarkers` 把问题标出来。
 *
 * 真实 Monaco 在 jsdom 下无法渲染（需要 canvas/worker/`ResizeObserver`），本文件用
 * `tests/support/monaco-editor-stub.tsx` 替身掉「Monaco 怎么画」，只测「我们喂给
 * Monaco 的东西对不对」——`validateRootFrontmatter` 本身是真代码、真跑，不是 mock。
 *
 * 反空转：
 * · 装置自检——挂载时（合法 frontmatter）markers 必须是空数组，不能一上来就红。
 * · 正样本——喂一个真的缺字段 frontmatter，断言 markers 非空、且带对应字段名。
 * · 负样本（`isRootFile: false`）——同一段坏 frontmatter，但当前文件不是根文件时
 *   **不应该**报错，防止「不管选中哪个文件都报同一个错」这种假阳性。
 * · 编辑期实时性——先挂载合法内容（markers 应为空），再模拟用户打字改坏，断言
 *   下一次 `setModelMarkers` 调用变成非空——这是「不用等提交到沙箱跑一遍」的
 *   核心承诺，必须证明它在**编辑过程中**触发，不是只在挂载那一刻算一次。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@monaco-editor/react", () => import("@/tests/support/monaco-editor-stub"));

import { monacoEditorStub } from "@/tests/support/monaco-editor-stub";
import { AssetCodeEditor, monacoLanguageFromPath } from "@/components/asset-governance/asset-code-editor";

afterEach(() => cleanup());
beforeEach(() => {
  monacoEditorStub.setModelMarkers.mockClear();
});

describe("monacoLanguageFromPath —— 扩展名到 Monaco language 的映射", () => {
  it.each([
    ["SKILL.md", "markdown"],
    ["scripts/run.py", "python"],
    ["scripts/run.js", "javascript"],
    ["scripts/run.ts", "typescript"],
    ["config.json", "json"],
    ["config.yaml", "yaml"],
    ["config.yml", "yaml"],
    ["run.sh", "shell"],
    ["没有扩展名的文件", "plaintext"],
  ])("%s → %s", (path, expected) => {
    expect(monacoLanguageFromPath(path)).toBe(expected);
  });
});

async function renderEditor(props: Partial<React.ComponentProps<typeof AssetCodeEditor>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <AssetCodeEditor
      testid="editor-under-test"
      path="SKILL.md"
      value="---\nname: ok\ndescription: ok\nallowed-tools: []\n---\n正文"
      onChange={onChange}
      {...props}
    />,
  );
  // `next/dynamic({ ssr: false })` 首帧渲染的是 loading 占位，真身（替身）要等一个
  // 微任务之后才挂上——所有断言都必须先等它出现，否则会在 loading 占位上断言。
  await waitFor(() => {
    within(screen.getByTestId("editor-under-test")).getByTestId("monaco-mock-editor");
  });
  const textarea = () =>
    within(screen.getByTestId("editor-under-test")).getByTestId("monaco-mock-editor") as HTMLTextAreaElement;
  return { view, onChange, textarea };
}

describe("AssetCodeEditor —— 根文件 frontmatter 内联校验", () => {
  it("装置自检：合法 frontmatter 挂载后 markers 为空数组，不能一上来就红", async () => {
    await renderEditor({
      value: "---\nname: ok\ndescription: ok\nallowed-tools: []\n---\n正文",
      rootFrontmatterCheck: { assetKind: "skill", isRootFile: true },
    });
    expect(monacoEditorStub.setModelMarkers).toHaveBeenCalled();
    const lastCall = monacoEditorStub.setModelMarkers.mock.calls.at(-1)!;
    expect(lastCall[2]).toEqual([]);
  });

  it("正样本：缺 description/allowed-tools 的 SKILL.md，markers 非空且带对应字段名", async () => {
    await renderEditor({
      value: "---\nname: ok\n---\n正文",
      rootFrontmatterCheck: { assetKind: "skill", isRootFile: true },
    });
    const lastCall = monacoEditorStub.setModelMarkers.mock.calls.at(-1)!;
    const markers = lastCall[2] as Array<{ message: string; severity: number }>;
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.some((m) => m.message.includes("description"))).toBe(true);
    expect(markers.some((m) => m.message.includes("allowed-tools"))).toBe(true);
  });

  it("负样本：同一段坏 frontmatter，但当前文件不是根文件时不应该报错", async () => {
    await renderEditor({
      path: "scripts/helper.py",
      value: "---\nname: ok\n---\n正文",
      rootFrontmatterCheck: { assetKind: "skill", isRootFile: false },
    });
    const lastCall = monacoEditorStub.setModelMarkers.mock.calls.at(-1)!;
    expect(lastCall[2]).toEqual([]);
  });

  it("编辑期实时性：挂载时合法 → 用户打字改坏 → 下一次 setModelMarkers 变成非空", async () => {
    const { textarea, onChange } = await renderEditor({
      value: "---\nname: ok\ndescription: ok\nallowed-tools: []\n---\n正文",
      rootFrontmatterCheck: { assetKind: "skill", isRootFile: true },
    });
    expect(monacoEditorStub.setModelMarkers.mock.calls.at(-1)![2]).toEqual([]);

    fireEvent.change(textarea(), { target: { value: "---\nname: ok\n---\n正文" } });
    expect(onChange).toHaveBeenCalledWith("---\nname: ok\n---\n正文");
    const lastCall = monacoEditorStub.setModelMarkers.mock.calls.at(-1)!;
    expect((lastCall[2] as unknown[]).length).toBeGreaterThan(0);
  });

  it("kind === agent 也接同一套校验（AGENT.md 必填字段不同）", async () => {
    await renderEditor({
      path: "AGENT.md",
      value: "---\nname: ok\n---\n正文",
      rootFrontmatterCheck: { assetKind: "agent", isRootFile: true },
    });
    const lastCall = monacoEditorStub.setModelMarkers.mock.calls.at(-1)!;
    const markers = lastCall[2] as Array<{ message: string }>;
    expect(markers.some((m) => m.message.includes("role"))).toBe(true);
    expect(markers.some((m) => m.message.includes("model"))).toBe(true);
  });

  it("不传 rootFrontmatterCheck（原型/mock 态）：从不调用 setModelMarkers 带非空 markers", async () => {
    await renderEditor({ rootFrontmatterCheck: undefined });
    for (const call of monacoEditorStub.setModelMarkers.mock.calls) {
      expect(call[2]).toEqual([]);
    }
  });
});
