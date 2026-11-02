import {HttpException} from "@nestjs/common";
import {TeamBillingErrorCode} from "@repo/contracts/billing-team";
export const ENTERPRISE_CACHE_CONTROL="private, no-store";
export class EnterpriseHttpException extends HttpException {
 constructor(readonly enterpriseCode:string,status:number){super({code:TeamBillingErrorCode.parse(enterpriseCode)},status);}
}
