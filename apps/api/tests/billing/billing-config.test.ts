import "reflect-metadata";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import { BillingModule } from "../../src/billing.module";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { billingCredits } from "@repo/contracts";
import { DeploymentBillingConfig, BILLING_ENV_KEYS } from "../../src/infrastructure/billing/deployment-billing-config";
import { ensureDatabase, migrateOnce } from "../support/db";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
function wechatEnv(): Record<string, string> {
  return { WECHAT_PAY_APP_ID: "wx-config-fixture", WECHAT_PAY_MCH_ID: "1900000000",
    WECHAT_PAY_API_V3_KEY: randomUUID().replaceAll("-", ""), WECHAT_PAY_MCH_SERIAL_NO: "ABC123",
    WECHAT_PAY_PRIVATE_KEY: privateKey, WECHAT_PAY_PLATFORM_PUBLIC_KEY: publicKey,
    WECHAT_PAY_PLATFORM_KEY_ID: "PUB_KEY_ID_CONFIG_FIXTURE", WECHAT_PAY_NOTIFY_URL: "https://pay.example.test/billing/wechat/notify" };
}
function stripeEnv(): Record<string, string> {
  return { STRIPE_SECRET_KEY: `sk_test_${randomUUID().replaceAll("-", "")}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${randomUUID()}`, STRIPE_PAYMENT_LINK: "https://buy.stripe.com/config-fixture",
    STRIPE_MANAGEMENT_PORTAL: "https://billing.stripe.com/p/login/config-fixture" };
}
afterEach(() => vi.unstubAllEnvs());

describe("reference Stripe configuration compatibility", () => {
  it("enables runtime Portal sessions without an unused static management link", () => {
    const env = stripeEnv(); delete env.STRIPE_MANAGEMENT_PORTAL;
    expect(new DeploymentBillingConfig(env).getPublicConfig()).toEqual({ enabledProviders: ["stripe"] });
  });
  it("accepts the reference return link and gives the canonical return URL precedence", () => {
    const env = { ...stripeEnv(), STRIPE_RETURN_LINK: "https://reference.example.test/billing", STRIPE_RETURN_URL: "https://devapp.example.test/billing" };
    expect(new DeploymentBillingConfig(env).getStripe()?.returnUrl).toBe(env.STRIPE_RETURN_URL);
    delete (env as Partial<typeof env>).STRIPE_RETURN_URL;
    expect(new DeploymentBillingConfig(env).getStripe()?.returnUrl).toBe(env.STRIPE_RETURN_LINK);
  });
  it("allows an explicit loopback return for local verification but rejects insecure remote redirects", () => {
    expect(new DeploymentBillingConfig({ ...stripeEnv(), STRIPE_RETURN_URL: "http://localhost:3000/billing?subscription_return=1" }).getStripe()?.returnUrl).toBe("http://localhost:3000/billing?subscription_return=1");
    expect(new DeploymentBillingConfig({ ...stripeEnv(), STRIPE_RETURN_URL: "http://app.example.test/billing" }).getStripe()).toBeNull();
    expect(new DeploymentBillingConfig({ ...stripeEnv(), STRIPE_RETURN_URL: "http://localhost@evil.example/billing" }).getStripe()).toBeNull();
  });
  it("refuses unsafe return URLs instead of falling back to an unrelated portal", () => {
    expect(new DeploymentBillingConfig({ ...stripeEnv(), STRIPE_RETURN_URL: "javascript:bad" }).getStripe()).toBeNull();
  });
});

