import { CreditRequiredBody } from '@repo/contracts/billing-consumption';
import { ownedRunCreditFailure } from '../agent-run/run-credit-failure';
import { CreditConsumptionError } from '../billing/credit-consumption';
import type { ReportFileActor } from './ports';
/** Reuse the run's closed failure vocabulary and actor binding; never trust an input URL. */
export function reportCreditFailure(actor: ReportFileActor, code: unknown, raw: unknown) {
  if (code === 'CREDIT_ACCOUNTING_UNAVAILABLE') return { errorCode: 'CREDIT_ACCOUNTING_UNAVAILABLE' as const };
  if (code !== 'CREDIT_REQUIRED') return null;
  if (raw === undefined) return { errorCode: 'CREDIT_REQUIRED' as const };
  const body = CreditRequiredBody.safeParse(raw);
  if (!body.success) return { errorCode: 'CREDIT_ACCOUNTING_UNAVAILABLE' as const };
  const bound = ownedRunCreditFailure(new CreditConsumptionError('credit_required', body.data.ownerType,
    body.data.ownerId, undefined, body.data.reason), actor.userId, actor.orgId)!;
  return { errorCode: bound.code, ...(bound.creditFailure ? { creditFailure: bound.creditFailure } : {}) };
}
