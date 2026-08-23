/**
 * F01 —— 统一的 Dialog / Dropdown 弹层原语（契约束 interaction-primitives）。
 *
 * 三件事：
 *   ① token 化：`components/ui/dialog.tsx` / `dropdown-menu.tsx` 源码里不得出现字面量
 *      色值 / 任意值圆角 / 任意值阴影（同 lint-design.sh 的 U5a/U5b 口径，但这里直接钉在
 *      这两个原语文件上，防止「原语本身破例」）。
 *   ② 关闭行为一致性：点遮罩能关闭的弹层，Esc 也必须能关闭——两者都是「取消」语义，
 *      不允许只接了一半（domain.md I-2）。
 *   ③ 嵌套 dialog 不丢焦点：关掉内层后，焦点必须落回外层 DialogContent 内部，
 *      不能弹到 <body>——那是无障碍走查最容易漏的一类回归。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

afterEach(() => cleanup());

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = join(__dirname, "..", "..", "components", "ui");
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

describe("token 化：dialog.tsx / dropdown-menu.tsx 不含字面量色值 / 圆角 / 阴影", () => {
  for (const file of ["dialog.tsx", "dropdown-menu.tsx"]) {
    const src = readFileSync(join(uiDir, file), "utf8");

    it(`${file}：无 hex / rgb() / hsl() 字面量色值`, () => {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    });

    it(`${file}：无 Tailwind 调色板类（必须走语义 token，如 bg-popover / border-border）`, () => {
      const re = new RegExp(`\\b(text|bg|border|ring|fill|stroke)-(${PALETTE})-[0-9]{2,3}\\b`);
      expect(src).not.toMatch(re);
    });

    it(`${file}：圆角只用 Tailwind 语义刻度，无任意值 rounded-[...]`, () => {
      expect(src).not.toMatch(/rounded-\[[^\]]+\]/);
    });

    it(`${file}：阴影只用 Tailwind 语义刻度，无任意值 shadow-[...]`, () => {
      expect(src).not.toMatch(/shadow-\[[^\]]+\]/);
    });
  }
});

function SimpleDialog() {
  return (
    <Dialog>
      <DialogTrigger data-testid="d-trigger">打开</DialogTrigger>
      <DialogContent data-testid="d-content">
        <DialogHeader>
          <DialogTitle>标题</DialogTitle>
          <DialogDescription>描述</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

function SimpleDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="m-trigger">更多</DropdownMenuTrigger>
      <DropdownMenuContent data-testid="m-content">
        <DropdownMenuItem data-testid="m-item-1">操作一</DropdownMenuItem>
        <DropdownMenuItem data-testid="m-item-2">操作二</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Radix 的 DismissableLayer 用 `window.setTimeout(..., 0)` 延后挂 `pointerdown` 监听
 * （避开触发弹层的那一次 pointerdown 把自己立刻关掉），且 outside-pointerdown 默认
 * 是**延迟到随后的 click 事件**才真正派发关闭（模拟真实浏览器 mousedown→click 的顺序）。
 * 测试要如实驱动这个顺序，不能只发一个事件就断言——那样测的是假设，不是真行为。
 */
async function nextTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickOutside() {
  fireEvent.pointerDown(document.body, { bubbles: true, pointerId: 1, button: 0 });
  fireEvent.click(document.body, { bubbles: true, button: 0 });
}

describe("关闭行为一致性：点遮罩能关闭的组件，Esc 也必须能关闭", () => {
  it("Dialog：点遮罩外部（outside pointerdown → click）关闭", async () => {
    render(<SimpleDialog />);
    fireEvent.click(screen.getByTestId("d-trigger"));
    expect(screen.getByTestId("d-content")).toBeInTheDocument();
    await nextTick();

    clickOutside();

    await waitFor(() => expect(screen.queryByTestId("d-content")).not.toBeInTheDocument());
  });

  it("Dialog：Esc 关闭（与点遮罩关闭是同一个「取消」出口，不能只接一半）", async () => {
    render(<SimpleDialog />);
    fireEvent.click(screen.getByTestId("d-trigger"));
    expect(screen.getByTestId("d-content")).toBeInTheDocument();
    await nextTick();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("d-content")).not.toBeInTheDocument());
  });

  it("DropdownMenu：点遮罩外部（outside pointerdown → click）关闭", async () => {
    render(<SimpleDropdown />);
    // trigger 走 onPointerDown 开合（不是 onClick，Radix DropdownMenuTrigger 的真实实现）
    fireEvent.pointerDown(screen.getByTestId("m-trigger"), { button: 0 });
    await waitFor(() => expect(screen.getByTestId("m-content")).toBeInTheDocument());
    await nextTick();

    clickOutside();

    await waitFor(() => expect(screen.queryByTestId("m-content")).not.toBeInTheDocument());
  });

  it("DropdownMenu：Esc 关闭（与点遮罩关闭是同一个「取消」出口，不能只接一半）", async () => {
    render(<SimpleDropdown />);
    fireEvent.pointerDown(screen.getByTestId("m-trigger"), { button: 0 });
    await waitFor(() => expect(screen.getByTestId("m-content")).toBeInTheDocument());
    await nextTick();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("m-content")).not.toBeInTheDocument());
  });
});

function NestedDialogs() {
  return (
    <Dialog>
      <DialogTrigger data-testid="outer-trigger">打开外层</DialogTrigger>
      <DialogContent data-testid="outer-content">
        <DialogHeader>
          <DialogTitle>外层</DialogTitle>
        </DialogHeader>
        <Dialog>
          <DialogTrigger data-testid="inner-trigger">打开内层</DialogTrigger>
          <DialogContent data-testid="inner-content">
            <DialogHeader>
              <DialogTitle>内层</DialogTitle>
            </DialogHeader>
            <DialogClose data-testid="inner-close">关闭内层</DialogClose>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

describe("嵌套 dialog：关掉内层后不丢焦点", () => {
  it("焦点落回外层 DialogContent 内部，不会弹到 <body>", async () => {
    render(<NestedDialogs />);

    fireEvent.click(screen.getByTestId("outer-trigger"));
    await waitFor(() => expect(screen.getByTestId("outer-content")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inner-trigger"));
    await waitFor(() => expect(screen.getByTestId("inner-content")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inner-close"));
    await waitFor(() => expect(screen.queryByTestId("inner-content")).not.toBeInTheDocument());

    // 外层必须还在——内层关闭不能连带关掉外层
    expect(screen.getByTestId("outer-content")).toBeInTheDocument();

    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(screen.getByTestId("outer-content").contains(document.activeElement)).toBe(true);
    });
  });
});
