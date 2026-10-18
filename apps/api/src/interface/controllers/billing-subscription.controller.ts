import { traceIdOf } from "../middleware/trace";
import { SubscriptionHttpException } from "./subscription-http-exception";
import { Controller, Get, Header, Inject, Req, Query, ServiceUnavailableException } from "@nestjs/common";
import { operations } from "@repo/contracts/billing-subscription";
import type { z } from "zod";
import type { Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { BillingSubscriptionService, SubscriptionError } from "../../application/billing/billing-subscription-service";
@Controller()
export class BillingSubscriptionController {
  constructor(@Inject(BillingSubscriptionService) private readonly service: BillingSubscriptionService) {}
  private async mapped<T>(run: () => Promise<T>) {
    try { return await run(); }
    catch (error) {
      if (error instanceof SubscriptionError) {
        if (error.code === "dependency_unavailable") throw new ServiceUnavailableException();
        throw new SubscriptionHttpException(error.code, error.code === "payment_provider_not_configured" ? 503 : 409);
      }
      throw error;
    }
  }
  @Header("Cache-Control", "no-store")
  @Get(operations.getSubscriptionInfo.path)
  info(@Req() req: unknown, @CurrentPrincipal() principal: Principal, @Query(new ZodBodyPipe(operations.getSubscriptionInfo.in)) _input: z.infer<typeof operations.getSubscriptionInfo.in>) {
    return this.mapped(() => this.service.info(principal, traceIdOf(req)));
  }
  @Header("Cache-Control", "no-store")
  @Get(operations.getUpgradeLink.path)
  upgrade(@Req() req: unknown, @CurrentPrincipal() principal: Principal, @Query(new ZodBodyPipe(operations.getUpgradeLink.in)) _input: z.infer<typeof operations.getUpgradeLink.in>) {
    return this.mapped(() => this.service.upgrade(principal, traceIdOf(req)));
  }
  @Header("Cache-Control", "no-store")
  @Get(operations.getManagementLink.path)
  management(@Req() req: unknown, @CurrentPrincipal() principal: Principal, @Query(new ZodBodyPipe(operations.getManagementLink.in)) _input: z.infer<typeof operations.getManagementLink.in>) {
    return this.mapped(() => this.service.management(principal, traceIdOf(req)));
  }
}
