/** Server maintenance only: no caller-provided owner, timestamps or SQL. */
export interface BillingOrderExpiryStore {
  closeExpired(): Promise<number>;
}
export const BILLING_ORDER_EXPIRY_WORKER = Symbol("BillingOrderExpiryWorker");
