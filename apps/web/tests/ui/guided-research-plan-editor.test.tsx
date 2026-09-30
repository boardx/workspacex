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
