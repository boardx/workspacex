import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AidtIdeaClassification } from "@/features/aidt/components/aidt-idea-classification";
import { AidtIdeaConversation } from "@/features/aidt/components/aidt-idea-conversation";
import { confirmAidtIdeaFromChat } from "@/features/aidt/lib/aidt-idea-chat";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtIdeaClassification, invalidateAidtIdeaClassification, setAidtIdeaCategory, setAidtIdeaClassificationReason } from "@/features/aidt/lib/aidt-idea-classification";

const initial = (): AidtUiStageDraft => ({ fields: {}, ideas: [{ id: "a", title: "试饮", description: "先试三口" }, { id: "b", title: "口味表", description: "同桌比较" }], selectedIdeaId: "b", selectionReasons: { b: "小组原选择" } });
function Controlled({ changed = () => undefined }: { changed?: (draft: AidtUiStageDraft) => void }) {
  const [draft, setDraft] = React.useState(initial());
  return <AidtIdeaClassification draft={draft} onChange={(next) => { changed(next); setDraft(next); }} />;
}

it("starts with student choices empty and supports multiple labels without copying or selecting candidates", () => {
  const changed = vi.fn();
  render(<Controlled changed={changed} />);
  expect(screen.getAllByRole("checkbox").every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "试饮 · 最容易实现的" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "试饮 · 最有趣的" }));
  expect(screen.getByRole("button", { name: "确认本组分类" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "试饮 · 分类理由" }), { target: { value: "容易搭建，比较过程有趣" } });
  fireEvent.click(screen.getByRole("button", { name: "确认本组分类" }));
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("学生已确认分类");
  expect(screen.getAllByTestId("aidt-classification-idea")).toHaveLength(2);
  const latest = changed.mock.calls.at(-1)![0] as AidtUiStageDraft;
  expect(latest.ideas).toEqual(initial().ideas);
  expect(latest.selectedIdeaId).toBe("b");
  expect(latest.selectionReasons).toEqual({ b: "小组原选择" });
  expect(within(screen.getByRole("region", { name: "最容易实现的分类" })).getByText("试饮")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "最有趣的分类" })).getByText("试饮")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "最具突破性的分类" })).getByText("暂无；无需填满每一类。")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "试饮 · 分类理由" }), { target: { value: "补充不同意见" } });
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("待学生确认分类");
});

it("allows explicit confirmation with all ideas unclassified, without mandatory category quotas", () => {
  render(<Controlled />);
  expect(screen.getByRole("button", { name: "确认本组分类" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "确认本组分类" }));
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("学生已确认分类");
  expect(screen.getAllByRole("checkbox").every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
});

it("shows an empty state instead of fabricating ideas or confirmations", () => {
  render(<AidtIdeaClassification draft={{ ...initial(), ideas: [{ id: "empty", title: "", description: "" }] }} onChange={vi.fn()} />);
  expect(screen.getByTestId("aidt-classification-empty")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认本组分类" })).toBeNull();
});

it("blocks edits after read-only downgrade, including synthetic change events", () => {
  const changed = vi.fn(), draft = initial();
  const { rerender } = render(<AidtIdeaClassification draft={draft} onChange={changed} />);
  rerender(<AidtIdeaClassification draft={draft} readOnly onChange={changed} />);
  expect(screen.getByRole("checkbox", { name: "试饮 · 最容易实现的" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "试饮 · 最容易实现的" }));
  fireEvent.change(screen.getByRole("textbox", { name: "试饮 · 分类理由" }), { target: { value: "越权编辑" } });
  fireEvent.click(screen.getByRole("button", { name: "确认本组分类" }));
  expect(changed).not.toHaveBeenCalled();
});

it("shows malformed saved data as a repairable error and never as confirmed", () => {
  const changed = vi.fn(), draft = { ...initial(), fields: { ideaClassificationTags: "{bad", ideaClassificationConfirmed: "true" } };
  const { rerender } = render(<AidtIdeaClassification draft={draft} onChange={changed} />);
  expect(screen.getByRole("alert")).toHaveTextContent("无法读取");
  expect(screen.getByRole("button", { name: "确认本组分类" })).toBeDisabled();
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("待学生确认分类");
  fireEvent.click(screen.getByRole("button", { name: "重新整理分类记录" }));
  const repaired = changed.mock.calls[0]![0] as AidtUiStageDraft;
  expect(repaired.fields.ideaClassificationConfirmed).toBe("");
  rerender(<AidtIdeaClassification draft={repaired} onChange={changed} />);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("requires review after external idea content edits while retaining the student's category history", () => {
  const saved = confirmAidtIdeaClassification(setAidtIdeaClassificationReason(setAidtIdeaCategory(initial(), "a", "easy", true), "a", "纸张可试"));
  const { rerender } = render(<AidtIdeaClassification draft={saved} onChange={vi.fn()} />);
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("学生已确认分类");
  const revised = invalidateAidtIdeaClassification({ ...saved, ideas: saved.ideas.map((idea) => idea.id === "a" ? { ...idea, title: "多口味试饮" } : idea) });
  rerender(<AidtIdeaClassification draft={revised} onChange={vi.fn()} />);
  expect(screen.getByRole("checkbox", { name: "多口味试饮 · 最容易实现的" })).toBeChecked();
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("待学生确认分类");
});

it("requests a shared save when confirming classification from a confirmed idea conversation", () => {
  const description = "先比较两条销路。再选择一个渠道试卖。";
  const base = confirmAidtIdeaFromChat({ ...initial(), ideas: [{ id: "a", title: "试饮", description }] }, "a", description);
  let draft = base;
  const requestSave = vi.fn(() => draft);
  const props = {
    projectId: "project", entityId: "a", savedDraft: base, readOnly: false,
    messages: [], loading: false, running: false, requestSave,
  };
  const update = (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => {
    draft = mutate(draft);
    view.rerender(<AidtIdeaConversation {...props} draft={draft} update={update} />);
  };
  const view = render(<AidtIdeaConversation {...props} draft={draft} update={update} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "试饮 · 最容易实现的" }));
  fireEvent.change(screen.getByRole("textbox", { name: "试饮 · 分类理由" }), { target: { value: "纸卡可以先试做" } });
  expect(requestSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认本组分类" }));
  expect(requestSave).toHaveBeenCalledTimes(1);
  const saved = requestSave.mock.results[0]!.value!;
  view.unmount();
  render(<AidtIdeaConversation {...props} draft={saved} savedDraft={saved} update={vi.fn()} />);
  expect(screen.getByRole("checkbox", { name: "试饮 · 最容易实现的" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: "试饮 · 分类理由" })).toHaveValue("纸卡可以先试做");
  expect(screen.getByTestId("aidt-classification-status")).toHaveTextContent("学生已确认分类");
});