describe("deployment billing configuration", () => {
  it.each([{}, { WECHAT_PAY_APP_ID: "partial" }, { STRIPE_SECRET_KEY: "partial" }])("partial deployment remains disabled: %j", (env) => {
    expect(new DeploymentBillingConfig(env).getPublicConfig()).toEqual({ enabledProviders: [] });
  });
  it.each([[wechatEnv(), ["wechat"]], [stripeEnv(), ["stripe"]], [{ ...wechatEnv(), ...stripeEnv() }, ["wechat", "stripe"]]] as const)("advertises only fully configured channels", (env, providers) => {
    expect(new DeploymentBillingConfig(env).getPublicConfig()).toEqual({ enabledProviders: providers });
  });
  it("invalid signing, callback, or Stripe links disable the affected provider", () => {
    for (const patch of [{ WECHAT_PAY_PRIVATE_KEY: "invalid PEM" }, { WECHAT_PAY_PLATFORM_PUBLIC_KEY: "invalid PEM" },
      { WECHAT_PAY_PLATFORM_KEY_ID: "" }, { WECHAT_PAY_API_V3_KEY: "short" }, { WECHAT_PAY_NOTIFY_URL: "javascript:bad" }]) {
      expect(new DeploymentBillingConfig({ ...wechatEnv(), ...patch, ...stripeEnv() }).getPublicConfig()).toEqual({ enabledProviders: ["stripe"] });
    }
    expect(new DeploymentBillingConfig({ ...stripeEnv(), STRIPE_PAYMENT_LINK: "http://buy.stripe.com/insecure" }).getPublicConfig()).toEqual({ enabledProviders: [] });
  });
  it("reads mounted PEM files once and tolerates missing files without boot failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-pem-"));
    try {
      const env = wechatEnv();
      delete env.WECHAT_PAY_PRIVATE_KEY;
      delete env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
      const privatePath = join(dir, "private.pem"), publicPath = join(dir, "platform.pem");
      writeFileSync(privatePath, privateKey); writeFileSync(publicPath, publicKey);
      const config = new DeploymentBillingConfig({ ...env, WECHAT_PAY_PRIVATE_KEY_PATH: privatePath, WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: publicPath });
      expect(config.getPublicConfig()).toEqual({ enabledProviders: ["wechat"] });
      rmSync(privatePath);
      expect(config.getPublicConfig()).toEqual({ enabledProviders: ["wechat"] });
      expect(new DeploymentBillingConfig({ ...env, WECHAT_PAY_PRIVATE_KEY_PATH: privatePath, WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: publicPath }).getPublicConfig()).toEqual({ enabledProviders: [] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("keeps a deployment snapshot and never returns credential fields", () => {
    const env = { ...wechatEnv(), ...stripeEnv() };
    const config = new DeploymentBillingConfig(env);
    const response = config.getPublicConfig();
    env.STRIPE_WEBHOOK_SECRET = "";
    response.enabledProviders.length = 0;
    expect(config.getPublicConfig()).toEqual({ enabledProviders: ["wechat", "stripe"] });
    expect(billingCredits.BillingConfig.safeParse(config.getPublicConfig()).success).toBe(true);
    expect(Object.keys(config.getPublicConfig())).toEqual(["enabledProviders"]);
  });
});

describe("configured billing module HTTP", () => {
  it.each([[{}, []], [wechatEnv(), ["wechat"]], [stripeEnv(), ["stripe"]],
    [{ ...wechatEnv(), ...stripeEnv() }, ["wechat", "stripe"]]] as const)("serves the signed model for each deployment profile", async (env, expected) => {
    for (const key of BILLING_ENV_KEYS) vi.stubEnv(key, "");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const resolver = { resolve: vi.fn(async () => null) };
    const app = await NestFactory.create<NestExpressApplication>({
      module: class ConfigTestRoot {}, imports: [BillingModule],
      providers: [{ provide: PRINCIPAL_RESOLVER_PORT, useValue: resolver }, { provide: APP_GUARD, useClass: PrincipalGuard }],
    }, { logger: false, abortOnError: false });
    try {
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      if (!address || typeof address === "string") throw new Error("No loopback listener");
      const response = await fetch(`http://127.0.0.1:${address.port}${billingCredits.operations.getBillingConfig.path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ enabledProviders: expected });
      expect(resolver.resolve).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

describe("real kernel anonymous billing config", () => {
  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    for (const key of BILLING_ENV_KEYS) vi.stubEnv(key, "");
    vi.stubEnv("KERNEL_QUIET", "1");
    ensureDatabase(); await migrateOnce();
    const { createApp } = await import("../../src/main");
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") throw new Error("No loopback listener");
    base = `http://127.0.0.1:${address.port}`;
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  it("boots without either payment provider and exposes exactly the signed anonymous read model", async () => {
    const response = await fetch(`${base}${billingCredits.operations.getBillingConfig.path}`);
    expect(response.status).toBe(200);
    expect(billingCredits.operations.getBillingConfig.out.parse(await response.json())).toEqual({ enabledProviders: [] });
  });
  it("does not make other kernel routes public", async () => {
    expect((await fetch(`${base}/identity/me`)).status).toBe(401);
  });
});
