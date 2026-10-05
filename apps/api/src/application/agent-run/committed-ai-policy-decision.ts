import type {DatabasePort,TenantSession} from "../ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {AiQuotaPolicyError} from "./ai-quota-policy-error";
/** A typed pre-dispatch refusal must not roll back its immutable rule audit.
 * SQL/ownership/accounting faults still roll back the whole transaction.
 */
export async function withCommittedAiPolicyDecision<T>(db:DatabasePort,orgId:OrgId,work:(s:TenantSession)=>Promise<T>):Promise<T>{
 const result=await db.withTenant(orgId,async s=>{
  try{return {value:await work(s)};}
  catch(error){if(error instanceof AiQuotaPolicyError)return {refusal:error};throw error;}
 });
 if("refusal" in result)throw result.refusal;
 return result.value;
}
