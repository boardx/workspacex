import { Controller, Get, Inject } from "@nestjs/common";
import { operations } from "@repo/contracts/billing-credits";
import { BILLING_CONFIG_PORT, type BillingConfigPort } from "../../application/billing/billing-config.port";
import { Public } from "../public.decorator";

@Controller()
export class BillingConfigController {
  constructor(@Inject(BILLING_CONFIG_PORT) private readonly config: BillingConfigPort) {}
  @Public()
  @Get(operations.getBillingConfig.path)
  getConfig() {
    return operations.getBillingConfig.out.parse(this.config.getPublicConfig());
  }
}
