/**
 * F10 —— 复合组件收口：Breadcrumb / Pagination 原语（契约束 interaction-primitives）。
 *
 * 盘点结论（2026-08-24，自己重新 grep 核对，不信任种子清单）：
 *
 * ## Breadcrumb —— 不收口（BELOW_THRESHOLD，usecases.md UC-4）
 * 全仓只有 `components/canvas/canvas-main.tsx` 一处「面包屑」相关文案，而且形状也不是
 * 层级路径导航（无 `/` 分隔的多级路径，只有一行「回到议程 · 议程环节 3」的返回态提示 +
 * 「画布来自 X · Y」的来源说明）。R4-A1 门槛是 ≥3 处重复，1 处远达不到；
 * `interaction-primitives` 束 `design-signoff.md` 已记录人类对 `BELOW_THRESHOLD` 默认接受
 * 「不收口」为合法结果。因此本次 **不** 新增 `components/ui/breadcrumb.tsx`，
 * 下面用一条反向断言把这个决定钉住——如果未来有人手滑加了这个文件却没有同步补三处以上
 * 收口证据，这条测试会提醒去核对盘点结论是否已经变化。
 *
 * ## Pagination —— 收口（3 处业务目录重复，达到门槛）
 * - `components/admin/capability-catalog-screen.tsx`：页码分页（`page`/`pageCount` state +
 *   「上一页」「下一页」两个按钮，边界值用 `disabled` 卡住）。
 * - `components/profile/profile-screen.tsx`：游标分页（`nextCursor` + 单个「加载更多」
 *   按钮，无法回退，纯追加列表）。
 * - `components/survey/workflow/response-review-step.tsx`：页码分页（原为静态原型，硬编码
 *   页码按钮，未接真实翻页状态——迁移后改用真实的 `PaginationItem`/`PaginationEllipsis`）。
 * 三种真实用法但共享同一个「分页控件」视觉/交互模式，达到 R4-A1 门槛，收口进
 * `components/ui/pagination.tsx`。响应 R4-E2/UC-4：组件层只负责展示与交互转发，不内置
 * 页码分页/游标分页的状态机，两种底层策略各配一套拼接件（Pagination 系列 vs
 * PaginationLoadMore）。
 *
 * 三件事：
 *   ① token 化：`pagination.tsx` 源码不得出现字面量色值 / 任意值圆角 / 任意值阴影
 *      （同 `composite-table-menu.test.tsx` 的 U5a/U5b 口径）。
 *   ② 页码分页：状态文案、边界 disabled、点击页码/上一页/下一页触发回调。
 *   ③ 游标分页（加载更多）：pending 态禁用 + 文案切换，非 pending 态点击触发回调。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationList,
  PaginationLoadMore,
  PaginationNext,
  PaginationPrevious,
  PaginationStatus,
} from "@/components/ui/pagination";

afterEach(() => cleanup());

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = join(__dirname, "..", "..", "components", "ui");
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

describe("Breadcrumb：盘点结论为不收口（BELOW_THRESHOLD）", () => {
  it("components/ui/ 下没有 breadcrumb.tsx —— 全仓只 1 处面包屑相关文案，未达 R4-A1 的 3 次门槛", () => {
    expect(existsSync(join(uiDir, "breadcrumb.tsx"))).toBe(false);
  });
});

describe("token 化：pagination.tsx 不含字面量色值 / 圆角 / 阴影", () => {
  const src = readFileSync(join(uiDir, "pagination.tsx"), "utf8");

  it("无 hex / rgb() / hsl() 字面量色值", () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it("无 Tailwind 调色板类（必须走语义 token，如 text-muted-foreground / border-border）", () => {
    const re = new RegExp(`\\b(text|bg|border|ring|fill|stroke)-(${PALETTE})-[0-9]{2,3}\\b`);
    expect(src).not.toMatch(re);
  });

  it("圆角只用 Tailwind 语义刻度，无任意值 rounded-[...]", () => {
    expect(src).not.toMatch(/rounded-\[[^\]]+\]/);
  });

  it("阴影只用 Tailwind 语义刻度，无任意值 shadow-[...]", () => {
    expect(src).not.toMatch(/shadow-\[[^\]]+\]/);
  });

  it("无裸 duration-<数字> —— 动效必须走 F03 的语义 token（duration-fast/base/slow）", () => {
    expect(src).not.toMatch(/\bduration-\d+\b/);
  });
});

/* ══════════════════ Pagination：页码分页 ══════════════════ */

function PageDemo() {
  const [page, setPage] = React.useState(0);
  const pageCount = 3;
  return (
    <Pagination aria-label="演示分页">
      <PaginationStatus data-testid="status">
        第 {page + 1} / {pageCount} 页
      </PaginationStatus>
      <div>
        <PaginationPrevious
          disabled={page === 0}
          onClick={() => setPage((v) => Math.max(0, v - 1))}
          data-testid="prev"
        />
        <PaginationList>
          {[0, 1, 2].map((index) => (
            <PaginationItem key={index} active={index === page} onClick={() => setPage(index)} data-testid={`item-${index}`}>
              {index + 1}
            </PaginationItem>
          ))}
          <PaginationEllipsis data-testid="ellipsis" />
        </PaginationList>
        <PaginationNext
          disabled={page + 1 >= pageCount}
          onClick={() => setPage((v) => Math.min(pageCount - 1, v + 1))}
          data-testid="next"
        />
      </div>
    </Pagination>
  );
}

