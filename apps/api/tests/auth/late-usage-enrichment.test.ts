import {it,expect} from "vitest";
import {enrichLateUsage,type UsageFacts} from "../../src/domain/agent-run/late-usage-enrichment";
const unknown:UsageFacts={tokens_total:0,total_source:"unknown",tokens_prompt:null,tokens_completion:null,tokens_cache_input:null,tokens_reasoning_output:null,cost_micros:null,currency:null,price_version:null,native_unit:null,native_quantity:null,native_source:null};
it("monotonic facts preserve earlier partial counters and ignore a later unknown replay",()=>{
 const partial=enrichLateUsage(unknown,{...unknown,tokens_prompt:7})!;
 const reported=enrichLateUsage(partial,{...unknown,total_source:"reported",tokens_total:10,tokens_prompt:7,tokens_completion:3,cost_micros:"20",currency:"CNY",price_version:"original-price"})!;
 expect(reported).toMatchObject({total_source:"reported",tokens_total:10,tokens_prompt:7,cost_micros:"20"});expect(unknown.total_source).toBe("unknown");
 expect(enrichLateUsage(reported,unknown)).toBeNull();expect(enrichLateUsage(reported,reported)).toBeNull();
});
it("known reported zero cannot be mistaken for missing",()=>{
 expect(()=>enrichLateUsage({...unknown,total_source:"reported"},{...unknown,total_source:"reported",tokens_total:1})).toThrow("KNOWN_VALUE_CONFLICT");
});
it("independently arriving subset cannot exceed earlier reported parent",()=>{
 expect(()=>enrichLateUsage({...unknown,tokens_prompt:2},{...unknown,tokens_cache_input:3})).toThrow("SUBSET_CONFLICT");
});
