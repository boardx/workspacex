import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { expect, it } from "vitest";
import { AidtCardFilters, AidtEntityCard, AidtEntityCardDirectory, updateAidtEntityCardTags } from "@/features/aidt/components/aidt-entity-card";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { I18nProvider } from "@/lib/i18n/provider";

const empty = emptyAidtUiDrafts()[1]!;

function Fixture({ showA = true }: { showA?: boolean }) {
  const draft = updateAidtEntityCardTags(
    updateAidtEntityCardTags(updateAidtEntityCardTags(empty, "orphan", ["归档专用"]), "a", ["AI", "校园"]), "b", ["通勤"],
  );
  return <I18nProvider initialLocale="zh-CN"><React.StrictMode>
    <AidtEntityCardDirectory draft={draft}><AidtCardFilters /><ul>
      {showA && <AidtEntityCard entityId="a"><h2>卡片 A</h2></AidtEntityCard>}
      <AidtEntityCard entityId="b"><h2>卡片 B</h2></AidtEntityCard>
    </ul></AidtEntityCardDirectory>
  </React.StrictMode></I18nProvider>;
}

it("excludes archived-only tags and reports a searchable empty result that can be cleared", async () => {
  render(<Fixture />);
  await screen.findByRole("region", { name: "筛选卡片标签" });
  expect(screen.queryByTestId("aidt-card-tag-归档专用")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索卡片标签" }), { target: { value: "不存在的标签" } });
  expect(screen.queryByRole("heading", { name: "卡片 A" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "卡片 B" })).not.toBeInTheDocument();
  expect(screen.getByTestId("aidt-card-filter-empty")).toHaveTextContent("没有匹配标签的卡片");
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getByRole("heading", { name: "卡片 A" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "卡片 B" })).toBeVisible();
  expect(screen.queryByTestId("aidt-card-filter-empty")).not.toBeInTheDocument();
});

it("keeps filtering case-insensitive and removes an archived active selection in StrictMode", async () => {
  const view = render(<Fixture />);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索卡片标签" }), { target: { value: "ai" } });
  expect(screen.getByRole("heading", { name: "卡片 A" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "卡片 B" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  fireEvent.click(screen.getByTestId("aidt-card-tag-AI"));
  view.rerender(<Fixture showA={false} />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "卡片 B" })).toBeVisible());
  expect(screen.queryByTestId("aidt-card-tag-AI")).not.toBeInTheDocument();
  expect(screen.queryByTestId("aidt-card-tag-归档专用")).not.toBeInTheDocument();
});
