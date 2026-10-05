import {afterEach,it,expect,vi} from "vitest";
import {selectImageProvider} from "../../src/infrastructure/agent-run/select-image-provider";
import type {ImageAiAdmission} from "../../src/infrastructure/agent-run/image-ai-admission";
import type {ImageContext} from "../../src/application/agent-run/standard-image-tools";
import type {OrgId} from "../../src/domain/org-id";
const context:ImageContext={orgId:"trusted-org" as OrgId,parentRunId:"trusted-run",attemptId:"trusted-attempt",leaseEpoch:7,bindingId:"native-binding",toolCallId:"tool-call"};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("selected Bailian receives the exact trusted ImageContext and admits once before submit/poll",async()=>{
 const order:string[]=[],terminal=vi.fn(async()=>{}),start=vi.fn(async(_context:ImageContext,_request:Parameters<ImageAiAdmission["start"]>[1])=>{order.push("admit");return {terminal};});
 const selected=selectImageProvider({KERNEL_MODEL_API_KEY:"fixture",KERNEL_IMAGE_PROVIDER:"bailian",KERNEL_AI_PRODUCT_QUOTA_ENABLED:"1",KERNEL_BAILIAN_IMAGE_POLL_INTERVAL_MS:"1"},undefined,{start});
 const fetcher=vi.fn(async(_url:unknown,opts?:RequestInit)=>{order.push(opts?.method==="POST"?"submit":"poll");return Response.json(opts?.method==="POST"?{output:{task_id:"fixture_task"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://fixture.invalid/image.png"}]},usage:{image_count:1}});});vi.stubGlobal("fetch",fetcher);
 expect(selected?.choice).toBe("bailian");await selected!.provider.generateImage("image",undefined,context);
 expect(order).toEqual(["admit","submit","poll"]);expect(start.mock.calls[0]?.[0]).toBe(context);expect(start).toHaveBeenCalledTimes(1);expect(terminal).toHaveBeenCalledWith(expect.objectContaining({quantity:1n}));
});
it("selected OpenAI receives trusted context through the native admission option",async()=>{
 const terminal=vi.fn(async()=>{}),start=vi.fn(async(_context:ImageContext,_request:Parameters<ImageAiAdmission["start"]>[1])=>({terminal}));
 const selected=selectImageProvider({OPENAI_API_KEY:"fixture",KERNEL_IMAGE_PROVIDER:"openai",KERNEL_AI_PRODUCT_QUOTA_ENABLED:"1"},undefined,{start});
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({data:[{b64_json:Buffer.from("fixture-image").toString("base64")}]})));
 await selected!.provider.generateImage("image",undefined,context);expect(start.mock.calls[0]?.[0]).toBe(context);expect(start).toHaveBeenCalledTimes(1);expect(terminal).toHaveBeenCalledWith(expect.objectContaining({quantity:null}));
});
it("native wiring rejection prevents selected provider HTTP and does not use legacy accounting",async()=>{
 const native:ImageAiAdmission={start:vi.fn(async()=>{throw new Error("AI_IMAGE_POLICY_UNCONFIGURED");})},legacy={start:vi.fn(async()=>({terminal:vi.fn(async()=>{})}))};
 const selected=selectImageProvider({OPENAI_API_KEY:"fixture",KERNEL_IMAGE_PROVIDER:"openai",KERNEL_AI_PRODUCT_QUOTA_ENABLED:"1"},legacy,native),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 await expect(selected!.provider.generateImage("image",undefined,context)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();expect(legacy.start).not.toHaveBeenCalled();
});
it("quota-enabled selection without native bounds cannot dispatch to either provider",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 expect(()=>selectImageProvider({KERNEL_MODEL_API_KEY:"fixture",KERNEL_IMAGE_PROVIDER:"bailian",KERNEL_AI_PRODUCT_QUOTA_ENABLED:"1"})).toThrow("BAILIAN_IMAGE_ACCOUNTING_NOT_IMPLEMENTED");
 const openai=selectImageProvider({OPENAI_API_KEY:"fixture",KERNEL_IMAGE_PROVIDER:"openai",KERNEL_AI_PRODUCT_QUOTA_ENABLED:"1"});
 await expect(openai!.provider.generateImage("image",undefined,context)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
