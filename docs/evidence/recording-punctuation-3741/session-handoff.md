# Handoff

Issue #3741; branch codex/recording-punctuation. Scope is recording-specific endpointing, no content transformations. Preserve chat/manual compatibility and the existing persistence boundary. Run ASR regression tests and API types/lint; final PR CI/review status is authoritative. Do not claim live accuracy improvement without a fixed-audio A/B test on the configured provider. No Docker or production services started; remove isolated worktree after PR delivery. Coordination service currently unreachable, so no lease acquired.
