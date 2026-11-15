import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtIdeaClassification, readAidtIdeaClassification, setAidtIdeaCategory, setAidtIdeaClassificationReason } from "@/features/aidt/lib/aidt-idea-classification";
import { confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";

const mocks = vi.hoisted(() => ({ print: vi.fn() }));
vi.mock("@/lib/research-report-export", () => ({ printResearchPdf: mocks.print }));
vi.mock("@/features/aidt/components/aidt-image-attachment-picker", () => ({
  AidtImageAttachmentPreview: () => null,
  AidtImageAttachmentPicker: ({ label, readOnly, onChange }: { label: string; readOnly: boolean; onChange: (reference: { attachmentId: string; threadId: string; name: string }) => void }) => <button disabled={readOnly} onClick={() => onChange({ attachmentId: "uploaded", threadId: "group-thread", name: "学生参考图.png" })}>{label}选择已上传图片</button>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { vi.unstubAllGlobals(); });

function seed(): AidtUiStageDraft {
  const draft: AidtUiStageDraft = { fields: { reason: "原入选理由" }, selectedIdeaId: "one", selectionReasons: { one: "原入选理由", two: "备用理由" }, ideas: ["试饮", "口味卡", "同伴墙"].map((title, index) => ({ id: ["one", "two", "three"][index]!, title, description: "先体验。再比较选择。", image: "data:image/png;base64,preview" })) };
  return confirmAidtIdeaClassification(setAidtIdeaClassificationReason(setAidtIdeaCategory(setAidtIdeaCategory(draft, "one", "easy", true), "one", "fun", true), "one", "学生判断：小杯易搭建，也方便一起尝试。"));
}
function Stage({ initial = seed(), readOnly = false, changed = () => undefined, stage = 4 }: { initial?: AidtUiStageDraft; readOnly?: boolean; changed?: (draft: AidtUiStageDraft) => void; stage?: number }) {
  const [draft, setDraft] = React.useState(initial);
  const update = (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => setDraft((old) => { const next = mutate(old); changed(next); return next; });
  return <><AidtStageOutput projectId="group" thread="group-thread" step={AIDT_STEPS[stage - 1]!} draft={draft} update={update} readOnly={readOnly} toolHref={(tool) => `/aidt/group?step=${stage}&tool=${tool}`} /><output data-testid="snapshot">{JSON.stringify(draft)}</output></>;
}
const snapshot = (): AidtUiStageDraft => JSON.parse(screen.getByTestId("snapshot").textContent!);

it("mounts classification after the original editors, preserves it when changing selection, and keeps selection reasons separate", () => {
  render(<Stage />);
  expect(screen.getByTestId("aidt-idea-cards").compareDocumentPosition(screen.getByTestId("aidt-idea-classification")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByLabelText("拟选择候选 2（不是投票）"));
  expect(snapshot().selectedIdeaId).toBe("two");
  expect(snapshot().fields.reason).toBe("备用理由");
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(true);
  fireEvent.change(screen.getByLabelText("选择理由与不同意见"), { target: { value: "学生另选的原因" } });
  expect(readAidtIdeaClassification(snapshot()).reasons.one).toContain("小杯易搭建");
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(true);
  expect(snapshot().selectionReasons?.two).toBe("学生另选的原因");
});

it.each([["候选1名称", "修改后的点子"], ["候选1核心说明", "修改了服务过程和做法。"]])("requires category review when %s changes", (label, value) => {
  render(<Stage />);
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(false);
  expect(readAidtIdeaClassification(snapshot()).tags.one).toEqual(["easy", "fun"]);
});

it("invalidates confirmation on adding or deleting ideas, and excludes deleted references from active classification", () => {
  render(<Stage />);
  fireEvent.click(screen.getByRole("button", { name: "添加候选" }));
  expect(snapshot().ideas).toHaveLength(4);
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认本组分类" }));
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "移除候选 1" }));
  fireEvent.click(screen.getByRole("button", { name: "确认移除候选" }));
  expect(snapshot().ideas.some((idea) => idea.id === "one")).toBe(false);
  expect(readAidtIdeaClassification(snapshot()).tags.one).toBeUndefined();
  expect(readAidtIdeaClassification(snapshot()).reasons.one).toBeUndefined();
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(false);
});

it("invalidates classification when a native uploaded image attachment is changed", () => {
  render(<Stage />);
  fireEvent.click(screen.getByRole("button", { name: "候选1图像选择已上传图片" }));
  expect(snapshot().ideas[0]?.imageAttachment?.attachmentId).toBe("uploaded");
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(false);
});

it("invalidates classification when local image preview finishes loading", () => {
  vi.stubGlobal("FileReader", class {
    result = "data:image/png;base64,new";
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  render(<Stage />);
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [new File(["image"], "new.png", { type: "image/png" })] } });
  expect(snapshot().ideas[0]?.imageName).toBe("new.png");
  expect(readAidtIdeaClassification(snapshot()).confirmed).toBe(false);
});

it("blocks disabled form events, pending removal, and late image callbacks after read-only downgrade", () => {
  let finish: (() => void) | undefined;
  vi.stubGlobal("FileReader", class {
    result = "data:image/png;base64,new";
    onload?: () => void;
    readAsDataURL() { finish = () => this.onload?.(); }
  });
  const changed = vi.fn();
  const { rerender } = render(<Stage changed={changed} />);
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [new File(["image"], "new.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "移除候选 1" }));
  rerender(<Stage changed={changed} readOnly />);
  fireEvent.click(screen.getByRole("button", { name: "确认移除候选" }));
  fireEvent.change(screen.getByLabelText("候选1名称"), { target: { value: "越权" } });
  fireEvent.change(screen.getByRole("textbox", { name: "试饮 · 分类理由" }), { target: { value: "越权" } });
  fireEvent.click(screen.getByLabelText("拟选择候选 2（不是投票）"));
  rerender(<Stage changed={changed} />);
  finish?.();
  expect(changed).not.toHaveBeenCalled();
  expect(snapshot().ideas[0]?.imageName).toBeUndefined();
});

it.each([true, false])("exports student classification and reasons with explicit confirmation state (%s), without duplicate concept sheets", async (confirmed) => {
  const draft = seed();
  draft.fields.ideaClassificationConfirmed = confirmed ? "true" : "";
  draft.fields.ideaClassificationReasons = JSON.stringify({ one: "<script>学生分类理由</script>" });
  render(<Stage initial={draft} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /本组已比较：/ }));
  fireEvent.click(screen.getByRole("button", { name: "描述单 PDF 预览" }));
  await waitFor(() => expect(mocks.print).toHaveBeenCalledOnce());
  const article = mocks.print.mock.calls[0]![0] as HTMLElement;
  expect(article.querySelectorAll("section")).toHaveLength(3);
  expect(article.querySelectorAll("section")[0]?.textContent).toContain(`学生分类（${confirmed ? "本组已确认" : "尚未确认"}）：最容易实现的、最有趣的`);
  expect(article.textContent).toContain("<script>学生分类理由</script>");
  expect(article.querySelector("script")).toBeNull();
  expect(article.textContent).not.toContain("投票完成");
});

it("requires a student-confirmed validation question before opening native Design Workbench", () => {
  const draft: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };
  const { unmount } = render(<Stage stage={5} initial={draft} />);
  expect(screen.getByRole("button", { name: "打开原生 Design Workbench" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "打开原生 Design Workbench" })).toBeNull();
  unmount();
  render(<Stage stage={5} initial={confirmAidtVerificationQuestion({ ...draft, fields: { verificationQuestion: "用户能理解第一步吗？" } })!} />);
  expect(screen.getByRole("link", { name: "打开原生 Design Workbench" })).toHaveAttribute("href", "/aidt/group?step=5&tool=design");
});

it("requires fresh student reflection confirmation after editing the actual test record", () => {
  const initial: AidtUiStageDraft = { fields: { reflectionConfirmed: "true", said: "先前原话" }, ideas: [], selectedIdeaId: "" };
  render(<Stage stage={6} initial={initial} />);
  fireEvent.change(screen.getByTestId("aidt-field-said"), { target: { value: "校正后的真实原话" } });
  expect(snapshot().fields.said).toBe("校正后的真实原话");
  expect(snapshot().fields.reflectionConfirmed).toBe("");
});
it("requires reconfirming the validation question when the selected concept text changes", () => {
  const initial = confirmAidtVerificationQuestion({ fields: { idea: "旧方案", verificationQuestion: "用户理解什么？" }, ideas: [], selectedIdeaId: "" })!;
  render(<Stage stage={5} initial={initial} />);
  fireEvent.change(screen.getByTestId("aidt-field-idea"), { target: { value: "另一方案" } });
  expect(screen.queryByRole("link", { name: "打开原生 Design Workbench" })).toBeNull();
  expect(snapshot().fields.verificationQuestionConfirmed).toBe("");
});
