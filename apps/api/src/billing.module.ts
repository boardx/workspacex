// Billing composition root: infrastructure credentials remain outside application/interface layers.
import { Module } from "@nestjs/common";
import { BILLING_CONFIG_PORT } from "./application/billing/billing-config.port";
import { DeploymentBillingConfig } from "./infrastructure/billing/deployment-billing-config";
import { BillingConfigController } from "./interface/controllers/billing-config.controller";

@Module({
  controllers: [BillingConfigController],
  providers: [
    { provide: DeploymentBillingConfig, useFactory: () => new DeploymentBillingConfig() },
    { provide: BILLING_CONFIG_PORT, useExisting: DeploymentBillingConfig },
  ],
  exports: [BILLING_CONFIG_PORT, DeploymentBillingConfig],
})
export class BillingModule {}
