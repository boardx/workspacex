import * as React from "react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {AiPolicyPanel} from "@/components/admin/ai-policy-panel";
const mocks=vi.hoisted(()=>({policy:vi.fn(),candidates:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/live-platform-organizations",()=>({getPlatformAiPolicy:mocks.policy,getPlatformAiCandidates:mocks.candidates,setPlatformAiPolicy:mocks.save}));
const state={version:0,configuration:null,priceVersion:null,updatedAt:null,updatedBy:null,enforcement:"pending",changes:[]};
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe("explicit AI policy configuration",()=>{
 it("shows unconfigured without guessed amounts and empty real pool keeps save disabled",async()=>{
  mocks.policy.mockResolvedValue(state);mocks.candidates.mockResolvedValue([]);render(<AiPolicyPanel orgId="formal"/>);
  await screen.findByText(/配置：未配置/);
  expect(screen.getByLabelText("普通用户每人 Token 上限（空白表示未配置）")).toHaveValue("");
  expect(screen.getByLabelText("货币（三位大写代码）")).toHaveValue("");
  expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();expect(screen.getByText(/没有可配置的模型/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("每人费用上限（整数微货币单位，1 单位货币 = 100万微单位）"),{target:{value:"not a number"}});
  expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();
 });
 it("uses official candidates and saves explicit version, model binding, caps/prices and audit reason while remaining pending",async()=>{
  mocks.policy.mockResolvedValue(state);mocks.candidates.mockResolvedValue([{modelId:"mdl-fixture",displayName:"Fixture Model",kind:"self-hosted",capabilityTags:[],contextWindow:1000,modelProviders:["fixture-route"]}]);
  mocks.save.mockImplementation(async(_org,input)=>({...state,version:1,configuration:input.configuration,priceVersion:"fixture-policy-v1",updatedAt:"2026-10-01T00:00:00Z",updatedBy:"operator"}));render(<AiPolicyPanel orgId="formal"/>);
  fireEvent.click(await screen.findByRole("checkbox",{name:/Fixture Model/}));
  const fields:[[string,string]]|[string,string][]=[
   ["窗口开始（含边界，ISO 时间与偏移）","2026-10-01T00:00:00Z"],["窗口结束（不含边界，ISO 时间与偏移）","2026-11-01T00:00:00Z"],["窗口时区（IANA 名称）","Etc/UTC"],
   ["普通用户每人 Token 上限（空白表示未配置）","100"],["每人费用上限（整数微货币单位，1 单位货币 = 100万微单位）","10000"],["货币（三位大写代码）","CNY"],
   ["供应商实际模型标识（需验证，不从名称推断）","runtime-fixture"],["输入价格（微货币/百万 Token）","10"],["输出价格（微货币/百万 Token）","20"],["缓存输入价格（微货币/百万 Token）","5"],
   ["单次输入安全上限（Token）","100"],["单次输出安全上限（Token）","200"],["一次调用最多尝试次数（含主模型，1–5）","1"],["变更理由（写入审计）","approved fixture"],
  ];
  for(const [label,value] of fields)fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText("已注册模型路由"),{target:{value:"fixture-route"}});
  fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith("formal",expect.objectContaining({expectedVersion:0,reason:"approved fixture",configuration:expect.objectContaining({ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",maxAttempts:1,fallbackModelIds:[],prices:[expect.objectContaining({modelId:"mdl-fixture",runtimeModelId:"runtime-fixture",modelProvider:"fixture-route",maxInputTokens:100,maxOutputTokens:200})]})})));
  expect(await screen.findByRole("status")).toHaveTextContent("配置已保存，限制尚未启用");
 });
 it("dependency failure is unavailable rather than an unconfigured or successful save",async()=>{
  mocks.policy.mockRejectedValue(new Error("down"));mocks.candidates.mockResolvedValue([]);render(<AiPolicyPanel orgId="formal"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("暂不可用");expect(screen.queryByRole("button",{name:"保存额度配置"})).not.toBeInTheDocument();
 });
 it.each(["success","failure"])("late %s response from organization A cannot overwrite B",async outcome=>{
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",
   prices:[{modelId:"mdl-fixture",modelProvider:"fixture-route",runtimeModelId:"runtime-fixture",inputMicrosPerMillion:"10",outputMicrosPerMillion:"20",cachedInputMicrosPerMillion:"5",maxInputTokens:100,maxOutputTokens:200}],fallbackModelIds:[],maxAttempts:1};
  const configured={...state,version:1,configuration,priceVersion:"fixture-v1",updatedBy:"operator",updatedAt:"2026-10-01T00:00:00Z"};
  mocks.policy.mockImplementation(async org=>org==="A"?configured:state);mocks.candidates.mockResolvedValue([]);
  let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;
  mocks.save.mockImplementation(()=>new Promise((ok,fail)=>{resolve=ok;reject=fail;}));
  const rendered=render(<AiPolicyPanel orgId="A"/>);await screen.findByText(/已配置 · 版本 1/);
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"fixture change"}});
  fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalled());
  rendered.rerender(<AiPolicyPanel orgId="B"/>);await screen.findByText(/配置：未配置/);
  await act(async()=>{if(outcome==="success")resolve({...configured,version:2});else reject(new Error("A failed"));});
  expect(screen.getByText(/配置：未配置/)).toBeInTheDocument();expect(screen.queryByText(/配置已保存/)).not.toBeInTheDocument();expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 });
 it("loads and saves input-only policy without adding output prices or a zero cap",async()=>{
  const price={billingMode:"input-only",modelId:"embedding",modelProvider:"fixture-route",runtimeModelId:"embed-actual",inputMicrosPerMillion:"10",cachedInputMicrosPerMillion:"5",maxInputTokens:100};
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",prices:[price],fallbackModelIds:[],maxAttempts:1};
  mocks.policy.mockResolvedValue({...state,version:3,configuration});mocks.candidates.mockResolvedValue([]);mocks.save.mockImplementation(async(_org,input)=>({...state,version:4,configuration:input.configuration}));
  render(<AiPolicyPanel orgId="formal"/>);await screen.findByText(/已配置 · 版本 3/);
  expect(screen.getByLabelText("计费方式")).toHaveValue("input-only");
  expect(screen.queryByLabelText("输出价格（微货币/百万 Token）")).not.toBeInTheDocument();expect(screen.queryByLabelText("单次输出安全上限（Token）")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"input-only audited"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith("formal",expect.objectContaining({expectedVersion:3,configuration:expect.objectContaining({prices:[price]})})));
  expect(mocks.save.mock.calls[0]![1].configuration.prices[0]).not.toHaveProperty("maxOutputTokens");expect(mocks.save.mock.calls[0]![1].configuration.prices[0]).not.toHaveProperty("outputMicrosPerMillion");
 });

});
