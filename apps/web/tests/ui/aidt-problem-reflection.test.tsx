import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtProblemReflection } from "@/features/aidt/components/aidt-problem-reflection";
import { formatAidtProblemReflectionMarkdown, isProblemReflectionConfirmed, readProblemSources } from "@/features/aidt/lib/aidt-problem-reflection";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

const base: AidtUiStageDraft = {
  fields: { initial: "改善校园奶茶选择体验", legacy: "保留原有内容" },
  ideas: [{ id: "old", title: "已有点子", description: "不可覆写" }], selectedIdeaId: "old",
  selectionReasons: { old: "已有理由" }, discoveryCards: [], unboundReason: "旧数据",
};
const ready: AidtUiStageDraft = {
  ...base,
  fields: { ...base.fields, whyWorthStudying: "暂时说不清", problemSources: '["guess"]', sourceDetails: "目前仅为猜测，需要访谈了解" },
};

function Controlled({ initial = base, change = vi.fn() }: { initial?: AidtUiStageDraft; change?: (next: AidtUiStageDraft) => void }) {
  const [draft, setDraft] = React.useState(initial);
  return <AidtProblemReflection draft={draft} onChange={(next) => { setDraft(next); change(next); }} />;
}

it("starts with student-owned empty answers and allows a rough draft without confirming it", () => {
  const change = vi.fn();
  render(<Controlled change={change} />);
  expect(screen.getByLabelText("为什么这是一个值得研究的问题？")).toHaveValue("");
  expect(screen.getByLabelText("我们的猜测")).not.toBeChecked();
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeDisabled();
  expect(screen.getByTestId("aidt-problem-reflection-status")).toHaveTextContent("待补充：选题理由、问题来源、来源描述");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("为什么这是一个值得研究的问题？"), { target: { value: "我们还说不清" } });
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.lastCall?.[0].fields.problemReflectionConfirmed).toBe("");
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeDisabled();
});

it("accepts acknowledged uncertainty and guesses without requiring fabricated proof", () => {
  const change = vi.fn();
  render(<Controlled initial={ready} change={change} />);
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeEnabled();
  expect(screen.getByTestId("aidt-problem-reflection-status")).toHaveTextContent("核对理由与来源后");
  expect(screen.getByTestId("aidt-problem-reflection-status")).not.toHaveTextContent("编辑者已确认");
  fireEvent.click(screen.getByTestId("aidt-problem-reflection-confirm"));
  expect(change.mock.lastCall?.[0]).toEqual({ ...ready, fields: { ...ready.fields, problemReflectionConfirmed: "true" } });
  expect(screen.getByTestId("aidt-problem-reflection-status")).toHaveTextContent("本组编辑者已确认 · 尚待研究核实");
  expect(screen.getByTestId("aidt-problem-reflection-status")).not.toHaveTextContent("已保存");
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeDisabled();
});

it("retains multiple source types separately and keeps all unrelated draft data", () => {
  const change = vi.fn();
  render(<Controlled initial={ready} change={change} />);
  fireEvent.click(screen.getByLabelText("亲自观察"));
  fireEvent.click(screen.getByLabelText("听到抱怨"));
  const latest = change.mock.lastCall?.[0] as AidtUiStageDraft;
  expect(JSON.parse(latest.fields.problemSources!)).toEqual(["observation", "complaint", "guess"]);
  expect(latest).toEqual({ ...ready, fields: { ...ready.fields, problemSources: '["observation","complaint","guess"]', problemReflectionConfirmed: "" } });
  fireEvent.click(screen.getByLabelText("我们的猜测"));
  expect(JSON.parse(change.mock.lastCall?.[0].fields.problemSources)).toEqual(["observation", "complaint"]);
});

it.each([
  ["aidt-problem-reflection-why", "补充理由"],
  ["aidt-problem-reflection-details", "新的来源描述"],
  ["aidt-problem-reflection-uncertainty", "仍不了解实际购买过程"],
])("clears student confirmation when %s changes", (testId, value) => {
  const change = vi.fn();
  render(<Controlled initial={{ ...ready, fields: { ...ready.fields, problemReflectionConfirmed: "true" } }} change={change} />);
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
  expect(change.mock.lastCall?.[0].fields.problemReflectionConfirmed).toBe("");
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeEnabled();
  expect(screen.getByTestId("aidt-problem-reflection-status")).not.toHaveTextContent("编辑者已确认");
});

