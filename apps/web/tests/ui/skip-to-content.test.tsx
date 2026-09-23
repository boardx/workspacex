/**
 * 键盘用户的第一条快捷路（#3872 R8）。
 *
 * 实测真实安装版：可聚焦元素 124 个，消息输入框排在第 113 位，跳转链接 0 个。
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));
import { MAIN_CONTENT_ID, SkipToContent } from "@/components/shell/skip-to-content";

afterEach(cleanup);

function withTarget(): HTMLElement {
  const { container } = render(
    <>
      <SkipToContent />
      <div id={MAIN_CONTENT_ID}>主要内容</div>
    </>,
  );
  return container;
}

describe("跳到主要内容", () => {
  it("指向内容容器，而且 id 只有一处声明", () => {
    withTarget();
    expect(screen.getByTestId("skip-to-content").getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
  });

  it("**它必须在 Tab 序里**——用 display:none 藏起来的链接永远聚焦不到", () => {
    withTarget();
    const a = screen.getByTestId("skip-to-content");
    const cls = a.className;
    expect(cls).not.toMatch(/\bhidden\b|invisible/);
    expect(a.getAttribute("tabindex")).not.toBe("-1");
  });

  it("平时挪出视口，聚焦时回来", () => {
    withTarget();
    const cls = screen.getByTestId("skip-to-content").className;
    expect(cls).toMatch(/-translate-y-/);          // 平时在视口外
    expect(cls).toMatch(/focus:translate-y-0/);    // 聚焦时回来
  });

  it("点了之后焦点真的落在内容容器上——只靠锚点滚过去不算跳", () => {
    withTarget();
    fireEvent.click(screen.getByTestId("skip-to-content"));
    expect(document.activeElement?.id).toBe(MAIN_CONTENT_ID);
  });

  it("内容容器不在时不炸", () => {
    render(<SkipToContent />);
    expect(() => fireEvent.click(screen.getByTestId("skip-to-content"))).not.toThrow();
  });
});

/**
 * 最关键的一条：它必须是**壳层里第一个**可聚焦的元素。
 *
 * 上面那几条测的是这个链接本身的性质（在 Tab 序里、平时藏起来、点了焦点真的跳过去），
 * **但都没测它排在第几**——而「排第几」正是它存在的全部理由。
 * 一个排在第 60 位的跳转链接，和没有跳转链接没区别。
 */
import { ShellChrome } from "@/components/shell/app-shell";
import { ShellBusyProvider } from "@/lib/shell-busy";
import type { Identity } from "@/lib/identity";

const IDENTITY = {
  userId: "u1", displayName: "阿本",
  org: { id: "o1", name: "我的本地工作区", kind: "organization" },
  orgRole: "member", avatarUrl: null,
} as unknown as Identity;

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )];
}

describe("在壳层里的位置", () => {
  it("是第一个可聚焦的元素——排在第 60 位的跳转链接等于没有", () => {
    const { container } = render(
      <ShellBusyProvider>
        <ShellChrome identity={IDENTITY} previewRole={null} organizations={[{ id: "o1", label: "我的本地工作区" }]}>
          <button type="button">业务屏里的某个按钮</button>
        </ShellChrome>
      </ShellBusyProvider>,
    );
    const all = focusables(container);
    expect(all.length).toBeGreaterThan(1);
    expect(all[0]?.dataset.testid).toBe("skip-to-content");
  });

  it("落点在壳层的主内容区上，不是某个不存在的 id", () => {
    const { container } = render(
      <ShellBusyProvider>
        <ShellChrome identity={IDENTITY} previewRole={null} organizations={[{ id: "o1", label: "我的本地工作区" }]}>
          <div />
        </ShellChrome>
      </ShellBusyProvider>,
    );
    expect(container.querySelector(`#${MAIN_CONTENT_ID}`)).toBeTruthy();
    expect(container.querySelector(`#${MAIN_CONTENT_ID}`)?.tagName.toLowerCase()).toBe("main");
  });
});
