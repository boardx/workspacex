import { HttpException } from "@nestjs/common";
import type { BillingErrorCode } from "@repo/contracts/billing-credits";
/** Only this boundary may expose a validated billing code. */
export class BillingHttpException extends HttpException {
  constructor(readonly billingCode: BillingErrorCode, status: number) {
    super({ code: billingCode }, status);
  }
}
