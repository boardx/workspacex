import {it,expect,vi} from "vitest";
import {evaluateAtomicAiLimitRules} from "../../src/infrastructure/auth/pg-ai-admission-repository";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("rule-org"),input={requestId:"physical",userId:"u",formalModelId:"primary",agentId:null,windowStart:"2026-10-01T00:00:00Z",windowEnd:"2026-11-01T00:00:00Z",maximumTokens:4n,maximumCostMicros:4n,modelProvider:"route",modelId:"runtime",currency:"CNY",priceVersion:"v",tokenPolicy:{primaryModelId:"primary",selectedModelId:"primary",allowDegradation:true}};
const rule={id:"r",scope_kind:"member",scope_ref:"u",model_id:null,window_kind:"month",threshold_tokens:"10",action:"block",degrade_to_model_id:null};
function fixture(rules:Array<Omit<typeof rule,"degrade_to_model_id">&{degrade_to_model_id:string|null}>=[rule],tokens="7",previous:unknown=null,unknown="0"){
 const query=vi.fn(async(sql:string,_args?:unknown[])=>({rows:sql.startsWith("SELECT input,result")?(previous?[previous]:[]):sql.includes("SELECT user_id,org_role")?[{user_id:"u",org_role:"member",team_id:"t"}]:sql.includes("FROM limit_rules")?rules:sql.startsWith("WITH counters")?[{tokens,unknown}]:[]}));
 const db={withTenant:vi.fn(()=>{throw new Error("nested pool checkout");})};
 return {query,db:db as never,s:{query} as never};
}
it("projects maximum and records the event/decision in the caller transaction",async()=>{
 const f=fixture();expect(await evaluateAtomicAiLimitRules(f.db,f.s,org,input,[])).toEqual({decision:"AI_LIMIT_RULE_BLOCKED"});
 const counter=f.query.mock.calls.find(([sql])=>sql.startsWith("WITH counters"))![0];
 expect(counter).toContain("r.state='held'");expect(counter).toContain("GREATEST(r.maximum_tokens");expect(counter).toContain("AT TIME ZONE 'UTC'");
 expect(f.query.mock.calls.filter(([sql])=>sql.includes("INSERT INTO limit_events"))).toHaveLength(1);
 expect(f.query.mock.calls.filter(([sql])=>sql.includes("INSERT INTO ai_limit_rule_decisions"))).toHaveLength(1);
});
it("replays one physical rule decision without emitting another event",async()=>{
 const stored={input:JSON.parse(JSON.stringify({...input,maximumTokens:"4",maximumCostMicros:"4"})),result:{decision:"AI_LIMIT_RULE_BLOCKED"}};
 const f=fixture([rule],"7",stored);expect(await evaluateAtomicAiLimitRules(f.db,f.s,org,input,[])).toEqual(stored.result);
 expect(f.query).toHaveBeenCalledTimes(1);
 await expect(evaluateAtomicAiLimitRules(f.db,f.s,org,{...input,maximumTokens:5n},[])).rejects.toThrow("AI_LIMIT_RULE_REPLAY_MISMATCH");
});
it("warn permits and approval denies without manufacturing approval",async()=>{
 for(const [action,result] of [["warn",{decision:"allowed",tokenWarning:true}],["require_approval",{decision:"AI_LIMIT_APPROVAL_REQUIRED"}]] as const){
  const f=fixture([{...rule,action}]);expect(await evaluateAtomicAiLimitRules(f.db,f.s,org,input,[])).toEqual(result);
 }
});
it("requires the precise authorized cheap target and forbids confidential degradation",async()=>{
 const target={...rule,action:"degrade",degrade_to_model_id:"cheap"};
 for(const [allowed,subject,result] of [[[],input,{decision:"AI_LIMIT_RULE_BLOCKED"}],[["cheap"],input,{decision:"AI_TOKEN_DEGRADE_REQUIRED",degradeToModelId:"cheap"}],[["cheap"],{...input,tokenPolicy:{...input.tokenPolicy,allowDegradation:false}},{decision:"AI_LIMIT_RULE_BLOCKED"}],[["cheap"],{...input,formalModelId:"cheap"},{decision:"allowed",tokenWarning:true}]] as const){
  const f=fixture([target]);expect(await evaluateAtomicAiLimitRules(f.db,f.s,org,subject,allowed)).toEqual(result);
 }
});
it("ignores unrelated scopes and refuses unverified agent attribution",async()=>{
 const f=fixture([{...rule,scope_ref:"other"}]);expect(await evaluateAtomicAiLimitRules(f.db,f.s,org,input,[])).toEqual({decision:"allowed"});
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith("WITH counters"))).toBe(false);
 const agent=fixture([{...rule,scope_kind:"agent"}]);await expect(evaluateAtomicAiLimitRules(agent.db,agent.s,org,{...input,agentId:undefined},[])).rejects.toThrow("AI_AGENT_SCOPE_UNVERIFIED");
});

it("freezes untriggered and unknown decisions, and includes unmatched durable starts",async()=>{
 const clear=fixture([],"0");expect(await evaluateAtomicAiLimitRules(clear.db,clear.s,org,input,[])).toEqual({decision:"allowed"});
 expect(clear.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO ai_limit_rule_decisions"))).toBe(true);
 const unknown=fixture([rule],"0",null,"1");expect(await evaluateAtomicAiLimitRules(unknown.db,unknown.s,org,input,[])).toEqual({decision:"TOKEN_LIMIT_UNCONFIGURED"});
 expect(unknown.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO ai_limit_rule_decisions"))).toBe(true);
 expect(unknown.query.mock.calls.find(([sql])=>sql.startsWith("WITH counters"))![0]).toContain("FROM model_request_starts pending");
 expect(unknown.query.mock.calls.some(([sql])=>sql.includes("ORDER BY user_id FOR SHARE"))).toBe(true);
});

it("private candidate slots retain independent immutable audits under one physical request",async()=>{
 const first=fixture(),second=fixture();
 await evaluateAtomicAiLimitRules(first.db,first.s,org,{...input,logicalAttempt:0},[]);
 await evaluateAtomicAiLimitRules(second.db,second.s,org,{...input,formalModelId:"cheap",logicalAttempt:1,candidateDecisionSlot:1},[]);
 const ids=[first,second].map(f=>(f.query.mock.calls.find(([sql])=>sql.includes("INSERT INTO ai_limit_rule_decisions")) as unknown as [string,unknown[]])[1][1]);
 expect(ids).toEqual(["physical",JSON.stringify(["private-candidate","physical",1])]);
 await expect(evaluateAtomicAiLimitRules(first.db,first.s,org,{...input,logicalAttempt:0,candidateDecisionSlot:1},[])).rejects.toThrow("AI_LIMIT_RULE_SLOT_INVALID");
});
