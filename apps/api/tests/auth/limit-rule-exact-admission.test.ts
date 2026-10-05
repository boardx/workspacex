import {it,expect} from "vitest";
import {pickFirstTriggeredExact} from "../../src/domain/auth/limit-rule-evaluation";
const rule=(ruleId:string,observedTokens:bigint,thresholdTokens=9007199254740993n,enabled=true)=>({ruleId,observedTokens,thresholdTokens,enabled});
it("orders counters beyond Number precision and includes the exact threshold",()=>{
 const lower=rule("a",9007199254740993n),higher=rule("z",9007199254740994n);
 expect(pickFirstTriggeredExact([lower,higher])).toBe(higher);
 expect(pickFirstTriggeredExact([lower])).toBe(lower);
 expect(pickFirstTriggeredExact([rule("below",9007199254740992n)])).toBeNull();
});
it("compares denominators and deterministic ties without disabled rules",()=>{
 const a=rule("a",10n,5n),z=rule("z",20n,10n);
 expect(pickFirstTriggeredExact([z,a])).toBe(a);
 expect(pickFirstTriggeredExact([rule("disabled",100n,1n,false),a,rule("more",7n,3n)])?.ruleId).toBe("more");
});
it("rejects invalid counters",()=>{
 expect(()=>pickFirstTriggeredExact([rule("invalid",-1n)])).toThrow("INVALID_LIMIT_RULE_COUNTER");
 expect(()=>pickFirstTriggeredExact([rule("invalid",0n,0n)])).toThrow("INVALID_LIMIT_RULE_COUNTER");
});
