import {PersonalCreditPeriodWorker} from "./infrastructure/billing/personal-credit-period-worker";
import { PersonalCheckoutController } from "./interface/controllers/personal-checkout.controller";
import { PersonalCheckoutService } from "./application/billing/personal-checkout-service";
import { PgPersonalCheckoutRepository } from "./infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "./infrastructure/billing/pg-personal-payment-repository";
import { PersonalCheckoutRouter } from "./infrastructure/billing/personal-checkout-router";
import { PersonalStripeCheckoutClient } from "./infrastructure/billing/personal-stripe-checkout-client";
import { PersonalWechatPaymentClient } from "./infrastructure/billing/personal-wechat-payment-client";
import { PersonalWechatCreditingStore } from "./infrastructure/billing/personal-wechat-crediting-store";
import { PersonalStripeWebhookStore } from "./infrastructure/billing/personal-stripe-webhook-store";
import { PgPersonalOrderReader } from "./infrastructure/billing/pg-personal-order-reader";
import { PgPersonalSubscriptionAccess } from "./infrastructure/billing/pg-personal-subscription-access";
import { PersonalPaymentReconciler } from "./infrastructure/billing/personal-payment-reconciler";
import { PgPersonalPaymentRecoveryStore } from "./infrastructure/billing/pg-personal-payment-recovery-store";
import { PersonalPaymentRecoveryWorker } from "./infrastructure/billing/personal-payment-recovery-worker";
import { PersonalEntitlementController } from "./interface/controllers/personal-entitlement.controller";
import { PersonalEntitlementService } from "./application/billing/personal-entitlement-service";
import { PgPersonalEntitlementRepository } from "./infrastructure/billing/pg-personal-entitlement-repository";
import {PgPersonalCreditScheduleStore} from "./infrastructure/billing/pg-personal-credit-schedule-store";
import {StripeCreditCheckout} from "./infrastructure/billing/stripe-credit-checkout";
import {MonthlyCheckoutRouter} from "./infrastructure/billing/monthly-checkout-router";
import { BillingCatalogService } from "./application/billing/billing-catalog-service";
import { BillingCatalogController } from "./interface/controllers/billing-catalog.controller";
import {WechatMonthlyPassClient} from "./infrastructure/billing/wechat-monthly-pass-client";
import {MonthlyWechatCreditingStore} from "./infrastructure/billing/monthly-wechat-crediting-store";
import {MonthlyPassService} from "./application/billing/monthly-pass-service";
import {PgMonthlyPassRepository} from "./infrastructure/billing/pg-monthly-pass-repository";
import {StripeMonthlyPassClient} from "./infrastructure/billing/stripe-monthly-pass-client";
import {MonthlyStripeWebhookStore} from "./infrastructure/billing/monthly-stripe-webhook-store";
import {CreditUsageReplayWorker} from "./infrastructure/billing/credit-usage-replay-worker";
import {NativeCreditTariffController} from "./interface/controllers/native-credit-tariff.controller";
import {NativeCreditTariffService} from "./application/billing/native-credit-tariff-service";
import {PgNativeCreditTariffRepository} from "./infrastructure/billing/pg-native-credit-tariff-repository";
import {APP_INTERCEPTOR} from "@nestjs/core";
import {CreditExecutionContextInterceptor} from "./interface/interceptors/credit-execution-context.interceptor";
import {ConsumptionSettingsService} from "./application/billing/consumption-settings-service";
import {ConsumptionSettingsController} from "./interface/controllers/consumption-settings.controller";
import {PgConsumptionSettingsRepository} from "./infrastructure/billing/pg-consumption-settings-repository";
import { BillingStripeWebhookService } from "./application/billing/billing-stripe-webhook-service";
import { StripeWebhookClient } from "./infrastructure/billing/stripe-webhook-client";
import { PgBillingStripeWebhookStore } from "./infrastructure/billing/pg-billing-stripe-webhook-store";
import { BillingStripeWebhookController } from "./interface/controllers/billing-stripe-webhook.controller";
import { BillingSubscriptionService } from "./application/billing/billing-subscription-service";
import { PgBillingSubscriptionRepository } from "./infrastructure/billing/pg-billing-subscription-repository";
import { StripePortalClient } from "./infrastructure/billing/stripe-portal-client";
import { BillingSubscriptionController } from "./interface/controllers/billing-subscription.controller";
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

