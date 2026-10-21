import { Controller, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { operations } from "@repo/contracts/billing-subscription";
import { BillingStripeWebhookService } from "../../application/billing/billing-stripe-webhook-service";
import { Public } from "../public.decorator";
import { traceIdOf } from "../middleware/trace";
@Controller()
export class BillingStripeWebhookController {
  constructor(@Inject(BillingStripeWebhookService) private readonly service: BillingStripeWebhookService) {}
  @Public()
  @Post(operations.stripeWebhook.path)
  async notify(@Req() request: Request,@Res() response: Response): Promise<void> {
    const result=await this.service.handle(request.body,request.headers["stripe-signature"],traceIdOf(request));
    response.status(result.status).json(result.body);
  }
}
