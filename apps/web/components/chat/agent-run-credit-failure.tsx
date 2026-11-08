"use client";
import {CreditFailureDetails} from '@/components/billing/credit-consumption-notice';
import {agentRunCreditFailure,creditGuidance} from '@/lib/credit-guidance';
/** Uses only server-owned guidance; legacy failures do not select a personal payer. */
export function AgentRunCreditFailure({error,creditFailure}:{error:string|null;creditFailure?:unknown}) {
 const notice=creditGuidance(agentRunCreditFailure(error,creditFailure));
 return notice?<div className="space-y-2" data-testid="chat-credit-guidance"><CreditFailureDetails notice={notice}/></div>:null;
}
