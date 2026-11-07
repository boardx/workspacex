export const PERSONAL_CREDIT_SWEEP_BATCH_SIZE = 100;
export type PersonalCreditSweep = { nextCursor: string | null; processed: number; failed: number };
export interface PersonalCreditScheduleStore {
  reconcileDue(afterOwner: string | null): Promise<PersonalCreditSweep>;
}
