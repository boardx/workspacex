import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtSummaryChatContext } from "@/features/aidt/components/aidt-summary-chat-context";
import { AidtSummaryImport } from "@/features/aidt/components/aidt-summary-import";
import { useComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import type { AidtSummaryContext } from "@/features/aidt/lib/aidt-summary-context";
const mocks = vi.hoisted(() => ({ context: vi.fn(), load: vi.fn(), choices: vi.fn(), source: vi.fn() }));
vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: mocks.context }));
vi.mock("@/features/aidt/lib/aidt-summary-context", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-summary-context")>(), loadAidtSummaryContext: mocks.load }));
vi.mock("@/features/aidt/lib/aidt-summary-results", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-summary-results")>(), loadAidtSummaryChoices: mocks.choices, readAidtSummaryChoice: mocks.source }));
const scope = { projectId:"p",orgId:"o",userId:"u",sessionToken:"token",lifecycleKey:"life" };
const packet: AidtSummaryContext = { projectId:"p",readAt:"2026-11-16T00:00:00Z",trust:"untrusted-student-material",teacherComments:null,currentStages:[{stageId:1,revision:2,markdown:"学生的问题来源反思",truncated:false}],missingStages:[2],failedStages:[],historyRevisions:[{stageId:6,revision:1}],historyMarkdown:"旧返工：暂未决定",historyTruncated:false };
const choice = {kind:"message" as const,id:"ai",messageId:"ai",runId:"run-real-id",title:"真实AI消息",markdown:"<script>模型草稿</script>\n教师点评缺少来源。"};
function Composer() { const draft = useComposerDraft({ ...scope,threadId:"sum" }); return <textarea aria-label="原生输入框" value={draft.text} onChange={event=>draft.setText(event.currentTarget.value)} />; }
beforeEach(()=>{ vi.clearAllMocks(); sessionStorage.clear(); mocks.load.mockResolvedValue(packet); mocks.choices.mockResolvedValue({choices:[choice],truncated:false,artifactsUnavailable:false}); mocks.source.mockResolvedValue({choice,markdown:choice.markdown,immutableRevision:null}); });
it("loads actual material only on request and hands generation to the existing scoped composer without sending", async ()=>{
  const selected=vi.fn(); render(<><AidtSummaryChatContext scope={scope} threadId="sum" onSelectorChange={selected}/><Composer/></>);
  expect(mocks.load).not.toHaveBeenCalled(); expect(screen.getByTestId("aidt-summary-offer-request")).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"读取报告材料"}));
  await waitFor(()=>expect(selected).toHaveBeenLastCalledWith({schemaVersion:1,projectId:"p",purpose:"summary",stageRevisions:[{stageId:1,revision:2}],historyRevisions:[{stageId:6,revision:1}]})); expect(mocks.context).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("aidt-summary-offer-request"));
  expect((screen.getByLabelText("原生输入框") as HTMLTextAreaElement).value).toContain("第1步 V2");
  expect(screen.getByText(/请审阅并发送/)).toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledOnce();
});
it("preserves an occupied native composer and removes old material on identity changes", async ()=>{
  const view=render(<><AidtSummaryChatContext scope={scope} threadId="sum"/><Composer/></>);
  fireEvent.click(screen.getByRole("button",{name:"读取报告材料"})); await waitFor(()=>expect(screen.getByTestId("aidt-summary-offer-request")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("原生输入框"),{target:{value:"学生未发送原稿"}}); fireEvent.click(screen.getByTestId("aidt-summary-offer-request"));
  expect(screen.getByLabelText("原生输入框")).toHaveValue("学生未发送原稿"); expect(screen.getByText(/已有草稿，未覆盖/)).toBeInTheDocument();
  view.rerender(<AidtSummaryChatContext scope={{...scope,userId:"other"}} threadId="sum"/>);
  expect(screen.queryByTestId("aidt-summary-materials")).toBeNull(); expect(mocks.context).not.toHaveBeenCalled();
});
it("keeps reports unchanged through listing and selection, requires review, and appends against the newest manual edit",async()=>{
  const change=vi.fn(); const view=render(<AidtSummaryImport scope={scope} threadId="sum" value="原人工报告" onChange={change} readOnly={false}/>);
  fireEvent.click(screen.getByText("选择AI总结结果带入报告")); fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  const select=await screen.findByLabelText("选择要审阅的AI结果"); expect(change).not.toHaveBeenCalled();
  fireEvent.change(select,{target:{value:"message:ai"}}); const preview=await screen.findByTestId("aidt-summary-result-preview");
  expect(preview).toHaveTextContent("<script>模型草稿</script>"); expect(preview.querySelector("script")).toBeNull();
  expect(screen.getByTestId("aidt-summary-import-apply")).toBeDisabled(); expect(change).not.toHaveBeenCalled();
  view.rerender(<AidtSummaryImport scope={scope} threadId="sum" value="读取时继续修改的人工报告" onChange={change} readOnly={false}/>);
  fireEvent.click(screen.getByRole("checkbox",{name:"我已核对AI草稿、材料缺口与点评来源"})); fireEvent.click(screen.getByTestId("aidt-summary-import-apply"));
  expect(change).toHaveBeenCalledOnce(); expect(change.mock.calls[0]![0]).toMatch(/^读取时继续修改的人工报告\n\n## AI报告草稿/); expect(change.mock.calls[0]![0]).toContain("run-real-id");
  expect(screen.getByText(/请修改、核对来源后主动保存/)).toBeInTheDocument();
});
it("clears old choices on scope loss and ignores an old result which arrives after cancellation",async()=>{
  let finish!:(value:unknown)=>void; mocks.source.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const change=vi.fn();const view=render(<AidtSummaryImport scope={scope} threadId="sum" value="保留稿" onChange={change} readOnly={false}/>);
  fireEvent.click(screen.getByText("选择AI总结结果带入报告"));fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"),{target:{value:"message:ai"}});
  const signal=mocks.source.mock.calls[0]![3] as AbortSignal;
  view.rerender(<AidtSummaryImport scope={{...scope,sessionToken:"new"}} threadId="sum" value="保留稿" onChange={change} readOnly={false}/>);
  expect(signal.aborted).toBe(true);await act(async()=>finish({choice,markdown:choice.markdown,immutableRevision:null}));
  expect(screen.queryByTestId("aidt-summary-result-preview")).toBeNull();expect(change).not.toHaveBeenCalled();
});
