import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { AidtEntityCard, AidtEntityCardDirectory, updateAidtEntityCardTags, readAidtEntityCardTags } from "@/features/aidt/components/aidt-entity-card";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { I18nProvider } from "@/lib/i18n/provider";

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
  render(<I18nProvider initialLocale="zh-CN"><React.StrictMode><Directory /></React.StrictMode></I18nProvider>);
  const filters = screen.getByRole("region", { name: "筛选卡片标签" });
  fireEvent.click(within(filters).getByTestId("aidt-card-tag-校园"));
  expect(screen.queryByRole("heading", { name: "第二张" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑标签" }));
  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByTestId("card-edit-tag-input");
  fireEvent.change(input, { target: { value: "通勤" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "观察" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "着眼未来" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(readAidtEntityCardTags(saved.mock.calls[0]![0].fields, "a")).toEqual(["校园", "通勤", "观察", "着眼未来"]);
  expect(readAidtEntityCardTags(saved.mock.calls[0]![0].fields, "b")).toEqual(["通勤"]);
  fireEvent.click(within(filters).getByTestId("aidt-card-tag-通勤"));
  expect(screen.getByRole("heading", { name: "第一张" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "第二张" })).toBeVisible();
});

function Fixture({ showA = true, readOnly = false, save = async () => true }: {
  showA?: boolean; readOnly?: boolean; save?: (draft: typeof empty) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState(() => updateAidtEntityCardTags(
    updateAidtEntityCardTags(updateAidtEntityCardTags(empty, "orphan", ["归档专用"]), "a", ["AI", "校园"]), "b", ["通勤"],
  ));
  return <I18nProvider initialLocale="zh-CN"><React.StrictMode>
    <AidtEntityCardDirectory draft={draft} readOnly={readOnly} saveDraft={async change => {
      const next = change(draft); const ok = await save(next); if (ok) setDraft(next); return ok;
    }}><ul>
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

it("cancels keyboard/chip edits without saving and commits an unconfirmed last tag only on explicit save", async () => {
  const save = vi.fn<(draft: typeof empty) => Promise<boolean>>().mockResolvedValue(true);
  render(<Fixture save={save} />);
  fireEvent.click(screen.getAllByRole("button", { name: "编辑标签" })[0]!);
  let dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByTestId("card-edit-tag-input"), { target: { value: "未保存" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "编辑标签" })[0]!);
  dialog = screen.getByRole("dialog");
  const input = within(dialog).getByTestId("card-edit-tag-input");
  expect(input).toHaveValue("");
  fireEvent.change(input, { target: { value: "ai" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(within(dialog).getAllByTestId(/^card-edit-tag-chip-/)).toHaveLength(2);
  fireEvent.change(input, { target: { value: "观察" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledTimes(1);
  expect(readAidtEntityCardTags(save.mock.calls[0]![0].fields, "a")).toEqual(["AI", "校园", "观察"]);
  expect(readAidtEntityCardTags(save.mock.calls[0]![0].fields, "b")).toEqual(["通勤"]);
});

it("retains a failed save and stops a pending dialog after write permission is removed", async () => {
  const save = vi.fn<(draft: typeof empty) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const view = render(<Fixture save={save} />);
  fireEvent.click(screen.getAllByRole("button", { name: "编辑标签" })[0]!);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByTestId("card-edit-tag-input"), { target: { value: "待核实" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await within(dialog).findByRole("alert");
  expect(within(dialog).getByTestId("card-edit-tag-input")).toHaveValue("待核实");
  view.rerender(<Fixture readOnly save={save} />);
  expect(within(dialog).getByRole("button", { name: "保存标签" })).toBeDisabled();
  expect(within(dialog).getByTestId("card-edit-tag-input")).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("button", { name: "编辑标签" })).not.toBeInTheDocument();
});

it("retries a rejected save with the same pending text without changing sibling tags", async () => {
  const save = vi.fn<(draft: typeof empty) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<Fixture save={save} />);
  fireEvent.click(screen.getAllByRole("button", { name: "编辑标签" })[0]!);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByTestId("card-edit-tag-input"), { target: { value: "需要补访" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await within(dialog).findByRole("alert");
  fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
  expect(readAidtEntityCardTags(save.mock.calls[1]![0].fields, "a")).toEqual(["AI", "校园", "需要补访"]);
  expect(readAidtEntityCardTags(save.mock.calls[1]![0].fields, "b")).toEqual(["通勤"]);
});
