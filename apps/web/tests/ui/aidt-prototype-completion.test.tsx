import { StageDraft } from "@repo/contracts/aidt-stages";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtPrototypeEntityOutput } from "@/features/aidt/components/aidt-prototype-handoff";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { useAidtConfirmedStages } from "@/features/aidt/lib/use-aidt-confirmed-stages";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { confirmAidtPrototypeHandoff, updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { readyFormalPrototypeFixture, storeFormalPrototypeFixture } from "../aidt-round-fixture-independent-qa";
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => undefined }));
vi.mock("@/features/aidt/components/aidt-prototype-version-picker", () => ({ AidtPrototypeVersionPicker: () => null }));
function stage(stageId: number, draft: AidtUiStageDraft): AidtSharedStage {
  return { projectId: "project", stageId, revision: 1, sourceStageRevisions: [], content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, updatedBy: "student", updatedAt: "2026-11-21T00:00:00Z" };
}
const ready = (id: string) => readyFormalPrototypeFixture({ projectId: "project", designId: id, sourceRevision: 1,
  fields: { verificationQuestion: "能否理解差别？", beforeTestBelief: "也许可以", verificationBasis: "尚无证据", verificationLimits: "静态理解", type: "静态图", situation: "午休", task: "比较两款" },
  reference: { designId: id, versionId: "v1", designName: id, createdAt: "2026-11-21T00:00:00Z", seq: 1, summary: "并排对比", frameCount: 2, generatedFrameCount: 2, source: "model" } });
const ideas = ready("A").sourceStage;
const candidate = (id: string) => ready(id).draft;

it("selects the current prototype through the existing confirmation action, persists it, and does not select a candidate merely by opening it", async () => {
  let receipt: AidtSharedStage | undefined;
  let initial = storeFormalPrototypeFixture(emptyAidtUiDrafts()[5]!, "A", candidate("A"));
  initial = storeFormalPrototypeFixture(initial, "B", confirmAidtPrototypeHandoff(candidate("B"))!);
  function Host({ id, restored }: { id: string; restored?: AidtSharedStage }) {
    const [draft, update] = React.useState(restored?.content.draft ?? initial);
    const [saved, setSaved] = React.useState(restored ?? stage(5, initial));
    const stages = React.useMemo(() => ({ 5: saved }), [saved]);
    const completed = useAidtConfirmedStages(stages, "project");
    return <><AidtDashboard href={step => `/aidt/project?step=${step}`} completed={completed} shared={{ phase: "ready", stages }} drafts={{ ...emptyAidtUiDrafts(), 5: draft }} />
      <AidtPrototypeEntityOutput projectId="project" designId={id} stageDraft={draft} update={update} readOnly={false} workflow={{ ideas, savedPrototype: saved, matchesServer: draft === saved.content.draft }} />
      <button onClick={() => { receipt = { ...saved, revision: saved.revision + 1, content: { ...saved.content, draft: StageDraft.parse(draft) } }; setSaved(receipt); update(receipt.content.draft); }}>保存到小组</button></>;
  }
  const view = render(<Host id="A" />);
  fireEvent.click(screen.getByRole("button", { name: "确认所选原型" }));
  expect(screen.queryByRole("link", { name: "带入测试与迭代" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存到小组" }));
  expect(await screen.findByText("已完成 · V2")).toBeVisible();
  expect(receipt?.content.draft.fields.prototypeHandoffEntity).toBe("A");
  view.rerender(<Host id="B" />);
  expect(screen.getByRole("button", { name: "确认所选原型" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "带入测试与迭代" })).toBeNull();
  expect(receipt?.content.draft.fields.prototypeHandoffEntity).toBe("A");
  fireEvent.click(screen.getByRole("button", { name: "确认所选原型" }));
  fireEvent.click(screen.getByRole("button", { name: "保存到小组" }));
  await waitFor(() => expect(receipt?.content.draft.fields.prototypeHandoffEntity).toBe("B"));
  expect(await screen.findByText("已完成 · V3")).toBeVisible();
  expect(screen.getByRole("link", { name: "带入测试与迭代" })).toHaveAttribute("href", expect.stringContaining("prototypeEntity=B"));
  view.unmount();
  render(<Host id="B" restored={structuredClone(receipt)} />);
  expect(await screen.findByText("已完成 · V3")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "用户需要完成的任务" }), { target: { value: "修改后的任务" } });
  fireEvent.click(screen.getByRole("button", { name: "保存到小组" }));
  await waitFor(() => expect(screen.getByTestId("aidt-stage-save-5")).toHaveTextContent("已保存草稿 · V4"));
  expect(screen.queryByRole("link", { name: "带入测试与迭代" })).toBeNull();
});

it("persists a large but valid prototype without overflowing the card record on confirmation", async () => {
  const { confirmAidtPrototypeEntityHandoff, listAidtConfirmedPrototypeEntities } = await import("@/features/aidt/lib/aidt-prototype-handoff");
  const id = "large";
  const initial = storeFormalPrototypeFixture(emptyAidtUiDrafts()[5]!, id, candidate(id));
  const key = `prototypeEntity:${id}`;
  const raw = JSON.parse(initial.fields[key]!);
  const length = 5990 - JSON.stringify({ ...raw, padding: "" }).length;
  const input = StageDraft.parse({ ...initial, fields: { ...initial.fields, [key]: JSON.stringify({ ...raw, padding: "字".repeat(length) }) } });

  const saved = StageDraft.parse(confirmAidtPrototypeEntityHandoff(input, id));
  expect(saved.fields.prototypeHandoffEntity).toBe(id);
  expect(listAidtConfirmedPrototypeEntities(saved).map(item => item.id)).toEqual([id]);
});
