import { describe, expect, it } from "vitest";
import { BillingWechatNotifyService } from "../../src/application/billing/billing-wechat-notify-service";
import { PaymentNoticeError, type BillingCreditingStore, type VerifiedPaymentReceipt, type WechatNoticeVerifier } from "../../src/application/billing/billing-notify-ports";
import type { LoggerPort, LogFields } from "../../src/application/ports/logger.port";
const receipt: VerifiedPaymentReceipt = { providerEventId: "verified-event", orderNo: "bg20261015000000abcdef", appId: "app", mchId: "merchant", amountFen: 9900, currency: "CNY", transactionId: "transaction", tradeState: "SUCCESS", paidAt: "2026-10-15T00:00:00.000Z", receiptHash: "a".repeat(64) };
function fixture(stage: "accept" | "credit" | "audit_rejection" | "pending") {
  const entries: {msg: string; fields: LogFields}[] = [];
  const logger: LoggerPort = { info: (msg,fields)=>entries.push({msg,fields}), error:(msg,fields)=>entries.push({msg,fields}) };
  const failure = Object.assign(new Error("private SQL detail and payer-secret"), {code: "23505", detail:"private SQL detail and payer-secret"});
  const verifier: WechatNoticeVerifier = { verify: () => { if(stage==="audit_rejection") throw new PaymentNoticeError("signature_invalid",false); return receipt; } };
  const store: BillingCreditingStore = {
    accept: async () => { if(stage==="accept") throw failure; return {completed:false,manual:false}; },
    processOne: async () => { if(stage==="pending") return {completed:false,manual:false}; throw failure; }, due: async()=>[],
    auditRejection: async()=>{throw failure;},
  };
  return {service:new BillingWechatNotifyService(verifier,store,logger),entries};
}
describe("callback failure diagnostics",()=>{
  it("bridges a real pending result to the request trace and verified event without requiring an exception",async()=>{
    const {service,entries}=fixture("pending");
    expect(await service.handle(Buffer.from("private callback"),{},"server-trace-pending")).toEqual({status:503,body:{code:"FAIL"}});
    expect(entries).toContainEqual({msg:"billing_callback_pending",fields:{traceId:"server-trace-pending",stage:"credit",providerEventId:receipt.providerEventId,orderNo:receipt.orderNo}});
    expect(JSON.stringify(entries)).not.toContain("private callback");
  });
  it.each(["accept","credit","audit_rejection"] as const)("logs %s SQL failures with the request trace and safe code while preserving the protocol body",async stage=>{
    const {service,entries}=fixture(stage);
    const response=await service.handle(Buffer.from("private raw callback payload"),{},"server-trace-123");
    expect(response).toEqual({status:503,body:{code:"FAIL"}});
    expect(entries).toContainEqual(expect.objectContaining({fields:expect.objectContaining({traceId:"server-trace-123",err:expect.objectContaining({stage,code:"23505"})})}));
    expect(JSON.stringify(entries)).not.toContain("payer-secret");
    expect(JSON.stringify(entries)).not.toContain("private raw callback payload");
    expect(JSON.stringify(response)).not.toContain("23505");
  });
});
