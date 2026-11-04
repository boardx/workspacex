# Structured activity display implementation — #6145

Goal: localize system-generated activity templates while preserving embedded user values and old summary responses. New optional query displayFormat=structured-v1 negotiates metadata because old event schemas are strict. Existing endpoints, permissions, own-user scoping, and summary text remain unchanged.

Files: contracts/identity schema; application/identity/list-own-activity metadata projection; identity.controller query forwarding; web live-identity opt-in query; typed safe formatter and profile resources; profile UI; existing real self-service-profile browser journey.

Test first: contract legacy/negotiated/invalid metadata assertions, API whitelist and query-scope unit tests, UI structured name/locale switch/unknown metadata fallback. Then implement minimum projection and formatting. Add HTTP-level assertions into existing real browser/API journey for both legacy and opt-in schemas, before rendering localized activity. Verify scoped contracts/API/web tests, typecheck/lint and real fullstack browser serially; independent review and normal push, distinct PR targeting develop.

Metadata uses stable closed codes and strict per-code parameter objects; no raw provenance detail, regex rewriting, or backend preference changes. For old servers or unknown/malformed display metadata, render summary unchanged. No changes to human signoff status; this is the user's explicitly instructed direct follow-up, with contract delta documented for review.
