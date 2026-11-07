# Release governance prerequisite removed

The user explicitly requested: “调整代码，移除发布治理校验”. The shared
CN release verifier now omits signed governance receipt collection/validation,
repository/environment policy auditing, and full bypass-actor visibility checks.
It does not emit a synthetic governance success or substitute an unsigned fact.

`verify-cn-release-promotion.sh` no longer reads a governance receipt or public
key. Its host snapshot retains actual prepared receipt/manifest/image/baseline
hashes and independently signed exact-source Devapp/browser evidence.
`cn-frozen-release-identity.mjs` no longer includes a governance receipt hash in
request or annotated-tag identity. It still obtains the real GitHub Actions App
identity for the existing native Deployment verification.

`promote-cn-production.yml` also removes its independent GitHub production
governance step; publication no longer calls ruleset/environment policy APIs.

This applies to both automatic and manual publication because they share these
verifiers. There is no hidden manual governance prerequisite or opt-out flag.
The change does not edit GitHub rulesets, environment approval settings, App
permissions, branch protections, or production host configuration. Their actual
GitHub enforcement remains in effect. Existing native Deployment verification,
source admission/CI, exact workflow/ref/source binding, annotated tag exact
message/create-once behavior, branch CAS, runtime/receipt verification and rollback
mechanisms remain independent requirements.

This session's proposed governance broker, OIDC consumer, App-token scope changes
and gateway route have been withdrawn from both working files and the staged
index. No replacement credential, signing key, App permission or broker endpoint
is required. The existing separate operator evidence tool may remain available;
its governance collection is not called or required by the publication lane.

Previously prepared tag messages still contain `governanceReceiptSha256`; those
tags cannot be reused or rewritten under the new format. An affected release must
use a new attempt and run preparation again. Removing the field from a snapshot
does not make an old tag valid: the exact annotated message must match. No schema
migration, forced tag edit, or rewrite of existing tags is performed.

Verification includes real-Git CLI fixtures whose GitHub stub does not provide
any ruleset/environment endpoints, while source/CI/native issuer/Devapp/tag
counterexamples continue to reject. The standalone nonproduction tag mutation
proof tests remain, preserving their actual update/delete enforcement checks.
This is code-level evidence only; it does not establish a completed production
release or change pending migration admission decisions.