import { BillingWechatNotifyController } from "./interface/controllers/billing-wechat-notify.controller";
import { BillingWechatNotifyService } from "./application/billing/billing-wechat-notify-service";
import { BILLING_CREDITING_STORE, BILLING_RECEIPT_WORKER, type BillingCreditingStore } from "./application/billing/billing-notify-ports";
import { PgBillingCreditingStore } from "./infrastructure/billing/pg-billing-crediting-store";
import { DeploymentWechatNoticeVerifier } from "./infrastructure/billing/wechat-notice-verifier";
import { BillingReceiptWorker } from "./infrastructure/billing/billing-receipt-worker";
import { BILLING_ORDER_EXPIRY_WORKER } from "./application/billing/billing-order-expiry.port";
import { BillingOrderExpiryWorker } from "./infrastructure/billing/billing-order-expiry-worker";
import { PgBillingOrderExpiryStore } from "./infrastructure/billing/pg-billing-order-expiry-store";

@Module({
  imports: [IdentityPersistenceModule],
  controllers: [PersonalEntitlementController, PersonalCheckoutController, BillingCatalogController, NativeCreditTariffController, ConsumptionSettingsController, BillingStripeWebhookController, BillingSubscriptionController, BillingConfigController, BillingWalletController, BillingOrderController, BillingWechatNotifyController],
  providers: [
    { provide: PersonalEntitlementService, useFactory: (db: DatabasePort) => new PersonalEntitlementService(new PgPersonalEntitlementRepository(db)), inject: [DATABASE_PORT] },
    { provide: PersonalCheckoutService, useFactory: (db: DatabasePort, config: DeploymentBillingConfig, logger: LoggerPort) =>
      new PersonalCheckoutService(new PgPersonalCheckoutRepository(db), config,
        new PersonalCheckoutRouter(new PersonalStripeCheckoutClient(config), new PersonalWechatPaymentClient(config, logger))),
      inject: [DATABASE_PORT, DeploymentBillingConfig, LOGGER_PORT] },
    { provide: BillingCatalogService, useFactory: (config: DeploymentBillingConfig) => new BillingCatalogService(config), inject: [DeploymentBillingConfig] },
    {provide:CreditUsageReplayWorker,useFactory:(db:DatabasePort,logger:LoggerPort)=>new CreditUsageReplayWorker(db,logger),inject:[DATABASE_PORT,LOGGER_PORT]},
    {provide:NativeCreditTariffService,useFactory:(db:DatabasePort,credentials:CredentialRepository,platformAdmins:PlatformAdminRepository)=>new NativeCreditTariffService(new PgNativeCreditTariffRepository(db),userId=>isRequestorPlatformOperator({credentials,platformAdmins},userId)),inject:[DATABASE_PORT,CREDENTIAL_REPOSITORY,PLATFORM_ADMIN_REPOSITORY]},
    {provide:APP_INTERCEPTOR,useClass:CreditExecutionContextInterceptor},
    {provide:ConsumptionSettingsService,useFactory:(db:DatabasePort,credentials:CredentialRepository,platformAdmins:PlatformAdminRepository)=>new ConsumptionSettingsService(new PgConsumptionSettingsRepository(db),userId=>isRequestorPlatformOperator({credentials,platformAdmins},userId)),inject:[DATABASE_PORT,CREDENTIAL_REPOSITORY,PLATFORM_ADMIN_REPOSITORY]},
    { provide: PersonalStripeWebhookStore, useFactory: (db: DatabasePort, config: DeploymentBillingConfig, logger: LoggerPort) => {
      const monthlyClient = new StripeMonthlyPassClient(config);
      const monthly = new MonthlyPassService(new PgMonthlyPassRepository(db), new MonthlyCheckoutRouter(monthlyClient,new WechatMonthlyPassClient(config,db,logger)));
      const legacy = new MonthlyStripeWebhookStore(db, new PgBillingStripeWebhookStore(db), monthly, monthlyClient,new StripeCreditCheckout(db,config));
      return new PersonalStripeWebhookStore(db, new PersonalStripeCheckoutClient(config), new PgPersonalPaymentRepository(db), legacy);
    }, inject: [DATABASE_PORT, DeploymentBillingConfig, LOGGER_PORT] },
    { provide: BillingStripeWebhookService, useFactory: (config: DeploymentBillingConfig, store: PersonalStripeWebhookStore, logger: LoggerPort) => {
      const client = new StripeWebhookClient(config); return new BillingStripeWebhookService(client, client, store, logger);
    }, inject: [DeploymentBillingConfig, PersonalStripeWebhookStore, LOGGER_PORT] },
    { provide: PersonalPaymentRecoveryWorker, useFactory: (db: DatabasePort, config: DeploymentBillingConfig, stripe: PersonalStripeWebhookStore, logger: LoggerPort) => {
      const provider = new StripeWebhookClient(config);
      const pending = new PersonalPaymentReconciler(new PersonalStripeCheckoutClient(config), new PersonalWechatPaymentClient(config, logger),
        new PgPersonalPaymentRepository(db), new PgPersonalCheckoutRepository(db), { reconcileCheckout: id => stripe.reconcileCheckout(id, provider) });
      return new PersonalPaymentRecoveryWorker(new PgPersonalPaymentRecoveryStore(db, pending, stripe, provider, logger), logger);
    }, inject: [DATABASE_PORT, DeploymentBillingConfig, PersonalStripeWebhookStore, LOGGER_PORT] },
    { provide: BillingSubscriptionService, useFactory: (db: DatabasePort, config: DeploymentBillingConfig, logger: LoggerPort) => new BillingSubscriptionService(new PgBillingSubscriptionRepository(db, logger), new StripePortalClient(config, logger), new MonthlyPassService(new PgMonthlyPassRepository(db), new MonthlyCheckoutRouter(new StripeMonthlyPassClient(config),new WechatMonthlyPassClient(config,db,logger))),new PgPersonalSubscriptionAccess(db)), inject: [DATABASE_PORT, DeploymentBillingConfig, LOGGER_PORT] },
    { provide: PersonalCreditPeriodWorker, useFactory: (db: DatabasePort, logger: LoggerPort) => new PersonalCreditPeriodWorker(new PgPersonalCreditScheduleStore(db,logger),logger), inject: [DATABASE_PORT,LOGGER_PORT] },
    { provide: BILLING_ORDER_EXPIRY_WORKER, useFactory: (db: DatabasePort, logger: LoggerPort) =>
      new BillingOrderExpiryWorker(new PgBillingOrderExpiryStore(db), logger), inject: [DATABASE_PORT, LOGGER_PORT] },
    { provide: BILLING_CREDITING_STORE, useFactory: (db:DatabasePort,config:DeploymentBillingConfig,logger:LoggerPort) => {
      const client=new WechatMonthlyPassClient(config,db,logger);
      const monthly=new MonthlyPassService(new PgMonthlyPassRepository(db),new MonthlyCheckoutRouter(new StripeMonthlyPassClient(config),client));
      const legacy = new MonthlyWechatCreditingStore(db,new PgBillingCreditingStore(db),monthly,client);
      return new PersonalWechatCreditingStore(db, new PersonalWechatPaymentClient(config, logger), new PgPersonalPaymentRepository(db), legacy);
    }, inject:[DATABASE_PORT,DeploymentBillingConfig,LOGGER_PORT] },
    { provide: BillingWechatNotifyService, useFactory: (config: DeploymentBillingConfig, store: BillingCreditingStore) =>
      new BillingWechatNotifyService(new DeploymentWechatNoticeVerifier(config), store, new ConsoleLogger()), inject: [DeploymentBillingConfig, BILLING_CREDITING_STORE] },
    { provide: BILLING_RECEIPT_WORKER, useFactory: (store: BillingCreditingStore, service: BillingWechatNotifyService) =>
      new BillingReceiptWorker(store, service), inject: [BILLING_CREDITING_STORE, BillingWechatNotifyService] },
    { provide: LOGGER_PORT, useFactory: () => new ConsoleLogger() },
    { provide: DeploymentBillingConfig, useFactory: () => new DeploymentBillingConfig() },
    { provide: BILLING_CONFIG_PORT, useExisting: DeploymentBillingConfig },
    { provide: BillingOrderService,
      useFactory: (db: DatabasePort, identity: IdentityRepository, config: DeploymentBillingConfig, logger: LoggerPort) =>
        new BillingOrderService(new PgBillingOrderRepository(db), identity, config, new WechatNativeClient(config, logger),new StripeCreditCheckout(db,config),new PgPersonalOrderReader(db)),
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
