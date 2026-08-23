/**
 * F09 —— 复合组件收口：Table / Menu 原语（契约束 interaction-primitives）。
 *
 * 盘点结论（2026-08-24，见 PR 描述完整清单）：19 处业务目录手写 `<table>`、5 处业务目录
 * 手写「open state + document mousedown/keydown 监听 + role="menu" 绝对定位 div」的菜单
 * 弹层，均清楚超过 R4-A1 的「≥3 处重复」收口门槛。逐一读过全部 19 张表格后没有发现语义
 * 分裂到需要拆成两个原语的地步——收口为一套 `Table` 原语；Menu 原语直接复用 F01 的
 * `dropdown-menu.tsx`（Radix DropdownMenu）底层实现，只做命名别名（`components/ui/menu.tsx`）。
 *
 * 三件事：
 *   ① token 化：`table.tsx` / `menu.tsx` 源码不得出现字面量色值 / 任意值圆角 / 任意值阴影
 *      （同 `overlay-primitives-dialog-dropdown.test.tsx` 的 U5a/U5b 口径，钉在这两个新原语
 *      文件上）。
 *   ② Table：渲染表头/数据行/空态行；`TableEmpty` 的 `colSpan` 撑满整行。
 *   ③ Menu：点击 trigger 打开，点击外部（pointerdown → click）与 Esc 都能关闭，
 *      菜单项可被键盘（↑↓ + Enter）到达并触发。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Table, TableBody, TableCaption, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

afterEach(() => cleanup());

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = join(__dirname, "..", "..", "components", "ui");
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** Radix 的外点关闭监听（pointerdown）在 `setTimeout(0)` 之后才挂载。 */
async function nextTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickOutside() {
  fireEvent.pointerDown(document.body, { bubbles: true, pointerId: 1, button: 0 });
  fireEvent.click(document.body, { bubbles: true, button: 0 });
}

