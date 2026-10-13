# Continuation stream identity — #5595

A snapshot could publish a previous request's reportStream status/sequence/offset under the current command request ID. Two actual red tests reproduced failed and streaming old states. The production fix only projects and caches a stream with an exact current request ID; current resets, deltas and real failures remain visible.

Source `db61d64593afaeff325d2c1fb18de48f003c2c17`, base main `fd5b3c3f1ad6a667f53e8973bdad13a49e386af3`. Full research unit 823, final generation8/privacy10, API types/lint/init pass; exact result boundaries and private log hashes are in result.json. No new model requests, runtime writes, Docker stack or worktree. Independent review and PR CI pending.

This fixes the erroneous first failed descriptor, **not** the original report's terminal RESEARCH_WORKFLOW_UNAVAILABLE. Request 8c015506-c550-4f9d-888f-0a8973e0431c/version7 stops in organizing; its backend safeErrors and actual running API identity remain unavailable. No repair of that terminal error or online recovery is claimed.
