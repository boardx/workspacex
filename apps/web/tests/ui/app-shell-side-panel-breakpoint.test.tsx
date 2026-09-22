/**
 * 右栏从多宽开始存在 —— 以及那三个元素**必须用同一个断点**。
 *
 * ## 这条门守的缺陷（2026-09-23，R2 复盘清单第 4 件）
 *
 * 右栏本体、它的「收起」按钮、收起后的「展开」轨，原先各自写死 `xl:*`（1280px）。
 * 1280 以下：右栏整条不存在，而且**没有任何入口能把它叫出来**——不是折叠，是没有。
 * 1152 / 1180 这些常见笔记本逻辑宽度正好落在下面。
 *
 * ## 这条门**测不到**什么，先说清楚
 *
 * jsdom 不求值媒体查询，所以这里断言的是**类名**，不是「在 1152px 下真的看得见」。
 * 它挡得住的是回归与分叉（有人把面板降到 lg 却忘了降展开轨，于是面板收起后在 lg
 * 宽度下再也展不开——比原缺陷更隐蔽），挡不住「Tailwind 没生成这个类」这种事。
 * 真实宽度下的可见性要真栈量，这里不假装自己做到了。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", async (orig) => ({
  ...(await orig<object>()),
  apiRequest: vi.fn().mockResolvedValue({}),
}));

import { AppShell } from "@/components/shell/app-shell";
import { MOCK_ORGS, type Identity } from "@/lib/identity";
import { SIDE_PANEL_BREAKPOINT } from "@/lib/shell/side-panel-visibility";

const identity: Identity = {
  displayName: "测试", avatarUrl: null, orgRole: "consultant",
  org: MOCK_ORGS[0]!, projectRole: null, projectName: null, groupName: null,
};

function shell(): void {
  render(
    <AppShell identity={identity} previewRole={null} left={<div>左内容</div>} right={<div>右内容</div>}>
      <div>主内容</div>
    </AppShell>,
  );
}

/** 一个元素上出现的所有响应式断点前缀（`lg:block` → `lg`）。 */
function breakpoints(el: Element): string[] {
  return [...new Set(
    el.className.split(/\s+/)
      .map((cls) => /^(sm|md|lg|xl|2xl):/.exec(cls)?.[1])
      .filter((bp): bp is string => bp !== undefined),
  )];
}

beforeEach(() => { window.localStorage.clear(); });

describe("右栏可见断点", () => {
  it("面板与收起按钮用的是同一个断点，且就是那个常量", () => {
    shell();
    for (const testId of ["shell-right-panel", "shell-right-collapse"]) {
      expect(breakpoints(screen.getByTestId(testId)), testId).toEqual([SIDE_PANEL_BREAKPOINT]);
    }
  });

  // 分叉才是真正会出事的那一件：面板降到 lg 而展开轨留在 xl，
  // 结果是「在 lg 宽度下收起右栏之后，再也展不开」。
  it("收起后的展开轨用的也是同一个断点", () => {
    shell();
    fireEvent.click(screen.getByTestId("shell-right-collapse"));
    expect(breakpoints(screen.getByTestId("shell-right-expand"))).toEqual([SIDE_PANEL_BREAKPOINT]);
  });

  it("断点不是 xl——1280 以下必须仍然有右栏", () => {
    expect(SIDE_PANEL_BREAKPOINT).not.toBe("xl");
  });
});
