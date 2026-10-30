import type { z } from "zod";
import { aiUsage as C } from "@repo/contracts";
import { apiRequest } from "./api-client";
export type UsageQuery=z.infer<typeof C.Query>;
export type UsageSummary=z.infer<typeof C.Summary>;
export type UsageCalls=z.infer<typeof C.Calls>;
function path(orgId:string,platform:boolean,input:UsageQuery,calls:boolean,self=false){
 const query=new URLSearchParams();
 for(const [key,value] of Object.entries(input)) if(value!==undefined) query.set(key,String(value));
 const operation=self?(calls?C.operations.selfCalls:C.operations.selfSummary):platform?(calls?C.operations.platformCalls:C.operations.platformSummary):(calls?C.operations.calls:C.operations.summary);
 return `${operation.path.replace(":orgId",encodeURIComponent(orgId))}?${query}`;
}
export const readAiUsage=(orgId:string,platform:boolean,input:UsageQuery,self=false)=>apiRequest<unknown>(path(orgId,platform,input,false,self)).then(out=>C.Summary.parse(out));
export const readAiUsageCalls=(orgId:string,platform:boolean,input:UsageQuery,self=false)=>apiRequest<unknown>(path(orgId,platform,input,true,self)).then(out=>C.Calls.parse(out));
