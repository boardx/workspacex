import { createDecipheriv, createHash } from "node:crypto";
import { OrderNo } from "@repo/contracts/billing-credits";
import { PaymentNoticeError, type VerifiedPaymentReceipt, type WechatNoticeVerifier } from "../../application/billing/billing-notify-ports";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
import { verifyWechatSignature } from "./wechat-signature";
function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
  return value as Record<string,unknown>;
}
function text(value: unknown, max=128): string {
  if (typeof value !== "string" || !value.length || value.length > max) throw new Error("invalid_text");
  return value;
}
export class DeploymentWechatNoticeVerifier implements WechatNoticeVerifier {
  constructor(private readonly deployment: DeploymentBillingConfig) {}
  verify(rawBody: Buffer, headers: Readonly<Record<string,string|string[]|undefined>>): VerifiedPaymentReceipt {
    const config = this.deployment.getWechat();
    if (!config) throw new PaymentNoticeError("provider_unavailable",false);
    if (!verifyWechatSignature(config,name => {const value=headers[name.toLowerCase()];return typeof value==="string"?value:undefined;},rawBody)) throw new PaymentNoticeError("signature_invalid",false);
    let orderNo: string|null=null;
    try {
      const envelope = object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(rawBody)));
      const providerEventId=text(envelope.id), resource=object(envelope.resource);
      if (envelope.resource_type!=="encrypt-resource" || envelope.event_type!=="TRANSACTION.SUCCESS" || resource.algorithm!=="AEAD_AES_256_GCM" || resource.original_type!=="transaction") throw new Error("invalid_resource");
      const nonce=text(resource.nonce,32), encoded=text(resource.ciphertext,1048576);
      const aad=resource.associated_data===undefined?"":resource.associated_data;
      if (typeof aad!=="string" || Buffer.byteLength(aad)>16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("invalid_resource");
      const ciphertext=Buffer.from(encoded,"base64"); if(ciphertext.length<=16) throw new Error("invalid_resource");
      const decipher=createDecipheriv("aes-256-gcm",Buffer.from(config.apiV3Key),Buffer.from(nonce));
      decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(ciphertext.subarray(-16));
      const paymentBytes=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);
      const payment=object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(paymentBytes)));
      orderNo=OrderNo.parse(payment.out_trade_no);
      if(payment.appid!==config.appId || payment.mchid!==config.mchId) throw new Error("merchant_mismatch");
      const amount=object(payment.amount);
      if(!Number.isSafeInteger(amount.total) || Number(amount.total)<0 || Number(amount.total)>2147483647 || amount.currency!=="CNY") throw new Error("invalid_amount");
      const tradeState=text(payment.trade_state,32);
      const transactionId=tradeState==="SUCCESS"?text(payment.transaction_id):null;
      let paidAt:string|null=null;
      if(tradeState==="SUCCESS") { const date=new Date(text(payment.success_time,64));if(!Number.isFinite(date.getTime()))throw new Error("invalid_paid_at");paidAt=date.toISOString(); }
      const facts={providerEventId,orderNo,appId:config.appId,mchId:config.mchId,amountFen:Number(amount.total),currency:"CNY",transactionId,tradeState,paidAt};
      return {...facts,receiptHash:createHash("sha256").update(JSON.stringify(facts)).digest("hex")};
    } catch { throw new PaymentNoticeError("receipt_invalid",true,orderNo); }
  }
}
