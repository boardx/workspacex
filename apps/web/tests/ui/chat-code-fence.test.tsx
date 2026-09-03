/**
 * AI 气泡里的围栏代码块超过阈值行数才默认折叠（人类 2026-09-02：跑 pdf/pptx/docx/xlsx
 * skill 时不要把生成脚本整段摊在回复里；review #2556 反馈③：普通技术问答里的短代码块
 * 不该跟着被藏起来），用户点「显示代码」再展开；行内 code 不受影响；复制在 Clipboard
 * API 不可用/被拒绝时诚实报「复制失败」，不假装成功（review #2556 反馈②）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn().mockResolvedValue(true), render: vi.fn() },
}));

// 11 行，超过折叠阈值（8 行）。
const SCRIPT = [
  "const { PDFDocument } = require('pdf-lib');",
  "const fs = require('fs');",
  "",
  "(async () => {",
  "  const doc = await PDFDocument.create();",
  "  const page = doc.addPage();",
  "  page.drawText('hello');",
  "  const bytes = await doc.save();",
  "  fs.writeFileSync('out.pdf', bytes);",
  "})();",
  "",
].join("\n");

describe("ChatCodeFence（围栏代码块超阈值才默认折叠）", () => {
  it("超过阈值行数的围栏默认隐藏，只留语言 + 行数摘要；点「显示代码」后展开，再点收起", async () => {
    render(<MarkdownMessage text={"PDF 这就生成。\n\n```javascript\n" + SCRIPT + "```\n\n完。"} />);
    const fence = await screen.findByTestId("chat-code-fence");
    expect(fence.getAttribute("data-open")).toBe("false");
    expect(fence.getAttribute("data-lang")).toBe("javascript");
    expect(fence.textContent).toContain("10 行");
    expect(fence.querySelector("pre")).toBeNull();
    expect(screen.queryByText(/pdf-lib/)).toBeNull();
    // 前后正文照常显示。
    expect(screen.getByText(/PDF 这就生成/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-code-fence-toggle"));
    expect(fence.getAttribute("data-open")).toBe("true");
    expect(fence.querySelector("pre code")?.textContent).toContain("pdf-lib");

    fireEvent.click(screen.getByTestId("chat-code-fence-toggle"));
    expect(fence.querySelector("pre")).toBeNull();
  });

  it("阈值以下的短代码块默认展开，不当作长脚本藏起来", async () => {
    render(<MarkdownMessage text={"```bash\npnpm i\n```"} />);
    const fence = await screen.findByTestId("chat-code-fence");
    expect(fence.getAttribute("data-open")).toBe("true");
    expect(fence.querySelector("pre code")?.textContent).toContain("pnpm i");
  });

  it("行内 code 不走折叠壳，照常内联显示", async () => {
    render(<MarkdownMessage text={"先跑 `pnpm harness verify` 再收尾。"} />);
    const md = await screen.findByTestId("chat-ai-markdown");
    expect(md.querySelector("code")?.textContent).toBe("pnpm harness verify");
    expect(screen.queryByTestId("chat-code-fence")).toBeNull();
  });

  it("「复制」成功时把围栏源码写进剪贴板并报「已复制」，折叠态也可复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MarkdownMessage text={"```bash\n" + SCRIPT + "```"} />);
    fireEvent.click(await screen.findByTestId("chat-code-fence-copy"));
    expect(writeText).toHaveBeenCalledWith(SCRIPT);
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("Clipboard API 不可用时报「复制失败」，不假装复制成功（review #2556 反馈②）", async () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<MarkdownMessage text={"```bash\npnpm i\n```"} />);
    fireEvent.click(await screen.findByTestId("chat-code-fence-copy"));
    expect(await screen.findByText("复制失败")).toBeInTheDocument();
  });

  it("Clipboard 权限被拒绝（writeText reject）时同样报「复制失败」", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MarkdownMessage text={"```bash\npnpm i\n```"} />);
    fireEvent.click(await screen.findByTestId("chat-code-fence-copy"));
    expect(await screen.findByText("复制失败")).toBeInTheDocument();
  });
});
