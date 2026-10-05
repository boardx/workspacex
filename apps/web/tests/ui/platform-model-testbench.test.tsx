import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlatformModelTestbench } from "@/components/admin/platform-model-testbench";
import { PlatformModelTestRequest, type PlatformModelTestRecord, type PlatformModelTestCapability } from "@repo/contracts/platform-model-test";
const mocks=vi.hoisted(()=>({orgs:vi.fn(),candidates:vi.fn(),start:vi.fn(),get:vi.fn(),cancel:vi.fn()}));
vi.mock("@/lib/live-platform-organizations",()=>({listPlatformOrganizations:mocks.orgs}));
vi.mock("@/lib/live-platform-model-test",()=>({getModelTestCandidates:mocks.candidates,startModelTest:mocks.start,getModelTest:mocks.get,cancelModelTest:mocks.cancel}));
vi.mock("@/components/admin/admin-screen",()=>({AdminScreen:({children}:{children:React.ReactNode})=><div>{children}</div>}));
const org=(orgId:string)=>({orgId,name:orgId,kind:"organization",memberCount:1,plan:{plan:null,version:0,updatedAt:null,updatedBy:null,enforcement:"pending"}});
const model=(capability="text",available=true)=>({modelId:"org-model",displayName:"Configured model",capability,available,reason:available?null:"adapter-unavailable",modelProvider:"bailian",runtimeModelId:"qwen3.8-max",currency:"CNY",maximumOutputTokens:64,nativeUnit:"request",maximumQuantity:"5"});
function record(input:{testId:string;orgId:string;capability?:PlatformModelTestCapability},state:PlatformModelTestRecord["state"]="succeeded",settlementState:PlatformModelTestRecord["settlementState"]="settled"):PlatformModelTestRecord{return {...input,modelId:"org-model",capability:input.capability??"text",state,settlementState,result:state==="succeeded"?{kind:"text",text:"Actual API response in mocked test"}:null,failureReason:null,usage:null};}
beforeEach(()=>{mocks.orgs.mockResolvedValue({organizations:[org("org-a"),org("org-b")],nextCursor:null});mocks.candidates.mockResolvedValue([model()]);mocks.start.mockImplementation(async input=>record(input));});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.useRealTimers();});
async function chooseOrg(name="org-a") {const trigger=await screen.findByRole("button",{name:"测试所属组织"});fireEvent.keyDown(trigger,{key:"Enter"});fireEvent.click(await screen.findByRole("menuitemradio",{name}));}
async function prepare(capability="text") {mocks.candidates.mockResolvedValue([model(capability)]);render(<PlatformModelTestbench/>);await chooseOrg();fireEvent.click(await screen.findByRole("button",{name:/Configured model/}));fireEvent.change(screen.getByLabelText(/最大费用/),{target:{value:"100"}});fireEvent.change(screen.getByLabelText(/超时上限/),{target:{value:"1000"}});}
function fillText() {fireEvent.change(screen.getByLabelText("测试提示词"),{target:{value:"non-confidential test"}});fireEvent.change(screen.getByLabelText("最大输出 Token"),{target:{value:"16"}});fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));}
describe("platform model testbench live API interaction",()=>{
 it("requires explicit bounds/consent and synchronously prevents duplicate paid starts",async()=>{
  await prepare();const start=screen.getByRole("button",{name:"发起一次真实测试"});expect(start).toBeDisabled();fillText();
  let resolve!:(value:PlatformModelTestRecord)=>void;mocks.start.mockImplementation(()=>new Promise<PlatformModelTestRecord>(done=>{resolve=done;}));fireEvent.click(start);fireEvent.click(start);
  expect(mocks.start).toHaveBeenCalledTimes(1);const input=mocks.start.mock.calls[0]![0];expect(PlatformModelTestRequest.safeParse(input).success).toBe(true);expect(input).not.toHaveProperty("userId");expect(input.bounds.maximumCostMicros).toBe("100000000");
  resolve(record(input));expect(await screen.findByText("执行成功")).toBeInTheDocument();expect(screen.getByText("费用：未知 · 币种：未知")).toBeInTheDocument();
 });
 it("disabled adapter candidates explain their reason and cannot start",async()=>{
  mocks.candidates.mockResolvedValue([model("image-generation",false)]);render(<PlatformModelTestbench/>);await chooseOrg();expect(await screen.findByRole("button",{name:/Configured model/})).toBeDisabled();expect(screen.getByText("不可测试：此能力尚未适配")).toBeInTheDocument();expect(mocks.start).not.toHaveBeenCalled();
 });
 it("an ambiguous start failure keeps its UUID and recovers by GET without redispatch",async()=>{
  await prepare();fillText();mocks.start.mockRejectedValue(new Error("network"));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));await screen.findByRole("alert");const input=mocks.start.mock.calls[0]![0];mocks.get.mockResolvedValue(record(input,"unknown","held"));fireEvent.click(screen.getByRole("button",{name:"查询原测试状态"}));
  expect(await screen.findByText("供应商结果未确认")).toBeInTheDocument();expect(mocks.get).toHaveBeenCalledWith(input.testId,input.orgId,expect.any(AbortSignal));expect(mocks.start).toHaveBeenCalledTimes(1);expect(screen.getByRole("button",{name:"准备新测试"})).toBeDisabled();
  fireEvent.click(screen.getByLabelText("确认旧测试预留仍保留"));fireEvent.click(screen.getByRole("button",{name:"准备新测试"}));expect(screen.getByLabelText(/最大费用/)).toHaveValue("");expect(screen.getByRole("button",{name:"发起一次真实测试"})).toBeDisabled();expect(screen.getByRole("region",{name:"之前测试"})).toHaveTextContent(input.testId);expect(mocks.start).toHaveBeenCalledTimes(1);
 });
 it("success and held settlement remain separate and cancellation preserves held status",async()=>{
  await prepare();fillText();mocks.start.mockImplementation(async input=>record(input,"unknown","held"));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));await screen.findByText("供应商结果未确认");const input=mocks.start.mock.calls[0]![0];mocks.cancel.mockResolvedValue(record(input,"cancelled","held"));fireEvent.click(screen.getByRole("button",{name:"取消本次测试"}));expect(await screen.findByText("已取消")).toBeInTheDocument();expect(screen.getByText("结算：费用保留，等待核对")).toBeInTheDocument();expect(mocks.start).toHaveBeenCalledTimes(1);
 });
 it("rejects output above server configured bounds",async()=>{await prepare();fillText();fireEvent.change(screen.getByLabelText("最大输出 Token"),{target:{value:"65"}});fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));expect(screen.getByRole("button",{name:"发起一次真实测试"})).toBeDisabled();expect(screen.getByRole("alert")).toHaveTextContent("安全边界");});
 it.each(["image-generation","text-to-speech","speech-to-text","embedding","rerank"])("builds modality-specific %s requests",async capability=>{
  await prepare(capability);if(capability==="speech-to-text")fireEvent.change(screen.getByLabelText("PCM16 单声道音频（Base64）"),{target:{value:"AAAAAA=="}});else fireEvent.change(screen.getByLabelText(capability==="embedding"?"向量文本（每行一条，最多 8 条）":capability==="rerank"?"重排查询":capability==="text-to-speech"?"合成文本":"测试提示词"),{target:{value:"first\nsecond"}});
  if(capability==="text-to-speech")fireEvent.change(screen.getByLabelText("音色 ID"),{target:{value:"configured-voice"}});if(capability==="rerank")fireEvent.change(screen.getByLabelText("候选文档（每行一条，最多 20 条）"),{target:{value:"doc1\ndoc2"}});
  if(["image-generation","text-to-speech","speech-to-text"].includes(capability))fireEvent.change(screen.getByLabelText(/最大计费数量/),{target:{value:"2"}});fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));await waitFor(()=>expect(mocks.start).toHaveBeenCalledTimes(1));const input=mocks.start.mock.calls[0]![0];expect(input.capability).toBe(capability);expect(PlatformModelTestRequest.safeParse(input).success).toBe(true);
 });
 it("ignores old candidate responses after organization switch and aborts old reads",async()=>{
  let finish!:(rows:ReturnType<typeof model>[])=>void;mocks.candidates.mockImplementationOnce(()=>new Promise(done=>{finish=done;})).mockResolvedValueOnce([{...model(),displayName:"Second org model"}]);render(<PlatformModelTestbench/>);await chooseOrg();await waitFor(()=>expect(mocks.candidates).toHaveBeenCalledTimes(1));const signal=mocks.candidates.mock.calls[0]![1] as AbortSignal;await chooseOrg("org-b");expect(await screen.findByText(/Second org model/)).toBeInTheDocument();finish([model()]);await waitFor(()=>expect(signal.aborted).toBe(true));expect(screen.queryByText(/Configured model/)).not.toBeInTheDocument();
 });
 it("polls queued execution using GET only and displays successful held usage independently",async()=>{
  await prepare();fillText();mocks.start.mockImplementation(async input=>record(input,"queued","pending"));mocks.get.mockImplementation(async(testId,orgId)=>record({testId,orgId},"succeeded","held"));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));
  expect(await screen.findByText("等待执行")).toBeInTheDocument();await waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(1),{timeout:4000});expect(await screen.findByText("执行成功")).toBeInTheDocument();expect(screen.getByText("结算：费用保留，等待核对")).toBeInTheDocument();expect(mocks.start).toHaveBeenCalledTimes(1);expect(screen.getByRole("button",{name:"准备新测试"})).toBeDisabled();
 });
 it("a failed cancel never repeats the paid start and a mismatched GET cannot overwrite status",async()=>{
  await prepare();fillText();mocks.start.mockImplementation(async input=>record(input,"unknown","held"));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));await screen.findByText("供应商结果未确认");mocks.cancel.mockRejectedValue(new Error("offline"));fireEvent.click(screen.getByRole("button",{name:"取消本次测试"}));await screen.findByRole("alert");
  const input=mocks.start.mock.calls[0]![0];mocks.get.mockResolvedValue(record({...input,orgId:"other-org"}));fireEvent.click(screen.getByRole("button",{name:"查询原测试状态"}));await screen.findByRole("alert");expect(screen.getByText("供应商结果未确认")).toBeInTheDocument();expect(screen.queryByText("执行成功")).not.toBeInTheDocument();expect(mocks.start).toHaveBeenCalledTimes(1);
 });
 it("unmount aborts the active browser request without claiming server-side cancellation",async()=>{
  mocks.start.mockImplementation(()=>new Promise(()=>{}));await prepare();fillText();fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));const signal=mocks.start.mock.calls[0]![1] as AbortSignal;cleanup();expect(signal.aborted).toBe(true);expect(mocks.cancel).not.toHaveBeenCalled();
 });

 it("never treats an available flag as confirmation of unknown pricing or route",async()=>{
  mocks.candidates.mockResolvedValue([{...model(),currency:null}]);render(<PlatformModelTestbench/>);await chooseOrg();expect(await screen.findByRole("button",{name:/Configured model/})).toBeDisabled();expect(screen.getByText("不可测试：费用币种尚未确认")).toBeInTheDocument();expect(mocks.start).not.toHaveBeenCalled();
 });

 it("explicit UUID recovery performs only GET for the chosen organization",async()=>{
  const testId="12345678-1234-4234-8234-123456789012";mocks.get.mockResolvedValue({...record({testId,orgId:"org-a"},"succeeded","settled"),modelId:"previous-model"});render(<PlatformModelTestbench/>);await chooseOrg();fireEvent.change(screen.getByLabelText("已有测试 UUID"),{target:{value:testId}});fireEvent.click(screen.getByRole("button",{name:"恢复原测试（仅查询）"}));
  expect(await screen.findByText("执行成功")).toBeInTheDocument();expect(mocks.get).toHaveBeenCalledWith(testId,"org-a",expect.any(AbortSignal));expect(mocks.start).not.toHaveBeenCalled();expect(screen.getByLabelText("已有测试 UUID")).toHaveValue(testId);
 });
 it("recovery errors and mismatched identity retain the exact UUID without replacing or starting it",async()=>{
  const testId="12345678-1234-4234-8234-123456789012";mocks.get.mockRejectedValue(new Error("not-found"));render(<PlatformModelTestbench/>);await chooseOrg();fireEvent.change(screen.getByLabelText("已有测试 UUID"),{target:{value:testId}});fireEvent.click(screen.getByRole("button",{name:"恢复原测试（仅查询）"}));await screen.findByRole("alert");expect(screen.getByLabelText("已有测试 UUID")).toHaveValue(testId);expect(screen.getByRole("button",{name:"恢复原测试（仅查询）"})).toBeDisabled();
  mocks.get.mockResolvedValue(record({testId,orgId:"other-org"}));fireEvent.click(screen.getByRole("button",{name:"查询原测试状态"}));await screen.findByRole("alert");expect(screen.getByLabelText("已有测试 UUID")).toHaveValue(testId);expect(screen.queryByText("执行成功")).not.toBeInTheDocument();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.get.mock.calls.every(call=>call[0]===testId&&call[1]==="org-a")).toBe(true);
 });
 it("rejects invalid recovery UUID locally and never sends any call",async()=>{
  render(<PlatformModelTestbench/>);await chooseOrg();fireEvent.change(screen.getByLabelText("已有测试 UUID"),{target:{value:"not-a-uuid"}});fireEvent.click(screen.getByRole("button",{name:"恢复原测试（仅查询）"}));expect(await screen.findByRole("alert")).toHaveTextContent("有效的测试 UUID");expect(mocks.get).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
 });

 it("accepts a precise currency amount and shows reported costs in the same currency",async()=>{
  await prepare();fillText();fireEvent.change(screen.getByLabelText(/最大费用/),{target:{value:"0.123456"}});fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));mocks.start.mockImplementation(async input=>({...record(input),usage:{tokens:null,nativeUnit:null,nativeQuantity:null,costMicros:"100001",currency:"CNY",priceVersion:"p1"}}));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));expect(await screen.findByText(/费用：0.100001 CNY/)).toBeInTheDocument();expect(mocks.start.mock.calls[0]![0].bounds.maximumCostMicros).toBe("123456");
 });
 it("never rounds an amount with more than six decimal places to enable a paid call",async()=>{
  await prepare();fillText();fireEvent.change(screen.getByLabelText(/最大费用/),{target:{value:"0.0000001"}});fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));expect(screen.getByRole("button",{name:"发起一次真实测试"})).toBeDisabled();expect(mocks.start).not.toHaveBeenCalled();
 });

 it("displays actual partial ASR output Tokens despite unknown or inapplicable total Tokens",async()=>{
  await prepare("speech-to-text");fireEvent.change(screen.getByLabelText("PCM16 单声道音频（Base64）"),{target:{value:"AAAAAA=="}});fireEvent.change(screen.getByLabelText(/最大计费数量/),{target:{value:"2"}});fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));mocks.start.mockImplementation(async input=>({...record(input),result:{kind:"text",text:"recognized text"},usage:{tokens:null,inputTokens:null,outputTokens:"6",nativeUnit:"millisecond",nativeQuantity:"1000",costMicros:null,currency:"CNY",priceVersion:"p1"}}));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));
  expect(await screen.findByText("总 Token：未知")).toBeInTheDocument();expect(screen.getByText("输入 Token：未知 · 输出 Token：6")).toBeInTheDocument();expect(screen.queryByText("输入 Token：0")).not.toBeInTheDocument();
 });
 it("missing optional input/output counts remain unknown, while explicitly reported zero is preserved",async()=>{
  await prepare();fillText();mocks.start.mockImplementation(async input=>({...record(input),usage:{tokens:"6",outputTokens:"0",nativeUnit:null,nativeQuantity:null,costMicros:null,currency:"CNY",priceVersion:null}}));fireEvent.click(screen.getByRole("button",{name:"发起一次真实测试"}));expect(await screen.findByText("输入 Token：未知 · 输出 Token：0")).toBeInTheDocument();expect(screen.getByText("总 Token：6")).toBeInTheDocument();
 });
 it("explains the unverified ordinary-organization ASR Token bound in Chinese",async()=>{
  mocks.candidates.mockResolvedValue([{...model("speech-to-text",false),reason:"native-asr-token-bound-unverified"}]);render(<PlatformModelTestbench/>);await chooseOrg();expect(await screen.findByText("不可测试：普通组织的语音识别 Token 上界尚未验证")).toBeInTheDocument();expect(screen.getByRole("button",{name:/Configured model/})).toBeDisabled();expect(mocks.start).not.toHaveBeenCalled();
 });

});
