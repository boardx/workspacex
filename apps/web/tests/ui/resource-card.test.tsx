import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

import { ResourceCard, ResourceCardTags } from "@/components/ui/resource-card";

/**
 * 标准资源卡片（2026-09-30 人类要求：所有卡片统一成标准项目卡片）。
 * 版式只在 `components/ui/resource-card.tsx` 一处定义；各列表页的卡片必须走它，
 * 不许各写一套——下面的源码断言就是这条的机械门。
 */
describe("ResourceCard", () => {
  afterEach(() => cleanup());

  it("标题 / 副标题 / 状态徽标 / ⋯ 菜单 / 描述 / 标签 / 元信息 / 主按钮 都在同一张卡里", () => {
    render(
      <ResourceCard
        testId="rc"
        title="供应链创新"
        titleTestId="rc-title"
        subtitle="工作坊"
        badges={<span>进行中</span>}
        menu={<button aria-label="更多操作">⋯</button>}
        description="描述一句话"
        tags={<ResourceCardTags tags={["战略", "Q4"]} testId="rc-tags" />}
        meta={<span>更新于今天</span>}
        actions={<button>进入项目</button>}
      >
        <div data-testid="rc-body">自定义正文</div>
      </ResourceCard>,
    );
    const card = screen.getByTestId("rc");
    expect(within(card).getByTestId("rc-title").tagName).toBe("H3");
    for (const text of ["工作坊", "进行中", "描述一句话", "自定义正文", "更新于今天"]) expect(within(card).getByText(text)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "更多操作" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "进入项目" })).toBeTruthy();
    // 标签是胶囊芯片
    expect(within(screen.getByTestId("rc-tags")).getByText("战略")).toHaveClass("rounded-full", "text-10");
    expect(card).toHaveClass("rounded-card", "hover:border-input");
  });

  it("R6 标题层级：默认 h3；页面 h1 之下直接是卡片列表时 headingLevel=2 渲染 h2（不跳级）", () => {
    const { rerender } = render(<ResourceCard title="默认" titleTestId="t" />);
    expect(screen.getByTestId("t").tagName).toBe("H3");
    rerender(<ResourceCard title="二级" titleTestId="t" headingLevel={2} />);
    expect(screen.getByTestId("t").tagName).toBe("H2");
  });

  it("没传的可选区域不渲染空壳", () => {
    render(<ResourceCard testId="rc" title="只有标题" />);
    const card = screen.getByTestId("rc");
    expect(card.querySelectorAll("p").length).toBe(0);
    expect(card.querySelector("button")).toBeNull();
  });

  it("带 href 时整张卡片是一条链接，testid 落在链接上", () => {
    render(<ResourceCard testId="rc" href="/projects/p1" title="项目" />);
    const card = screen.getByTestId("rc");
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe("/projects/p1");
  });

  it("ResourceCardTags：空列表不渲染，max 截断", () => {
    const { container, rerender } = render(<ResourceCardTags tags={[]} />);
    expect(container.firstChild).toBeNull();
    rerender(<ResourceCardTags tags={["a", "b", "c", "d"]} max={3} />);
    // 3 个胶囊 + 一个「+1」余量提示
    expect(container.querySelectorAll("span").length).toBe(4);
    expect(container.textContent).toContain("+1");
  });
});

describe("所有列表页的卡片都走 ResourceCard（版式单源）", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");
  it.each([
    "components/projects/projects-screen.tsx",
    "components/studio/studio-history.tsx",
    "components/design-loop/workbench-screen.tsx",
    "components/survey/live/survey-library.tsx",
    "components/home/home-work-cards.tsx",
  ])("%s 引用 ResourceCard", (file) => {
    expect(read(file)).toContain("@/components/ui/resource-card");
  });

  it("研究卡片不再有自己的版式（无封面图、无专属 article）", () => {
    const src = read("components/research-studio/research-history-card.tsx");
    expect(src).not.toContain("next/image");
    expect(src).not.toContain("<article");
  });
});

describe("ResourceCard 扩展能力（迭代2）", () => {
  afterEach(() => cleanup());

  it("onClick：整卡是 role=button，Enter/空格触发；内部按钮/菜单的点击不冒泡成整卡点击", () => {
    const open = vi.fn(); const inner = vi.fn();
    render(<ResourceCard testId="rc" title="A" onClick={open} actions={<button onClick={inner}>编辑</button>} />);
    const card = screen.getByTestId("rc");
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
    fireEvent.click(card);
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1); // 没被内部按钮触发
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("selected 加描边并标记 aria-pressed；leading / media 槽渲染；compact 用紧凑内边距", () => {
    render(<ResourceCard testId="rc" title="A" onClick={() => {}} selected leading={<i data-testid="lead" />} media={<div data-testid="media" />} density="compact" />);
    const card = screen.getByTestId("rc");
    expect(card).toHaveClass("ring-2");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("lead")).toBeTruthy();
    expect(screen.getByTestId("media")).toBeTruthy();
    expect(card.querySelector(".p-3")).not.toBeNull();
  });
});
