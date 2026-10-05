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

 it.each([undefined,false,true])("preserves existing rule enforcement value %s without implicitly enabling it",async enforceLimitRules=>{
  const tokenControls={quotaSource:"organization-template",warningAtTokens:null,degradeAtTokens:null,memberOverrides:[],...enforceLimitRules===undefined?{}:{enforceLimitRules}};
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",prices:[{billingMode:"input-only",modelId:"embedding",modelProvider:"fixture-route",runtimeModelId:"embed-actual",inputMicrosPerMillion:"10",cachedInputMicrosPerMillion:"5",maxInputTokens:100}],fallbackModelIds:[],maxAttempts:1,tokenControls};
  mocks.policy.mockResolvedValue({...state,version:1,configuration});mocks.candidates.mockResolvedValue([]);mocks.save.mockImplementation(async(_org,input)=>({...state,version:2,configuration:input.configuration}));
  render(<AiPolicyPanel orgId="formal"/>);await screen.findByText(/已配置 · 版本 1/);
  const checkbox=screen.getByRole("checkbox",{name:"执行已有组织 Token 规则"});expect(checkbox).toHaveProperty("checked",enforceLimitRules===true);
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"fixture rule preservation"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0]![1].configuration.tokenControls).toEqual(tokenControls);
  fireEvent.click(checkbox);fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"fixture explicit rule change"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![1].configuration.tokenControls.enforceLimitRules).toBe(enforceLimitRules!==true);
 });
 it.each([false,true])("preserves optional controls and zero overrides (configured=%s)",async configured=>{
  const tokenControls={quotaSource:"organization-template",warningAtTokens:null,degradeAtTokens:"0",memberOverrides:[{userId:"member-fixture",tokens:"0"}]};
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",prices:[{billingMode:"input-only",modelId:"embedding",modelProvider:"fixture-route",runtimeModelId:"embed-actual",inputMicrosPerMillion:"10",cachedInputMicrosPerMillion:"5",maxInputTokens:100}],fallbackModelIds:[],maxAttempts:1,...configured?{tokenControls}:{}};
  mocks.policy.mockResolvedValue({...state,version:1,configuration});mocks.candidates.mockResolvedValue([]);mocks.save.mockImplementation(async(_org,input)=>({...state,version:2,configuration:input.configuration}));
  render(<AiPolicyPanel orgId="formal"/>);await screen.findByText(/已配置 · 版本 1/);
  expect(screen.getByRole("checkbox",{name:"显式配置阈值与成员额度来源"})).toHaveProperty("checked",configured);
  if(configured){expect(screen.getByLabelText("预警阈值（Token，空白表示未配置）")).toHaveValue("");expect(screen.getByLabelText("降级阈值（Token，空白表示未配置）")).toHaveValue("0");expect(screen.getByLabelText("成员 Token 上限 1（0 表示零额度）")).toHaveValue("0");}
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"fixture controls"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalled());
  const saved=mocks.save.mock.calls[0]![1].configuration;
  if(configured)expect(saved.tokenControls).toEqual(tokenControls);else expect(saved).not.toHaveProperty("tokenControls");
 });
 it("switches to member UTC authority without preserving template overrides",async()=>{
  const tokenControls={quotaSource:"organization-template",warningAtTokens:null,degradeAtTokens:null,memberOverrides:[{userId:"member-fixture",tokens:"0"}]};
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",prices:[{billingMode:"input-only",modelId:"embedding",modelProvider:"fixture-route",runtimeModelId:"embed-actual",inputMicrosPerMillion:"10",cachedInputMicrosPerMillion:"5",maxInputTokens:100}],fallbackModelIds:[],maxAttempts:1,tokenControls};
  mocks.policy.mockResolvedValue({...state,version:1,configuration});mocks.candidates.mockResolvedValue([]);mocks.save.mockImplementation(async(_org,input)=>({...state,version:2,configuration:input.configuration}));
  render(<AiPolicyPanel orgId="formal"/>);await screen.findByText(/已配置 · 版本 1/);
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"fixture authority"}});
  fireEvent.click(screen.getByRole("button",{name:"添加成员覆盖"}));
  fireEvent.change(screen.getByLabelText("成员用户 ID 2"),{target:{value:"member-fixture"}});
  fireEvent.change(screen.getByLabelText("成员 Token 上限 2（0 表示零额度）"),{target:{value:"0"}});
  expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("额度来源"),{target:{value:"member-monthly-utc"}});
  expect(screen.queryByRole("button",{name:"添加成员覆盖"})).not.toBeInTheDocument();expect(screen.getByText(/完整 UTC 自然月/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"fixture authority"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls[0]![1].configuration.tokenControls).toEqual({quotaSource:"member-monthly-utc",warningAtTokens:null,degradeAtTokens:null,memberOverrides:[]});
 });

});

const nativeBaseConfiguration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",
 prices:[{billingMode:"input-only",modelId:"embedding",modelProvider:"fixture-route",runtimeModelId:"embed-actual",inputMicrosPerMillion:"10",cachedInputMicrosPerMillion:"5",maxInputTokens:100}],fallbackModelIds:[],maxAttempts:1};
