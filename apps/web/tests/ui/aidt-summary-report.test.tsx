import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtSummaryChatContext } from "@/features/aidt/components/aidt-summary-chat-context";
import { AidtSummaryImport } from "@/features/aidt/components/aidt-summary-import";
import { useComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import type { AidtSummaryContext } from "@/features/aidt/lib/aidt-summary-context";
import { AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { useAidtSharedStages } from "@/features/aidt/lib/use-aidt-shared-stages";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSaveStageInput } from "@/features/aidt/lib/live-aidt-stages";
const mocks = vi.hoisted(() => ({ context: vi.fn(), load: vi.fn(), choices: vi.fn(), source: vi.fn(), readStage:vi.fn(), saveStage:vi.fn() }));
vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: mocks.context }));
vi.mock("@/features/aidt/lib/aidt-summary-context", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-summary-context")>(), loadAidtSummaryContext: mocks.load }));
vi.mock("@/features/aidt/lib/aidt-summary-results", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-summary-results")>(), loadAidtSummaryChoices: mocks.choices, readAidtSummaryChoice: mocks.source }));
vi.mock("@/features/aidt/lib/live-aidt-stages",()=>({readAidtStage:mocks.readStage,saveAidtStage:mocks.saveStage}));
const scope = { projectId:"p",orgId:"o",userId:"u",sessionToken:"token",lifecycleKey:"life" };
const packet: AidtSummaryContext = { projectId:"p",readAt:"2026-11-16T00:00:00Z",trust:"untrusted-student-material",teacherComments:null,currentStages:[{stageId:1,revision:2,markdown:"学生的问题来源反思",truncated:false}],missingStages:[2],failedStages:[],historyRevisions:[{stageId:6,revision:1}],historyMarkdown:"旧返工：暂未决定",historyTruncated:false };
const choice = {kind:"message" as const,id:"ai",messageId:"ai",runId:"run-real-id",title:"真实AI消息",markdown:"<script>模型草稿</script>\n教师点评缺少来源。"};
const receipt = AidtContextReceipt.parse({runId:choice.runId,projectId:"p",purpose:"summary",skillVersionId:"summary-version",snapshotHash:"a".repeat(64),preparedAt:"2026-11-16T00:00:00Z",stageRevisions:[{stageId:5,revision:4},{stageId:6,revision:7}],historyRevisions:[{stageId:6,revision:4}],omissions:[{kind:"truncated",stageId:6,revision:4},{kind:"original-file-bytes-not-read"},{kind:"teacher-comments-no-source"}],truncated:true,application:{state:"message-dispatch-observed",attemptId:"attempt",assembledContextHash:"b".repeat(64),assembledAt:"2026-11-16T00:00:00Z",messageDispatchedAt:"2026-11-16T00:00:00Z",checkpointResumedAt:null,inheritedMessageDispatchAttemptId:null}});
function Composer() { const draft = useComposerDraft({ ...scope,threadId:"sum" }); return <textarea aria-label="原生输入框" value={draft.text} onChange={event=>draft.setText(event.currentTarget.value)} />; }
beforeEach(()=>{ vi.clearAllMocks(); sessionStorage.clear(); mocks.load.mockResolvedValue(packet); mocks.choices.mockResolvedValue({choices:[choice],truncated:false,artifactsUnavailable:false}); mocks.source.mockResolvedValue({choice,markdown:choice.markdown,immutableRevision:null,sourceReview:{status:"available",receipt}}); });
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
it("uses the reviewed result as standalone report text without importing diagnostics", async () => {
  const change = vi.fn();
  render(<AidtSummaryImport scope={scope} threadId="sum" value="原表单汇总" onChange={change} readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "读取AI总结结果" }));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"), { target: { value: "message:ai" } });
  const preview = await screen.findByTestId("aidt-summary-result-preview");
  const replace = screen.getByTestId("aidt-summary-import-replace");
  expect(replace).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对AI草稿、材料缺口与点评来源" }));
  fireEvent.click(replace);
  expect(change).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledWith(preview.textContent?.trim());
});
it("clears old choices on scope loss and ignores an old result which arrives after cancellation",async()=>{
  let finish!:(value:unknown)=>void; mocks.source.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const change=vi.fn();const view=render(<AidtSummaryImport scope={scope} threadId="sum" value="保留稿" onChange={change} readOnly={false}/>);
  fireEvent.click(screen.getByText("选择AI总结结果带入报告"));fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"),{target:{value:"message:ai"}});
  const signal=mocks.source.mock.calls[0]![3] as AbortSignal;
  view.rerender(<AidtSummaryImport scope={{...scope,sessionToken:"new"}} threadId="sum" value="保留稿" onChange={change} readOnly={false}/>);
  expect(signal.aborted).toBe(true);await act(async()=>finish({choice,markdown:choice.markdown,immutableRevision:null,sourceReview:{status:"available",receipt}}));
  expect(screen.queryByTestId("aidt-summary-result-preview")).toBeNull();expect(change).not.toHaveBeenCalled();
});
it("exposes truncated source ranges and old/current versions before the student may adopt unchanged AI text",async()=>{
  const body="AI称完整报告，但遗漏已保存V2原型；学生仍需核对。";
  mocks.source.mockResolvedValueOnce({choice,markdown:body,immutableRevision:null,sourceReview:{status:"available",receipt}});
  const change=vi.fn();render(<AidtSummaryImport scope={scope} threadId="sum" value="保留V1人工说明" onChange={change} readOnly={false}/>);
  fireEvent.click(screen.getByText("选择AI总结结果带入报告"));fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"),{target:{value:"message:ai"}});
  const review=await screen.findByTestId("aidt-summary-source-review");
  expect(review).toHaveTextContent("本轮固定版本：第5步 V4、第6步 V7");expect(review).toHaveTextContent("历史版本：第6步 V4");
  expect(review).toHaveTextContent("来源已截断");expect(review).toHaveTextContent("第6步 V4：仅传入部分摘录");expect(review).toHaveTextContent("未读取原始文件字节");
  expect(review).toHaveTextContent("原型notes／制作说明是声明");expect(review).toHaveTextContent("静态图不证明可点击或真实用户行为");
  expect(screen.getByTestId("aidt-summary-result-preview").textContent).toBe(body);expect(screen.getByTestId("aidt-summary-import-apply")).toBeDisabled();expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox",{name:"我已核对AI草稿、材料缺口与点评来源"}));fireEvent.click(screen.getByTestId("aidt-summary-import-apply"));
  const imported=change.mock.calls[0]![0] as string;
  expect(imported).toMatch(/^保留V1人工说明\n\n/);expect(imported).toContain("不是AI报告正文");expect(imported).toContain("历史版本：第6步 V4");expect(imported).toContain(body);
  expect(imported).not.toContain("V2已验证");expect(imported).not.toContain("V2已生成");
});
it("keeps receipt failure visible, preserves manual text, and requires a fresh review for each selection",async()=>{
  mocks.source.mockResolvedValueOnce({choice,markdown:choice.markdown,immutableRevision:null,sourceReview:{status:"unavailable"}});
  const change=vi.fn();render(<AidtSummaryImport scope={scope} threadId="sum" value="失败也保留人工稿" onChange={change} readOnly={false}/>);
  fireEvent.click(screen.getByText("选择AI总结结果带入报告"));fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"),{target:{value:"message:ai"}});
  expect(await screen.findByTestId("aidt-summary-source-review")).toHaveTextContent("无法核对本轮版本与截断范围");
  expect(change).not.toHaveBeenCalled();expect(screen.getByTestId("aidt-summary-import-apply")).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox",{name:"我已核对AI草稿、材料缺口与点评来源"}));
  mocks.source.mockRejectedValueOnce(new Error("permission changed"));
  fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"),{target:{value:"message:ai"}});
  expect(await screen.findByText(/报告编辑保留/)).toBeInTheDocument();expect(change).not.toHaveBeenCalled();expect(screen.queryByTestId("aidt-summary-import-apply")).toBeNull();
});
it("shows material-preview truncation before offering a request without treating selected versions as model consumption",async()=>{
  mocks.load.mockResolvedValueOnce({...packet,currentStages:[{...packet.currentStages[0]!,truncated:true}],historyTruncated:true});
  render(<AidtSummaryChatContext scope={scope} threadId="sum"/>);
  fireEvent.click(screen.getByRole("button",{name:"读取报告材料"}));
  const warning=await screen.findByTestId("aidt-summary-materials-truncated");
  expect(warning).toHaveTextContent("版本选择不表示模型已读全文");expect(warning.closest("details")).toBeNull();
  expect(screen.getByTestId("aidt-summary-materials")).toHaveTextContent("第6步 V1");
});
it("does not relabel old report refs or modify the saved stage draft when a reviewed AI appendix mentions newer versions",async()=>{
  const original=SharedStage.parse({projectId:"p",stageId:6,revision:3,updatedBy:"u",updatedAt:"2026-11-16T00:00:00Z",sourceStageRevisions:[{stageId:5,revision:1}],content:{schemaVersion:1,draft:{...emptyAidtUiDrafts()[6]!,fields:{feedback:"原测试反馈保留"}},summaryReport:{markdown:"人工旧稿仅讨论V1",sourceStageRevisions:[{stageId:5,revision:1}]}}});
  mocks.readStage.mockImplementation(async(_project,id)=>({stage:id===6?original:id===5?{...original,stageId:5,revision:2,content:{schemaVersion:1,draft:{...emptyAidtUiDrafts()[5]!,fields:{version:"已保存V2"}}}}:null}));
  mocks.saveStage.mockImplementation(async(input:AidtSaveStageInput)=>({stage:{...original,revision:4,content:input.content,sourceStageRevisions:input.sourceStageRevisions},replayed:false}));
  function Report(){
    const [drafts,setDrafts]=React.useState(emptyAidtUiDrafts),[text,setText]=React.useState<string|null>(null);
    const shared=useAidtSharedStages({enabled:true,scope,lifecycleKey:"life",stageId:6,drafts,canWrite:true,reportText:text,onHydrateReport:setText,onHydrate:(id,draft)=>setDrafts(old=>({...old,[id]:draft}))});
    return <><output data-testid="report-manuscript">{text}</output><AidtSummaryImport scope={scope} threadId="sum" value={text??""} onChange={setText} readOnly={false}/><button type="button" disabled={!shared.report.canSave} onClick={()=>void shared.report.save()}>主动保存报告</button></>;
  }
  render(<Report/>);await waitFor(()=>expect(screen.getByTestId("report-manuscript")).toHaveTextContent("人工旧稿仅讨论V1"));
  fireEvent.click(screen.getByText("选择AI总结结果带入报告"));fireEvent.click(screen.getByRole("button",{name:"读取AI总结结果"}));
  fireEvent.change(await screen.findByLabelText("选择要审阅的AI结果"),{target:{value:"message:ai"}});await screen.findByTestId("aidt-summary-result-preview");
  fireEvent.click(screen.getByRole("checkbox",{name:"我已核对AI草稿、材料缺口与点评来源"}));fireEvent.click(screen.getByTestId("aidt-summary-import-apply"));
  expect(mocks.saveStage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"主动保存报告"}));await waitFor(()=>expect(mocks.saveStage).toHaveBeenCalledOnce());
  const saved=mocks.saveStage.mock.calls[0]![0] as AidtSaveStageInput;
  expect(saved.content.summaryReport?.markdown).toMatch(/^人工旧稿仅讨论V1\n\n/);
  expect(saved.content.summaryReport?.markdown).toContain("第5步 V4");
  expect(saved.content.summaryReport?.sourceStageRevisions).toEqual([{stageId:5,revision:1}]);
  expect(saved.sourceStageRevisions).toEqual(original.sourceStageRevisions);expect(saved.content.draft).toEqual(original.content.draft);
});

it("automatically loads the current report entity's materials in compact native Chat", async () => {
  const selected = vi.fn();
  render(<AidtSummaryChatContext compact reportEntityId="group-report" scope={scope} threadId="sum" onSelectorChange={selected} />);
  await waitFor(() => expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "summary", projectId: "p" })));
  expect(mocks.load).toHaveBeenCalledWith(scope, expect.any(AbortSignal), "group-report");
  expect(screen.queryByRole("button", { name: "读取报告材料" })).toBeNull();
  expect(screen.getByRole("button", { name: "起草报告" })).toBeEnabled();
});
