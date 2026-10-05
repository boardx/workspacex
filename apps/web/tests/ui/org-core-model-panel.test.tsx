import * as React from "react";
import {Binding} from "@repo/contracts/organization-core-model";
import {afterEach,it,expect,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {OrgCoreModelPanel} from "@/components/admin/org-core-model-panel";
import {ApiError} from "@/lib/api-client";
import type {OrgCoreModelState,OrgCoreModelCandidate} from "@/lib/live-org-core-model";
const mocks=vi.hoisted(()=>({get:vi.fn(),candidates:vi.fn(),set:vi.fn()}));
vi.mock("@/lib/live-org-core-model",()=>({getOrgCoreModel:mocks.get,getOrgCoreModelCandidates:mocks.candidates,setOrgCoreModel:mocks.set}));
const empty:OrgCoreModelState={version:0,selection:null,updatedBy:null,reason:null};
const available:OrgCoreModelCandidate={modelId:"formal-model",modelProvider:"verified-provider",runtimeModelId:"actual-model",configRevision:"verified-revision",displayName:"Verified Model",available:true,reason:null};
const unavailable={...available,modelId:"unavailable-model",displayName:"Unavailable Model",available:false,reason:"BILLING_CONFIGURATION_MISSING"};
const selection=Binding.parse({modelId:available.modelId,modelProvider:available.modelProvider,runtimeModelId:available.runtimeModelId,configRevision:available.configRevision});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
function fixture(state:OrgCoreModelState=empty,candidates:OrgCoreModelCandidate[]=[available,unavailable]){mocks.get.mockResolvedValue(state);mocks.candidates.mockResolvedValue(candidates);return render(<OrgCoreModelPanel orgId="current-org"/>);}
async function chooseDraft(){fireEvent.click(await screen.findByRole("button",{name:"选择 Verified Model"}));fireEvent.change(screen.getByLabelText("变更理由（写入审计）"),{target:{value:"approved business choice"}});}
it("loading and unconfigured are distinct; no default model or supplier call is invented",async()=>{
 let resolve!:(value:unknown)=>void;mocks.get.mockImplementation(()=>new Promise(ok=>{resolve=ok;}));mocks.candidates.mockResolvedValue([available]);render(<OrgCoreModelPanel orgId="current-org"/>);
 expect(screen.getByTestId("loading")).toBeInTheDocument();expect(screen.queryByText("核心模型未配置")).not.toBeInTheDocument();await act(async()=>resolve(empty));
 expect(await screen.findByText("核心模型未配置")).toBeInTheDocument();expect(screen.getByRole("button",{name:"选择 Verified Model"})).toHaveAttribute("aria-pressed","false");expect(screen.getByRole("button",{name:"保存核心模型选择"})).toBeDisabled();expect(mocks.set).not.toHaveBeenCalled();
 expect(screen.getByText(/仅新默认助手调用继承/)).toBeInTheDocument();expect(screen.getByText(/保存选择不会测试模型或启用供应商/)).toBeInTheDocument();
});
it("empty verified pool offers a next step and cannot save",async()=>{fixture(empty,[]);expect(await screen.findByTestId("empty")).toHaveTextContent("组织正式模型准入");expect(screen.getByRole("button",{name:"保存核心模型选择"})).toBeDisabled();});
it("unavailable models are disabled; explicit verified selection saves only model, version and audit reason",async()=>{
 fixture();expect(await screen.findByRole("button",{name:"选择 Unavailable Model"})).toBeDisabled();mocks.set.mockResolvedValue({version:1,selection,updatedBy:"org-admin",reason:"approved business choice"});await chooseDraft();fireEvent.click(screen.getByRole("button",{name:"保存核心模型选择"}));
 await waitFor(()=>expect(mocks.set).toHaveBeenCalledWith({expectedVersion:0,modelId:available.modelId,reason:"approved business choice"}));expect(await screen.findByText("核心模型选择已保存，变更理由已记录。")).toBeInTheDocument();expect(screen.getByText("最近修改人：org-admin")).toBeInTheDocument();
});
it("changed deployed binding is explicitly unavailable without silently replacing saved selection",async()=>{
 fixture({version:2,selection:{...selection,configRevision:"obsolete"},updatedBy:"admin",reason:"prior decision"});expect(await screen.findByText(/当前配置不可用，或部署配置已变化/)).toBeInTheDocument();expect(screen.getByRole("button",{name:"保存核心模型选择"})).toBeDisabled();expect(mocks.set).not.toHaveBeenCalled();
});
it.each([new Error("offline"),new ApiError(403,"NOT_ORG_ADMIN",null),new ApiError(401,"UNAUTHORIZED",null)])("read failure does not masquerade as unconfigured",async cause=>{
 mocks.get.mockRejectedValue(cause);mocks.candidates.mockResolvedValue([available]);render(<OrgCoreModelPanel orgId="current-org"/>);expect(await screen.findByRole("alert")).toBeInTheDocument();expect(screen.queryByText("核心模型未配置")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"保存核心模型选择"})).not.toBeInTheDocument();
});
it("version conflict blocks save, then refresh adopts latest version while preserving choice and reason",async()=>{
 fixture();await chooseDraft();mocks.set.mockRejectedValueOnce(new ApiError(409,"VERSION_CHANGED",null));fireEvent.click(screen.getByRole("button",{name:"保存核心模型选择"}));expect(await screen.findByRole("alert")).toHaveTextContent("配置已被其他管理员修改");expect(screen.getByRole("button",{name:"保存核心模型选择"})).toBeDisabled();
 mocks.get.mockResolvedValue({...empty,version:3});fireEvent.click(screen.getByRole("button",{name:"刷新并保留草稿"}));await screen.findByText("配置版本 3");expect(screen.getByLabelText("变更理由（写入审计）")).toHaveValue("approved business choice");expect(screen.getByRole("button",{name:"选择 Verified Model"})).toHaveAttribute("aria-pressed","true");
 mocks.set.mockResolvedValue({version:4,selection,updatedBy:"org-admin",reason:"approved business choice"});fireEvent.click(screen.getByRole("button",{name:"保存核心模型选择"}));await waitFor(()=>expect(mocks.set).toHaveBeenLastCalledWith({expectedVersion:3,modelId:available.modelId,reason:"approved business choice"}));
});
it("failed save preserves draft and never announces success",async()=>{
 fixture();await chooseDraft();mocks.set.mockRejectedValueOnce(new ApiError(422,"CORE_MODEL_UNAVAILABLE",null));fireEvent.click(screen.getByRole("button",{name:"保存核心模型选择"}));expect(await screen.findByRole("alert")).toHaveTextContent("所选模型当前不可用");expect(screen.getByLabelText("变更理由（写入审计）")).toHaveValue("approved business choice");expect(screen.queryByText("核心模型选择已保存，变更理由已记录。")).not.toBeInTheDocument();
});
it("withdrawn candidate retains draft but cannot save after refresh",async()=>{
 fixture();await chooseDraft();mocks.candidates.mockResolvedValue([{...available,available:false,reason:"DEPLOYMENT_CHANGED"}]);fireEvent.click(screen.getByRole("button",{name:"刷新配置与候选"}));expect(await screen.findByText(/草稿选择：Verified Model（当前不可用/)).toBeInTheDocument();expect(screen.getByLabelText("变更理由（写入审计）")).toHaveValue("approved business choice");expect(screen.getByRole("button",{name:"保存核心模型选择"})).toBeDisabled();
});
it.each(["success","failure"])("late save %s from prior organization cannot update new organization",async result=>{
 const view=fixture();await chooseDraft();let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;mocks.set.mockImplementation(()=>new Promise((ok,fail)=>{resolve=ok;reject=fail;}));fireEvent.click(screen.getByRole("button",{name:"保存核心模型选择"}));await waitFor(()=>expect(mocks.set).toHaveBeenCalledOnce());view.rerender(<OrgCoreModelPanel orgId="new-org"/>);await screen.findByText("核心模型未配置");
 await act(async()=>{if(result==="success")resolve({version:1,selection,updatedBy:"old-org-admin",reason:"old"});else reject(new ApiError(409,"VERSION_CHANGED",null));});expect(screen.getByText("核心模型未配置")).toBeInTheDocument();expect(screen.queryByText(/最近修改人：old-org-admin/)).not.toBeInTheDocument();expect(screen.queryByRole("alert")).not.toBeInTheDocument();expect(screen.getByLabelText("变更理由（写入审计）")).toHaveValue("");
});
it("late old read is ignored even if transport disregards AbortSignal",async()=>{
 let resolve!:(value:unknown)=>void;mocks.get.mockImplementationOnce(()=>new Promise(ok=>{resolve=ok;})).mockResolvedValue(empty);mocks.candidates.mockResolvedValue([available]);const view=render(<OrgCoreModelPanel orgId="old-org"/>);view.rerender(<OrgCoreModelPanel orgId="new-org"/>);await screen.findByText("核心模型未配置");await act(async()=>resolve({version:9,selection,updatedBy:"old-admin",reason:"old"}));expect(screen.getByText("配置版本 0")).toBeInTheDocument();expect(screen.queryByText("配置版本 9")).not.toBeInTheDocument();
});