describe("Pagination：页码分页", () => {
  it("首页时上一页 disabled，末页时下一页 disabled", () => {
    render(<PageDemo />);
    expect(screen.getByTestId("prev")).toBeDisabled();
    expect(screen.getByTestId("next")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("item-2"));
    expect(screen.getByTestId("prev")).not.toBeDisabled();
    expect(screen.getByTestId("next")).toBeDisabled();
  });

  it("点击页码按钮更新状态文案", () => {
    render(<PageDemo />);
    expect(screen.getByTestId("status")).toHaveTextContent("第 1 / 3 页");

    fireEvent.click(screen.getByTestId("item-1"));
    expect(screen.getByTestId("status")).toHaveTextContent("第 2 / 3 页");
  });

  it("点击下一页/上一页按钮翻页", () => {
    render(<PageDemo />);
    fireEvent.click(screen.getByTestId("next"));
    expect(screen.getByTestId("status")).toHaveTextContent("第 2 / 3 页");

    fireEvent.click(screen.getByTestId("prev"));
    expect(screen.getByTestId("status")).toHaveTextContent("第 1 / 3 页");
  });

  it("当前页有 aria-current=page，其余页码没有", () => {
    render(<PageDemo />);
    expect(screen.getByTestId("item-0")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("item-1")).not.toHaveAttribute("aria-current");
  });

  it("Pagination 容器渲染为可达的 navigation landmark", () => {
    render(<PageDemo />);
    expect(screen.getByRole("navigation", { name: "演示分页" })).toBeInTheDocument();
  });

  it("PaginationEllipsis 是纯展示，不可交互（aria-hidden）", () => {
    render(<PageDemo />);
    expect(screen.getByTestId("ellipsis")).toHaveAttribute("aria-hidden");
  });
});

/* ══════════════════ Pagination：游标分页（加载更多）══════════════════ */

describe("PaginationLoadMore：游标分页", () => {
  it("默认态可点击，触发 onClick", () => {
    const onClick = vi.fn();
    render(<PaginationLoadMore onClick={onClick} data-testid="load-more" />);

    const button = screen.getByTestId("load-more");
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("加载更多");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("pending 态禁用且文案切换为加载中，点击不触发 onClick", () => {
    const onClick = vi.fn();
    render(<PaginationLoadMore pending onClick={onClick} data-testid="load-more" />);

    const button = screen.getByTestId("load-more");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("加载中…");

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("支持自定义文案（不同业务场景的措辞可以不一样）", () => {
    render(<PaginationLoadMore data-testid="load-more">查看更多历史记录</PaginationLoadMore>);
    expect(screen.getByTestId("load-more")).toHaveTextContent("查看更多历史记录");
  });
});

/* ══════════════════ 迁移点：实际业务文件已换用新原语 ══════════════════ */

describe("迁移证据：3 处业务目录已改用 components/ui/pagination.tsx", () => {
  const filesDir = join(__dirname, "..", "..", "components");

  /**
   * 2026-09-02：Agent / Skill 目录简化成「搜索 + 标签筛选的卡片网格」（人类原话，参照画布
   * 模板库），不再分页——这个曾经的第 3 处消费方退役了。这里不再断言它引用 Pagination，
   * 但仍断言它**没有**回到收口前那种手搓分页（`page` / `pageCount` 本地 state），
   * 保证「要么用原语，要么不分页」，不会出现第二份分页实现。
   */
  it("capability-catalog-screen.tsx 已改成不分页的卡片目录，且没有手搓分页 state", () => {
    const src = readFileSync(join(filesDir, "admin", "capability-catalog-screen.tsx"), "utf8");
    expect(src).not.toMatch(/useState[<(][^)]*\bpage\b/);
    expect(src).not.toMatch(/\bpageCount\b/);
    expect(src).toMatch(/from "\.\/entity-catalog"/);
  });

  it("profile-screen.tsx 引用 PaginationLoadMore", () => {
    const src = readFileSync(join(filesDir, "profile", "profile-screen.tsx"), "utf8");
    expect(src).toMatch(/from "@\/components\/ui\/pagination"/);
    expect(src).toMatch(/<PaginationLoadMore/);
  });

  it("response-review-step.tsx 引用 Pagination/PaginationItem", () => {
    const src = readFileSync(join(filesDir, "survey", "workflow", "response-review-step.tsx"), "utf8");
    expect(src).toMatch(/from "@\/components\/ui\/pagination"/);
    expect(src).toMatch(/<PaginationItem/);
  });
});
