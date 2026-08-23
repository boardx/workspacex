/**
 * F02 —— 统一的 Select / Tooltip 弹层原语（契约束 interaction-primitives）。
 *
 * 三件事：
 *   ① token 化：`components/ui/select.tsx` / `tooltip.tsx` 源码里不得出现字面量
 *      色值 / 任意值圆角 / 任意值阴影（同 lint-design.sh 的 U5a/U5b 口径，钉在这两个
 *      原语文件上，防止「原语本身破例」，与 F01 对 dialog/dropdown 的钉法一致）。
 *   ② 超长下拉列表可滚动截断：选项很多时，展开的 content 必须带 max-h-* +
 *      overflow-y-auto，不能把页面撑爆或超出视口。
 *   ③ tooltip 空 content 不渲染气泡：children 为 null/undefined/纯空白字符串时，
 *      `TooltipContent` 不挂载任何气泡节点——没有内容的提示不该占屏幕。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// jsdom 没有 ResizeObserver，Radix Popper（Tooltip/Select 底层都用）挂载时会调——
// 本仓其它 vitest 套件不需要它是因为没渲染到「真的展开/可见」这一步，这里要，补个最小桩。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

afterEach(() => cleanup());

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = join(__dirname, "..", "..", "components", "ui");
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

describe("token 化：select.tsx / tooltip.tsx 不含字面量色值 / 圆角 / 阴影", () => {
  for (const file of ["select.tsx", "tooltip.tsx"]) {
    const src = readFileSync(join(uiDir, file), "utf8");

    it(`${file}：无 hex / rgb() / hsl() 字面量色值`, () => {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    });

    it(`${file}：无 Tailwind 调色板类（必须走语义 token，如 bg-popover / bg-inverse）`, () => {
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

const LONG_OPTIONS: SelectOption[] = Array.from({ length: 30 }, (_, i) => ({
  value: `opt-${i + 1}`,
  label: `选项 ${i + 1}`,
}));

function LongSelect() {
  const [value, setValue] = React.useState("opt-1");
  return (
    <Select
      options={LONG_OPTIONS}
      value={value}
      onValueChange={setValue}
      data-testid="long-select-trigger"
    />
  );
}

describe("Select：超长下拉列表在视口内可滚动截断", () => {
  it("展开后的 content 带 max-h-* 与 overflow-y-auto，不是无限撑高", async () => {
    render(<LongSelect />);
    fireEvent.pointerDown(screen.getByTestId("long-select-trigger"), { button: 0 });

    const content = await waitFor(() => {
      const el = document.querySelector('[role="menu"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    // 30 个选项全部渲染（截断是视觉滚动，不是裁掉数据）
    expect(content.querySelectorAll('[role="menuitemradio"]').length).toBe(30);

    expect(content.className).toMatch(/max-h-\d+/);
    expect(content.className).toMatch(/overflow-y-auto/);
    // 不能是任意值高度——同样要过 U5b 口径
    expect(content.className).not.toMatch(/max-h-\[[^\]]+\]/);
  });
});

describe("Tooltip：空 content 不渲染气泡", () => {
  function EmptyTooltip({ children }: { children: React.ReactNode }) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger data-testid="empty-tip-trigger">悬停我</TooltipTrigger>
          <TooltipContent data-testid="empty-tip-content">{children}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  it("children 为 null 时，气泡节点不挂载", () => {
    render(<EmptyTooltip>{null}</EmptyTooltip>);
    expect(screen.queryByTestId("empty-tip-content")).not.toBeInTheDocument();
  });

  it("children 为纯空白字符串时，气泡节点不挂载", () => {
    render(<EmptyTooltip>{"   "}</EmptyTooltip>);
    expect(screen.queryByTestId("empty-tip-content")).not.toBeInTheDocument();
  });

  it("children 有实际内容时，气泡正常挂载（反证：不是规则本身失效了）", () => {
    render(<EmptyTooltip>真实提示文案</EmptyTooltip>);
    expect(screen.getByTestId("empty-tip-content")).toBeInTheDocument();
    expect(screen.getByText("真实提示文案")).toBeInTheDocument();
  });
});
