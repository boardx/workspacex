import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GuidedResearchPlanEditor } from "@/components/research-studio/guided-research-plan-editor";
import { runtimeFixture } from "../guided-runtime-fixture";

it("edits a single plan on click, adds/removes boxes and confirms saving", async () => {
  const outline = runtimeFixture("outline").outline;
  const save = vi.fn().mockResolvedValue(true);
  render(<GuidedResearchPlanEditor value={outline} disabled={false} onSave={save} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /编辑计划 1/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "计划 1" }), { target: { value: "新的简单计划" } });
  fireEvent.click(screen.getByRole("button", { name: "新增计划" }));
  expect(screen.getByRole("textbox", { name: "计划 2" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "删除计划 2" }));
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: outline[0]!.id, title: "新的简单计划", questions: outline[0]!.questions })]));
});

it("derives a newly added plan's research question from its final edited title", async () => {
  const outline = runtimeFixture("outline").outline;
  const save = vi.fn().mockResolvedValue(true);
  render(<GuidedResearchPlanEditor value={outline} disabled={false} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "新增计划" }));
  fireEvent.change(screen.getByRole("textbox", { name: "计划 2" }), { target: { value: "初始市场范围" } });
  fireEvent.change(screen.getByRole("textbox", { name: "计划 2" }), { target: { value: "欧洲储能并网审批风险" } });
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const saved = save.mock.calls[0]![0];
  expect(saved[0].questions).toEqual(outline[0]!.questions);
  expect(saved[1].questions[0]).toContain("欧洲储能并网审批风险");
  expect(saved[1].questions[0]).not.toContain("需要回答什么问题");
});


it("keeps a retained draft dirty against acknowledged data and cancels to that data", () => {
  const acknowledged = runtimeFixture("outline").outline;
  const retained = acknowledged.map((item, index) => index ? item : { ...item, title: "恢复后保留的草稿" });
  const cancel = vi.fn();
  render(<GuidedResearchPlanEditor value={retained} persistedValue={acknowledged} disabled={false} onSave={vi.fn()} onCancel={cancel} />);
  expect(screen.getByRole("button", { name: "保存计划" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "保存计划" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /编辑计划 1/ })).not.toHaveTextContent("恢复后保留的草稿");
});

it("does not overwrite unsaved input when acknowledged values arrive as fresh objects", () => {
  const acknowledged = runtimeFixture("outline").outline;
  const original = JSON.stringify(acknowledged);
  const props = { disabled: false, onSave: vi.fn() };
  const { rerender } = render(<GuidedResearchPlanEditor value={acknowledged} persistedValue={acknowledged} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /编辑计划 1/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "计划 1" }), { target: { value: "尚未提交的输入" } });
  rerender(<GuidedResearchPlanEditor value={JSON.parse(original)} persistedValue={JSON.parse(original)} {...props} />);
  expect(screen.getByRole("textbox", { name: "计划 1" })).toHaveValue("尚未提交的输入");
  expect(screen.getByRole("button", { name: "保存计划" })).toBeEnabled();
  expect(JSON.stringify(acknowledged)).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("button", { name: "保存计划" })).not.toBeInTheDocument();
  expect(JSON.stringify(acknowledged)).toBe(original);
});
