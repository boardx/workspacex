/**
 * AI 气泡里的围栏代码块超过阈值行数才默认折叠（人类 2026-09-02：跑 pdf/pptx/docx/xlsx
 * skill 时不要把生成脚本整段摊在回复里；review #2556 反馈③：普通技术问答里的短代码块
 * 不该跟着被藏起来），用户点「显示代码」再展开；行内 code 不受影响；复制在 Clipboard
 * API 不可用/被拒绝时诚实报「复制失败」，不假装成功（review #2556 反馈②）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ChatCodeFence } from "@/components/chat/chat-code-fence";

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

  const shortCode = <code className="language-js">pnpm i</code>;
  const longCode = <code className="language-js">{SCRIPT}</code>;

  it("流式增量：短→长时折叠态跟着阈值自动收起（用户没手动切换过）", () => {
    const { getByTestId, rerender } = render(<ChatCodeFence>{shortCode}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("true");

    rerender(<ChatCodeFence>{longCode}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("false");
  });

  it("流式增量：长→短时折叠态跟着阈值自动展开（用户没手动切换过）", () => {
    const { getByTestId, rerender } = render(<ChatCodeFence>{longCode}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("false");

    rerender(<ChatCodeFence>{shortCode}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("true");
  });

  it("用户手动展开后，后续流式更新不再把面板收回去（review #2556 二轮反馈②）", () => {
    const { getByTestId, rerender } = render(<ChatCodeFence>{longCode}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("false");

    fireEvent.click(getByTestId("chat-code-fence-toggle"));
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("true");

    // 流式增量继续追加内容（同样 > 阈值），用户的「展开」选择应该保留。
    rerender(<ChatCodeFence>{<code className="language-js">{SCRIPT + "// more\n"}</code>}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("true");
  });

  it("用户手动收起后，后续流式更新（含缩短到阈值以下）不再自动展开", () => {
    const { getByTestId, rerender } = render(<ChatCodeFence>{longCode}</ChatCodeFence>);
    fireEvent.click(getByTestId("chat-code-fence-toggle")); // 展开
    fireEvent.click(getByTestId("chat-code-fence-toggle")); // 再手动收起
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("false");

    rerender(<ChatCodeFence>{shortCode}</ChatCodeFence>);
    expect(getByTestId("chat-code-fence").getAttribute("data-open")).toBe("false");
  });

  it("连续快速复制只保留最后一次结果的计时器，不被更早的计时器提前冲掉", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    const { getByTestId } = render(<ChatCodeFence>{shortCode}</ChatCodeFence>);
    const btn = getByTestId("chat-code-fence-copy");

    await fireEvent.click(btn); // 第一次：成功
    await vi.advanceTimersByTimeAsync(500); // 还没到第一次的 1500ms 复位
    await fireEvent.click(btn); // 第二次：失败，应重置计时器
    await vi.advanceTimersByTimeAsync(1000); // 到第一次计时器原本该触发的时间点
    expect(btn.textContent).toBe("复制失败"); // 没被第一次的旧计时器提前冲回「复制」

    await vi.advanceTimersByTimeAsync(500); // 补满第二次计时器的 1500ms
    expect(btn.textContent).toBe("复制");
    vi.useRealTimers();
  });

  it("乱序 settle：更早发起但更晚 resolve 的复制请求，不能覆盖更新一次的结果（review #2556 三轮反馈①）", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const writeText = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    Object.assign(navigator, { clipboard: { writeText } });
    const { getByTestId } = render(<ChatCodeFence>{shortCode}</ChatCodeFence>);
    const btn = getByTestId("chat-code-fence-copy");

    fireEvent.click(btn); // 第一次：writeText 挂起，尚未 settle
    fireEvent.click(btn); // 第二次：writeText 挂起，尚未 settle
    expect(writeText).toHaveBeenCalledTimes(2);

    // 乱序 settle：第二次（更新的一次）先 resolve。
    resolveSecond();
    await screen.findByText("已复制");

    // 第一次（更早发起、但更晚 settle 的一次）随后才 resolve——它的结果必须被丢弃，
    // 不能把已经显示的「已复制」覆盖掉或重置计时器。
    resolveFirst();
    await Promise.resolve(); // 让第一次的 await 继续跑到 applyIfLatest。
    expect(btn.textContent).toBe("已复制");
  });

  it("卸载时清理未触发的复位计时器，不留悬挂回调（review #2556 二轮反馈④）", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { getByTestId, unmount } = render(<ChatCodeFence>{shortCode}</ChatCodeFence>);
    await fireEvent.click(getByTestId("chat-code-fence-copy"));
    expect(() => unmount()).not.toThrow();
    // 计时器本该在卸载前被清掉；推进到原定触发点，不应抛出 setState-on-unmounted 之类的错误。
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    vi.useRealTimers();
  });
});
