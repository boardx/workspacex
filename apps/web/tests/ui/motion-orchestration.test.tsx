/**
 * F04 —— 编排级动效（契约束 motion-microinteraction UC-2：chat 消息到达进场）。
 *
 * 断的四件事：
 *   ① 有明确时间线，不是单一线性过渡：位移阶段（外层）与淡入阶段（内层）
 *      分别绑定 `duration-fast`（淡入）与 `duration-base` + `delay-150`（位移，
 *      延后于淡入开始），两段各自的 duration/ease 都走 F03 的语义 token，
 *      不出现裸 `duration-<数字>`/内建 `ease-*`。
 *   ② mount 之后动效状态从「未进场」翻到「已进场」（用
 *      `data-motion-entered` 断言，不直接断 class 字符串，避免和实现细节耦合）。
 *   ③ HIGH_FREQUENCY_ARRIVAL 反证：同一条消息在「已进场」之后收到 props 更新
 *      （模拟流式增量改文本），不会把 `data-motion-entered` 打回 "false"
 *      重新触发整条编排动效——因为触发只挂在 mount 的空依赖 useEffect 上。
 *   ④ `prefers-reduced-motion: reduce` 降级：`motion-reduce:` 变体把 transition
 *      去掉、把位移/透明度钉在终态，不依赖 JS matchMedia。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { MessageEntrance } from "@/components/chat/message-entrance";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MessageEntrance —— F04 编排级动效", () => {
  it("有两段各自独立计时的时间线：内容淡入（duration-fast）先于位移（duration-base + delay-150）", () => {
    render(
      <MessageEntrance testId="entrance-under-test">
        <p>你好</p>
      </MessageEntrance>,
    );

    const positionLayer = screen.getByTestId("entrance-under-test");
    const fadeLayer = screen.getByTestId("entrance-under-test-fade");

    // 位移层：走语义 token duration-base，delay-150 起步（不是单一线性过渡的证据——
    // 两层的 duration class 不同，且位移层带 delay，淡入层不带）。
    expect(positionLayer.className).toMatch(/\bduration-base\b/);
    expect(positionLayer.className).toMatch(/\bease-base\b/);
    expect(positionLayer.className).toMatch(/\bdelay-150\b/);

    // 淡入层：走语义 token duration-fast，不带 delay。
    expect(fadeLayer.className).toMatch(/\bduration-fast\b/);
    expect(fadeLayer.className).toMatch(/\bease-fast\b/);
    expect(fadeLayer.className).not.toMatch(/\bdelay-/);

    // 反证：不允许裸数值 duration-<数字> 或内建 ease-linear/in/out/in-out 漏网
    // （对应 lint-design.sh U10；这里在组件产出的 class 字符串上直接反证，
    // 与 lint 的静态扫描互为双保险）。
    const allClasses = `${positionLayer.className} ${fadeLayer.className}`;
    expect(allClasses).not.toMatch(/\bduration-\d+\b/);
    expect(allClasses).not.toMatch(/\bease-(linear|in|out|in-out)\b/);
  });

  it("mount 后从未进场翻到已进场", async () => {
    vi.useFakeTimers();
    render(
      <MessageEntrance testId="entrance-mount-flip">
        <p>消息内容</p>
      </MessageEntrance>,
    );

    const layer = screen.getByTestId("entrance-mount-flip");
    expect(layer).toHaveAttribute("data-motion-entered", "false");
    expect(layer.className).toMatch(/\btranslate-y-1\b/);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(layer).toHaveAttribute("data-motion-entered", "true");
    expect(layer.className).toMatch(/\btranslate-y-0\b/);
  });

  it("HIGH_FREQUENCY_ARRIVAL 反证：已进场后再收到内容更新（模拟流式增量），不会重新触发整条编排动效", async () => {
    vi.useFakeTimers();
    function StreamingBubble({ text }: { text: string }) {
      return (
        <MessageEntrance testId="entrance-streaming">
          <p>{text}</p>
        </MessageEntrance>
      );
    }

    const { rerender } = render(<StreamingBubble text="第" />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    const layer = screen.getByTestId("entrance-streaming");
    expect(layer).toHaveAttribute("data-motion-entered", "true");

    // 同一个组件实例（同一个 React 元素位置，未换 key）收到多次流式增量——
    // 逐字追加文本，模拟高频到达。每次都不应把 data-motion-entered 打回 "false"。
    for (const next of ["第一", "第一段", "第一段回复", "第一段回复。"]) {
      rerender(<StreamingBubble text={next} />);
      expect(layer).toHaveAttribute("data-motion-entered", "true");
    }
    expect(screen.getByText("第一段回复。")).toBeInTheDocument();
  });

  it("prefers-reduced-motion 降级：用 motion-reduce: 变体钉死终态与去掉 transition，不依赖 JS matchMedia", () => {
    render(
      <MessageEntrance testId="entrance-reduced-motion">
        <p>内容</p>
      </MessageEntrance>,
    );
    const positionLayer = screen.getByTestId("entrance-reduced-motion");
    const fadeLayer = screen.getByTestId("entrance-reduced-motion-fade");

    expect(positionLayer.className).toMatch(/\bmotion-reduce:transition-none\b/);
    expect(positionLayer.className).toMatch(/\bmotion-reduce:translate-y-0\b/);
    expect(positionLayer.className).toMatch(/\bmotion-reduce:delay-0\b/);
    expect(fadeLayer.className).toMatch(/\bmotion-reduce:transition-none\b/);
    expect(fadeLayer.className).toMatch(/\bmotion-reduce:opacity-100\b/);
  });
});
