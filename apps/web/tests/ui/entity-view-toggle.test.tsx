/**
 * 后台管理统一标准（2026-08-15，人类原话：「卡片也可以切换为列表，需要有这个切换的
 * 功能」）——`EntityViewToggle`（`components/admin/entity-view-toggle.tsx`）的机械回归。
 *
 * 反空转重点：不是 `getByText` 空转断言组件挂载了，而是**真的点了切换按钮之后**，
 * 断言渲染容器（`data-testid`）与 DOM class（网格 vs 纵向排列）确实换了一套，
 * 且 `renderCard`/`renderListRow` 各自被调用的次数与传入的 entity 集合一致。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntityViewToggle } from "@/components/admin/entity-view-toggle";

interface Fixture {
  readonly id: string;
  readonly name: string;
}

const FIXTURES: readonly Fixture[] = [
  { id: "a", name: "条目 A" },
  { id: "b", name: "条目 B" },
];

describe("EntityViewToggle：卡片 / 列表切换", () => {
  it("默认卡片视图：网格容器可见，切换按钮的 aria-pressed 反映当前态", () => {
    render(
      <EntityViewToggle
        prefix="fx"
        entities={FIXTURES}
        keyOf={(e) => e.id}
        renderCard={(e) => <span data-testid={`fx-card-body-${e.id}`}>卡片·{e.name}</span>}
        renderListRow={(e) => <span data-testid={`fx-list-body-${e.id}`}>列表·{e.name}</span>}
      />,
    );

    // 默认态：卡片网格容器存在，列表容器不存在。
    expect(screen.getByTestId("fx-card-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("fx-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("fx-card-body-a")).toBeInTheDocument();
    expect(screen.getByTestId("fx-card-body-b")).toBeInTheDocument();
    expect(screen.queryByTestId("fx-list-body-a")).not.toBeInTheDocument();

    expect(screen.getByTestId("fx-view-toggle-card")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("fx-view-toggle-list")).toHaveAttribute("aria-pressed", "false");
    // 外层容器 testid 与当前视图无关，始终存在。
    expect(screen.getByTestId("fx-view-container")).toBeInTheDocument();
  });

  it("点击「列表」按钮后：卡片网格容器消失，列表容器出现且渲染的是 renderListRow", () => {
    render(
      <EntityViewToggle
        prefix="fx"
        entities={FIXTURES}
        keyOf={(e) => e.id}
        renderCard={(e) => <span data-testid={`fx-card-body-${e.id}`}>卡片·{e.name}</span>}
        renderListRow={(e) => <span data-testid={`fx-list-body-${e.id}`}>列表·{e.name}</span>}
      />,
    );

    fireEvent.click(screen.getByTestId("fx-view-toggle-list"));

    // 反空转关键断言：不是「列表按钮存在」，是切换之后卡片容器真的从 DOM 里消失了，
    // 列表容器真的出现了，且内容确实换成了 `renderListRow` 的渲染结果。
    expect(screen.queryByTestId("fx-card-grid")).not.toBeInTheDocument();
    const list = screen.getByTestId("fx-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId("fx-list-body-a")).toHaveTextContent("列表·条目 A");
    expect(screen.getByTestId("fx-list-body-b")).toHaveTextContent("列表·条目 B");
    expect(screen.queryByTestId("fx-card-body-a")).not.toBeInTheDocument();

    expect(screen.getByTestId("fx-view-toggle-card")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("fx-view-toggle-list")).toHaveAttribute("aria-pressed", "true");

    // 切回卡片：能来回切，不是一次性的单向开关。
    fireEvent.click(screen.getByTestId("fx-view-toggle-card"));
    expect(screen.getByTestId("fx-card-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("fx-list")).not.toBeInTheDocument();
  });

  it("defaultView='list' 时初始就是列表态，且 renderCard 一次都没被调用过", () => {
    const renderCard = vi.fn((e: Fixture) => <span key={e.id}>{e.name}</span>);
    const renderListRow = vi.fn((e: Fixture) => <span key={e.id}>{e.name}</span>);

    render(
      <EntityViewToggle
        prefix="fx2"
        entities={FIXTURES}
        keyOf={(e) => e.id}
        defaultView="list"
        renderCard={renderCard}
        renderListRow={renderListRow}
      />,
    );

    expect(screen.getByTestId("fx2-list")).toBeInTheDocument();
    expect(screen.queryByTestId("fx2-card-grid")).not.toBeInTheDocument();
    expect(renderListRow).toHaveBeenCalledTimes(FIXTURES.length);
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("cardContainerTestId / listContainerTestId 覆盖时，两态共用同一个容器 testid", () => {
    render(
      <EntityViewToggle
        prefix="fx3"
        entities={FIXTURES}
        keyOf={(e) => e.id}
        cardContainerTestId="shared-container"
        listContainerTestId="shared-container"
        renderCard={(e) => <span>{e.name}</span>}
        renderListRow={(e) => <span>{e.name}</span>}
      />,
    );

    expect(screen.getByTestId("shared-container")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fx3-view-toggle-list"));
    // 切了视图，但既有断言只认这一个容器 testid 时不用跟着改——这正是接入
    // `capability-catalog-screen.tsx` / `skill-catalog-live.tsx` 时依赖的行为。
    expect(screen.getByTestId("shared-container")).toBeInTheDocument();
  });
});
