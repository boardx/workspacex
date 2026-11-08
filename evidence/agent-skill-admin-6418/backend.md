# Backend evidence #6418

## Actual implementation

PlatformOperatorGuard protects dedicated platform list/detail/create/update/publish/disable paths; actual user identity is preserved. Application service checks organization member/admin before public discovery/enablement. Explicit target tenant transactions exclude personal-local organizations. Infrastructure uses named storage methods; no principal impersonation, fabricated administrator membership or generic SQL delegation.

New platform-authored records are marked ai_catalog_managed; publication ledger binds an immutable published version. Per-org enablement copies an authorized published source into a local real Agent/Skill, together with a local published version. Agent copy retains frozen instructions/model/avatar/category; no foreign tool, workflow or skill grants are copied. Existing cross-tenant runtime readers cannot reach managed public Skill originals; legacy built-in platform Skill policies remain compatible.

Enablement is serialized by the target organization lock, records source/local version and actual administrator, and rejects conflicting idempotency key kind/id/version. Changes record actual actor/action/target organization. Platform metadata enumeration uses the existing separate least-privilege organization catalog, with bounded org/entity pagination, public page included. Missing catalog credentials remains unavailable, never falls back to a privileged pool.

## Verification

- Contracts3 passed /tmp/catalog-contract.log.
- Combined real HTTP/PG3 files6 tests passed /tmp/catalog-combined-final.log (Agent3 plus Skill3).
- Expanded Agent real HTTP/PG4 tests passed /tmp/catalog-agent-negative-green.log. Proves platform nonmember tenant management, ordinary org-admin platform denial, incorrect target ID denial, private source isolation, public draft invisibility, org-admin enablement/member denial, actual member directory visibility, persisted exact instructions and avatar, stopped-source denial, conflicting idempotency payloads, organization/public pagination and real actor audit.
- Earlier expanded run2/4 passed and2 failed /tmp/catalog-agent-negative-final.log. Failures exposed JSONnull versus SQLNULL avatar handling and missing explicit metadata catalog fixture; both corrected. These are retained failures, not passing evidence.
- API typecheck exit0 /tmp/catalog-api-types-final2.log; final lint results recorded by root.
- Every owned isolated stack directly checked empty after wrapper completion: wsx-16ab06b1806b4bf4b8bb, wsx-1b07a4ed5d1e84fc482b, wsx-1713179f5d983b1843fc, wsx-ec0e2c9e8ed84ba65eee. No shared database used.

## Boundaries

Agent publication uses the existing toolless domain gate. An Agent with skill/workflow/tool dependencies is explicitly rejected pending an authorized local dependency installation; no foreign permissions are copied. Existing Skill contract review lifecycle is not replaced: new API authors wave2 Skill content and preserves its actual existing publisher invariants. Runtime member-directory availability and published bytes are verified, not real model task execution. No production publish or migration occurred.

The narrowly named configuration-storage permission exceptions are constrained by scripts/lib/ai-catalog-boundary.mjs: exact consumers, no global data reads, platform guards on routes, no SQL in application/controller, and membership-before-organization-enablement ordering. They are not a general tenant-content exception.

## Review follow-up (verification pending at this checkpoint)

P1: disabling an Agent now writes authoritative agents.status=disabled as well as publish_state/listing, so chat reader and workflow access both refuse future resolution. HTTP plus actual PgPublishedAgentReader/PgWorkflowAccess before/after assertions added. Initial red attempt failed bootstrap timeout (0 assertions), retry cancelled during resource admission; neither is red assertion evidence.

P2: published Agent edits stage a private ai_catalog_agent_drafts record with the prior published base version, leaving the running version unchanged. Publishing locks and compares the base, applies pending content and reuses the existing toolless domain gate and publisher to create a new immutable revision with a distinct semantic label. A disabled Agent cannot be revived by pending publication. Pending detail payload preserves authored instructions. New regression covers v1/edit-pending/reader-v1/publish-v2/old-v1-bytes unchanged.

Review verification results: /tmp/catalog-review-combined.log executed4 files11 tests:10 passed,1 revision publication failed due duplicate capability listing insertion. This run proves actual disabled Agent chat/workflow resolution is refused, closed catalog HTTP reasons survive filtering, and Skill legacy/public isolation cases pass. Fixed the revision publisher's listing projection with same-org/same-kind upsert only for the explicit new-revision route. /tmp/catalog-revision-focused-green.log then executed the failed revision case:1 passed,4 nonselected cases skipped (not counted). It proves running v1 remains unchanged during pending edit, v2 publication succeeds, and v1 instructions remain immutable. Earlier load-induced beforeAll timeouts and the cancelled admission retry are not assertion coverage.

Existing publisher regression: /tmp/catalog-publisher-existing-green.log executed the original version-snapshot-frozen-fields case "draft edit persists, publish freezes all 7 fields, later draft edits leave the version alone":1 passed,16 nonselected skipped. Confirms the default non-catalog publisher still freezes the complete original role snapshot and does not mutate the published version on later draft changes. Owned stacks4695e276a3dee22145fb (combined),89a9bb76e4648566fb52 (revision retry),dace8e822f450c178617 (existing publisher) were directly verified absent after cleanup. Final integrated type/lint is intentionally run once by root at concurrency1.

Further P2 frozen-base review: revisions now validate the actual base agent_versions skill_version_ids/tool_policy/workflow_allowlist/pending_skill_bindings, rejecting nonempty/invalid dependency planes even when agents draft arrays are empty. Toolless revisions preserve the base fixed model provider/id and all seven frozen role fields via the canonical version insertion helper; changing the organization default model cannot silently reroute a revision. Explicit unsupported model changes are rejected with CATALOG_MODEL_CHANGE_REQUIRES_VALIDATION. Public copies likewise retain their source model snapshot.

/tmp/catalog-frozen-base-focused.log passed the model-preservation revision case but failed constructing the rich fixture (invalid instruction digest); /tmp/catalog-frozen-deps-green.log then failed fixture tool_policy validation. Neither invalid fixture reached the intended assertion. Corrected the fixture to a genuine SHA256 digest and legal empty tool policy with nonempty frozen skill pins. Final /tmp/catalog-base-final-green.log executed both focused cases:2 passed,4 nonselected skipped. It proves imported frozen pins cannot be dropped by editing an empty draft and the rejected publication leaves the prior runtime snapshot intact. Final owned stack wsx-6789e3104afc117d871b directly verified absent; invalid-fixture stacks wsx-e72dfcba96ea76649581 and wsx-26b98465d0d99da9efbf also directly verified absent. Skill worker owns the next isolated run; no duplicate API typecheck was launched.
