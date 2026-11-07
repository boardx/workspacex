import { HttpException } from "@nestjs/common";
import type { operations } from "@repo/contracts/billing-pricing";
/** Only operation-declared codes may cross the production error boundary. */
export class PersonalCheckoutHttpException extends HttpException {
  constructor(readonly checkoutCode: typeof operations.createPersonalCheckout.err[number], status: number) {
    super({ code: checkoutCode }, status);
  }
}
