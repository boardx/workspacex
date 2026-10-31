import { createPrivateKey, createPublicKey, X509Certificate, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BillingConfigPort } from "../../application/billing/billing-config.port";

function readDeployment() {
  return {
    BILLING_DEPLOYMENT: process.env.BILLING_DEPLOYMENT,
    BILLING_WECHAT_ENABLED: process.env.BILLING_WECHAT_ENABLED,
    BILLING_STRIPE_ENABLED: process.env.BILLING_STRIPE_ENABLED,
    WECHAT_PAY_APP_ID: process.env.WECHAT_PAY_APP_ID,
    WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID,
    WECHAT_PAY_API_V3_KEY: process.env.WECHAT_PAY_API_V3_KEY,
    WECHAT_PAY_MCH_SERIAL_NO: process.env.WECHAT_PAY_MCH_SERIAL_NO,
    WECHAT_PAY_PRIVATE_KEY: process.env.WECHAT_PAY_PRIVATE_KEY,
    WECHAT_PAY_PRIVATE_KEY_PATH: process.env.WECHAT_PAY_PRIVATE_KEY_PATH,
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY,
    WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH,
    WECHAT_PAY_PLATFORM_KEY_ID: process.env.WECHAT_PAY_PLATFORM_KEY_ID,
    WECHAT_PAY_NOTIFY_URL: process.env.WECHAT_PAY_NOTIFY_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PAYMENT_LINK: process.env.STRIPE_PAYMENT_LINK,
    STRIPE_MANAGEMENT_PORTAL: process.env.STRIPE_MANAGEMENT_PORTAL,
    STRIPE_RETURN_URL: process.env.STRIPE_RETURN_URL,
    STRIPE_RETURN_LINK: process.env.STRIPE_RETURN_LINK,
  };
}
export const BILLING_ENV_KEYS = Object.keys(readDeployment());
type Deployment = Readonly<Record<string, string | undefined>>;
export type WechatDeployment = Readonly<{
  appId: string; mchId: string; apiV3Key: string; mchSerialNo: string;
  privateKey: KeyObject; platformKey: KeyObject | null; platformKeyId: string | null; notifyUrl: string;
}>;
export type StripeDeployment = Readonly<{
  secretKey: string; webhookSecret: string; paymentLink: string; managementPortal: string; returnUrl?: string;
}>;
function text(env: Deployment, name: string): string { return env[name]?.trim() ?? ""; }
// Unspecified switches preserve existing deployments. Invalid explicit values fail closed.
function purchaseEnabled(env: Deployment, name: string): boolean {
  const value = text(env, name).toLowerCase();
  return !value || value === "true" || value === "1";
}
function httpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}
function pem(env: Deployment, inline: string, path: string): string {
  const value = text(env, inline);
  return value ? value.replace(/\\n/g, "\n") : text(env, path) ? readFileSync(text(env, path), "utf8") : "";
}
function rsa(key: KeyObject): boolean {
  return key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
}
function wechat(env: Deployment): WechatDeployment | null {
  try {
    const appId = text(env, "WECHAT_PAY_APP_ID"), mchId = text(env, "WECHAT_PAY_MCH_ID");
    const apiV3Key = text(env, "WECHAT_PAY_API_V3_KEY"), mchSerialNo = text(env, "WECHAT_PAY_MCH_SERIAL_NO");
    const notifyUrl = text(env, "WECHAT_PAY_NOTIFY_URL");
    if (!appId || !/^\d+$/.test(mchId) || Buffer.byteLength(apiV3Key, "utf8") !== 32
      || !/^[a-fA-F0-9]+$/.test(mchSerialNo) || !httpsUrl(notifyUrl)) return null;
    const privateKey = createPrivateKey(pem(env, "WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_PRIVATE_KEY_PATH"));
    if (!rsa(privateKey)) return null;
    const platformPem = pem(env, "WECHAT_PAY_PLATFORM_PUBLIC_KEY", "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH");
    let platformKeyId = text(env, "WECHAT_PAY_PLATFORM_KEY_ID");
    // Reference backend compatibility: merchant signing and API-v3 callback
    // decryption remain available without platform RSA verification material.
    const platformConfigured = text(env, "WECHAT_PAY_PLATFORM_PUBLIC_KEY") || text(env, "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH") || platformKeyId;
    if (!platformConfigured) return Object.freeze({ appId, mchId, apiV3Key, mchSerialNo, privateKey, platformKey: null, platformKeyId: null, notifyUrl });
    let platformKey: KeyObject;
    if (platformPem.includes("-----BEGIN CERTIFICATE-----")) {
      const certificate = new X509Certificate(platformPem);
      const now = Date.now();
      if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) return null;
      const serial = certificate.serialNumber.replaceAll(":", "").toUpperCase();
      if (platformKeyId && platformKeyId.toUpperCase() !== serial) return null;
      platformKeyId = serial;
      platformKey = certificate.publicKey;
    } else {
      if (!/^PUB_KEY_ID_[A-Za-z0-9_]+$/.test(platformKeyId)) return null;
      platformKey = createPublicKey(platformPem);
    }
    if (!rsa(privateKey) || !rsa(platformKey)) return null;
    return Object.freeze({ appId, mchId, apiV3Key, mchSerialNo, privateKey, platformKey, platformKeyId, notifyUrl });
  } catch { return null; } // missing mounts and invalid credentials disable this channel; never abort boot.
}
function stripe(env: Deployment): StripeDeployment | null {
  const secretKey = text(env, "STRIPE_SECRET_KEY"), webhookSecret = text(env, "STRIPE_WEBHOOK_SECRET");
  const paymentLink = text(env, "STRIPE_PAYMENT_LINK"), managementPortal = text(env, "STRIPE_MANAGEMENT_PORTAL");
  const returnUrl = text(env, "STRIPE_RETURN_URL") || text(env, "STRIPE_RETURN_LINK");
  let validReturn = !returnUrl || httpsUrl(returnUrl);
  if (!validReturn && returnUrl) {
    try { const url = new URL(returnUrl); validReturn = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password; }
    catch { /* Invalid configured return URLs disable the provider. */ }
  }
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey) || !/^whsec_.+$/.test(webhookSecret)
    || (paymentLink && !httpsUrl(paymentLink)) || (managementPortal && !httpsUrl(managementPortal)) || !validReturn) return null;
  return Object.freeze({ secretKey, webhookSecret, paymentLink, managementPortal, ...(returnUrl ? { returnUrl } : {}) });
}

