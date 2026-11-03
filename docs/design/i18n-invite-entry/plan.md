# Invitation entry localization — #6158

Translate only static copy and render-time failure/completion descriptors in InviteActivation, LinkActivation and the shared completion-text map. The actual useInvitationSession hook behavior, token replacement guards, query claims, payloads, modes, redirects and retry actions remain intact. Typed resources are the single source for zh-CN/en display text. Preserve private input and unknown server reason strings literally.

1. Red real-component tests: language switching preserves original inputs/token/claims, request count and stored errors; successful session-preserved status retranslates without replacing the account.
2. Translate labels, field/terminal/unavailable errors and completion-map keys; preserve IDs and policy constants.
3. Existing invitation/session regressions and resource checks; registered public route browser for single/shared/missing-token states and narrow widths.
4. Serial static gates and independent exact-SHA review; evidence, normal push, one develop PR, latest-head CI and authorized coordinator merge.
