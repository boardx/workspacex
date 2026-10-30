# Completion contract

Run node tests for ci-promotion evidence and lookup, workflow mechanical tests, existing integration/dedup/backend-required regressions, pnpm run lint:vitest-config-reachability, pnpm --dir apps/api run test:billing-provider and test:self-usage. Verify ordinary PR/develop push still runs complete validation; only same-repository pure develop promotion may reuse latest complete successful exact-source evidence.

Changes must first merge into develop through a green PR. Bootstrap policy changes cannot reuse their own candidate policy. No production branch rules or secrets should be weakened. Do not claim time savings from static workflow edits; record actual qualifying promotion run evidence when available.