/** One immutable startup snapshot, shared by public availability and later payment adapters. */
export class DeploymentBillingConfig implements BillingConfigPort {
  private readonly wechat: WechatDeployment | null;
  private readonly stripe: StripeDeployment | null;
  private readonly wechatEnabled: boolean;
  private readonly stripeEnabled: boolean;
  constructor(env: Deployment = readDeployment()) {
    this.wechat = wechat(env);
    this.stripe = stripe(env);
    const deployment=text(env,"BILLING_DEPLOYMENT").toLowerCase();
    const valid=["","cn","us","devapp"].includes(deployment);
    this.wechatEnabled = valid&&deployment!=="us"&&purchaseEnabled(env, "BILLING_WECHAT_ENABLED");
    const stripeModeAllowed=deployment==="devapp"?this.stripe?.secretKey.startsWith("sk_test_"):deployment==="us"?this.stripe?.secretKey.startsWith("sk_live_"):true;
    this.stripeEnabled = valid&&deployment!=="cn"&&!!stripeModeAllowed&&purchaseEnabled(env, "BILLING_STRIPE_ENABLED");
  }
  getPublicConfig(): ReturnType<BillingConfigPort["getPublicConfig"]> {
    return { enabledProviders: [...(this.wechat && this.wechatEnabled ? ["wechat" as const] : []), ...(this.stripe && this.stripeEnabled ? ["stripe" as const] : [])] };
  }
  // Credential access remains available for existing-order callbacks and renewal settlement.
  getWechat(): WechatDeployment | null { return this.wechat; }
  getStripe(): StripeDeployment | null { return this.stripe; }
}