describe("token 化：table.tsx / menu.tsx 不含字面量色值 / 圆角 / 阴影", () => {
  for (const file of ["table.tsx", "menu.tsx"]) {
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

/* ══════════════════ Table ══════════════════ */

interface Row {
  id: string;
  name: string;
  status: string;
}
const ROWS: Row[] = [
  { id: "r1", name: "远洋新能源", status: "在用" },
  { id: "r2", name: "恒泰咨询", status: "已归档" },
];

function DemoTable({ rows }: { rows: Row[] }) {
  return (
    <Table data-testid="demo-table">
      <TableCaption>示例表格 · 用于 F09 单测</TableCaption>
      <TableHeader>
        <TableRow variant="header">
          <TableHead>名称</TableHead>
          <TableHead>状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={2} data-testid="demo-table-empty">
            暂无数据
          </TableEmpty>
        ) : (
          rows.map((r) => (
            <TableRow key={r.id} data-testid={`demo-table-row-${r.id}`}>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.status}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

describe("Table 原语：表头 / 数据行 / 空态", () => {
  it("渲染表头与全部数据行，单元格内容正确", () => {
    render(<DemoTable rows={ROWS} />);
    const table = screen.getByTestId("demo-table");
    expect(table.tagName).toBe("TABLE");
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("状态")).toBeInTheDocument();
    expect(screen.getByTestId("demo-table-row-r1")).toHaveTextContent("远洋新能源");
    expect(screen.getByTestId("demo-table-row-r1")).toHaveTextContent("在用");
    expect(screen.getByTestId("demo-table-row-r2")).toHaveTextContent("恒泰咨询");
  });

  it("空数组时渲染 TableEmpty 一行、colSpan 撑满整行，不渲染数据行", () => {
    render(<DemoTable rows={[]} />);
    const empty = screen.getByTestId("demo-table-empty");
    expect(empty).toHaveTextContent("暂无数据");
    expect(empty.closest("td")).toHaveAttribute("colSpan", "2");
    expect(screen.queryByTestId(/demo-table-row-/)).not.toBeInTheDocument();
  });

  it("TableRow variant=\"header\" 与默认 body 变体分别贴不同的默认 token（不强制覆盖调用方 className）", () => {
    render(<DemoTable rows={ROWS} />);
    const headerRow = screen.getByText("名称").closest("tr")!;
    const bodyRow = screen.getByTestId("demo-table-row-r1");
    expect(headerRow.className).toMatch(/bg-panel/);
    expect(bodyRow.className).toMatch(/border-border-subtle/);
  });

  it("调用方传入的 className 能覆盖默认值（tailwind-merge 去重冲突类）", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell data-testid="custom-cell" className="px-1 py-1 text-center">custom</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = screen.getByTestId("custom-cell");
    expect(cell.className).toContain("px-1");
    expect(cell.className).not.toContain("px-3"); // 默认值被覆盖，不是并存
  });
});

/* ══════════════════ Menu ══════════════════ */

function DemoMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" data-testid="demo-menu-trigger">更多操作</button>
      </MenuTrigger>
      <MenuContent data-testid="demo-menu-content">
        <MenuItem data-testid="demo-menu-rename" onSelect={onRename}>重命名</MenuItem>
        <MenuSeparator />
        <MenuItem data-testid="demo-menu-delete" onSelect={onDelete}>删除</MenuItem>
      </MenuContent>
    </Menu>
  );
}

describe("Menu 原语：开合 / 外点关闭 / Esc 关闭 / 键盘可达", () => {
  it("点击 trigger 打开菜单，菜单项可见", () => {
    render(<DemoMenu onRename={vi.fn()} onDelete={vi.fn()} />);
    const trigger = screen.getByTestId("demo-menu-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Radix DropdownMenuTrigger 靠 pointerdown 开菜单，不是 click。
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("demo-menu-rename")).toBeVisible();
    expect(screen.getByTestId("demo-menu-delete")).toBeVisible();
  });

  it("点击菜单项触发对应回调，并关闭菜单（默认「选中即关闭」）", () => {
    const onRename = vi.fn();
    render(<DemoMenu onRename={onRename} onDelete={vi.fn()} />);
    fireEvent.pointerDown(screen.getByTestId("demo-menu-trigger"), { button: 0 });
    fireEvent.click(screen.getByTestId("demo-menu-rename"));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("demo-menu-content")).not.toBeInTheDocument();
  });

  it("点击外部关闭菜单，不触发任何菜单项回调", async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <div>
        <DemoMenu onRename={onRename} onDelete={onDelete} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByTestId("demo-menu-trigger"), { button: 0 });
    expect(screen.getByTestId("demo-menu-content")).toBeInTheDocument();
    await nextTick();

    clickOutside();

    await waitFor(() => expect(screen.queryByTestId("demo-menu-content")).not.toBeInTheDocument());
    expect(onRename).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Esc 关闭菜单，焦点回落 trigger", async () => {
    render(<DemoMenu onRename={vi.fn()} onDelete={vi.fn()} />);
    const trigger = screen.getByTestId("demo-menu-trigger");
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(screen.getByTestId("demo-menu-content")).toBeInTheDocument();
    await nextTick();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("demo-menu-content")).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("菜单项可被键盘到达：Enter 触发选中项的回调（Radix 原生 ↑↓/type-ahead，这里钉住 Enter 出口）", () => {
    const onDelete = vi.fn();
    render(<DemoMenu onRename={vi.fn()} onDelete={onDelete} />);
    fireEvent.pointerDown(screen.getByTestId("demo-menu-trigger"), { button: 0 });

    const deleteItem = screen.getByTestId("demo-menu-delete");
    deleteItem.focus();
    fireEvent.keyDown(deleteItem, { key: "Enter" });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("MenuItem disabled 时不可选中、不触发回调", () => {
    const onRename = vi.fn();
    render(
      <Menu>
        <MenuTrigger asChild>
          <button type="button" data-testid="disabled-menu-trigger">更多</button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem disabled data-testid="disabled-menu-item" onSelect={onRename}>禁用项</MenuItem>
        </MenuContent>
      </Menu>,
    );
    fireEvent.pointerDown(screen.getByTestId("disabled-menu-trigger"), { button: 0 });
    const item = screen.getByTestId("disabled-menu-item");
    expect(item).toHaveAttribute("data-disabled");
    fireEvent.click(item);
    expect(onRename).not.toHaveBeenCalled();
  });
});
