/**
 * issue #3387 ② —— 「Thinking · 进展摘要」里的 markdown 必须真的被渲染。
 *
 * ## 人类实测（devapp，2026-09-11）
 *
 * 展开执行过程后，进展摘要一节原样显示了 markdown 源码：
 * `### 2026 年上半年（H1）整体表现`、`- **产量**：743.8 万辆` —— `###` 与 `**`
 * 都是字面显示。根因：`run-trace-panel.tsx` 把 `entry.text` 直接塞进一个
 * `whitespace-pre-wrap` 的 `div`，从没经过任何 markdown 渲染。
 *
 * ## 判据判的是**渲染结果**，不是文本内容
 *
 * 「文本里含 `### …`」在**没渲染**的时候同样为真——那种断言无法被证伪。所以这里判的是
 * DOM 结构：`<h3>` 元素存在且它的文本是标题正文（不带 `###`）、`<strong>` 元素存在。
 * 并且配一条反面：整个进展摘要容器的 `textContent` 里**不许再出现** `###` / `**`
 * 这些字面标记。
 *
 * ## 取证：只有这一处，还是执行过程里所有文本块都这样？
 *
 * 逐个数过 `run-trace-panel.tsx` 里会显示模型文本的位置：
 *   · `entry.kind === "progress"` 的正文 —— **就是这一处**，本文件修的；
 *   · 工具的「输入」/「结果」（`entry.args` / `entry.result`）—— `<pre>` 里的 JSON，
 *     本来就该原样显示，当 markdown 渲染是另一个 bug，**刻意不动**（下面有反面断言）；
 *   · 折叠行标题、工具名、`entry.progressText` —— 系统写的短标签/单行截断，不是 markdown。
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

vi.mock("@/components/chat/subtask-run-live-panel", () => ({
  SubtaskRunLivePanel: () => null,
}));

const base = { runId: "run-1", emittedAt: "2026-09-11T00:00:00Z" };

/** 人类截图里那段原文，逐字。 */
const PROGRESS_MARKDOWN = "### 2026 年上半年（H1）整体表现\n\n- **产量**：743.8 万辆，同比增长 6.7%\n";

/**
 * 真实事件序列：先来一段公开文本，随后一次 `tool_start` —— 这个工具边界正是
 * `progressMessageIds` 把前面那段文本认定为「进展」而不是「最终答案」的依据
 * （`lib/chat-workbench/run-trace.ts`）。不手搓 entry，走真实投影。
 */
const events: ExecutionEvent[] = [
  { ...base, seq: 1, kind: "text_delta", messageId: "m-progress", delta: PROGRESS_MARKDOWN },
  { ...base, seq: 2, kind: "tool_start", toolCallId: "tool-1", toolName: "fetch_url", args: { url: "https://example.com", note: "**不是 markdown**" } },
];

describe("issue #3387 ② —— 进展摘要里的 markdown 必须渲染成元素", () => {
  it("### 渲成 h3、** 渲成 strong，且容器里不再残留字面标记", () => {
    render(<RunTracePanel runId="run-1" events={events} />);
    fireEvent.click(screen.getByTestId("run-trace-toggle"));

    /* 自检：这一节确实是「Thinking · 进展摘要」那一节，不是随便一个别的块。 */
    expect(screen.getByText("Thinking · 进展摘要")).toBeVisible();

    const container = screen.getByTestId("run-trace-progress-markdown");

    // ── 判渲染结果 ①：标题真的是一个 h3 元素，且它的文本不带 `###` ──────────
    const heading = within(container).getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("2026 年上半年（H1）整体表现");
    expect(heading.textContent).not.toContain("#");

    // ── 判渲染结果 ②：粗体真的是一个 strong 元素 ────────────────────────────
    const strong = container.querySelector("strong");
    expect(
      strong,
      `进展摘要里没有渲出任何 <strong>——容器 innerHTML 是：${container.innerHTML}`,
    ).not.toBeNull();
    expect(strong!.textContent).toBe("产量");

    // ── 反面：字面标记不许再出现在这一节的可读文本里 ────────────────────────
    expect(
      container.textContent,
      "进展摘要仍然在原样显示 markdown 源码（`###` / `**`），这正是 issue #3387 ②。",
    ).not.toMatch(/###|\*\*/);
  });

  it("反面：工具的「输入」JSON 不受影响，仍然原样显示（不该被当 markdown 渲染）", () => {
    render(<RunTracePanel runId="run-1" events={events} />);
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    fireEvent.click(screen.getByText("正在执行 · fetch_url"));
    /*
     * 这条守住修法的边界：本次改的是**进展摘要这一处**，不是「把执行过程里所有文本
     * 都当 markdown 渲染」。工具入参里的 `**不是 markdown**` 必须逐字保留在 <pre> 里。
     */
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("**不是 markdown**");
    expect(pre!.querySelector("strong")).toBeNull();
  });
});
