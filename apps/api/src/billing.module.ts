// Billing composition root: infrastructure credentials remain outside application/interface layers.
import { Module } from "@nestjs/common";
import { BILLING_CONFIG_PORT } from "./application/billing/billing-config.port";
import { DeploymentBillingConfig } from "./infrastructure/billing/deployment-billing-config";
import { BillingConfigController } from "./interface/controllers/billing-config.controller";
import { IdentityPersistenceModule } from "./infrastructure/identity/identity-persistence.module";
import { DATABASE_PORT, type DatabasePort } from "./application/ports/database.port";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "./application/identity/ports";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "./application/auth/ports";
import { PLATFORM_ADMIN_REPOSITORY, type PlatformAdminRepository } from "./application/system/platform-admin-ports";
import { isRequestorPlatformOperator } from "./application/system/platform-operator-check";
import { BillingWalletService } from "./application/billing/billing-wallet-service";
import { PgBillingWalletRepository } from "./infrastructure/billing/pg-billing-wallet-repository";
import { BillingWalletController } from "./interface/controllers/billing-wallet.controller";

@Module({
  imports: [IdentityPersistenceModule],
  controllers: [BillingConfigController, BillingWalletController],
  providers: [
    { provide: DeploymentBillingConfig, useFactory: () => new DeploymentBillingConfig() },
    { provide: BILLING_CONFIG_PORT, useExisting: DeploymentBillingConfig },
    { provide: BillingWalletService,
      useFactory: (db:DatabasePort, identity:IdentityRepository, credentials:CredentialRepository, platformAdmins:PlatformAdminRepository) =>
        new BillingWalletService(new PgBillingWalletRepository(db),identity,userId=>isRequestorPlatformOperator({credentials,platformAdmins},userId)),
      inject:[DATABASE_PORT,IDENTITY_REPOSITORY,CREDENTIAL_REPOSITORY,PLATFORM_ADMIN_REPOSITORY],
    },
  ],
  exports: [BILLING_CONFIG_PORT, DeploymentBillingConfig],
})
export class BillingModule {}
