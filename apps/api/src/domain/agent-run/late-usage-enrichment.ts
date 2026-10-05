/** Same physical request, only monotonic filling of unknown billable dimensions.
 * Reported-value replacement requires a separate verified supplier revision protocol.
 */
export type UsageFacts=Readonly<Record<string,string|number|null>>;
const counters=["tokens_prompt","tokens_completion","tokens_cache_input","tokens_reasoning_output","cost_micros","native_quantity"] as const;
const equal=(a:unknown,b:unknown)=>a===b||(a!==null&&b!==null&&String(a)===String(b));
export function enrichLateUsage(current:UsageFacts,incoming:UsageFacts):UsageFacts|null {
 const merged:Record<string,string|number|null>={...current};
 let changed=false;
 for(const key of counters){
  if(key==="native_quantity"&&current.native_source!=="reported")continue;
  const next=incoming[key]??null,previous=current[key]??null;
  if(next===null)continue;
  if(previous!==null&&!equal(previous,next))throw new Error("AI_USAGE_KNOWN_VALUE_CONFLICT");
  if(previous===null){merged[key]=next;changed=true;}
 }
 for(const [source,value] of [["total_source","tokens_total"],["native_source","native_quantity"]] as const){
  if(incoming[source]===undefined||incoming[source]===null||incoming[source]==="unknown")continue;
  if(current[source]!=="unknown"&&current[source]!==null&&current[source]!==undefined&&!(source==="native_source"&&current[source]==="estimated")){
   if(!equal(current[source],incoming[source])||!equal(current[value],incoming[value]))throw new Error("AI_USAGE_KNOWN_VALUE_CONFLICT");
  }else{merged[source]=incoming[source]!;merged[value]=incoming[value]??null;changed=true;}
 }
 for(const key of ["currency","price_version","native_unit"]){
  const next=incoming[key]??null,previous=current[key]??null;if(next===null)continue;
  if(previous!==null&&!equal(previous,next))throw new Error("AI_USAGE_PRICE_OR_UNIT_CONFLICT");
  if(previous===null){merged[key]=next;changed=true;}
 }
 if(merged.tokens_cache_input!==null&&merged.tokens_prompt!==null&&BigInt(merged.tokens_cache_input!)>BigInt(merged.tokens_prompt!))throw new Error("AI_USAGE_SUBSET_CONFLICT");
 if(merged.tokens_reasoning_output!==null&&merged.tokens_completion!==null&&BigInt(merged.tokens_reasoning_output!)>BigInt(merged.tokens_completion!))throw new Error("AI_USAGE_SUBSET_CONFLICT");
 return changed?Object.freeze(merged):null;
}
