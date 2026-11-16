import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AidtStageFields } from "@/features/aidt/components/aidt-stage-fields";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot, isAidtIterationPrototypeRelated } from "@/features/aidt/lib/aidt-verification-loop";
import { readAidtIterationPrototypeReference, updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
const v1 = { designId: "design", versionId: "v1", designName: "原型", seq: 1, summary: "旧版", source: "user" as const, createdAt: "2026-11-16", frameCount: 1, generatedFrameCount: 1 };
const v2 = { ...v1, versionId: "v2", seq: 2, summary: "新版" };
vi.mock("@/features/aidt/components/aidt-prototype-version-picker", () => ({ AidtPrototypeVersionPicker: ({ onChange, readOnly, label }: { onChange: (ref: typeof v2) => void; readOnly?: boolean; label?: string }) => <button disabled={readOnly} onClick={() => onChange(v2)}>选择{label}</button> }));
function initial(): AidtUiStageDraft {
  const source = confirmAidtVerificationQuestion(updateAidtPrototypeReference({ ...emptyAidtUiDrafts()[5]!, fields: { verificationQuestion: "原入口是否清楚？" } }, v1))!;
  const result = createAidtQuestionSnapshot(source, 3); if (!result.ok) throw new Error(result.reason);
  return { ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: result.serialized, newVersion: "学生既有新版文字" } };
}
function Host({ readOnly = false }: { readOnly?: boolean }) {
  const [draft, setDraft] = React.useState(initial);
  return <><AidtStageFields stageNumber={6} projectId="class" draft={draft} readOnly={readOnly} onDraftChange={setDraft} onChange={(field, text) => setDraft(old => ({ ...old, fields: { ...old.fields, [field]: text } }))} /><output data-testid="iteration-state">{JSON.stringify(draft)}</output></>;
}
const current = () => JSON.parse(screen.getByTestId("iteration-state").textContent!) as AidtUiStageDraft;
it("selects an optional iteration result, explicitly relates feedback, and clears that marker on manual newVersion edits", () => {
  render(<Host />); const old = current().fields.questionSnapshot;
  fireEvent.click(screen.getByTestId("aidt-more-fields").querySelector("summary")!);
  fireEvent.click(screen.getByRole("button", { name: "选择迭代产出原型版本" }));
  expect(readAidtIterationPrototypeReference(current())?.versionId).toBe("v2");
  expect(current().fields.questionSnapshot).toBe(old);
  expect(current().fields.newVersion).toBe("学生既有新版文字");
  fireEvent.change(screen.getByRole("textbox", { name: "本次修改依据的反馈或未解问题引用" }), { target: { value: "观察记录A 00:30" } });
  fireEvent.change(screen.getByRole("textbox", { name: "相对旧版改了什么，为什么？" }), { target: { value: "入口位置更清楚，仍待测试" } });
  fireEvent.click(screen.getByRole("button", { name: "确认关联本次产出、旧版与反馈" }));
  expect(isAidtIterationPrototypeRelated(current())).toBe(true);
  fireEvent.change(screen.getByTestId("aidt-field-newVersion"), { target: { value: "学生手工改写新版引用" } });
  expect(readAidtIterationPrototypeReference(current())).toBeNull(); expect(isAidtIterationPrototypeRelated(current())).toBe(false);
  expect(current().fields.questionSnapshot).toBe(old);
});
it("keeps the optional output controls readonly without requiring an iteration to view the prior question", () => {
  render(<Host readOnly />); fireEvent.click(screen.getByTestId("aidt-more-fields").querySelector("summary")!);
  expect(screen.getByRole("button", { name: "选择迭代产出原型版本" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "确认关联本次产出、旧版与反馈" })).toBeDisabled();
  expect(screen.getByTestId("aidt-iteration-tested-source")).toHaveTextContent("原入口是否清楚？");
});
