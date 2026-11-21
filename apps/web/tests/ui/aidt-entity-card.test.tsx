import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { AidtEntityCard, AidtEntityCardDirectory, updateAidtEntityCardTags, readAidtEntityCardTags } from "@/features/aidt/components/aidt-entity-card";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";

const empty = emptyAidtUiDrafts()[1]!;

it("lists tags inline and filters cards, while one durable mutation edits only the chosen card", async () => {
  const initial = updateAidtEntityCardTags(updateAidtEntityCardTags(empty, "a", ["校园"]), "b", ["通勤"]);
  const saved = vi.fn();
  function Directory() {
    const [draft, setDraft] = React.useState(initial);
    return <AidtEntityCardDirectory draft={draft} readOnly={false} saveDraft={async change => {
      const next = change(draft);
      saved(next);
      setDraft(next);
      return true;
    }}><ul><AidtEntityCard entityId="a"><h2>第一张</h2></AidtEntityCard><AidtEntityCard entityId="b"><h2>第二张</h2></AidtEntityCard></ul></AidtEntityCardDirectory>;
  }
  render(<Directory />);
  const filters = screen.getByRole("group", { name: "筛选卡片标签" });
  fireEvent.click(within(filters).getByRole("button", { name: "校园" }));
  expect(screen.queryByRole("heading", { name: "第二张" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑标签" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "通勤" }));
  const input = within(dialog).getByRole("textbox", { name: "新标签" });
  fireEvent.change(input, { target: { value: "观察" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "着眼未来" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(readAidtEntityCardTags(saved.mock.calls[0]![0].fields, "a")).toEqual(["校园", "通勤", "观察", "着眼未来"]);
  expect(readAidtEntityCardTags(saved.mock.calls[0]![0].fields, "b")).toEqual(["通勤"]);
  fireEvent.click(within(filters).getByRole("button", { name: "通勤" }));
  expect(screen.getByRole("heading", { name: "第一张" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "第二张" })).toBeVisible();
});
