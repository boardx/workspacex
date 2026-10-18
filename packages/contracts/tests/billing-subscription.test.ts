import { describe, expect, it } from 'vitest';
import { SubscriptionStatus, subscriptionEligibility } from '../src/billing-subscription';

describe('ADR-123 subscription eligibility', () => {
  it.each([
    ['none', false, true, false],
    ['active', true, false, true],
    ['trialing', true, false, true],
    ['past_due', false, false, true],
    ['unpaid', false, false, true],
    ['incomplete', false, false, true],
    ['paused', false, false, true],
    ['canceled', false, true, false],
    ['incomplete_expired', false, true, false],
  ] as const)('%s separates entitlement, purchase and management', (status, pro, purchase, manage) => {
    expect(SubscriptionStatus.parse(status)).toBe(status);
    expect(subscriptionEligibility(status)).toEqual({
      hasEffectivePro: pro,
      canCreateSubscription: purchase,
      canManageSubscription: manage,
    });
  });
  it('rejects unknown future provider states instead of treating them as none', () => {
    expect(SubscriptionStatus.safeParse('future_status').success).toBe(false);
  });
});
