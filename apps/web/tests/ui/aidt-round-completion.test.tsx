import * as React from "react";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtRoundCompletion } from "@/features/aidt/components/aidt-round-completion";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { aidtRoundPayload, aidtRoundDigest, aidtRoundConfirmation, aidtRoundMissingOutput } from "@/features/aidt/lib/aidt-round-completion";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { useAidtSharedStages } from "@/features/aidt/lib/use-aidt-shared-stages";
import { confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";
import { confirmAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";

const initial = (): AidtUiStageDraft => ({ fields: { initial: "研究午休体验", rewrittenTheme: "理解赶课学生如何安排午休", whyWorthStudying: "想理解时间安排", problemSources: '["guess"]', sourceDetails: "目前只是猜测", problemReflectionConfirmed: "true" }, ideas: [], selectedIdeaId: "" });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });

function Harness({ success = true, readOnly = false }: { success?: boolean; readOnly?: boolean } = {}) {
  const [draft, setDraft] = React.useState(initial);
  const [saved, setSaved] = React.useState<AidtUiStageDraft | null>(null);
  const controller = { sourceStageRevisions: [], stages: {}, canSave: true, matchesServer: saved === draft, write: { phase: "idle" }, server: saved ? { revision: 2, content: { draft: saved } } : undefined,
    saveCurrent: async () => { if (success) setSaved(draft); },
  } as unknown as ReturnType<typeof useAidtSharedStages>;
  return <><AidtRoundCompletion projectId="group-a" step={AIDT_STEPS[0]} draft={draft} controller={controller} readOnly={readOnly} nextHref="/aidt/group-a?step=2" onConfirm={record => setDraft(old => ({ ...old, fields: { ...old.fields, roundCompletion: record } }))} />
    <button onClick={() => setDraft(old => ({ ...old, fields: { ...old.fields, rewrittenTheme: "重新聚焦研究方向" } }))}>修改学生稿</button></>;
}

it("continues only after student confirmation and a matching server receipt", async () => {
  render(<Harness />);
  expect(screen.queryByRole("link", { name: "继续第2步" })).toBeNull();
  const confirm = screen.getByRole("button", { name: "确认本轮成果并保存" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  expect(await screen.findByRole("link", { name: "继续第2步" })).toHaveAttribute("href", "/aidt/group-a?step=2");
  expect(screen.getByText("本轮成果已确认并保存")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "修改学生稿" }));
  expect(screen.queryByRole("link", { name: "继续第2步" })).toBeNull();
  expect(await screen.findByRole("button", { name: "确认本轮成果并保存" })).toBeVisible();
});

it("retains confirmation for retry after a failed save without exposing Continue", async () => {
  render(<Harness success={false} />);
  const confirm = screen.getByRole("button", { name: "确认本轮成果并保存" });
  await waitFor(() => expect(confirm).toBeEnabled()); fireEvent.click(confirm);
  expect(await screen.findByRole("button", { name: "重试保存确认" })).toBeEnabled();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("尚未保存");
});

it("does not allow a read-only participant to confirm", async () => {
  render(<Harness readOnly />);
  expect(screen.getByRole("button", { name: "确认本轮成果并保存" })).toBeDisabled();
  expect(screen.queryByRole("link")).toBeNull();
});

it("binds confirmation to the full student content, source versions, group and stage", async () => {
  const draft = initial(), refs = [{ stageId: 1, revision: 3 }];
  const digest = await aidtRoundDigest(aidtRoundPayload("a", 2, draft, refs));
  const confirmed = { ...draft, fields: { ...draft.fields, roundCompletion: aidtRoundConfirmation("a", 2, digest) } };
  expect(await aidtRoundDigest(aidtRoundPayload("a", 2, confirmed, refs))).toBe(digest);
  for (const payload of [aidtRoundPayload("b", 2, draft, refs), aidtRoundPayload("a", 3, draft, refs), aidtRoundPayload("a", 2, draft, [{ stageId: 1, revision: 4 }]), aidtRoundPayload("a", 2, { ...draft, fields: { ...draft.fields, sourceDetails: "改过来源" } }, refs)]) {
    expect(await aidtRoundDigest(payload)).not.toBe(digest);
  }
});

it("accepts explicit none before persona while keeping missing outputs incomplete", () => {
  expect(aidtRoundMissingOutput(1, initial())).toBeNull();
  expect(aidtRoundMissingOutput(1, { ...initial(), fields: {} })).not.toBeNull();
  const draft = { fields: { surpriseStatus: "none", surpriseConfirmed: "true", personaBehavior: "未知，需后续研究", hmw: "我们如何帮助赶课学生安排午休？" }, ideas: [], selectedIdeaId: "" };
  expect(aidtRoundMissingOutput(3, draft)).toBeNull();
  expect(aidtRoundMissingOutput(2, draft)).not.toBeNull();
  expect(aidtRoundMissingOutput(4, draft)).not.toBeNull();
  expect(aidtRoundMissingOutput(5, draft)).not.toBeNull();
  expect(aidtRoundMissingOutput(6, draft)).not.toBeNull();
});

it.each([4, 5])("requires the student's file review before confirming stage %i and resets it after a change", async stage => {
  let draft: AidtUiStageDraft = stage === 4 ? confirmAidtIdeaClassification({ fields: {}, ideas: [1, 2, 3].map(id => ({ id: String(id), title: `不同点子${id}`, description: "先试一种方法。再看使用反馈。", image: "data:image/png;base64,YQ==" })), selectedIdeaId: "1" }) : confirmAidtVerificationQuestion({ fields: { verificationQuestion: "能理解步骤吗", beforeTestBelief: "猜测能理解", verificationBasis: "未知", verificationLimits: "仅理解", version: "学生文字版本记录，未自动核验文件" }, ideas: [], selectedIdeaId: "" })!;
  const save = vi.fn();
  const controller = { sourceStageRevisions: [], stages: {}, canSave: true, matchesServer: false, write: { phase: "idle" }, saveCurrent: save } as unknown as ReturnType<typeof useAidtSharedStages>;
  const confirm = vi.fn();
  const view = () => <AidtRoundCompletion projectId="p" step={AIDT_STEPS[stage - 1]!} draft={draft} controller={controller} readOnly={false} nextHref="/next" onConfirm={confirm} />;
  const { rerender } = render(view());
  const button = screen.getByRole("button", { name: "确认本轮成果并保存" });
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(JSON.parse(confirm.mock.calls[0]![0])).toMatchObject({ stageId: stage, filesReviewed: true });
  expect(screen.queryByRole("link")).toBeNull();
  draft = { ...draft, fields: { ...draft.fields, extraStudentNote: "本轮内容改变" } }; rerender(view());
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(button).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it("keeps unfinished brainstorming but requires the chosen prototype idea to have a complete sheet", () => {
  const draft = confirmAidtIdeaClassification({ fields: {}, ideas: [...[1, 2, 3].map(id => ({ id: String(id), title: `点子${id}`, description: "说明做法。说明怎样帮助用户。", image: "data:image/png;base64,YQ==" })), { id: "later", title: "未完成的第四个点子", description: "待讨论" }], selectedIdeaId: "1" });
  expect(aidtRoundMissingOutput(4, draft)).toBeNull();
  expect(aidtRoundMissingOutput(4, { ...draft, selectedIdeaId: "later" })).not.toBeNull();
  const withDuplicate = { ...draft, ideas: [...draft.ideas.slice(0, 3), { ...draft.ideas[0]!, id: "later" }] };
  expect(aidtRoundMissingOutput(4, withDuplicate)).toBeNull();
});
