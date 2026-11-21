import * as React from "react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { AidtRoundCompletion } from "@/features/aidt/components/aidt-round-completion";
import { useAidtConfirmedStages } from "@/features/aidt/lib/use-aidt-confirmed-stages";
import { aidtRoundConfirmation, aidtRoundDigest, aidtRoundPayload } from "@/features/aidt/lib/aidt-round-completion";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import type { useAidtSharedStages } from "@/features/aidt/lib/use-aidt-shared-stages";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { ApiError } from "@/lib/api-client";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), search: "", list: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-test", userId: "student-test", sessionToken: "token-test" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => <div /> }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/lib/live-aidt-stages", async original => ({ ...await original<typeof import("@/features/aidt/lib/live-aidt-stages")>(), readAidtStage: mocks.read, saveAidtStage: mocks.save }));

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.clearAllMocks();
  mocks.search = "";
  mocks.read.mockResolvedValue({ stage: null });
  mocks.list.mockResolvedValue({ items: [] });
});
afterEach(() => vi.unstubAllGlobals());

function stage(stageId = 1, revision = 1, projectId = "group-test"): AidtSharedStage {
  const draft = emptyAidtUiDrafts()[stageId]!;
  return SharedStage.parse({ projectId, stageId, revision, content: { schemaVersion: 1, draft: { ...draft, fields: { initial: "学生提出的研究问题" } } }, sourceStageRevisions: [], updatedBy: "student-test", updatedAt: "2026-11-21T00:00:00.000Z" });
}
async function confirm(saved: AidtSharedStage): Promise<AidtSharedStage> {
  const digest = await aidtRoundDigest(aidtRoundPayload(saved.projectId, saved.stageId, saved.content.draft, saved.sourceStageRevisions));
  return { ...saved, content: { ...saved.content, draft: { ...saved.content.draft, fields: { ...saved.content.draft.fields, roundCompletion: aidtRoundConfirmation(saved.projectId, saved.stageId, digest, saved.stageId === 4 || saved.stageId === 5) } } } };
}
function matchingDrafts(stages: Record<number, AidtSharedStage>): AidtUiDrafts {
  return { ...emptyAidtUiDrafts(), ...Object.fromEntries(Object.values(stages).map(saved => [saved.stageId, structuredClone(saved.content.draft)])) };
}
function Dashboard({ stages, drafts = matchingDrafts(stages), scope = "group-test" }: { stages: Record<number, AidtSharedStage>; drafts?: AidtUiDrafts; scope?: string }) {
  const completed = useAidtConfirmedStages(stages, scope);
  return <AidtDashboard href={id => `/aidt/${scope}?step=${id}`} drafts={drafts} completed={completed} shared={{ phase: "ready", stages }} />;
}

it("does not skip a saved but unconfirmed step when choosing what to continue", async () => {
  const first = await confirm(stage(1)), second = stage(2), fifth = stage(5);
  render(<Dashboard stages={{ 1: first, 2: second, 5: fifth }} />);
  expect(await screen.findByText("已完成 · V1")).toBeVisible();
  expect(screen.getByTestId("aidt-stage-save-2")).toHaveTextContent("已保存草稿 · V1");
  expect(screen.getByTestId("aidt-stage-save-5")).toHaveAttribute("data-completed", "false");
  expect(screen.getByRole("link", { name: "继续第2步" })).toHaveAttribute("href", "/aidt/group-test?step=2");
});

it("shows all six persisted confirmations after re-entry and offers review instead of an unfinished step", async () => {
  const saved = await Promise.all(AIDT_STEPS.map(step => confirm(stage(step.id))));
  const stages = Object.fromEntries(saved.map(row => [row.stageId, row]));
  const view = render(<Dashboard stages={stages} />);
  await waitFor(() => expect(screen.getAllByText("已完成 · V1")).toHaveLength(6));
  expect(screen.getByRole("link", { name: "回顾成果" })).toHaveAttribute("href", "/aidt/group-test?step=6");
  expect(screen.queryByTestId("aidt-continue-task")).toBeNull();
  view.unmount();
  render(<Dashboard stages={structuredClone(stages)} />);
  await waitFor(() => expect(screen.getAllByText("已完成 · V1")).toHaveLength(6));
});

it("keeps the last confirmed revision visible while local changes wait for a fresh confirmation", async () => {
  const saved = await confirm(stage()), stages = { 1: saved }, drafts = matchingDrafts(stages);
  drafts[1]!.fields.initial = "修改后的问题";
  const view = render(<Dashboard stages={stages} drafts={drafts} />);
  expect(await screen.findByText("已确认 V1 · 有修改待确认")).toBeVisible();
  expect(screen.getByTestId("aidt-stage-save-1")).toHaveAttribute("data-completed", "false");
  expect(screen.getByRole("link", { name: "继续第1步" })).toHaveAttribute("href", "/aidt/group-test?step=1");
  expect(saved.content.draft.fields.initial).toBe("学生提出的研究问题");
  view.rerender(<Dashboard stages={stages} drafts={matchingDrafts(stages)} />);
  expect(await screen.findByText("已完成 · V1")).toBeVisible();
});

it.each(["content", "sources", "project", "stage"])("does not reuse an old confirmation after saved %s changes", async change => {
  const saved = await confirm(stage());
  if (change === "content") saved.content.draft.fields.initial = "保存后的新问题";
  if (change === "sources") saved.sourceStageRevisions = [{ stageId: 2, revision: 4 }];
  if (change === "project") saved.projectId = "another-group";
  if (change === "stage") saved.stageId = 2;
  render(<Dashboard stages={{ [saved.stageId]: saved }} scope={saved.projectId} />);
  await waitFor(() => expect(screen.queryByTestId("aidt-dashboard-confirmation-loading")).toBeNull());
  expect(screen.queryByText(/已完成|已确认 V/)).toBeNull();
  expect(screen.getByTestId(`aidt-stage-save-${saved.stageId}`)).toHaveTextContent("已保存草稿 · V1");
});

