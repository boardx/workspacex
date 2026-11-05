# Global image fixture isolation — PR #6297

The image PostgreSQL fixture activated `billing_pricing_epoch` but never restored
it. A later subscription backfill file therefore failed its legacy epoch guard
with `dependency_unavailable`. Running backfill alone or racing its grants does
not reproduce this shared-state failure.

A two-file ordered reproduction (image fixture then backfill in the same isolated
database) failed before the fix. The fixture now snapshots generation and the
full-precision timestamp as PostgreSQL text, restoring the exact row or prior
absence from afterAll even after setup/assertion/close failures.

The final ordered run passed image 6/6 and backfill 7/7 in 36 seconds; see
`epoch-isolation.log`. Independent review found no actionable issue. Production
billing behavior and backfill assertions are unchanged. Isolation stack released.
