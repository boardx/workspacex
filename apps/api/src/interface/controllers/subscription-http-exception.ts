import { HttpException } from "@nestjs/common";
import type { SubscriptionErrorCode } from "@repo/contracts/billing-subscription";
/** Explicit closed subscription-code boundary; arbitrary exception details stay private. */
export class SubscriptionHttpException extends HttpException {
  constructor(readonly subscriptionCode: SubscriptionErrorCode, status: number) {
    super({ code: subscriptionCode }, status);
  }
}