it("does not guess progress while confirmation verification is pending", () => {
  render(<AidtDashboard href={id => `/aidt/group-test?step=${id}`} completed={null} shared={{ phase: "ready", stages: { 1: stage() } }} />);
  expect(screen.getByTestId("aidt-dashboard-confirmation-loading")).toBeVisible();
  expect(screen.queryByTestId("aidt-continue-task")).toBeNull();
  expect(screen.queryByText(/已完成|已保存草稿/)).toBeNull();
});

it("does not claim completion or offer a next step when digest verification fails", async () => {
  const saved = await confirm(stage());
  const digest = vi.fn().mockRejectedValue(new Error("unavailable"));
  vi.stubGlobal("crypto", { subtle: { digest } });
  render(<Dashboard stages={{ 1: saved }} />);
  await waitFor(() => expect(digest).toHaveBeenCalledOnce());
  expect(screen.getByTestId("aidt-dashboard-confirmation-loading")).toBeVisible();
  expect(screen.queryByText(/已完成/)).toBeNull();
  expect(screen.queryByTestId("aidt-continue-task")).toBeNull();
});

it.each(["loading", "error"] as const)("never uses stale completion after a %s read", phase => {
  const reload = vi.fn();
  render(<AidtDashboard href={id => `/aidt/group-test?step=${id}`} completed={new Set([1])} shared={{ phase, stages: { 1: stage() }, error: "无权读取本组成果", reload }} />);
  expect(screen.queryByText(/已完成|已确认 V/)).toBeNull();
  expect(screen.queryByTestId("aidt-continue-task")).toBeNull();
  if (phase === "error") { fireEvent.click(screen.getByRole("button", { name: "重新读取成果" })); expect(reload).toHaveBeenCalledOnce(); }
});

function RoundAndDashboard({ initial, onSaved }: { initial: AidtSharedStage; onSaved: (saved: AidtSharedStage) => void }) {
  const [saved, setSaved] = React.useState(initial), [draft, setDraft] = React.useState(initial.content.draft);
  const stages = React.useMemo(() => ({ 1: saved }), [saved]);
  const c = { sourceStageRevisions: [], stages, canSave: true, matchesServer: saved.content.draft === draft, write: { phase: "idle" }, server: saved,
    saveCurrent: async () => { const next = { ...saved, revision: saved.revision + 1, content: { ...saved.content, draft } }; setSaved(next); onSaved(next); },
  } as unknown as ReturnType<typeof useAidtSharedStages>;
  return <><Dashboard stages={stages} drafts={{ ...matchingDrafts(stages), 1: draft }} /><AidtRoundCompletion projectId={saved.projectId} step={AIDT_STEPS[0]} draft={draft} controller={c} readOnly={false} nextHref="/aidt/group-test?step=2" onConfirm={record => setDraft(old => ({ ...old, fields: { ...old.fields, roundCompletion: record } }))} /></>;
}
it("updates the card only after the actual confirmation action is saved, and restores it on remount", async () => {
  const initial = stage();
  initial.content.draft.fields = { initial: "学生命题", rewrittenTheme: "理解赶课学生如何安排午休", whyWorthStudying: "理解时间安排", problemSources: '["guess"]', sourceDetails: "暂为猜测", problemReflectionConfirmed: "true" };
  const persisted = vi.fn();
  const view = render(<RoundAndDashboard initial={initial} onSaved={persisted} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "确认本轮成果并保存" })).toBeEnabled());
  expect(screen.queryByText(/已完成/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认本轮成果并保存" }));
  expect(await screen.findByText("已完成 · V2")).toBeVisible();
  expect(persisted).toHaveBeenCalledOnce();
  view.unmount();
  render(<Dashboard stages={{ 1: structuredClone(persisted.mock.calls[0]![0]) }} />);
  expect(await screen.findByText("已完成 · V2")).toBeVisible();
});

it("wires the real project parent, server read and confirmation hook into dashboard completion", async () => {
  const saved = await confirm(stage());
  mocks.read.mockImplementation(async (_project, id) => ({ stage: id === 1 ? saved : null }));
  render(<ProjectAidt projectId="group-test" sub="aidt" canWrite={false} />);
  expect(await screen.findByText("已完成 · V1")).toBeVisible();
  expect(screen.getByRole("link", { name: "继续第2步" })).toHaveAttribute("href", "/aidt/group-test?step=2");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not carry a confirmed card into another group or turn denied reads into completion", async () => {
  const saved = await confirm(stage());
  mocks.read.mockImplementation(async (_project, id) => ({ stage: id === 1 ? saved : null }));
  const view = render(<ProjectAidt projectId="group-test" sub="aidt" canWrite={false} />);
  expect(await screen.findByText("已完成 · V1")).toBeVisible();
  mocks.read.mockRejectedValue(new ApiError(403, "FORBIDDEN", {}));
  view.rerender(<ProjectAidt projectId="another-group" sub="aidt" canWrite={false} />);
  expect(screen.queryByText(/已完成/)).toBeNull();
  expect(await screen.findByTestId("aidt-dashboard-error")).toBeVisible();
  expect(screen.queryByTestId("aidt-continue-task")).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});
