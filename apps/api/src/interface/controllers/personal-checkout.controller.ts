import { Body, Controller, Header, Inject, Post, ServiceUnavailableException } from "@nestjs/common";
import { operations } from "@repo/contracts/billing-pricing";
import type { z } from "zod";
import type { Principal } from "../../domain/principal";
import { PersonalCheckoutService } from "../../application/billing/personal-checkout-service";
import { PersonalCheckoutError } from "../../application/billing/personal-checkout-error";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { PersonalCheckoutHttpException } from "./personal-checkout-http-exception";

@Controller()
export class PersonalCheckoutController {
  constructor(@Inject(PersonalCheckoutService) private readonly service: PersonalCheckoutService) {}
  @Header("Cache-Control", "no-store")
  @Post(operations.createPersonalCheckout.path)
  async checkout(@CurrentPrincipal() principal: Principal, @Body(new ZodBodyPipe(operations.createPersonalCheckout.in)) input: z.infer<typeof operations.createPersonalCheckout.in>) {
    try { return await this.service.checkout(principal, input); }
    catch (error) {
      if (error instanceof PersonalCheckoutError) {
        if (error.code === "dependency_unavailable") throw new ServiceUnavailableException();
        throw new PersonalCheckoutHttpException(error.code, error.code === "payment_provider_not_configured" ? 503 : 409);
      }
      throw error;
    }
  }
}