it("real adapter uses session-scoped routes and strict public contracts, rejecting private fields",async()=>{
 const adapter=await vi.importActual<typeof import("@/lib/live-org-core-model")>("@/lib/live-org-core-model");
 const fetchMock=vi.fn<typeof fetch>();vi.stubGlobal("fetch",fetchMock);
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(empty),{status:200}));
 expect(await adapter.getOrgCoreModel()).toEqual(empty);expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/organization/core-model");
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([available]),{status:200}));expect(await adapter.getOrgCoreModelCandidates()).toEqual([available]);
 expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/organization/core-model/candidates");
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({...empty,version:1,selection,updatedBy:"admin",reason:"approved"}),{status:200}));
 await adapter.setOrgCoreModel({expectedVersion:0,modelId:available.modelId,reason:" approved "});
 expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({method:"PATCH",body:JSON.stringify({expectedVersion:0,modelId:available.modelId,reason:"approved"})});
 expect(()=>adapter.setOrgCoreModel({expectedVersion:0,modelId:available.modelId,reason:"approved",privateConnectionId:"forged"} as never)).toThrow();expect(fetchMock).toHaveBeenCalledTimes(3);
 fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({...empty,privateConnectionId:"must-not-project"}),{status:200}));await expect(adapter.getOrgCoreModel()).rejects.toThrow();
});

it("unknown deployment metadata stays explicitly unconfigured and cannot be selected",async()=>{fixture(empty,[{modelId:"unknown",displayName:"Unknown Deployment",modelProvider:null,runtimeModelId:null,configRevision:null,available:false,reason:"DEPLOYMENT_BINDING_UNVERIFIED"}]);expect(await screen.findByRole("button",{name:"选择 Unknown Deployment"})).toBeDisabled();expect(screen.getByText(/未配置.*未配置/)).toBeInTheDocument();expect(mocks.set).not.toHaveBeenCalled();});
