import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModelTestCandidates, startModelTest, getModelTest, cancelModelTest, type PlatformModelTestRequest } from "@/lib/live-platform-model-test";
const mock=vi.hoisted(()=>vi.fn());vi.mock("@/lib/api-client",()=>({apiRequest:mock}));
const id="12345678-1234-4234-8234-123456789012";
const input:PlatformModelTestRequest={testId:id,orgId:"org-a",modelId:"registered-id",capability:"text",declaredNonConfidential:true,input:{prompt:"test"},bounds:{maximumCostMicros:"100",timeoutMs:1000,maxOutputTokens:16}};
const record={testId:id,orgId:"org-a",modelId:"registered-id",capability:"text",state:"queued",settlementState:"pending",result:null,failureReason:null,usage:null};
beforeEach(()=>mock.mockReset());
describe("platform model test API contract adapter",()=>{
 it("parses candidate payloads and passes the active abort signal",async()=>{const signal=new AbortController().signal;mock.mockResolvedValue([]);expect(await getModelTestCandidates("org-a",signal)).toEqual([]);expect(mock).toHaveBeenCalledWith("/platform/model-tests/candidates",{query:{orgId:"org-a"},signal});mock.mockResolvedValue([{modelId:"public-only"}]);await expect(getModelTestCandidates("org-a")).rejects.toThrow();});
 it("rejects arbitrary billed user identity and malformed input before any request",async()=>{await expect(startModelTest({...input,userId:"victim"} as PlatformModelTestRequest)).rejects.toThrow();await expect(startModelTest({...input,bounds:{...input.bounds,maximumCostMicros:"0"}})).rejects.toThrow();expect(mock).not.toHaveBeenCalled();});
 it("validates both real start input and response without inventing unknown usage",async()=>{mock.mockResolvedValue(record);expect(await startModelTest(input)).toEqual(record);expect(mock).toHaveBeenCalledWith("/platform/model-tests",{method:"POST",body:input,signal:undefined});mock.mockResolvedValue({...record,usage:{costMicros:"0"}});await expect(startModelTest(input)).rejects.toThrow();});
 it("GET status never changes to a POST or replays model input",async()=>{mock.mockResolvedValue(record);await getModelTest(id,"org-a");expect(mock).toHaveBeenCalledWith(`/platform/model-tests/${id}`,{query:{orgId:"org-a"},signal:undefined});mock.mockClear();await expect(getModelTest("invalid","org-a")).rejects.toThrow();expect(mock).not.toHaveBeenCalled();});
 it("cancel carries only strict org identity and validates its response",async()=>{mock.mockResolvedValue({...record,state:"cancelled",settlementState:"held"});expect((await cancelModelTest(id,"org-a")).settlementState).toBe("held");expect(mock).toHaveBeenCalledWith(`/platform/model-tests/${id}/cancel`,{method:"POST",body:{orgId:"org-a"},signal:undefined});mock.mockResolvedValue({...record,state:"imaginary"});await expect(cancelModelTest(id,"org-a")).rejects.toThrow();});
 it("preserves partial input/output counters independently from a null total",async()=>{
  const usage={tokens:null,inputTokens:null,outputTokens:"6",nativeUnit:"millisecond",nativeQuantity:"1000",costMicros:null,currency:"CNY",priceVersion:"p1"};mock.mockResolvedValue({...record,capability:"speech-to-text",usage});expect((await getModelTest(id,"org-a")).usage).toEqual(usage);mock.mockResolvedValue({...record,usage:{...usage,outputTokens:"-1"}});await expect(getModelTest(id,"org-a")).rejects.toThrow();
 });

});