const nativeCandidate={modelId:"asr-fixture",displayName:"Fixture ASR",kind:"closed-api",capabilityTags:["asr"],contextWindow:1000,modelProviders:["verified-asr-route"]};
const nativePrice={modelId:nativeCandidate.modelId,modelProvider:"verified-asr-route",runtimeModelId:"verified-runtime-asr",unit:"millisecond",quantum:"1000",microsPerQuantum:"15",maxQuantity:"30000"};
function nativeFixture(nativePrices?:unknown[]){
 const configuration={...nativeBaseConfiguration,...nativePrices===undefined?{}:{nativePrices}};
 mocks.policy.mockResolvedValue({...state,version:7,configuration});mocks.candidates.mockResolvedValue([nativeCandidate]);
 mocks.save.mockImplementation(async(_org,input)=>({...state,version:8,configuration:input.configuration}));
 render(<AiPolicyPanel orgId="formal"/>);
}
async function addNativePrice(){
 await screen.findByText(/已配置 · 版本 7/);
 fireEvent.change(screen.getByLabelText("添加原生计费模型"),{target:{value:nativeCandidate.modelId}});
}
function fillNativePrice(){
 for(const [label,value] of [["原生模型供应商实际标识",nativePrice.runtimeModelId],["每个计价单位包含的用量（正整数）",nativePrice.quantum],["每个计价单位价格（正整数微货币）",nativePrice.microsPerQuantum],["单次原生用量硬上限（正整数）",nativePrice.maxQuantity]])fireEvent.change(screen.getByLabelText(label!),{target:{value}});
 fireEvent.change(screen.getByLabelText("原生模型已注册路由"),{target:{value:nativePrice.modelProvider}});
 fireEvent.change(screen.getByLabelText("原生计量单位"),{target:{value:nativePrice.unit}});
 fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"verified native policy"}});
}
describe("explicit native model pricing",()=>{
 it("keeps absent native policy absent and presents honest catalog and cost boundaries",async()=>{
  nativeFixture();await screen.findByTestId("ai-native-empty");
  expect(screen.getByText(/已进入模型目录不代表账号可用/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"preserve legacy"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());expect(mocks.save.mock.calls[0]![1].configuration).not.toHaveProperty("nativePrices");
 });
 it("new native model starts entirely unconfigured, then saves verified unit/rate/cap with existing version and audit",async()=>{
  nativeFixture();await addNativePrice();
  for(const label of ["原生模型供应商实际标识","原生模型已注册路由","原生计量单位","每个计价单位包含的用量（正整数）","每个计价单位价格（正整数微货币）","单次原生用量硬上限（正整数）"])expect(screen.getByLabelText(label)).toHaveValue("");
  expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();
  fillNativePrice();fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith("formal",expect.objectContaining({expectedVersion:7,reason:"verified native policy",configuration:expect.objectContaining({nativePrices:[nativePrice],prices:nativeBaseConfiguration.prices})})));
  expect(await screen.findByText("配置已保存，限制尚未启用。")).toBeInTheDocument();
 });
 it("loads existing native values and saves a deliberate rate edit without dropping other configuration",async()=>{
  nativeFixture([nativePrice]);await screen.findByText(/已配置 · 版本 7/);
  expect(screen.getByLabelText("原生计量单位")).toHaveValue("millisecond");expect(screen.getByLabelText("单次原生用量硬上限（正整数）")).toHaveValue("30000");
  fireEvent.change(screen.getByLabelText("每个计价单位价格（正整数微货币）"),{target:{value:"20"}});
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"confirmed new rate"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());expect(mocks.save.mock.calls[0]![1].configuration.nativePrices).toEqual([{...nativePrice,microsPerQuantum:"20"}]);
 });
 it.each(["0","-1","1.5","9223372036854775808","not-a-number"])("rejects invalid native maximum %s before API save",async invalid=>{
  nativeFixture([nativePrice]);await screen.findByText(/已配置 · 版本 7/);
  fireEvent.change(screen.getByLabelText("单次原生用量硬上限（正整数）"),{target:{value:invalid}});fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"attempt invalid"}});
  expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();expect(screen.getByRole("alert")).toHaveTextContent("正整数");expect(mocks.save).not.toHaveBeenCalled();
 });
 it("shared Configuration rejects one formal model as both token and native billing, with clear recovery",async()=>{
  nativeFixture([nativePrice]);await screen.findByText(/已配置 · 版本 7/);
  fireEvent.click(screen.getByRole("checkbox",{name:/Fixture ASR/}));fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"conflict"}});
  expect(screen.getByRole("alert")).toHaveTextContent("同一正式模型不能同时配置 Token 与原生价格");expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox",{name:/Fixture ASR/}));expect(screen.queryByRole("alert")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"保存额度配置"})).toBeEnabled();
 });
 it("native removal is explicit and saves an empty native array without touching token prices",async()=>{
  nativeFixture([nativePrice]);await screen.findByText(/已配置 · 版本 7/);
  fireEvent.click(screen.getByRole("button",{name:"移除原生价格 Fixture ASR"}));expect(screen.getByTestId("ai-native-empty")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"remove native price"}});fireEvent.click(screen.getByRole("button",{name:"保存额度配置"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());expect(mocks.save.mock.calls[0]![1].configuration.nativePrices).toEqual([]);expect(mocks.save.mock.calls[0]![1].configuration.prices).toEqual(nativeBaseConfiguration.prices);
 });
});
it("blocks duplicate runtime binding across distinct formal models and explains what to repair",async()=>{
 nativeFixture([{...nativePrice,modelProvider:"fixture-route",runtimeModelId:"embed-actual"}]);await screen.findByText(/已配置 · 版本 7/);
 fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"duplicate binding"}});
 expect(screen.getByRole("alert")).toHaveTextContent("同一供应商路由与实际模型标识不能重复配置价格");expect(screen.getByRole("button",{name:"保存额度配置"})).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();
});
