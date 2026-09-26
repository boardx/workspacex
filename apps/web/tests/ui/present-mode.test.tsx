/**
 * 深度 S7（#3988）—— 演示模式：整屏一页一页放、方向键翻页、页码、Esc 退出回到那一页。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { PresentMode } from "@/components/design-loop/present-mode";
import { deviceOf } from "@/components/design-loop/prototype-canvas";
import type { DesignProject } from "@/lib/live-design-workbench";

afterEach(cleanup);

const slide = (title: string) => ({ type: "stack", id: `s-${title}`, children: [{ type: "text", id: `t-${title}`, props: { content: title, variant: "title" } }] });

const project = {
  id: "p1", name: "路演", template: "ui", theme: "light", accent: "blue",
  tokens: { brand: null, font: "sans", radius: "default", density: "default" }, tags: [], refImages: [], share: null,
  problem: "", criteria: [], frames: ["封面", "市场", "团队"], frameNotes: [],
  prototype: [slide("轻账"), slide("¥3,200 亿"), null] as never,
  pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
  chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
} as unknown as DesignProject;

function present(startFrame = 0) {
  const onExit = vi.fn();
  render(<PresentMode project={project} startFrame={startFrame} device={deviceOf("ui")} landscape={false} links={[]} onExit={onExit} />);
  return onExit;
}
const counter = () => screen.getByTestId("design-present-counter").textContent;
const key = (k: string) => fireEvent.keyDown(window, { key: k });

describe("PresentMode", () => {
  it("方向键 / 空格翻页，页码跟着走；到头不越界；没画出来的页如实说", () => {
    // ⭐ 反证锚点：不接键盘 ⇒ 这条红——演示时只能摸鼠标去点。
    present();
    expect(counter()).toBe("1 / 3");
    expect(screen.getByTestId("design-present").textContent).toContain("轻账");
    key("ArrowRight");
    expect(counter()).toBe("2 / 3");
    expect(screen.getByTestId("design-present").textContent).toContain("¥3,200 亿");
    key(" ");
    expect(counter()).toBe("3 / 3");
    expect(screen.getByTestId("design-present").textContent).toContain("「团队」这一页还没画出来");
    key("ArrowRight");
    expect(counter()).toBe("3 / 3");
    key("Home");
    expect(counter()).toBe("1 / 3");
    key("ArrowLeft");
    expect(counter()).toBe("1 / 3");
  });

  it("从编辑器当前那一页开始；Esc 退出时告诉编辑器停在哪一页", () => {
    const onExit = present(1);
    expect(counter()).toBe("2 / 3");
    key("ArrowRight");
    key("Escape");
    expect(onExit).toHaveBeenCalledWith(2);
  });

  it("焦点在按钮上时空格是按按钮，不再额外翻一页", () => {
    present();
    const next = screen.getAllByRole("button", { name: "下一页" });
    expect(next).toHaveLength(1); // 点半屏翻页那两块对读屏器隐藏，不重复念「下一页」
    fireEvent.keyDown(next[0]!, { key: " " });
    expect(counter()).toBe("1 / 3");
    fireEvent.click(screen.getByTestId("design-present-exit"));
  });
});
