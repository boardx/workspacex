import { verify } from "node:crypto";
import type { WechatDeployment } from "./deployment-billing-config";
/** Shared response/callback verification. Always signs the original bytes. */
export function verifyWechatSignature(config: WechatDeployment, header: (name: string) => string | null | undefined, body: Buffer): boolean {
  if (!config.platformKey || !config.platformKeyId) return false;
  const timestamp = header("Wechatpay-Timestamp") ?? "", nonce = header("Wechatpay-Nonce") ?? "";
  const serial = header("Wechatpay-Serial") ?? "", signature = header("Wechatpay-Signature") ?? "";
  const matches = config.platformKeyId.startsWith("PUB_KEY_ID_") ? serial === config.platformKeyId : serial.toUpperCase() === config.platformKeyId;
  if (!matches || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    || !nonce || nonce.length > 256 || signature.startsWith("WECHATPAY/SIGNTEST/") || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  try { return verify("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from("\n")]), config.platformKey, Buffer.from(signature,"base64")); }
  catch { return false; }
}
