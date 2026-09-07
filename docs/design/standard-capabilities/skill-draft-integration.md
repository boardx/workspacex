# W15 skill draft → governed import

WX-T039/S015 reuse the existing complete SkillStarterPack v1 JSON format. The frozen POST /skills route remains 410. The generated result is `artifact_draft`, not a new Skill/version identity. Those identities are allocated only by the existing administrator importer after an explicit import.

## Actual production path

The native official graph exposes `wx_skill_create_draft`. Its strict generated schema accepts named workspace files mapped to package-relative paths, description/version, input/output schema and runtime declarations. ToolRuntime supplies the real tool call ID; callback config supplies org/run/attempt/lease and native binding. No model field selects credentials, actor, storage namespace or approval.

`DefaultSkillDraftService` verifies existing ToolExecutionAuthority before session access, resolves the bound session, downloads explicit files through the existing UDS file API, validates canonical bytes/paths/UTF8/limits and required entry/reference/runtime declarations, then assembles and verifies the existing SkillStarterPack. It never runs submitted scripts. `risk_level:L2` is applied conservatively to the draft manifest; metadata does not grant tool permissions.

Complete JSON is bounded by the existing sandbox file limit. The same trusted org/run/toolCallId hashes select an immutable ObjectStore.putOnce key; all actual file bytes and metadata participate in conflict detection. A replay cannot overwrite another payload. The workspace output is written and read back, then authority/binding are rechecked before confirming a result. Cancelled/expired calls can leave unreferenced draft objects/files but do not receive success. Existing object retention/reclamation applies; object existence is not Skill creation.

The caller publishes the returned JSON workspacePath using existing `wx_artifact_publish` and waits for the normal artifact writeback. `fileDigest` is SHA256 of complete JSON bytes; `packDigest` is the existing internal pack digest. These are distinct and must not be substituted.

## Administrator consumer

`POST /admin/skills/artifact-imports` accepts only artifactId, explicit version, expectedDigest (complete JSON bytes), and idempotencyKey. It checks current organization admin membership, then reuses **agent** `artifacts-steering/getArtifact` and `PgArtifactStore` to select a currently visible version, including observer source restrictions. It does not use the similarly named Studio materialization model.

The selected version's actual storageKey is read through the existing ObjectStore, with head/size/MIME/digest/UTF8/complete pack validation. Current admin membership and artifact visibility are checked again after reading bytes. A one-pack in-memory SkillStarterPackSource then delegates to the existing `importSkillStarterPack`; this is a request adapter, not an additional registry or publisher. Original admin authorization, transactional Skill/version/files persistence, name collision handling and import records remain authoritative. Replay also checks the previously imported packDigest against the currently verified package, so forged reused coordinates do not silently accept changed content.

Existing importer semantics apply: it creates the existing Skill entry and version according to that implementation. No extra approval workflow is invented, and no ordinary user can invoke the administrator action successfully. No new admin UI is claimed by this API increment.

## Verification boundaries

Package integrity/referring files/runtime declarations are checked. Arbitrary dynamic dependency completeness is not proven by static text; binary templates are rejected by this UTF8-only increment. `validationReport` says dependencyExecution:not_verified and fixtureExecution:not_run because the packaging tool does not execute code. S015 instructs separate real sandbox fixture testing; the complete chain actually runs the generated Python fixture with a five-second timeout and checks its exact output before packaging. This proves that fixture, not arbitrary generated code safety or real external model G-SKILL.

S015 is a complete four-file package adapted from OpenAI skill-creator at fixed SHA `4ab6e0fd99c6667163bc34173e3ed3a3fed75ebc`, with Apache-2.0 license retained. There is no second Skill persistence, no POST /skills revival, no automatic platform publication.
