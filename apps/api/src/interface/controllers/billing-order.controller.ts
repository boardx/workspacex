import { BillingHttpException } from "./billing-http-exception";
import { traceIdOf } from "../middleware/trace";
import { Controller, Get, Post, Body, Param, Query, Inject, Req, Header } from "@nestjs/common";
import type { z } from "zod";
import { operations } from "@repo/contracts/billing-credits";
import type { Principal } from "../../domain/principal";
import { BillingOrderError, BillingOrderService } from "../../application/billing/billing-order-service";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
@Controller()
export class BillingOrderController {
  constructor(@Inject(BillingOrderService) private readonly service: BillingOrderService) {}
  private async mapped<T>(call: () => Promise<T>) {
    try { return await call(); }
    catch (error) {
      if (error instanceof BillingOrderError) {
        const status = error.code === "forbidden" ? 403 : error.code === "order_not_found" || error.code === "package_not_found" ? 404
          : error.code === "payment_provider_not_configured" ? 503 : error.code === "wechat_upstream_failed" ? 502 : 409;
        throw new BillingHttpException(error.code, status);
      }
      throw error;
    }
  }
  @Get(operations.listPackages.path)
  packages(@CurrentPrincipal() principal: Principal, @Query(new ZodBodyPipe(operations.listPackages.in)) input: z.infer<typeof operations.listPackages.in>) {
    return this.mapped(() => this.service.packages(principal, input));
  }
  @Post(operations.createPaymentOrder.path)
  create(@Req() req: unknown, @CurrentPrincipal() principal: Principal, @Body(new ZodBodyPipe(operations.createPaymentOrder.in)) input: z.infer<typeof operations.createPaymentOrder.in>) {
    return this.mapped(() => this.service.create(principal, input, traceIdOf(req)));
  }
  @Post(operations.cancelPaymentOrder.path)
  cancel(@Req() req: unknown, @CurrentPrincipal() principal: Principal, @Param(new ZodBodyPipe(operations.cancelPaymentOrder.in)) input: z.infer<typeof operations.cancelPaymentOrder.in>) {
    return this.mapped(() => this.service.cancel(principal, input, traceIdOf(req)));
  }
  @Header("Cache-Control", "no-store")
  @Get(operations.getPaymentOrder.path)
  get(@CurrentPrincipal() principal: Principal, @Param(new ZodBodyPipe(operations.getPaymentOrder.in)) input: z.infer<typeof operations.getPaymentOrder.in>) {
    return this.mapped(() => this.service.get(principal, input));
  }
}
