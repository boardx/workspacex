import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtSharedStagePanel } from "@/features/aidt/components/aidt-shared-stage-panel";
import { useAidtSharedStages } from "@/features/aidt/lib/use-aidt-shared-stages";
import { aidtUiReportMarkdown, emptyAidtUiDrafts, type AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedStage, AidtSaveStageInput } from "@/features/aidt/lib/live-aidt-stages";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), hydrate: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read, saveAidtStage: mocks.save }));
function fieldFor(stageId: number) { return stageId === 2 ? "guide" : stageId === 6 ? "feedback" : "initial"; }
function draft(text = "", stageId = 1) { return StageDraft.parse({ ...emptyAidtUiDrafts()[stageId]!, fields: { [fieldFor(stageId)]: text } }); }
function saved(text = "服务器问题", revision = 1, stageId = 1): AidtSharedStage { return { projectId: "project", stageId, revision, updatedBy: "student-b", updatedAt: "2026-11-15T00:00:00.000Z", content: { schemaVersion: 1, draft: draft(text, stageId) }, sourceStageRevisions: [] }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let exposed: ReturnType<typeof useAidtSharedStages>;
function Harness({ actor = "student-a", token = "token-a", life = "a", canWrite = true, initial = "本页学生问题", stageId = 1, enabled = true, reportInitial = null, localImage }: { actor?: string; token?: string; life?: string; canWrite?: boolean; initial?: string; stageId?: number; enabled?: boolean; reportInitial?: string | null; localImage?: string }) {
  const [state, setState] = React.useState<{ life: string; drafts: AidtUiDrafts }>({ life, drafts: { ...emptyAidtUiDrafts(), [stageId]: { ...draft(initial, stageId), ...(localImage ? { ideas: [{ id: "idea-local", title: "学生点子", description: "学生的点子说明", image: localImage }] } : {}) } } });
  const drafts = state.life === life ? state.drafts : emptyAidtUiDrafts();
  React.useEffect(() => { setState(old => old.life === life ? old : { life, drafts: emptyAidtUiDrafts() }); }, [life]);
  const [reportState, setReport] = React.useState<{ life: string; text: string | null }>({ life, text: reportInitial });
  const reportText = reportState.life === life ? reportState.text : null;
  React.useEffect(() => { setReport(old => old.life === life ? old : { life, text: null }); }, [life]);
  const c = useAidtSharedStages({ enabled, scope: { orgId: "org", projectId: "project", userId: actor, sessionToken: token }, lifecycleKey: life, stageId, drafts, canWrite, reportText, onHydrateReport: text => setReport({ life, text }), onHydrate: (id, restored) => { mocks.hydrate(id, restored); setState(old => ({ life, drafts: { ...(old.life === life ? old.drafts : emptyAidtUiDrafts()), [id]: restored } })); } });
  exposed = c;
  return <><label>学生本页内容<input aria-label="学生本页内容" disabled={!canWrite} value={drafts[stageId]!.fields[fieldFor(stageId)] ?? ""} onChange={event => { const value = event.currentTarget.value; setState(old => ({ life, drafts: { ...old.drafts, [stageId]: { ...old.drafts[stageId]!, fields: { ...old.drafts[stageId]!.fields, [fieldFor(stageId)]: value } } } })); }} /></label><output data-testid="full-drafts">{JSON.stringify(drafts)}</output><label>本页报告<textarea aria-label="本页报告" disabled={!canWrite} value={reportText ?? ""} onChange={event => setReport({ life, text: event.currentTarget.value })} /></label><button disabled={!c.report.canSave} onClick={() => void c.report.save()} data-testid="save-report">保存报告</button><output data-testid="report-server">{c.report.serverMarkdown}</output><output data-testid="report-error">{c.report.error}{c.report.loadError}</output><AidtSharedStagePanel key={c.writeKey} controller={c} stageNumber={stageId} readOnly={!canWrite} /></>;
}
async function ready() { await waitFor(() => expect(exposed.read?.phase).toBe("ready")); }
function openDetails() { fireEvent.click(screen.getByTestId("aidt-shared-details").querySelector("summary")!); }
beforeEach(() => { mocks.read.mockReset(); mocks.save.mockReset(); mocks.hydrate.mockReset(); mocks.read.mockResolvedValue({ stage: null }); mocks.save.mockImplementation(async (input: AidtSaveStageInput) => ({ stage: { ...saved("", input.expectedRevision + 1, input.stageId), content: input.content, sourceStageRevisions: input.sourceStageRevisions }, replayed: false })); });

it("keeps unsaved content distinct and waits for a real server receipt", async () => {
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValue(pending.promise);
  render(<Harness />); await ready(); expect(screen.getByTestId("aidt-shared-status")).toHaveTextContent("尚未保存"); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("aidt-shared-save")); expect(screen.getByTestId("aidt-shared-save")).toBeDisabled(); expect(screen.queryByTestId("aidt-shared-receipt")).toBeNull();
  const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput;
  expect(request.expectedRevision).toBe(0); expect(request.content.draft.fields.initial).toBe("本页学生问题");
  await act(async () => pending.resolve({ stage: { ...saved(), content: request.content }, replayed: false }));
  expect(screen.getByTestId("aidt-shared-receipt")).toHaveTextContent("服务器已回执 V1"); expect(screen.getByTestId("aidt-shared-status")).toHaveTextContent("保存不代表小组确认或阶段完成");
});
it("recovers all six authorized saved stages into untouched empty forms on re-entry", async () => {
  mocks.read.mockImplementation(async (_project, id: number) => ({ stage: id === 1 || id === 2 ? saved(`保存的第${id}步`, 2, id) : null }));
  render(<Harness initial="" />); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("保存的第1步"));
  expect(screen.getByTestId("full-drafts")).toHaveTextContent("保存的第2步"); expect(mocks.save).not.toHaveBeenCalled(); expect(screen.getByTestId("aidt-shared-status")).toHaveTextContent("小组已保存 · V2");
});
it("does not replace edits made while the initial read is pending, even after text is cleared", async () => {
  const pending = deferred<{ stage: AidtSharedStage | null }>(); mocks.read.mockImplementation((_p, id) => id === 1 ? pending.promise : Promise.resolve({ stage: null }));
  render(<Harness initial="" />); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "刚输入" } }); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "" } });
  await act(async () => pending.resolve({ stage: saved() })); await ready(); expect(screen.getByLabelText("学生本页内容")).toHaveValue(""); expect(exposed.server?.revision).toBe(1);
});
it("does not overwrite a nonempty local draft on load or refresh; restore is deliberate and cancelable", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved() : null })); render(<Harness />); await ready();
  expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题"); openDetails(); fireEvent.click(screen.getByTestId("aidt-shared-restore")); fireEvent.click(screen.getByText("取消")); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题");
  fireEvent.click(screen.getByTestId("aidt-shared-restore")); fireEvent.click(screen.getByTestId("aidt-shared-restore-confirm")); expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器问题");
});
it("preserves edits made while saving without marking the new text saved", async () => {
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValue(pending.promise); render(<Harness />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save"));
  const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput; fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "保存途中继续写" } });
  await act(async () => pending.resolve({ stage: { ...saved(), content: request.content }, replayed: false })); expect(screen.getByLabelText("学生本页内容")).toHaveValue("保存途中继续写"); expect(screen.getByTestId("aidt-shared-receipt")).toHaveTextContent("当前新修改尚未保存");
});
it("retains local work on uncertain failure and reuses the operation ID for an identical retry", async () => {
  mocks.save.mockRejectedValueOnce(new Error("network")); render(<Harness />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-save-error");
  const first = mocks.save.mock.calls[0]![0] as AidtSaveStageInput; fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); const second = mocks.save.mock.calls[1]![0] as AidtSaveStageInput; expect(second.operationId).toBe(first.operationId); expect(second.content).toEqual(first.content);
});
it("detects CAS conflict, reads the actual server version and requires deliberate rebase before saving", async () => {
  let current = saved("成员B的稿", 1); mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? current : null }));
  mocks.save.mockRejectedValueOnce(new ApiError(409, "AIDT_STAGE_REVISION_CONFLICT", {})); render(<Harness />); await ready(); current = saved("成员B更新后的稿", 2);
  fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-conflict"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题"); expect(screen.getByTestId("aidt-shared-save")).toBeDisabled();
  openDetails(); expect(screen.getByTestId("aidt-shared-server-preview")).toHaveTextContent("成员B更新后的稿"); fireEvent.click(screen.getByTestId("aidt-shared-use-server-base")); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题");
  fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); expect((mocks.save.mock.calls[1]![0] as AidtSaveStageInput).expectedRevision).toBe(2);
});
it("treats load failure as failure instead of an empty group and disables writes until a successful retry", async () => {
  mocks.read.mockRejectedValue(new Error("503")); render(<Harness />); await screen.findByTestId("aidt-shared-load-error"); expect(screen.getByTestId("aidt-shared-save")).toBeDisabled(); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题");
  mocks.read.mockResolvedValue({ stage: null }); fireEvent.click(screen.getByTestId("aidt-shared-reload")); await ready(); expect(screen.getByTestId("aidt-shared-save")).toBeEnabled();
});
it("keeps local work and blocks saving if the conflict readback fails", async () => {
  render(<Harness />); await ready(); mocks.save.mockRejectedValueOnce(new ApiError(409, "AIDT_STAGE_REVISION_CONFLICT", {})); mocks.read.mockRejectedValue(new Error("503"));
  fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-load-error"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题"); expect(screen.getByTestId("aidt-shared-save")).toBeDisabled();
});
it("records only explicit actually saved earlier-stage revisions as provenance", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved("前序主题", 3) : null })); render(<Harness stageId={2} />); await ready(); openDetails();
  expect(exposed.sourceStageRevisions).toEqual([]); fireEvent.click(screen.getByTestId("aidt-shared-source-1")); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); expect((mocks.save.mock.calls[0]![0] as AidtSaveStageInput).sourceStageRevisions).toEqual([{ stageId: 1, revision: 3 }]);
});
it("does not revive a late A read after A to B to A", async () => {
  const pending = deferred<{ stage: AidtSharedStage | null }>(); let count = 0; mocks.read.mockImplementation((_p, id) => id === 1 && ++count === 1 ? pending.promise : Promise.resolve({ stage: null }));
  const view = render(<Harness initial="" />); const stale = exposed.restoreServer; view.rerender(<Harness actor="student-b" life="b" initial="" />); await ready(); view.rerender(<Harness initial="" />); await ready();
  fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "返回A后的新稿" } }); await act(async () => pending.resolve({ stage: saved("过期A稿", 9) })); act(() => stale());
  expect(screen.getByLabelText("学生本页内容")).toHaveValue("返回A后的新稿"); expect(exposed.server).toBeUndefined();
});
it("ignores an old save receipt across actor ABA and preserves the returning actor's new draft", async () => {
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValue(pending.promise); const view = render(<Harness />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save"));
  view.rerender(<Harness actor="student-b" life="b" />); await ready(); view.rerender(<Harness />); await ready(); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "返回后的新稿" } });
  await act(async () => pending.resolve({ stage: saved("旧保存回执"), replayed: false })); expect(screen.queryByTestId("aidt-shared-receipt")).toBeNull(); expect(screen.getByLabelText("学生本页内容")).toHaveValue("返回后的新稿");
});
it("retains the same student's current draft across token refresh while reading authorized state again", async () => {
  const view = render(<Harness />); await ready(); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "刷新token之前写的稿" } }); view.rerender(<Harness token="token-new" />); await ready(); expect(screen.getByLabelText("学生本页内容")).toHaveValue("刷新token之前写的稿"); expect(mocks.read.mock.calls.some(call => call[2] === "token-new")).toBe(true);
});
it("can read server content in read-only mode but offers no restore/save/selection mutation", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved() : null })); render(<Harness canWrite={false} initial="" />); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器问题")); expect(screen.queryByTestId("aidt-shared-save")).toBeNull(); act(() => { exposed.restoreServer(); void exposed.saveCurrent(); }); expect(mocks.save).not.toHaveBeenCalled();
});
it("does no reads or writes while the module is disabled", async () => {
  render(<Harness enabled={false} />); expect(screen.getByTestId("aidt-shared-unavailable")).toBeVisible(); act(() => { void exposed.saveCurrent(); }); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("refreshes a clean previously saved form to a newer member version", async () => {
  let current = saved("组内版本一", 1); mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? current : null })); render(<Harness initial="" />); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("组内版本一"));
  current = saved("组内版本二", 2); fireEvent.click(screen.getByTestId("aidt-shared-reload")); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("组内版本二"));
});
it("preserves deliberately cleared content on refresh and token refresh", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved() : null })); const view = render(<Harness initial="" />); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器问题"));
  fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "" } }); fireEvent.click(screen.getByTestId("aidt-shared-reload")); await ready(); expect(screen.getByLabelText("学生本页内容")).toHaveValue(""); view.rerender(<Harness initial="" token="refreshed" />); await ready(); expect(screen.getByLabelText("学生本页内容")).toHaveValue("");
});
it("keeps discovery cards and source references intact in the shared save request", async () => {
  const cards = [{ id: "card-a", participantCode: "访谈A", headline: "学生概括", headlineKind: "student-summary" as const, context: "课堂观察", quote: "", sourceRef: "访谈A录音", photoRef: "已上传照片引用" }];
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 2 ? { ...saved("访谈提纲", 1, 2), content: { schemaVersion: 1, draft: { ...draft("访谈提纲", 2), discoveryCards: cards } }, sourceStageRevisions: [{ stageId: 1, revision: 2 }] } : null }));
  render(<Harness initial="" stageId={2} />); await ready(); await waitFor(() => expect(screen.getByTestId("full-drafts")).toHaveTextContent("访谈A")); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "修订提纲" } }); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt");
  const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput; expect(request.content.draft.discoveryCards).toEqual(cards); expect(request.sourceStageRevisions).toEqual([{ stageId: 1, revision: 2 }]);
});
it("releases the old in-flight guard on actor changes, allowing the new actor to save without the stale receipt", async () => {
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValueOnce(pending.promise); const view = render(<Harness />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save"));
  view.rerender(<Harness actor="student-b" life="b" />); await ready(); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "B的稿" } }); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1]![1]).toBe("token-a");
  await act(async () => pending.resolve({ stage: saved("旧A稿", 9), replayed: false })); expect(screen.getByTestId("aidt-shared-receipt")).toHaveTextContent("V1"); expect(screen.getByTestId("aidt-shared-receipt")).not.toHaveTextContent("V9"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("B的稿");
});
function withReport(markdown = "服务器小组报告", revision = 3) { return { ...saved("服务器已保存测试反馈", revision, 6), content: { schemaVersion: 1 as const, draft: draft("服务器已保存测试反馈", 6), summaryReport: { markdown, sourceStageRevisions: [{ stageId: 1, revision: 1 }] } }, sourceStageRevisions: [{ stageId: 1, revision: 1 }] }; }
it("does not relabel a retained old report as using a newer fifth-stage revision after refresh and editing", async () => {
  let prototype = { ...saved("", 1, 5), content: { schemaVersion: 1 as const, draft: { ...emptyAidtUiDrafts()[5]!, fields: { version: "prototype-v1", verificationQuestion: "旧验证问题" } } } };
  const original = withReport("# 学生原有报告\n这份正文只讨论 prototype-v1 和旧验证问题。", 3);
  original.content.summaryReport.sourceStageRevisions = [{ stageId: 5, revision: 1 }];
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 5 ? prototype : id === 6 ? original : null }));
  render(<Harness stageId={6} initial="" />); await ready();
  await waitFor(() => expect(screen.getByLabelText("本页报告")).toHaveValue(original.content.summaryReport.markdown));
  await waitFor(() => expect(screen.getByTestId("full-drafts")).toHaveTextContent("prototype-v1"));
  prototype = { ...prototype, revision: 2, content: { schemaVersion: 1, draft: { ...prototype.content.draft, fields: { version: "prototype-v2", verificationQuestion: "新版完全不同的问题" } } } };
  act(() => exposed.reload()); await ready();
  await waitFor(() => expect(screen.getByTestId("full-drafts")).toHaveTextContent("prototype-v2"));
  expect(screen.getByLabelText("本页报告")).toHaveValue(original.content.summaryReport.markdown);
  const edited = `${original.content.summaryReport.markdown}\n学生保留旧正文，只补充写作说明。`;
  fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: edited } });
  fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput;
  expect(request.content.summaryReport?.markdown).toBe(edited);
  expect(request.content.summaryReport?.sourceStageRevisions).toEqual([{ stageId: 5, revision: 1 }]);
  expect(request.content.summaryReport?.sourceStageRevisions).not.toContainEqual({ stageId: 5, revision: 2 });
});
it("freezes a generated report's sources through stage changes and historical append, then refreshes them only when students replace the report with current assembly", async () => {
  let prototype: AidtSharedStage = { ...saved("", 1, 5), content: { schemaVersion: 1, draft: { ...emptyAidtUiDrafts()[5]!, fields: { version: "first-prototype", verificationQuestion: "第一版验证问题" } } } };
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 5 ? prototype : id === 6 ? saved("测试反馈", 1, 6) : null }));
  render(<Harness stageId={6} initial="" />); await ready();
  await waitFor(() => expect(screen.getByTestId("full-drafts")).toHaveTextContent("first-prototype"));
  const original = aidtUiReportMarkdown(JSON.parse(screen.getByTestId("full-drafts").textContent!) as AidtUiDrafts);
  fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: original } });
  prototype = { ...prototype, revision: 2, content: { schemaVersion: 1, draft: { ...prototype.content.draft, fields: { version: "second-prototype", verificationQuestion: "第二版验证问题" } } } };
  act(() => exposed.reload()); await ready();
  await waitFor(() => expect(screen.getByTestId("full-drafts")).toHaveTextContent("second-prototype"));
  const appended = `${original}\n\n## 历史学习追溯\n第6步 V1；缺失仍待核对。`;
  fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: appended } });
  fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.matchesServer).toBe(true));
  const first = mocks.save.mock.calls[0]![0] as AidtSaveStageInput;
  expect(first.content.summaryReport?.markdown).toBe(appended);
  expect(first.content.summaryReport?.sourceStageRevisions).toContainEqual({ stageId: 5, revision: 1 });
  expect(first.content.summaryReport?.sourceStageRevisions).not.toContainEqual({ stageId: 5, revision: 2 });
  const regenerated = aidtUiReportMarkdown(JSON.parse(screen.getByTestId("full-drafts").textContent!) as AidtUiDrafts);
  fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: regenerated } });
  fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  const second = mocks.save.mock.calls[1]![0] as AidtSaveStageInput;
  expect(second.content.summaryReport?.markdown).toBe(regenerated);
  expect(second.content.summaryReport?.sourceStageRevisions).toContainEqual({ stageId: 5, revision: 2 });
  expect(second.content.summaryReport?.sourceStageRevisions).not.toContainEqual({ stageId: 5, revision: 1 });
});
it("does not infer current saved sources for an unknown initial handwritten report", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 5 ? saved("不同的新原型", 2, 5) : null }));
  render(<Harness stageId={6} reportInitial="来源未知的手写旧报告；不得自动认领当前原型" />); await ready();
  fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect((mocks.save.mock.calls[0]![0] as AidtSaveStageInput).content.summaryReport?.sourceStageRevisions).toEqual([]);
});
it("retains the manuscript's original sources after conflict review instead of adopting the other writer's new report sources", async () => {
  let current = withReport("原来的报告", 3); current.content.summaryReport.sourceStageRevisions = [{ stageId: 5, revision: 1 }];
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 6 ? current : null }));
  render(<Harness stageId={6} initial="" />); await ready();
  await waitFor(() => expect(screen.getByLabelText("本页报告")).toHaveValue("原来的报告"));
  fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: "保留原来的报告，加学生说明" } });
  current = withReport("另一位同学新报告", 4); current.content.summaryReport.sourceStageRevisions = [{ stageId: 5, revision: 2 }];
  mocks.save.mockRejectedValueOnce(new ApiError(409, "AIDT_STAGE_REVISION_CONFLICT", {}));
  fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.conflict).toBe(true));
  act(() => exposed.report.reviewBase()); fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  const request = mocks.save.mock.calls[1]![0] as AidtSaveStageInput;
  expect(request.expectedRevision).toBe(4);
  expect(request.content.summaryReport?.markdown).toBe("保留原来的报告，加学生说明");
  expect(request.content.summaryReport?.sourceStageRevisions).toEqual([{ stageId: 5, revision: 1 }]);
});
it("restores the actual group report on re-entry without inventing a report from missing stages", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 6 ? withReport() : null })); render(<Harness initial="" stageId={6} />); await ready(); await waitFor(() => expect(screen.getByLabelText("本页报告")).toHaveValue("服务器小组报告")); expect(exposed.report.matchesServer).toBe(true); expect(exposed.report.serverRevision).toBe(3); expect(exposed.report.sourceStageRevisions).toEqual([{ stageId: 1, revision: 1 }]); expect(mocks.save).not.toHaveBeenCalled();
});
it("does not overwrite report edits made while loading, including an intentionally cleared report", async () => {
  const pending = deferred<{ stage: AidtSharedStage | null }>(); mocks.read.mockImplementation((_p, id) => id === 6 ? pending.promise : Promise.resolve({ stage: null })); render(<Harness initial="" stageId={6} />);
  fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: "先写" } }); fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: "" } }); await act(async () => pending.resolve({ stage: withReport() })); await ready(); expect(screen.getByLabelText("本页报告")).toHaveValue(""); expect(exposed.report.serverMarkdown).toBe("服务器小组报告");
});
it("saves edited report with the server stage6 draft, preserving unsaved stage6 form locally", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 6 ? withReport() : null })); render(<Harness initial="本页尚未保存测试反思" stageId={6} reportInitial="学生修改后的报告" />); await ready(); fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.matchesServer).toBe(true));
  const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput; expect(request.expectedRevision).toBe(3); expect(request.content.draft.fields.feedback).toBe("服务器已保存测试反馈"); expect(request.content.summaryReport?.markdown).toBe("学生修改后的报告"); expect(request.content.summaryReport?.sourceStageRevisions).toEqual([]); expect(request.sourceStageRevisions).toEqual([{ stageId: 1, revision: 1 }]); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页尚未保存测试反思");
});
it("preserves the saved report when saving the normal stage6 form", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 6 ? withReport() : null })); render(<Harness initial="新测试反思" stageId={6} />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput; expect(request.content.summaryReport).toEqual(withReport().content.summaryReport); expect(request.content.draft.fields.feedback).toBe("新测试反思");
});
it("uses an empty stage6 container if no stage6 draft exists, never auto-saving its local form with the report", async () => {
  render(<Harness stageId={6} reportInitial="一组一份研究报告" initial="不应被连带保存" />); await ready(); fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.matchesServer).toBe(true)); const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput; expect(request.expectedRevision).toBe(0); expect(request.content.draft).toEqual(emptyAidtUiDrafts()[6]); expect(request.content.summaryReport?.markdown).toBe("一组一份研究报告"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("不应被连带保存");
});
it("reuses the exact operation for an uncertain report retry and keeps edits typed during save", async () => {
  mocks.save.mockRejectedValueOnce(new Error("network")); render(<Harness stageId={6} reportInitial="本页报告初稿" />); await ready(); fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.error).not.toBeNull()); const first = mocks.save.mock.calls[0]![0] as AidtSaveStageInput;
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByTestId("save-report")); const second = mocks.save.mock.calls[1]![0] as AidtSaveStageInput; expect(second.operationId).toBe(first.operationId); expect(second.content).toEqual(first.content); fireEvent.change(screen.getByLabelText("本页报告"), { target: { value: "保存过程中再编辑的报告" } }); await act(async () => pending.resolve({ stage: { ...withReport(), content: second.content }, replayed: true })); expect(screen.getByLabelText("本页报告")).toHaveValue("保存过程中再编辑的报告"); expect(exposed.report.matchesServer).toBe(false);
});
it("retains a conflicting report, presents the real server version and saves only after explicit review", async () => {
  let current = withReport("同学B的报告", 3); mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 6 ? current : null })); mocks.save.mockRejectedValueOnce(new ApiError(409, "AIDT_STAGE_REVISION_CONFLICT", {})); render(<Harness stageId={6} reportInitial="本页学生的报告" />); await ready(); current = withReport("同学B新报告", 4); fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.conflict).toBe(true)); expect(exposed.report.serverMarkdown).toBe("同学B新报告"); expect(screen.getByLabelText("本页报告")).toHaveValue("本页学生的报告"); expect(screen.getByTestId("save-report")).toBeDisabled(); act(() => exposed.report.reviewBase()); fireEvent.click(screen.getByTestId("save-report")); await waitFor(() => expect(exposed.report.matchesServer).toBe(true)); expect((mocks.save.mock.calls[1]![0] as AidtSaveStageInput).expectedRevision).toBe(4);
});
it("does not permit report saving/restoring in read-only or revive old report receipts across actor changes", async () => {
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValueOnce(pending.promise); const view = render(<Harness stageId={6} reportInitial="A的报告" />); await ready(); fireEvent.click(screen.getByTestId("save-report")); view.rerender(<Harness actor="student-b" life="b" stageId={6} canWrite={false} />); await ready(); act(() => { exposed.report.restore(); void exposed.report.save(); }); await act(async () => pending.resolve({ stage: withReport("旧A的报告", 9), replayed: false })); expect(screen.getByLabelText("本页报告")).toHaveValue(""); expect(exposed.report.serverRevision).toBeNull(); expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("rejects local embedded image previews before sending without dropping or relabelling the student's draft", async () => {
  render(<Harness stageId={4} localImage="data:image/png;base64,not-uploaded" />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-save-error"); expect(mocks.save).not.toHaveBeenCalled(); expect(screen.getByTestId("full-drafts")).toHaveTextContent("data:image/png;base64,not-uploaded"); expect(screen.queryByTestId("aidt-shared-receipt")).toBeNull();
});
it("can explicitly save a deliberately cleared existing stage without treating it as a new untouched empty stage", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved() : null })); render(<Harness initial="" />); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器问题")); fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "" } }); expect(screen.getByTestId("aidt-shared-save")).toBeEnabled(); fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); expect((mocks.save.mock.calls[0]![0] as AidtSaveStageInput).content.draft.fields.initial).toBe(""); expect((mocks.save.mock.calls[0]![0] as AidtSaveStageInput).expectedRevision).toBe(1);
});
it("does not re-hydrate unchanged saved forms on refresh or manufacture a local stage revision", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved() : null })); render(<Harness initial="" reportInitial="学生正在写自己的报告" />); await ready(); await waitFor(() => expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器问题")); mocks.hydrate.mockClear();
  fireEvent.click(screen.getByTestId("aidt-shared-reload")); await ready(); expect(mocks.hydrate).not.toHaveBeenCalled(); expect(screen.getByLabelText("本页报告")).toHaveValue("学生正在写自己的报告");
});
it("retains each step's unsaved source choices when editing sources in another step then returning", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved("前序主题", 2) : null })); const view = render(<Harness stageId={2} />); await ready(); openDetails(); fireEvent.click(screen.getByTestId("aidt-shared-source-1")); expect(screen.getByTestId("aidt-shared-source-1")).toBeChecked();
  view.rerender(<Harness stageId={3} />); openDetails(); fireEvent.click(screen.getByTestId("aidt-shared-source-1")); view.rerender(<Harness stageId={2} />); openDetails(); expect(screen.getByTestId("aidt-shared-source-1")).toBeChecked(); expect(exposed.sourceStageRevisions).toEqual([{ stageId: 1, revision: 2 }]); expect(mocks.save).not.toHaveBeenCalled();
});
it("keeps the same student's pending source choices across token refresh", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved("前序主题", 2) : null })); const view = render(<Harness stageId={2} />); await ready(); openDetails(); fireEvent.click(screen.getByTestId("aidt-shared-source-1")); view.rerender(<Harness stageId={2} token="refreshed-token" />); await ready(); openDetails(); expect(screen.getByTestId("aidt-shared-source-1")).toBeChecked(); expect(exposed.sourceStageRevisions).toEqual([{ stageId: 1, revision: 2 }]);
});
it("does not revive the previous actor lifecycle's source choices on A to B to A", async () => {
  mocks.read.mockImplementation(async (_p, id) => ({ stage: id === 1 ? saved("前序主题", 2) : null })); const view = render(<Harness stageId={2} />); await ready(); openDetails(); fireEvent.click(screen.getByTestId("aidt-shared-source-1")); view.rerender(<Harness stageId={2} actor="student-b" life="b" />); await ready(); expect(exposed.sourceStageRevisions).toEqual([]); view.rerender(<Harness stageId={2} />); await ready(); openDetails(); expect(screen.getByTestId("aidt-shared-source-1")).not.toBeChecked(); expect(exposed.sourceStageRevisions).toEqual([]);
});
it("does not leave a stage permanently saving after navigating away during save then returning", async () => {
  const pending = deferred<{ stage: AidtSharedStage; replayed: boolean }>(); mocks.save.mockReturnValueOnce(pending.promise); const view = render(<Harness />); await ready(); fireEvent.click(screen.getByTestId("aidt-shared-save")); const request = mocks.save.mock.calls[0]![0] as AidtSaveStageInput;
  view.rerender(<Harness stageId={2} />); view.rerender(<Harness stageId={1} />); expect(screen.getByLabelText("学生本页内容")).toHaveValue("本页学生问题"); expect(screen.getByTestId("aidt-shared-save")).toBeEnabled(); expect(screen.getByTestId("aidt-shared-save-error")).toHaveTextContent("未确认");
  fireEvent.click(screen.getByTestId("aidt-shared-save")); await screen.findByTestId("aidt-shared-receipt"); expect((mocks.save.mock.calls[1]![0] as AidtSaveStageInput).operationId).toBe(request.operationId); await act(async () => pending.resolve({ stage: saved("旧请求", 9), replayed: false })); expect(screen.getByTestId("aidt-shared-receipt")).not.toHaveTextContent("V9");
});
