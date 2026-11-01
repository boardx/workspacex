import { Controller, Get, Inject, Query, ServiceUnavailableException } from "@nestjs/common";
import { operations } from "@repo/contracts/billing-pricing";
import type { z } from "zod";
import type { Principal } from "../../domain/principal";
import { BillingCatalogService, BillingCatalogUnavailableError } from "../../application/billing/billing-catalog-service";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
export class BillingCatalogController {
  constructor(@Inject(BillingCatalogService) private readonly service: BillingCatalogService) {}
  @Get(operations.getPricingCatalog.path)
  catalog(@CurrentPrincipal() principal: Principal, @Query(new ZodBodyPipe(operations.getPricingCatalog.in)) _query: z.infer<typeof operations.getPricingCatalog.in>) {
    try { return this.service.catalog(principal); }
    catch (error) {
      if (error instanceof BillingCatalogUnavailableError) throw new ServiceUnavailableException("billing_catalog_unavailable");
      throw error;
    }
  }
}
