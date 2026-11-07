import { Controller, Get, Header, Inject, Query, ServiceUnavailableException } from "@nestjs/common";
import { operations } from "@repo/contracts/billing-pricing";
import type { Principal } from "../../domain/principal";
import { PersonalEntitlementService } from "../../application/billing/personal-entitlement-service";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
@Controller()
export class PersonalEntitlementController {
  constructor(@Inject(PersonalEntitlementService) private readonly service: PersonalEntitlementService) {}
  @Header("Cache-Control", "no-store")
  @Get(operations.getPricingEntitlement.path)
  async read(@CurrentPrincipal() principal: Principal, @Query(new ZodBodyPipe(operations.getPricingEntitlement.in)) _input: Record<string, never>) {
    try { return await this.service.read(principal); }
    catch { throw new ServiceUnavailableException(); }
  }
}
