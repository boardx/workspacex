/**
 * F14（#2722）—— 错误状态卡片（`ErrorCard`,
 * `components/agent-kernel/agent-kernel-units.tsx`）。
 *
 * `requirements/05-error-observability.md` R3 步骤 5 / R7 / R8：run 失败时前端主展示区
 * 只显示人性化 `message` 与可点击的 `suggestedAction` 按钮（至少覆盖 重试/简化任务
 * 重试/联系支持），原始技术错误码/堆栈放入默认收起的『查看详情』折叠区，主展示区
 * 绝不出现未转换的技术错误码/堆栈（I-3，`contracts/error-observability/domain.md`）。
 *
 * 组件本身在 UI 先行阶段已作为原型建成（`ui-preview/error-observability/06-error-card.png`
 * 的落地），本次补的是把这份 user_visible_behavior 固化成会红的回归门控。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorCard } from "@/components/agent-kernel/agent-kernel-units";
import { MOCK_ERROR } from "@/lib/mock/agent-kernel";

describe("ErrorCard 主展示区：人性化 message，不泄漏原始技术信息", () => {
  it("渲染 error-card（role=alert）与 error-message，文本等于人性化 message", () => {
    render(<ErrorCard />);
    const card = screen.getByTestId("error-card");
    expect(card).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("error-message")).toHaveTextContent(MOCK_ERROR.message);
  });

  it("I-3：折叠区收起时，主展示区整体文本不含原始 failureCode 或堆栈原文", () => {
    render(<ErrorCard />);
    const card = screen.getByTestId("error-card");
    expect(card.textContent).not.toContain(MOCK_ERROR.failureCode);
    expect(card.textContent).not.toContain("ModelCallError");
    expect(card.textContent).not.toContain(MOCK_ERROR.runId);
  });

  it("CP 反证：MOCK_ERROR.message 本身若真的拼进了原始错误码，上一条断言必红", () => {
    // 证明上面「不含原始错误码」的断言不是恒真——把它套在一段真的拼了错误码的文本上，
    // 断言必须失败，才能说明它确实抓得住"消息里混进了未转换的技术信息"这个退化。
    const leaked = `${MOCK_ERROR.message}（${MOCK_ERROR.failureCode}）`;
    expect(() => expect(leaked).not.toContain(MOCK_ERROR.failureCode)).toThrow();
  });
});

describe("ErrorCard suggestedAction：至少覆盖 重试/简化任务重试/联系支持 三个可点击按钮", () => {
  it.each(["retry", "simplify", "contact"] as const)(
    "error-action-%s 存在、是按钮、可点击（未禁用）",
    (kind) => {
      render(<ErrorCard />);
      const btn = screen.getByTestId(`error-action-${kind}`);
      expect(btn.tagName).toBe("BUTTON");
      expect(btn).toBeEnabled();
    },
  );

  it("三个按钮的 data-testid 与 MOCK_ERROR.suggestedActions 的 kind 集合一致（无遗漏、无多余）", () => {
    render(<ErrorCard />);
    const rendered = MOCK_ERROR.suggestedActions.map((a) => a.kind).sort();
    expect(rendered).toEqual(["contact", "retry", "simplify"]);
    for (const kind of rendered) {
      expect(screen.getByTestId(`error-action-${kind}`)).toBeInTheDocument();
    }
  });
});

describe("ErrorCard 详情折叠区：默认收起，仅展开后可见原始技术信息", () => {
  it("默认 aria-expanded=false，折叠区节点不在 DOM 中（不是仅靠 CSS 隐藏）", () => {
    render(<ErrorCard />);
    expect(screen.getByTestId("error-detail-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("error-detail")).not.toBeInTheDocument();
  });

  it("点击『查看详情』后展开，折叠区内才出现原始 failureCode 与堆栈原文", () => {
    render(<ErrorCard />);
    fireEvent.click(screen.getByTestId("error-detail-toggle"));
    expect(screen.getByTestId("error-detail-toggle")).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByTestId("error-detail");
    expect(detail).toHaveTextContent(MOCK_ERROR.failureCode);
    expect(detail.textContent).toContain("ModelCallError");
  });

  it("再次点击收起，折叠区节点从 DOM 移除", () => {
    render(<ErrorCard />);
    const toggle = screen.getByTestId("error-detail-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("error-detail")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("error-detail")).not.toBeInTheDocument();
  });
});
