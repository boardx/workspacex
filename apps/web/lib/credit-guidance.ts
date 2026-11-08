import type {CreditRequiredReason} from "@repo/contracts/billing-consumption";
import {CreditRequiredBody} from "@repo/contracts/billing-consumption";
/** Shared presentation only: never retries a model request or changes its owner. */
export const CREDIT_FAILURE_EVENT = "workspacex:credit-failure";
export type CreditGuidance = { code: "credit_required" | "credit_accounting_unavailable"; ownerType?: "user" | "team"; rechargePath?: string; reason?: CreditRequiredReason };
/** A stale or unrelated scope cannot turn an accounting outage into a recharge action. */
export function agentRunCreditFailure(error:string|null|undefined,raw:unknown):unknown {
 if(error==='CREDIT_REQUIRED'){
  const parsed=CreditRequiredBody.safeParse(raw);
  if(parsed.success)return parsed.data;
 }
 return {code:error};
}
export function creditGuidance(raw: unknown): CreditGuidance | null {
 if (!raw || typeof raw !== "object") return null;
 const data = raw as Record<string, unknown>;
 const sourceCode = data.code ?? data.reasonCode ?? data.reason ?? data.error;
 const code = typeof sourceCode === "string" ? sourceCode.toLowerCase() : "";
 if (code !== "credit_required" && code !== "credit_accounting_unavailable") return null;
 if (code === "credit_accounting_unavailable") return {code};
 const ownerType = data.ownerType === "user" || data.ownerType === "team" ? data.ownerType : undefined;
 const ownerId = typeof data.ownerId === "string" && data.ownerId ? data.ownerId : undefined;
 // Construct from verified account fields, never follow arbitrary error payload URLs.
 const expected = ownerType === "team" && ownerId ? `/billing?ownerType=team&ownerId=${encodeURIComponent(ownerId)}&purchase=1` : ownerType === "user" && ownerId ? "/billing?purchase=1" : undefined;
 if(data.reason === "member_monthly_limit" || data.failureReason === "member_monthly_limit")return {code,ownerType,reason:"member_monthly_limit"};
 return {code, ownerType, ...(expected && data.rechargePath === expected ? {rechargePath:expected} : {})};
}
export function notifyCreditFailure(raw: unknown): boolean {
 const detail = creditGuidance(raw);
 if (!detail) return false;
 if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CREDIT_FAILURE_EVENT,{detail:raw}));
 return true;
}
