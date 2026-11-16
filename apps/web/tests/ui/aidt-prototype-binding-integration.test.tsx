import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { readAidtPrototypeReference, updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { aidtPrototypeVersionLabel } from "@/features/aidt/lib/aidt-prototype-label";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import type { AidtPrototypeVersionReference } from "@/features/aidt/lib/aidt-prototype-versions";

const reference: AidtPrototypeVersionReference = { designId: "design-fixture", versionId: "version-two", designName: "教学测试示意图", seq: 2, summary: "人工示例", source: "user", createdAt: "2026-11-16T00:00:00.000Z", frameCount: 1, generatedFrameCount: 1 };
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "o", userId: "u", sessionToken: "token" } }) }));
// Host wiring only; native API and ownership checks have their own tests/acceptance.
vi.mock("@/features/aidt/components/aidt-prototype-version-picker", () => ({ AidtPrototypeVersionPicker: ({ onChange }: { onChange: (value: AidtPrototypeVersionReference) => void }) => <button onClick={() => onChange(reference)}>选择示例原生版本</button> }));
function Harness({ stage, initial }: { stage: number; initial: AidtUiStageDraft }) {
  const [draft, setDraft] = React.useState(initial);
  return <><AidtStageOutput projectId="g" step={AIDT_STEPS[stage - 1]!} draft={draft} update={mutate => setDraft(mutate)} readOnly={false} toolHref={tool => `/tool/${tool}`} /><output data-testid="binding-state">{JSON.stringify(draft)}</output></>;
}
const current = () => JSON.parse(screen.getByTestId("binding-state").textContent!) as AidtUiStageDraft;
it("routes the real stage version textarea through selection invalidation and preserves student text", () => {
  render(<Harness stage={5} initial={{ ...emptyAidtUiDrafts()[5]!, fields: { version: "学生旧文字说明" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "选择示例原生版本" }));
  expect(readAidtPrototypeReference(current())?.versionId).toBe("version-two");
  expect(current().fields.version).toBe("学生旧文字说明");
  fireEvent.change(screen.getByTestId("aidt-field-version"), { target: { value: "学生手工改写" } });
  expect(readAidtPrototypeReference(current())).toBeNull();
  fireEvent.change(screen.getByTestId("aidt-field-version"), { target: { value: aidtPrototypeVersionLabel(reference) } });
  expect(readAidtPrototypeReference(current())).toBeNull();
});
it("changing the tested native version warns and preserves the original frozen question", () => {
  const v1 = { ...reference, versionId: "version-one", seq: 1 };
  const prototype = confirmAidtVerificationQuestion(updateAidtPrototypeReference({ ...emptyAidtUiDrafts()[5]!, fields: { verificationQuestion: "能否看懂示意？", version: "原学生说明" } }, v1))!;
  const snapshot = createAidtQuestionSnapshot(prototype, 3);
  if (!snapshot.ok) throw new Error(snapshot.reason);
  render(<Harness stage={6} initial={{ ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: snapshot.serialized, version: snapshot.snapshot.prototypeRef, reflectionConfirmed: "true" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "选择示例原生版本" }));
  expect(current().fields.questionSnapshot).toBe(snapshot.serialized);
  expect(current().fields.reflectionConfirmed).toBe("");
  expect(screen.getByText(/测试表单记录的被测版本与本轮问题绑定的/)).toBeVisible();
});
