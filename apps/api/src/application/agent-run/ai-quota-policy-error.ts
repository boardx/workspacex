import type {AiAdmissionDecision} from "../../domain/agent-run/ai-budget";
/** Typed pre-dispatch budget decisions; provider/detail text cannot request a model downgrade. */
export class AiQuotaPolicyError extends Error {
 constructor(readonly decision:Exclude<AiAdmissionDecision,"allowed">,readonly degradeToModelId?:string){super(decision);this.name="AiQuotaPolicyError";}
}
