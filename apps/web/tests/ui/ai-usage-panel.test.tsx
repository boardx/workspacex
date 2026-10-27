import * as React from "react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {AiUsagePanel} from "../../components/admin/ai-usage-panel";
import {readAiUsage,readAiUsageCalls} from "../../lib/live-ai-usage";
vi.mock("../../lib/use-org-member-names",()=>({useOrgMemberNames:()=>new Map([["member-a","张三"]]),memberLabel:()=>"张三"}));
vi.mock("../../lib/live-ai-usage",()=>({readAiUsage:vi.fn(),readAiUsageCalls:vi.fn()}));
const totals={inputTokens:"5",outputTokens:"3",totalTokens:"8",callCount:1,failedCalls:0,reportedCalls:1,legacyCalls:0,unknownCalls:0,unknownInputCalls:0,unknownOutputCalls:0,nativeCalls:0};
const summary={asOf:"2026-10-03T00:00:00Z",start:"2026-10-01T00:00:00Z",end:"2026-10-03T00:00:00Z",timezone:"Etc/UTC",coverage:"partial" as const,nativeUnits:[],
 current:totals,previous:totals,dispatchIntents:2,unsettledDispatchIntents:1,
 truncated:{members:false,models:false,matrix:false,projects:false},trend:[{day:"2026-10-02",totalTokens:"8",callCount:1}],
 members:[{userId:"member-a",totalTokens:"8",callCount:1}],models:[{modelProvider:"p",modelId:"m",totalTokens:"8",callCount:1}],
 matrix:[{userId:"member-a",modelProvider:"p",modelId:"m",totalTokens:"8",callCount:1}],projects:[{projectId:null,totalTokens:"8",callCount:1}]};
const call={id:"receipt-a",userId:"member-a",runId:null,projectId:null,threadId:null,agentId:null,modelProvider:"p",modelId:"m",occurredAt:"2026-10-02T00:00:00.000001Z",
 startedAt:null,endedAt:null,executionAttemptId:null,totalTokens:"8",inputTokens:"5",outputTokens:"3",totalSource:"reported" as const,outcome:"succeeded" as const,callPurpose:null,costMicros:null,currency:null,priceVersion:null,cacheInputTokens:null,reasoningOutputTokens:null,subtaskId:null,nativeUsage:null};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(readAiUsage).mockResolvedValue(summary);vi.mocked(readAiUsageCalls).mockResolvedValue({asOf:summary.asOf,coverage:"partial",calls:[call],nextCursor:null});});
