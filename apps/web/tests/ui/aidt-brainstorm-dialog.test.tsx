import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { readAidtBrainstorms } from "@repo/contracts/aidt-brainstorm";
import { AidtIdeaDirectory } from "@/features/aidt/components/aidt-idea-directory";
import { readAidtEntityCardTags } from "@/features/aidt/components/aidt-entity-card";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

it("creates a named, tagged brainstorm with the selected frozen HMW before opening its Chat", async () => {
  const draft = emptyAidtUiDrafts()[4]!;
  const source = { id: "hmw-two", text: "如何预估等候时间？", revision: 2 };
  const attempts: AidtUiStageDraft[] = [];
  const openChat = vi.fn();
  render(<AidtIdeaDirectory draft={draft} saved={draft} readOnly={false} href={id => "/aidt/p?entity=" + id}
    allowBrainstorm sources={[source]} update={() => {}} onCreated={openChat} saveDraft={async change => {
      attempts.push(change(draft));
      return attempts.length === 2;
    }} />);

  fireEvent.click(screen.getByRole("button", { name: "新建卡片" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "新建卡片" })).getByRole("button", { name: "头脑风暴" }));
  const dialog = within(screen.getByRole("dialog", { name: "新建头脑风暴" }));
  const submit = dialog.getByRole("button", { name: "开始头脑风暴" });
  expect(submit).toBeDisabled();
  fireEvent.change(dialog.getByRole("textbox", { name: "场次名称" }), { target: { value: "午休排队发散" } });
  fireEvent.change(dialog.getByTestId("card-create-tag-input"), { target: { value: "课堂" } });
  fireEvent.change(dialog.getByRole("combobox", { name: "HMW", exact: true }), { target: { value: source.id } });
  fireEvent.change(dialog.getByRole("combobox", { name: "发散方法" }), { target: { value: "reverse" } });
  fireEvent.change(dialog.getByRole("spinbutton", { name: "希望探索的点子数" }), { target: { value: "7" } });
  fireEvent.click(submit);
  await dialog.findByRole("alert");
  expect(openChat).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "开始头脑风暴" }));
  await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
  const [session] = readAidtBrainstorms(attempts[1]!.fields);
  expect(session).toMatchObject({ name: "午休排队发散", source, method: "reverse", count: 7 });
  expect(readAidtBrainstorms(attempts[0]!.fields)[0]?.id).toBe(session!.id);
  expect(readAidtEntityCardTags(attempts[1]!.fields, session!.id)).toEqual(["课堂"]);
  expect(openChat).toHaveBeenCalledWith(session!.id);
});