it("requires an original proposition and a source description before confirming, but still allows editing", () => {
  const change = vi.fn();
  const { rerender } = render(<AidtProblemReflection draft={{ ...ready, fields: { ...ready.fields, initial: "" } }} onChange={change} />);
  expect(screen.getByTestId("aidt-problem-reflection-initial-missing")).toBeInTheDocument();
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeDisabled();
  rerender(<AidtProblemReflection draft={{ ...ready, fields: { ...ready.fields, sourceDetails: "  " } }} onChange={change} />);
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeDisabled();
  fireEvent.change(screen.getByTestId("aidt-problem-reflection-details"), { target: { value: "暂时说不清" } });
  expect(change).toHaveBeenCalledTimes(1);
});

it("does not silently accept or rewrite malformed persisted sources", () => {
  const change = vi.fn();
  render(<Controlled initial={{ ...ready, fields: { ...ready.fields, problemSources: '["unknown"]', problemReflectionConfirmed: "true" } }} change={change} />);
  expect(screen.getByRole("alert")).toHaveTextContent("请重新核对问题来源");
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeDisabled();
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByTestId("aidt-problem-reflection-details")).toHaveValue(ready.fields.sourceDetails);
  fireEvent.click(screen.getByLabelText("我们的猜测"));
  expect(change.mock.lastCall?.[0].fields.problemSources).toBe('["guess"]');
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByTestId("aidt-problem-reflection-confirm")).toBeEnabled();
});

it("blocks every mutation after a read-only downgrade, including dispatched change events", () => {
  const change = vi.fn();
  const { rerender } = render(<AidtProblemReflection draft={ready} onChange={change} />);
  rerender(<AidtProblemReflection draft={ready} readOnly onChange={change} />);
  for (const input of screen.getAllByRole("textbox")) {
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "不应修改" } });
  }
  for (const checkbox of screen.getAllByRole("checkbox")) {
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
  }
  fireEvent.click(screen.getByTestId("aidt-problem-reflection-confirm"));
  expect(change).not.toHaveBeenCalled();
});

it("safely parses canonical provenance without turning unknown data into evidence", () => {
  expect(readProblemSources(undefined)).toEqual({ selected: [], invalid: false });
  expect(readProblemSources("[broken")).toEqual({ selected: [], invalid: true });
  expect(readProblemSources('{"guess":true}')).toEqual({ selected: [], invalid: true });
  expect(readProblemSources('["guess","guess","observation",null,"new-source"]')).toEqual({ selected: ["guess", "observation"], invalid: true });
});

it("uses the same confirmation rules in the report and does not promote a raw flag to evidence", () => {
  const confirmed = { ...ready, fields: { ...ready.fields, problemReflectionConfirmed: "true" } };
  expect(isProblemReflectionConfirmed(confirmed)).toBe(true);
  const report = formatAidtProblemReflectionMarkdown(confirmed).join("\n");
  expect(report).toContain("学生标注的问题来源：我们的猜测");
  expect(report).toContain("反思确认：本组编辑者已确认");
  expect(report).toContain("学生记录，尚待研究核实");
  expect(report).toContain("尚未填写；不表示没有不确定性");
  for (const fields of [
    { ...confirmed.fields, initial: "" },
    { ...confirmed.fields, whyWorthStudying: " " },
    { ...confirmed.fields, sourceDetails: "" },
    { ...confirmed.fields, problemSources: '["unknown"]' },
    { ...confirmed.fields, problemSources: "[]" },
  ]) {
    const invalid = { ...confirmed, fields };
    expect(isProblemReflectionConfirmed(invalid)).toBe(false);
    expect(formatAidtProblemReflectionMarkdown(invalid).join("\n")).toContain("反思确认：待学生确认；待补充：");
  }
});