describe("readable AI usage ledger",()=>{
 it("shows Beijing date/model/usage without internal identifiers and expands metering details",async()=>{
  render(<AiUsagePanel orgId="org-a" platform/>);
  await screen.findByText("2026年10月2日");
  expect(screen.getByText("08:00:00")).toBeTruthy();
  expect(screen.queryByText("receipt-a")).toBeNull();expect(screen.queryByText("member-a")).toBeNull();
  expect(screen.getByText("张三")).toBeTruthy();expect(screen.getByText("暂无数据")).toBeTruthy();
  expect(screen.getByText("计量详情")).toBeTruthy();
 });
 it("does not turn unreported tokens into zero consumption",async()=>{
  vi.mocked(readAiUsage).mockResolvedValue({...summary,current:{...totals,totalTokens:"0",inputTokens:"0",outputTokens:"0",reportedCalls:0,unknownCalls:1,unknownInputCalls:1,unknownOutputCalls:1},models:[{...summary.models[0]!,totalTokens:"0"}]});
  vi.mocked(readAiUsageCalls).mockResolvedValue({asOf:summary.asOf,coverage:"partial",calls:[{...call,totalTokens:"0",inputTokens:null,outputTokens:null,totalSource:"unknown"}],nextCursor:null});
  render(<AiUsagePanel orgId="org-a" selfUserId="self-a"/>);
  await screen.findByTestId("usage-total-tokens");
  expect(screen.getByTestId("usage-total-tokens").textContent).toBe("未上报");
  expect(screen.getByText(/1 次调用未上报用量/)).toBeTruthy();
 });
 it("keeps forced self scope and the snapshot when paging and clearing filters",async()=>{
  const nextCursor={occurredAt:call.occurredAt,id:call.id};
  vi.mocked(readAiUsageCalls).mockResolvedValue({asOf:summary.asOf,coverage:"partial",calls:[call],nextCursor});
  render(<AiUsagePanel orgId="org-a" selfUserId="self-a"/>);await screen.findByText("2026年10月2日");
  fireEvent.click(screen.getByRole("button",{name:"下一页"}));
  await waitFor(()=>expect(readAiUsageCalls).toHaveBeenLastCalledWith("org-a",false,expect.objectContaining({userId:"self-a",asOf:summary.asOf,cursorId:call.id,cursorTime:call.occurredAt})));
  fireEvent.click(screen.getByRole("button",{name:"重置筛选"}));
  await waitFor(()=>expect(readAiUsage).toHaveBeenLastCalledWith("org-a",false,expect.objectContaining({userId:"self-a"})));
 });
 it("uses inclusive Beijing calendar dates for the query",async()=>{
  render(<AiUsagePanel orgId="org-a"/>);await screen.findByText("2026年10月2日");
  fireEvent.click(screen.getByRole("button",{name:"自定义日期"}));
  fireEvent.change(screen.getByLabelText("开始日期"),{target:{value:"2026-10-01"}});
  fireEvent.change(screen.getByLabelText("结束日期"),{target:{value:"2026-10-02"}});
  fireEvent.click(screen.getByRole("button",{name:"应用日期"}));
  await waitFor(()=>expect(readAiUsage).toHaveBeenLastCalledWith("org-a",false,expect.objectContaining({start:"2026-09-30T16:00:00.000Z",end:"2026-10-02T16:00:00.000Z",timezone:"Asia/Shanghai"})));
 });
 it("shows model summary as a secondary view",async()=>{
  render(<AiUsagePanel orgId="org-a"/>);await screen.findByText("2026年10月2日");
  fireEvent.mouseDown(screen.getByRole("tab",{name:"按模型汇总"}),{button:0,ctrlKey:false});
  fireEvent.click(screen.getByRole("tab",{name:"按模型汇总"}));
  await screen.findByText("已记录 Token");
  expect(screen.getByRole("button",{name:"查看 m 的调用"})).toBeTruthy();
 });
 it("API failure is an error, not an empty report",async()=>{
  vi.mocked(readAiUsage).mockRejectedValueOnce(new Error("private upstream detail"));
  render(<AiUsagePanel orgId="org-a"/>);await screen.findByRole("alert");
  expect(screen.queryByText(/暂无调用记录/)).toBeNull();expect(screen.queryByText(/private upstream detail/)).toBeNull();
 });
 it("uses native units instead of zero Tokens",async()=>{
  vi.mocked(readAiUsageCalls).mockResolvedValue({asOf:summary.asOf,coverage:"partial",nextCursor:null,calls:[{...call,totalTokens:"0",inputTokens:null,outputTokens:null,totalSource:"not-applicable",nativeUsage:{unit:"millisecond",quantity:"2000",source:"estimated"}}]});
  render(<AiUsagePanel orgId="org-a"/>);
  await screen.findByText("2,000 毫秒（估算）");expect(screen.getByText("Token 不适用")).toBeTruthy();
 });
});

it("does not label a mixed report's unknown model as zero Tokens", async () => {
 vi.mocked(readAiUsage).mockResolvedValue({...summary,current:{...totals,callCount:2,unknownCalls:1},models:[...summary.models,{modelProvider:"p",modelId:"unreported-model",totalTokens:"0",callCount:1}]});
 render(<AiUsagePanel orgId="org-a"/>); await screen.findByText("2026年10月2日");
 fireEvent.mouseDown(screen.getByRole("tab",{name:"按模型汇总"}),{button:0,ctrlKey:false});
 fireEvent.click(screen.getByRole("tab",{name:"按模型汇总"}));
 expect(screen.getByText("用量待确认")).toBeTruthy();
});

it("does not invent reported/estimated zero buckets for unknown native usage", async () => {
 vi.mocked(readAiUsage).mockResolvedValue({...summary,nativeUnits:[{unit:"image",reportedQuantity:"0",estimatedQuantity:"0",reportedCalls:0,estimatedCalls:0,unknownCalls:1}]});
 render(<AiUsagePanel orgId="org-a"/>); await screen.findByText("2026年10月2日");
 expect(screen.queryByText(/0 张图片/)).toBeNull();
 expect(screen.getByText(/图片：1 次调用未上报/)).toBeTruthy();
});
