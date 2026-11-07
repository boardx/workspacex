import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { LoggerPort } from "../../application/ports/logger.port";
import type { StripeSnapshotProvider } from "../../application/billing/billing-stripe-webhook-service";
import { PERSONAL_PAYMENT_RECOVERY_BATCH_SIZE as BATCH, PERSONAL_PAYMENT_RECOVERY_INTERVAL_MS as TICK,
  PERSONAL_STRIPE_RECONCILE_INTERVAL_MS, PERSONAL_STRIPE_TERMINAL_RECHECK_MS,
  type PersonalPaymentRecoveryStore, type PersonalPaymentRecoveryStats } from "../../application/billing/personal-payment-recovery.port";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { PERSONAL_CHECKOUT_RETRY_WINDOW_MS } from "../../domain/billing/personal-purchase";
import { PERSONAL_PAYMENT_RECOVERY_SQL as SQL } from "./personal-payment-recovery-sql";
import { assertBillingGlobalStatement } from "./billing-global-boundary";
import { pricingEpochMode, requireActivePricingEpoch } from "./personal-pricing-epoch";
import { personalPurchaseView, type PersonalPurchaseRow } from "./pg-personal-checkout-repository";
import type { PersonalPaymentReconciler } from "./personal-payment-reconciler";
import type { PersonalStripeWebhookStore } from "./personal-stripe-webhook-store";

type BindingRow = PersonalPurchaseRow & { subscription_ref: string; invoice_cursor: string | null };
function guarded(raw: TenantSession): TenantSession { return { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } }; }
/** Cross-owner billing queue. Only closed SQL crosses this boundary; provider work never holds this selection transaction. */
export class PgPersonalPaymentRecoveryStore implements PersonalPaymentRecoveryStore {
  private pendingCursor: string | null = null;
  private bindingCursor: string | null = null;
  constructor(private readonly db: DatabasePort, private readonly pending: Pick<PersonalPaymentReconciler, "reconcile">,
    private readonly stripe: Pick<PersonalStripeWebhookStore, "reconcileSubscription" | "reconcilePaidInvoices">,
    private readonly provider: StripeSnapshotProvider, private readonly logger: LoggerPort) {}
  private active<T>(run: (session: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withoutTenant(async raw => { const session = guarded(raw); await requireActivePricingEpoch(session); return run(session); });
  }
  private deferPending(ref: string, error: "binding_unresolved" | "provider_unavailable" | null, manual = false) {
    return this.active(s => s.query(SQL.recoveryPendingHint, [ref, TICK, error, manual]));
  }
  private deferBinding(row: BindingRow, cursor: string | null, interrupted: boolean) {
    return this.active(s => s.query(SQL.recoveryBindingHint, [row.subscription_ref, row.invoice_cursor, cursor,
      TICK, PERSONAL_STRIPE_RECONCILE_INTERVAL_MS, PERSONAL_STRIPE_TERMINAL_RECHECK_MS, interrupted]));
  }
  private failed(ref: string) {
    try { this.logger.error("billing_personal_payment_recovery_item_failed", { traceId: `personal-payment:${randomUUID()}`, purchaseRef: ref,
      err: { reason: "recovery_dependency_unavailable" } }); } catch { /* diagnostics cannot skip the next owner */ }
  }
  async reconcileDue(shouldContinue: () => boolean): Promise<PersonalPaymentRecoveryStats> {
    const result = { processed: 0, failed: 0 }; if (!shouldContinue()) return result;
    const due = await this.db.withoutTenant(async raw => {
      const s = guarded(raw);
      if (await pricingEpochMode(s) !== "active") return { pending: [], bindings: [] };
      return { pending: (await s.query<PersonalPurchaseRow>(SQL.recoveryPending, [BILLING_ACCOUNTING_GENERATION, this.pendingCursor, BATCH])).rows,
        bindings: (await s.query<BindingRow>(SQL.recoveryBindings, [BILLING_ACCOUNTING_GENERATION, this.bindingCursor, BATCH])).rows };
    });
    for (const row of due.pending) {
      if (!shouldContinue()) return result;
      try {
        const purchase = personalPurchaseView(row), state = await this.pending.reconcile(purchase);
        const unbound = state === "unbound", manual = unbound && Date.now() - purchase.createdAt.getTime() >= PERSONAL_CHECKOUT_RETRY_WINDOW_MS[purchase.provider];
        await this.deferPending(purchase.purchaseRef, unbound ? "binding_unresolved" : null, manual);
        result.processed++;
      } catch {
        result.failed++; await this.deferPending(row.purchase_ref, "provider_unavailable").catch(() => undefined); this.failed(row.purchase_ref);
      }
      this.pendingCursor = row.purchase_ref;
    }
    if (due.pending.length < BATCH) this.pendingCursor = null;
    for (const row of due.bindings) {
      if (!shouldContinue()) return result;
      try {
        if (!await this.stripe.reconcileSubscription(row.subscription_ref, this.provider)) throw Error("personal_recovery_retry_required");
        const page = await this.stripe.reconcilePaidInvoices(row.subscription_ref, row.invoice_cursor ?? undefined, this.provider, shouldContinue);
        await this.deferBinding(row, page.interrupted ? row.invoice_cursor : page.nextCursor, page.interrupted);
        result.processed++;
      } catch {
        result.failed++; await this.deferBinding(row, row.invoice_cursor, true).catch(() => undefined); this.failed(row.purchase_ref);
      }
      this.bindingCursor = row.subscription_ref;
    }
    if (due.bindings.length < BATCH) this.bindingCursor = null;
    return result;
  }
}
