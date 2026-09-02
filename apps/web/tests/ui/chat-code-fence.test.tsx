/**
 * AI 气泡里的围栏代码块默认折叠（人类 2026-09-02：跑 pdf/pptx/docx/xlsx skill 时不要
 * 把生成脚本整段摊在回复里），用户点「显示代码」再展开；行内 code 不受影响。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn().mockResolvedValue(true), render: vi.fn() },
}));

const SCRIPT = "const { PDFDocument } = require('pdf-lib');\nconst fs = require('fs');\n\n(async () => {\n  const doc = await PDFDocument.create();\n})();";

describe("ChatCodeFence（围栏代码块默认折叠）", () => {
  it("围栏代码默认隐藏，只留语言 + 行数摘要；点「显示代码」后展开，再点收起", async () => {
    render(<MarkdownMessage text={"PDF 这就生成。\n\n```javascript\n" + SCRIPT + "\n```\n\n完。"} />);
    const fence = await screen.findByTestId("chat-code-fence");
    expect(fence.getAttribute("data-open")).toBe("false");
    expect(fence.getAttribute("data-lang")).toBe("javascript");
    expect(fence.textContent).toContain("6 行");
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

  it("行内 code 不走折叠，照常内联显示", async () => {
    render(<MarkdownMessage text={"先跑 `pnpm harness verify` 再收尾。"} />);
    const md = await screen.findByTestId("chat-ai-markdown");
    expect(md.querySelector("code")?.textContent).toBe("pnpm harness verify");
    expect(screen.queryByTestId("chat-code-fence")).toBeNull();
  });

  it("「复制」把围栏源码写进剪贴板（折叠态也可复制，不必先展开）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MarkdownMessage text={"```bash\npnpm i\n```"} />);
    fireEvent.click(await screen.findByTestId("chat-code-fence-copy"));
    expect(writeText).toHaveBeenCalledWith("pnpm i\n");
  });
});
