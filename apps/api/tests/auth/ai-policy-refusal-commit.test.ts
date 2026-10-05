import {it,expect,vi} from "vitest";
import {withCommittedAiPolicyDecision} from "../../src/application/agent-run/committed-ai-policy-decision";
import {AiQuotaPolicyError} from "../../src/application/agent-run/ai-quota-policy-error";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("refusal-org");
function fixture(){let committed=false,rolledBack=false;const session={query:vi.fn()};return {db:{withTenant:async(tenant:unknown,work:(s:unknown)=>Promise<unknown>)=>{expect(tenant).toBe(org);try{const result=await work(session);committed=true;return result;}catch(error){rolledBack=true;throw error;}}} as never,session,state:()=>({committed,rolledBack})};}
it("commits a typed pre-dispatch rule refusal before propagating it",async()=>{
 const f=fixture(),error=new AiQuotaPolicyError("AI_LIMIT_RULE_BLOCKED");
 await expect(withCommittedAiPolicyDecision(f.db,org,async s=>{expect(s).toBe(f.session);throw error;})).rejects.toBe(error);
 expect(f.state()).toEqual({committed:true,rolledBack:false});
});
it("rolls back SQL and ownership faults, even with a refusal-looking message",async()=>{
 const f=fixture(),error=new Error("AI_LIMIT_RULE_BLOCKED");
 await expect(withCommittedAiPolicyDecision(f.db,org,async()=>{throw error;})).rejects.toBe(error);
 expect(f.state()).toEqual({committed:false,rolledBack:true});
});
it("preserves successful transaction results",async()=>{
 const f=fixture();expect(await withCommittedAiPolicyDecision(f.db,org,async()=>42)).toBe(42);
 expect(f.state()).toEqual({committed:true,rolledBack:false});
});
