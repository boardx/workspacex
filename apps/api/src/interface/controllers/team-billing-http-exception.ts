import {HttpException} from "@nestjs/common";
import {TeamBillingErrorCode} from "@repo/contracts/billing-team";
/** Closed operation error vocabulary, consumed by the existing global envelope. */
type TeamCode=(typeof TeamBillingErrorCode.options)[number];
export class TeamBillingHttpException extends HttpException{
 readonly billingTeamCode:TeamCode;
 constructor(code:TeamCode,status:number){super({code:TeamBillingErrorCode.parse(code)},status);this.billingTeamCode=code;}
}
