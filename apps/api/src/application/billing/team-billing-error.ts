import {TeamBillingErrorCode} from "@repo/contracts/billing-team";
type TeamCode=(typeof TeamBillingErrorCode.options)[number];
/** Only the shared closed vocabulary crosses into an HTTP handler. Cause remains private diagnostics. */
export class TeamBillingError extends Error{
 readonly code:TeamCode;
 constructor(code:TeamCode,options?:ErrorOptions){super(code,options);this.code=TeamBillingErrorCode.parse(code);}
}
