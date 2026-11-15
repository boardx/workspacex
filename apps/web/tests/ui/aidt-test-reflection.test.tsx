import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtTestReflection } from "@/features/aidt/components/aidt-test-reflection";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";

function prototype(question = "愿意等待吗？") {
  const draft = emptyAidtUiDrafts()[5]!;
  draft.fields = { verificationQuestion: question, beforeTestBelief: "尚无结论", version: "V1 流程图" };
  return confirmAidtVerificationQuestion(draft)!;
}
function bound() {
  const result = createAidtQuestionSnapshot(prototype(), 2);
  if (!result.ok) throw new Error(result.reason);
  const draft = emptyAidtUiDrafts()[6]!;
  draft.fields.questionSnapshot = result.serialized;
  return draft;
}
function Controlled({ previousPrototype }: { previousPrototype?: AidtUiStageDraft }) {
  const [draft, onChange] = React.useState(emptyAidtUiDrafts()[6]!);
  return <><AidtTestReflection draft={draft} onChange={onChange} previousPrototype={previousPrototype} previousPrototypeRevision={2} /><output data-testid="fields">{JSON.stringify(draft.fields)}</output></>;
}
it("imports only by student action and does not overwrite a round after stage5 changes", () => {
  const { rerender } = render(<Controlled previousPrototype={prototype()} />);
  expect(screen.queryByTestId("aidt-bound-question")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "带入本轮验证问题" }));
  expect(screen.getByTestId("aidt-bound-question")).toHaveTextContent("愿意等待吗？");
  expect(JSON.parse(screen.getByTestId("fields").textContent!).version).toBe("V1 流程图");
  rerender(<Controlled previousPrototype={prototype("理解流程吗？")} />);
  expect(screen.getByTestId("aidt-bound-question")).toHaveTextContent("愿意等待吗？");
  expect(screen.getByTestId("aidt-bound-question")).not.toHaveTextContent("理解流程吗？");
  expect(screen.getByText(/第5步已有不同的内容/)).toBeInTheDocument();
});
it("confirms insufficient evidence and a request for support without forcing a new version or routing", () => {
  render(<Controlled previousPrototype={prototype()} />);
  fireEvent.click(screen.getByRole("button", { name: "带入本轮验证问题" }));
  fireEvent.change(screen.getByLabelText("测试之后，对这个问题的认识有什么变化？"), { target: { value: "insufficient" } });
  fireEvent.change(screen.getByLabelText("仍不确定的地方"), { target: { value: "尚缺实际行为观察" } });
  fireEvent.change(screen.getByLabelText("如果继续改进，优先从哪一步重新入手？"), { target: { value: "undecided" } });
  fireEvent.change(screen.getByLabelText("需要什么支持才能继续？"), { target: { value: "请老师帮助确定补访方向" } });
  fireEvent.click(screen.getByRole("button", { name: "确认本轮学习记录" }));
  expect(screen.getByRole("button", { name: "本轮学习记录已确认" })).toBeDisabled();
  expect(JSON.parse(screen.getByTestId("fields").textContent!)).toMatchObject({ reflectionConfirmed: "true", returnStep: "undecided" });
  expect(JSON.parse(screen.getByTestId("fields").textContent!).newVersion).toBeFalsy();
  fireEvent.change(screen.getByLabelText("仍不确定的地方"), { target: { value: "更新缺口" } });
  expect(screen.getByRole("button", { name: "确认本轮学习记录" })).toBeEnabled();
});
it("does not replace unreadable saved round context", () => {
  const draft = bound(); draft.fields.questionSnapshot = "broken data";
  const onChange = vi.fn();
  render(<AidtTestReflection draft={draft} onChange={onChange} previousPrototype={prototype()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("已保留原稿");
  expect(screen.queryByRole("button", { name: "带入本轮验证问题" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
it("preserves an existing conflicting test version and blocks confirmation until the student resolves it", () => {
  const draft = emptyAidtUiDrafts()[6]!;
  draft.fields.version = "另一个 V2";
  draft.fields.reflectionConfirmed = "true";
  const onChange = vi.fn();
  const { rerender } = render(<AidtTestReflection draft={draft} onChange={onChange} previousPrototype={prototype()} />);
  fireEvent.click(screen.getByRole("button", { name: "带入本轮验证问题" }));
  const next = onChange.mock.calls[0]![0] as AidtUiStageDraft;
  expect(next.fields.version).toBe("另一个 V2");
  expect(next.fields.reflectionConfirmed).toBe("");
  rerender(<AidtTestReflection draft={next} onChange={onChange} previousPrototype={prototype()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("与本轮问题绑定的“V1 流程图”不同");
  expect(screen.getByRole("button", { name: "确认本轮学习记录" })).toBeDisabled();
});
it("disables every draft mutation after read-only downgrade", () => {
  const draft = emptyAidtUiDrafts()[6]!;
  const onChange = vi.fn();
  const { rerender } = render(<AidtTestReflection draft={draft} onChange={onChange} previousPrototype={prototype()} />);
  rerender(<AidtTestReflection draft={draft} onChange={onChange} previousPrototype={prototype()} readOnly />);
  fireEvent.click(screen.getByRole("button", { name: "带入本轮验证问题" }));
  fireEvent.change(screen.getByLabelText("仍不确定的地方"), { target: { value: "edited" } });
  fireEvent.change(screen.getByLabelText("如果继续改进，优先从哪一步重新入手？"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "确认本轮学习记录" }));
  expect(onChange).not.toHaveBeenCalled();
});
