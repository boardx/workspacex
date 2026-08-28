/**
 * issue #2321 round 4 —— `ActiveFilePanel` 对 `source: "agent_run_output"` 文件的下载卡片
 * 分支反证。真实证据：`run-skill-script.ts` 产出的 PDF/DOCX/XLSX 是二进制字节，
 * `file_content_delta` 从来没有真实生产者对这类来源发过，`file.content` 永远是空字符串
 * ——升级前会一路落到 `<pre>` 分支渲染出一个"生成完了却什么都没有"的空白 tab。
 *
 * 不覆盖既有 markdown/code 分支（`copilotkit-v2-active-file-panel.spec.ts` 已经是真实
 * wire 级证据，这里只加"新分支"这一段）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ActiveFilePanel } from "@/components/chat/active-file-panel";
import type { ActiveFile } from "@/lib/agui-file-events";

const PRODUCED_FILE: ActiveFile = {
  uri: "vfs://attachment/att-pdf-fixture-001",
  name: "季度报告.pdf",
  mime: "application/pdf",
  source: "agent_run_output",
  bytes: 204_800,
  content: "",
  nextSequence: 0,
};

describe("ActiveFilePanel -- source: agent_run_output 下载卡片（issue #2321 round 4）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["%PDF-1.4 fake bytes"], { type: "application/pdf" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    createObjectURL = vi.fn(() => "blob:produced-file-fixture");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("不落到空白 <pre>：渲染文件名 + 人读字节数 + 下载按钮，从不显示空文本区", async () => {
    render(<ActiveFilePanel files={[PRODUCED_FILE]} threadId="thread-fixture-1" />);

    const content = screen.getByTestId("active-file-content");
    const { getByText } = within(content);
    expect(getByText("季度报告.pdf")).toBeInTheDocument();
    expect(getByText("200 KB")).toBeInTheDocument();
    expect(screen.queryByTestId("active-file-plaintext")).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-file-code-editor")).not.toBeInTheDocument();
  });

  it("拉到真实字节后，下载链接指向鉴权路由拉回来的 blob URL（真实附件下载路由，不是新造的）", async () => {
    render(<ActiveFilePanel files={[PRODUCED_FILE]} threadId="thread-fixture-1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/chat/threads/thread-fixture-1/attachments/att-pdf-fixture-001/content"),
        expect.anything(),
      );
    });

    const link = await screen.findByTestId("active-file-produced-download-link");
    await waitFor(() => expect(link).toHaveAttribute("href", "blob:produced-file-fixture"));
    expect(link).toHaveAttribute("download", "季度报告.pdf");
  });

  it("threadId 还没解析出来（null）时不发请求，下载按钮保持禁用而不是拼一个坏 URL", () => {
    render(<ActiveFilePanel files={[PRODUCED_FILE]} threadId={null} />);

    expect(fetchMock).not.toHaveBeenCalled();
    const link = screen.getByTestId("active-file-produced-download-link");
    expect(link).toHaveAttribute("aria-disabled", "true");
  });

  it("下载路由请求失败时如实报错，不假装下载按钮可用", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404 }));
    render(<ActiveFilePanel files={[PRODUCED_FILE]} threadId="thread-fixture-1" />);

    expect(await screen.findByTestId("active-file-produced-download-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("active-file-produced-download-link")).not.toBeInTheDocument();
  });
});
