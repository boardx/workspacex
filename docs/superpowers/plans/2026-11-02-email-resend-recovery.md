# Email verification resend recovery implementation plan

Goal: unverified users can resend verification after delivery failure, expiry or loss of the registration cookie by proving their email and password. User selected this approach on 2026-11-02.

Architecture: reuse the existing password authentication and lockout rules without issuing an authenticated session. Only a verified password may authorize a new challenge for the matching unverified user. Existing cookie-based resend remains supported. Retain repository transaction serialization, 60-second cooldown, five resends per day, and atomic supersession of previous challenges. Never alter email_verified_at except normal link confirmation.

- [x] Add meaningful failing API tests for password recovery without a cookie and with an expired challenge; wrong password, missing account, verified account, lockout, cooldown and concurrent requests must remain safe.
- [x] Extend the auth contract and controller using the existing auth credential-checking policy. Introduce a narrowly scoped trusted user identity at the repository boundary, never trust a client-supplied user ID.
- [x] Add login-page resend entry following EMAIL_NOT_VERIFIED, using existing entered email/password, a resend status and recoverable transport error. Add an accessible route from invalid verification links back to the login recovery path. Never persist passwords in URL or browser storage.
- [x] Run focused API/Postgres and web tests, contracts and relevant typechecks; leave evidence.
- [ ] Open one PR targeting develop referencing #6085 and follow checks to green.

Development isolation: /Users/shenyangjun/boardx/workspacex-email-resend-6085; branch worker/email-resend-recovery-6085, based on fetched origin/develop. No production change until implementation and verification are complete.
