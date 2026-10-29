# Stripe cancellation follow-up — issue #5988

2026-10-29, user-directed ad-hoc fix based on latest origin/main a6bc8bc17.

## Behavior and root cause

The reference boardx-backend PaymentService.createStripePortalSession and
boardx-web UpgradePlanDialog use an authenticated, customer-bound Stripe
Customer Portal. Keep the existing endpoint and trusted-customer authorization.
Both live and test account default Portal configurations already enable
subscription_cancel with mode at_period_end and proration_behavior none.

A management return with an unchanged active snapshot stopped polling immediately.
Cancellation webhooks can arrive after that first read. Mark Portal return URLs
with subscription_management_return=1, preserving the configured query, and poll
six times at three-second intervals. URL hints only trigger reads; they never
change entitlements. Explain how to cancel through management and distinguish
scheduled cancellation from entitlement expiry.

## Verification

- Before fix: delayed-cancellation UI regression failed; management return URL
  assertions failed for six manageable subscription statuses.
- API HTTP/PostgreSQL: subscription-links.test.ts + stripe-webhook.test.ts,
  49/49 passed in standard with-test-isolation wrapper. Scheduled cancellation
  retains active status; authoritative deletion transitions to canceled.
- Web: billing-subscription-live.test.tsx + billing-overview.test.tsx.
- Real browser: subscription-browser.integration.ts passed using Next, real
  Billing HTTP/PostgreSQL, controlled Stripe HTTP and independently signed
  webhook. Returning while active then receiving cancellation updates UI without
  manual refresh; Pro remains effective. No real-money transaction.
- API/Web typecheck and lint passed. Database stacks and owned browser process
  released by the standard wrapper / integration teardown.

## Production boundary and user decision

CN runtime management request returned Stripe HTTP400, resource_missing,
param customer; provider explicitly indicated the object exists in test mode.
CN has a retained test subscription while runtime now uses live credentials.
User explicitly chose to retain that test binding and complete code changes
first. No subscription data was deleted, no existing subscription canceled,
and no source image was deployed during this follow-up.
The retained test binding still cannot open a live-mode Portal. Do not claim
this code change converts sandbox objects or fixes that historical binding.
The separate cross-environment webhook filtering issue remains outside scope.

Root checkout develop/main divergence was preserved. harness tick remains
unavailable because COORD_GATEWAY_URL is not configured; no lease is claimed.
