import * as React from "react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {AiUsagePanel} from "../../components/admin/ai-usage-panel";
import {readAiUsage,readAiUsageCalls} from "../../lib/live-ai-usage";
vi.mock("../../lib/live-ai-usage",()=>({readAiUsage:vi.fn(),readAiUsageCalls:vi.fn()}));
const totals={inputTokens:"5",outputTokens:"3",totalTokens:"8",callCount:1,failedCalls:0,reportedCalls:1,legacyCalls:0,unknownCalls:0,unknownInputCalls:0,unknownOutputCalls:0};
const summary={asOf:"2026-10-03T00:00:00Z",start:"2026-10-01T00:00:00Z",end:"2026-10-03T00:00:00Z",timezone:"Etc/UTC",coverage:"partial" as const,
 current:totals,previous:totals,dispatchIntents:2,unsettledDispatchIntents:1,
 truncated:{members:false,models:false,matrix:false,projects:false},trend:[{day:"2026-10-02",totalTokens:"8",callCount:1}],
 members:[{userId:"member-a",totalTokens:"8",callCount:1}],models:[{modelProvider:"p",modelId:"m",totalTokens:"8",callCount:1}],
 matrix:[{userId:"member-a",modelProvider:"p",modelId:"m",totalTokens:"8",callCount:1}],projects:[{projectId:null,totalTokens:"8",callCount:1}]};
const call={id:"receipt-a",userId:"member-a",runId:null,projectId:null,threadId:null,agentId:null,modelProvider:"p",modelId:"m",occurredAt:"2026-10-02T00:00:00.000001Z",
 startedAt:null,endedAt:null,executionAttemptId:null,totalTokens:"8",inputTokens:"5",outputTokens:"3",totalSource:"reported" as const,outcome:"succeeded" as const,callPurpose:null,costMicros:null,currency:null,priceVersion:null};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(readAiUsage).mockResolvedValue(summary);vi.mocked(readAiUsageCalls).mockResolvedValue({asOf:summary.asOf,coverage:"partial",calls:[call],nextCursor:null});});
describe("AI usage live endpoint projection (fixture, not live backend)",()=>{
 it("shows coverage/unknown price and drills member×model to same-ledger calls",async()=>{
  render(<AiUsagePanel orgId="org-a" platform/>);
  await screen.findByText("receipt-a");expect(screen.getByText(/当前覆盖不完整/)).toBeTruthy();
  expect(screen.getByText("未配置价格/未报告")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"member-a / p / m · 8"}));
  await waitFor(()=>expect(readAiUsage).toHaveBeenLastCalledWith("org-a",true,expect.objectContaining({userId:"member-a",modelProvider:"p",modelId:"m"})));
  await waitFor(()=>expect(readAiUsageCalls).toHaveBeenLastCalledWith("org-a",true,expect.objectContaining({asOf:summary.asOf,userId:"member-a",modelProvider:"p",modelId:"m"})));
 });
 it("personal view remains forced self even after clearing filters",async()=>{
  render(<AiUsagePanel orgId="org-a" selfUserId="self-a"/>);await screen.findByText("receipt-a");
  fireEvent.click(screen.getByRole("button",{name:"清除分组筛选"}));
  await waitFor(()=>expect(readAiUsage).toHaveBeenLastCalledWith("org-a",false,expect.objectContaining({userId:"self-a"})));
  expect(readAiUsageCalls).toHaveBeenCalledWith("org-a",false,expect.objectContaining({userId:"self-a"}));
 });
 it("API failure has a visible failure state, not an empty or zero-consumption report",async()=>{
  vi.mocked(readAiUsage).mockRejectedValueOnce(new Error("private upstream detail"));
  render(<AiUsagePanel orgId="org-a"/>);await screen.findByRole("alert");
  expect(screen.queryByText(/此窗口与筛选下没有/)).toBeNull();expect(screen.queryByText(/private upstream detail/)).toBeNull();
 });
});
