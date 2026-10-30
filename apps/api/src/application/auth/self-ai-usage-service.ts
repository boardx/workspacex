import {createHash} from "node:crypto";
import {aiUsage as C} from "@repo/contracts";
import type {z} from "zod";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {toOrgId} from "../../domain/org-id";
import type {IdentityRepository} from "../identity/ports";
import {AiUsageScopeError,type AiUsageQuery,type AiUsageRepository} from "./ai-usage-ports";
type Summary=z.infer<typeof C.Summary>;
function totals(rows:Summary[],field:"current"|"previous"){
 const names=["inputTokens","outputTokens","totalTokens","creditHundredths"];
 const counts=["callCount","failedCalls","reportedCalls","legacyCalls","unknownCalls","unknownInputCalls","unknownOutputCalls","nativeCalls","pendingCreditCalls"];
 return C.Totals.parse(Object.fromEntries([...names.map(key=>[key,rows.reduce((n,row)=>n+BigInt((row[field] as Record<string,unknown>)[key] as string??"0"),0n).toString()]),...counts.map(key=>[key,rows.reduce((n,row)=>n+Number((row[field] as Record<string,unknown>)[key]??0),0)])]));
}
function groups<T extends object>(rows:T[],keys:(keyof T)[],strings:(keyof T)[],counts:(keyof T)[]):T[]{
 const result=new Map<string,Record<string,unknown>>();
 for(const row of rows){const source=row as Record<string,unknown>,key=JSON.stringify(keys.map(k=>row[k]));const out=result.get(key)??Object.fromEntries(keys.map(k=>[k,row[k]]));
  for(const k of strings)out[String(k)]=(BigInt(out[String(k)] as string??"0")+BigInt(source[String(k)] as string??"0")).toString();
  for(const k of counts)out[String(k)]=Number(out[String(k)]??0)+Number(source[String(k)]??0);result.set(key,out);
 }
 return [...result.values()] as T[];
}
/** Caller identity is fixed; verified membership determines every withTenant read. */
export class SelfAiUsageService{
 constructor(private readonly identity:Pick<IdentityRepository,"listMemberships">,private readonly usage:AiUsageRepository){}
 private async scope(principal:Principal,input:AiUsageQuery){
  assertPrincipal(principal);const q=C.Query.parse(input);
  if(q.userId!==undefined&&q.userId!==principal.userId)throw new AiUsageScopeError("FORBIDDEN");
  const orgs=[...new Set((await this.identity.listMemberships(principal.userId)).map(m=>m.orgId))].sort();
  const query={...q,userId:principal.userId,asOf:q.asOf&&Date.parse(q.asOf)<=Date.now()?q.asOf:new Date().toISOString()};
  return {orgs,query};
 }
 async summary(principal:Principal,input:AiUsageQuery){
  const {orgs,query}=await this.scope(principal,input),rows:Summary[]=[];
  for(const org of orgs)rows.push(await this.usage.summary(toOrgId(org),query));
  const models=groups(rows.flatMap(r=>r.models),["modelProvider","modelId"],["totalTokens"],["callCount"]);
  const members=groups(rows.flatMap(r=>r.members),["userId"],["totalTokens"],["callCount"]);
  const matrix=groups(rows.flatMap(r=>r.matrix),["userId","modelProvider","modelId"],["totalTokens"],["callCount"]);
  const projects=groups(rows.flatMap(r=>r.projects),["projectId"],["totalTokens"],["callCount"]);
  const ranked=<T extends {totalTokens:string}>(items:T[])=>items.sort((a,b)=>BigInt(a.totalTokens)>BigInt(b.totalTokens)?-1:BigInt(a.totalTokens)<BigInt(b.totalTokens)?1:JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return C.Summary.parse({asOf:query.asOf,start:query.start,end:query.end,timezone:query.timezone,coverage:"partial",current:totals(rows,"current"),previous:totals(rows,"previous"),
   costs:groups(rows.flatMap(r=>r.costs??[]),["currency"],["costMicros"],["pricedCalls"]),unpricedCalls:rows.reduce((n,r)=>n+(r.unpricedCalls??0),0),
   dailyCosts:groups(rows.flatMap(r=>r.dailyCosts??[]),["day","currency"],["costMicros"],["pricedCalls"]),
   nativeUnits:groups(rows.flatMap(r=>r.nativeUnits),["unit"],["reportedQuantity","estimatedQuantity"],["reportedCalls","estimatedCalls","unknownCalls"]),
   dispatchIntents:rows.reduce((n,r)=>n+r.dispatchIntents,0),unsettledDispatchIntents:rows.reduce((n,r)=>n+r.unsettledDispatchIntents,0),
   trend:groups(rows.flatMap(r=>r.trend),["day"],["totalTokens"],["callCount"]).sort((a,b)=>a.day.localeCompare(b.day)),
   members:ranked(members).slice(0,200),models:ranked(models).slice(0,100),matrix:ranked(matrix).slice(0,1000),projects:ranked(projects).slice(0,100),
   truncated:{members:members.length>200||rows.some(r=>r.truncated.members),models:models.length>100||rows.some(r=>r.truncated.models),matrix:matrix.length>1000||rows.some(r=>r.truncated.matrix),projects:projects.length>100||rows.some(r=>r.truncated.projects)}});
 }
 async calls(principal:Principal,input:AiUsageQuery){
  const {orgs,query}=await this.scope(principal,input);
  const digest=createHash("sha256").update(JSON.stringify([principal.userId,orgs,{...query,cursorId:undefined,cursorTime:undefined}])).digest("hex");
  let id:string|undefined;
  if(query.cursorId){try{const cursor=JSON.parse(Buffer.from(query.cursorId,"base64url").toString("utf8"));if(cursor.scope!==digest||typeof cursor.id!=="string"||!input.asOf)throw Error();id=cursor.id;}catch{throw new AiUsageScopeError("FORBIDDEN");}}
  const rows:z.infer<typeof C.Calls>[]=[];
  for(const org of orgs)rows.push(await this.usage.calls(toOrgId(org),{...query,cursorId:id}));
  const all=rows.flatMap(r=>r.calls).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id)),calls=all.slice(0,query.limit),last=calls.at(-1);
  const more=all.length>query.limit||rows.some(r=>r.nextCursor);
  return C.Calls.parse({asOf:query.asOf,coverage:"partial",calls,nextCursor:more&&last?{occurredAt:last.occurredAt,id:Buffer.from(JSON.stringify({id:last.id,scope:digest})).toString("base64url")}:null});
 }
}
