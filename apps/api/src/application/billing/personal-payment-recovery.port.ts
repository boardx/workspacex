export const PERSONAL_PAYMENT_RECOVERY_INTERVAL_MS = 60_000;
export const PERSONAL_PAYMENT_RECOVERY_BATCH_SIZE = 5;
export const PERSONAL_STRIPE_RECONCILE_INTERVAL_MS = 300_000;
export const PERSONAL_STRIPE_TERMINAL_RECHECK_MS = 86_400_000;
export type PersonalPaymentRecoveryStats = { processed: number; failed: number };
export interface PersonalPaymentRecoveryStore {
  reconcileDue(shouldContinue: () => boolean): Promise<PersonalPaymentRecoveryStats>;
}
