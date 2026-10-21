export interface VerifiedPaymentReceipt {
  readonly providerEventId: string;
  readonly orderNo: string;
  readonly appId: string;
  readonly mchId: string;
  readonly amountFen: number;
  readonly currency: string;
  readonly transactionId: string | null;
  readonly tradeState: string;
  readonly paidAt: string | null;
  readonly receiptHash: string;
  readonly signatureVerified: boolean;
}
export class PaymentNoticeError extends Error {
  constructor(readonly reason: string, readonly signatureVerified: boolean, readonly orderNo: string | null = null) { super(reason); }
}
export interface WechatNoticeVerifier {
  verify(rawBody: Buffer, headers: Readonly<Record<string, string | string[] | undefined>>): VerifiedPaymentReceipt;
}
export interface CreditingResult { readonly completed: boolean; readonly manual: boolean }
export interface BillingCreditingStore {
  accept(receipt: VerifiedPaymentReceipt): Promise<CreditingResult>;
  processOne(providerEventId: string): Promise<CreditingResult>;
  due(): Promise<string[]>;
  auditRejection(signatureVerified: boolean, orderNo: string | null): Promise<void>;
}
export const BILLING_CREDITING_STORE = Symbol("BillingCreditingStore");
export const BILLING_RECEIPT_WORKER = "BILLING_RECEIPT_WORKER";
