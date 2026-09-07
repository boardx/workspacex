import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "@/components/ui/button";
import { useDialogReturnFocus } from "@/components/chat/workbench/use-dialog-return-focus";

/**
 * TW-A11Y-2 / TW-A11Y-5 的**近距离**回归网。
 *
 * ⚠ 权威判据仍然是真栈 e2e（`chat-task-workbench-a11y.spec.ts`）——jsdom 没有布局，
 * 量不出「237×18」这种真实尺寸。这里守的是两条**在 jsdom 里就能判真假**的机械事实：
 * ① 最小命中区的类名是 base 的不变量，调用方的 `h-auto` 顶不掉它；
 * ② 关闭弹窗时的焦点落点函数真的把焦点放回去了，而不是留在 `BODY`。
 */

describe("TW-A11Y-2：24px 最小命中区是 Button 的 base 不变量", () => {
  it("调用方用 h-auto 解开高度上界时，min-h-6 仍然留在类名里", () => {
    // 这正是 CI 抓到的那个按钮（未读任务提醒）的类名组合。
    render(
      <Button size="sm" className="h-auto w-full justify-start whitespace-normal text-left">
        某个很长的任务标题 · 已完成
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("min-h-6");
    expect(button.className).toContain("h-auto");
  });

  it("每一档 size 都带着 base 的最小命中区（不是某一档单独记得写）", () => {
    for (const size of ["xs", "sm", "md", "lg", "icon"] as const) {
      const view = render(<Button size={size}>x</Button>);
      expect(screen.getByRole("button").className, `size=${size}`).toContain("min-h-6");
      view.unmount();
    }
  });
});

function Harness({ open }: { open: boolean }): JSX.Element {
  const returnFocus = useDialogReturnFocus(open);
  return <button type="button" data-testid="close-trigger" onClick={(event) => returnFocus(event.nativeEvent)}>close</button>;
}

describe("TW-A11Y-5：弹窗关闭后焦点不许留在 BODY", () => {
  it("没有可用 trigger 时（挂载即打开，焦点在 BODY），焦点回到工作台输入框", () => {
    const composer = document.createElement("textarea");
    composer.setAttribute("data-testid", "copilotkit-v2-input");
    document.body.appendChild(composer);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    render(<Harness open />);
    screen.getByTestId("close-trigger").click();

    expect(document.activeElement).toBe(composer);
    composer.remove();
  });

  it("真有 trigger 时，焦点回到打开弹窗的那个元素而不是输入框", () => {
    const composer = document.createElement("textarea");
    composer.setAttribute("data-testid", "copilotkit-v2-input");
    document.body.appendChild(composer);
    const trigger = document.createElement("button");
    trigger.textContent = "打开待确认请求";
    document.body.appendChild(trigger);
    trigger.focus();

    // open=false → open=true：hook 在「打开」那一刻记住当时的 activeElement。
    const view = render(<Harness open={false} />);
    view.rerender(<Harness open />);
    composer.focus(); // 弹窗打开后焦点被移进弹窗（这里用输入框代表"别处"）
    screen.getByTestId("close-trigger").click();

    expect(document.activeElement).toBe(trigger);
    composer.remove();
    trigger.remove();
  });
});
