# Account entry localization — #6155

Translate Registration, EmailVerification and ResetPassword across normal/bootstrap/queued/resend, pending/completed/invalid/unavailable/session-failed, form/missing-token/field-failure/terminal/retry/success states. Preserve all input values, tokens, payloads, policy constants, anonymous/public endpoint behavior and session routing. Reuse AuthShell and global provider; no auth/backend/schema/layout changes. Shared Metamorphosis stage-copy ownership was explicitly assigned to this slice after screenshot inspection; only its six copy resources and render-time translation are added, retaining animation timing, paths and reduced-motion classes.

1. Fail real-component English/input/field-error/verification-token-once tests.
2. Add typed account-entry namespace; store copy descriptors or raw reason metadata so locale rerenders existing failures rather than retrying. Keep cooldown/effect dependencies unchanged and use policy constants for numbers.
3. Run existing registration-field/bootstrap/verification/reset regressions and resource tests.
4. Extend registered i18n-entry browser journey with public account routes, input retention and narrow-screen overflow; retain existing real authentication integration gates.
5. Static checks serially, independent review, evidence and normal push; distinct develop PR and latest-head CI/authorized coordinator merge.

Copy correction: a lost HTTP response cannot establish whether the reset transaction committed. The former “failure does not consume your link” promise is replaced in both locales with an unknown-outcome notice and guidance to request a new link if invalid. Explicit retry and all auth/API/token semantics remain unchanged. The regression test covers both translations and absence of locale-triggered replay.
