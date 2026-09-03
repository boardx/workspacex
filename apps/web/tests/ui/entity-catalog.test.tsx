/**
 * `EntityCatalog`（`components/admin/entity-catalog.tsx`）——后台四个能力目录共用的
 * 卡片目录壳（2026-09-02，人类原话：「简化为一个卡片的列表，通过一个侧边面板来展示当前
 * 的实体的内容…并通过 tag 来过滤和搜索」）。
 *
 * 断的是壳本身的行为，与任何一种实体无关：
 *   ① 搜索与标签都是**本地**过滤——rows 不变、没有回调被触发；
 *   ② 标签由行汇总、带数量、多选是「且」；「全部」清空；
 *   ③ 筛空 ≠ 真实空态：两个 testid 分得开；
 *   ④ 点卡片打开面板、面板按 key 跟随最新的行、行没了面板自动关。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EntityCatalog, tagOf, tagSlug } from "@/components/admin/entity-catalog";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly status: "已启用" | "已停用";
  readonly scope: "org-wide" | "team-only";
}

const ROWS: readonly Row[] = [
  { id: "a", name: "排序器", status: "已启用", scope: "org-wide" },
  { id: "b", name: "翻译器", status: "已停用", scope: "org-wide" },
  { id: "c", name: "摘要器", status: "已启用", scope: "team-only" },
];

function Harness({ rows, initialSelected = null }: { rows: readonly Row[]; initialSelected?: string | null }) {
  const [selected, setSelected] = React.useState<string | null>(initialSelected);
  return (
    <EntityCatalog<Row>
      prefix="t"
      title="测试目录"
      status={{ kind: "ready" }}
      rows={rows}
      keyOf={(r) => r.id}
      searchTextOf={(r) => `${r.name} ${r.id}`}
      tagsOf={(r) => [tagOf(r.status), tagOf(r.scope)]}
      renderCard={(r) => <div>{r.name}</div>}
      onRefresh={() => {}}
      emptyState="没有行"
      selectedKey={selected}
      onSelect={setSelected}
      detailTitle={(r) => `面板 · ${r.name}`}
      renderDetail={(r) => <div data-testid="t-detail-body">{r.name} / {r.status}</div>}
    />
  );
}

describe("EntityCatalog · 卡片目录壳", () => {
  it("标签由行汇总并带数量；多选是「且」；「全部」清空", () => {
    render(<Harness rows={ROWS} />);
    const filters = screen.getByTestId("t-tag-filters");
    expect(within(filters).getByTestId("t-tag-filter-enabled").textContent).toContain("已启用 2");
    expect(within(filters).getByTestId("t-tag-filter-disabled").textContent).toContain("已停用 1");
    expect(within(filters).getByTestId("t-tag-filter-team-only").textContent).toContain("team-only 1");

    fireEvent.click(screen.getByTestId("t-tag-filter-enabled"));
    let list = screen.getByTestId("t-list");
    expect(list.textContent).toContain("排序器");
    expect(list.textContent).toContain("摘要器");
    expect(list.textContent).not.toContain("翻译器");
    // 数量基于全部行，不随已选标签变化。
    expect(screen.getByTestId("t-tag-filter-disabled").textContent).toContain("已停用 1");

    fireEvent.click(screen.getByTestId("t-tag-filter-team-only"));
    list = screen.getByTestId("t-list");
    expect(list.textContent).toBe("摘要器");
    expect(screen.getByTestId("t-count").textContent).toContain("筛选后 1 个");

    fireEvent.click(screen.getByTestId("t-tag-filter-all"));
    expect(screen.getByTestId("t-list").textContent).toContain("翻译器");
    expect(screen.getByTestId("t-tag-filter-all")).toHaveAttribute("aria-pressed", "true");
  });

  it("搜索与标签叠加是「且」；筛空显示 no-match，不是真实空态", () => {
    render(<Harness rows={ROWS} />);
    fireEvent.change(screen.getByTestId("t-search"), { target: { value: "器" } });
    expect(screen.getByTestId("t-list").textContent).toContain("翻译器");
    fireEvent.click(screen.getByTestId("t-tag-filter-disabled"));
    expect(screen.getByTestId("t-list").textContent).toBe("翻译器");
    fireEvent.change(screen.getByTestId("t-search"), { target: { value: "摘要" } });
    expect(screen.queryByTestId("t-list")).toBeNull();
    expect(screen.getByTestId("t-no-match")).toBeInTheDocument();
    expect(screen.queryByTestId("t-empty")).toBeNull();
  });

  it("真实空态：empty 在场、筛选条不在场", () => {
    render(<Harness rows={[]} />);
    expect(screen.getByTestId("t-empty")).toHaveTextContent("没有行");
    expect(screen.queryByTestId("t-tag-filters")).toBeNull();
    expect(screen.queryByTestId("t-no-match")).toBeNull();
  });

  it("点卡片打开面板；面板显示的是按 key 找到的最新行；行不在了面板自动关", () => {
    const view = render(<Harness rows={ROWS} />);
    expect(screen.queryByTestId("t-detail")).toBeNull();
    fireEvent.click(screen.getByTestId("t-row-b"));
    expect(screen.getByTestId("t-detail")).toBeInTheDocument();
    expect(screen.getByTestId("t-detail-body").textContent).toBe("翻译器 / 已停用");
    expect(screen.getByTestId("t-row-b")).toHaveAttribute("aria-pressed", "true");

    // 「刷新」带回同一个 key 的新内容 ⇒ 面板跟着变，不是打开时的快照。
    view.rerender(<Harness rows={ROWS.map((r) => (r.id === "b" ? { ...r, status: "已启用" } : r))} />);
    // Harness 的 selected state 在 rerender 后仍在（同一个组件实例）。
    expect(screen.getByTestId("t-detail-body").textContent).toBe("翻译器 / 已启用");

    // 这一行被移出（比如停用后不再出现在目录里）⇒ 面板关掉，不留一份过期快照。
    view.rerender(<Harness rows={ROWS.filter((r) => r.id !== "b")} />);
    expect(screen.queryByTestId("t-detail")).toBeNull();
  });

  it("面板关闭按钮把 selectedKey 清回 null", () => {
    render(<Harness rows={ROWS} initialSelected="a" />);
    expect(screen.getByTestId("t-detail")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("t-detail-close"));
    expect(screen.queryByTestId("t-detail")).toBeNull();
  });

  it("tagSlug：契约中文枚举映射成稳定的 ASCII，没收录的值仍是唯一的 ASCII", () => {
    expect(tagSlug("已启用")).toBe("enabled");
    expect(tagSlug("org-wide")).toBe("org-wide");
    expect(tagSlug("Closed-API")).toBe("closed-api");
    const odd = tagSlug("长文");
    expect(odd).toMatch(/^t-[0-9a-f-]+$/);
    expect(tagSlug("长文")).toBe(odd);
    expect(tagSlug("推理")).not.toBe(odd);
  });
});
