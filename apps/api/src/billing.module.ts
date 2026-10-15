import { LOGGER_PORT, type LoggerPort } from "./application/ports/logger.port";
import { ConsoleLogger } from "./infrastructure/logging/console-logger";
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
import { BillingOrderService } from "./application/billing/billing-order-service";
import { PgBillingOrderRepository } from "./infrastructure/billing/pg-billing-order-repository";
import { WechatNativeClient } from "./infrastructure/billing/wechat-native-client";
import { BillingOrderController } from "./interface/controllers/billing-order.controller";

@Module({
  imports: [IdentityPersistenceModule],
  controllers: [BillingConfigController, BillingWalletController, BillingOrderController],
  providers: [
    { provide: LOGGER_PORT, useFactory: () => new ConsoleLogger() },
    { provide: DeploymentBillingConfig, useFactory: () => new DeploymentBillingConfig() },
    { provide: BILLING_CONFIG_PORT, useExisting: DeploymentBillingConfig },
    { provide: BillingOrderService,
      useFactory: (db: DatabasePort, identity: IdentityRepository, config: DeploymentBillingConfig, logger: LoggerPort) =>
        new BillingOrderService(new PgBillingOrderRepository(db), identity, config, new WechatNativeClient(config, logger)),
      inject: [DATABASE_PORT, IDENTITY_REPOSITORY, DeploymentBillingConfig, LOGGER_PORT],
    },
    { provide: BillingWalletService,
      useFactory: (db:DatabasePort, identity:IdentityRepository, credentials:CredentialRepository, platformAdmins:PlatformAdminRepository) =>
        new BillingWalletService(new PgBillingWalletRepository(db),identity,userId=>isRequestorPlatformOperator({credentials,platformAdmins},userId)),
      inject:[DATABASE_PORT,IDENTITY_REPOSITORY,CREDENTIAL_REPOSITORY,PLATFORM_ADMIN_REPOSITORY],
    },
  ],
  exports: [BILLING_CONFIG_PORT, DeploymentBillingConfig],
})
export class BillingModule {}
