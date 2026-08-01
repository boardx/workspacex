#!/usr/bin/env node
/**
 * lint-permission-paths.mjs -- the structural half of R7 "permission travels along the
 * data path" (UC-0.3 R7 / R12 V10, coherence X-1).
 *
 * `permission-filter.ts` makes it impossible to DISCLOSE tenant content without a
 * decision: the payload is unreachable except through `disclose()`. What it cannot do is
 * stop someone reading the table directly and never wrapping the rows at all. That is the
 * bypass this script closes.
 *
 * ## The rule
 *
 * A file under `apps/api/src` that names a tenant-carrying table in SQL must
 *   (a) live under `src/infrastructure/`  -- data access is not a controller's job, and
 *   (b) import `application/security/permission-filter` -- i.e. hand back `Guarded<T>`.
 * Anything else is a read path that reaches tenant rows with no decision attached.
 *
 * ## The table list is derived, never written down
 *
 * Tenant tables come from parsing `apps/api/migrations/*.sql`: any CREATE TABLE whose body
 * declares `org_id`, plus whatever those columns REFERENCE (that is how `organizations` is
 * found). Same derivation as `kernel_tenant_table_audit()` in the database, for the same
 * reason: a hand-maintained list is missing exactly the table someone just added, and the
 * gate stays green while the newest table is the unguarded one.
 *
 * ## The allowlist, and why it is three files
 *
 * Enumerated here rather than inferred, and each entry states what makes it different --
 * an allowlist without reasons grows.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(API, "migrations");
const FILTER_MODULE = "application/security/permission-filter";

/**
 * Files permitted to read tenant tables without going through the filter.
 *
 * Every entry is a place where the filter CANNOT apply, not a place where it was
 * inconvenient. Keep it at three; a fourth needs an argument this shape:
 *
 * ⚠ **F32（迁移 0027，新增 `download_grants`）量过这张表，结论是不用改** ——
 *   rebase 到同时含 F49 / F117 / F81 的 main 之后实测
 *   `node scripts/lint-permission-paths.mjs` 报 `allowlisted=9`，F32 **没有**加第 10 条。
 *   `pg-download-grant-repository.ts` 读 `download_grants` / `artifacts` / `artifact_versions`，
 *   三张都是租户表，但它在 `infrastructure/` 下、且经 `guard()` 出门，本来就走的是正门。
 *
 *   这句话之所以写下来：**「量过、结论是不用改」和「根本没量」在 diff 里长得一模一样**，
 *   两者都是「这个文件没出现在改动列表里」。同一个仓的 `verify-rls.sh` ratchet 正是
 *   因为这种不可分辨静默失效过三次（F31 也为此在那边留过同样一句）。
 */
const ALLOWLIST = new Map([
  [
    "src/infrastructure/identity/pg-identity-repository.ts",
    "reads the memberships and bindings the decision is MADE from -- guarding it with the decision would be circular",
  ],
  [
    "src/interface/controllers/kernel-probe.controller.ts",
    "the RLS evidence surface (UC-0.6): it must read rls_probe with NO application-level filtering, because the whole point is proving the database layer alone isolates",
  ],
  [
    "src/infrastructure/db/migrator.ts",
    "schema/DDL machinery; its rls_probe row count feeds the migration idempotency digest, not a response",
  ],
  [
    "src/infrastructure/auth/pg-registration-repository.ts",
    "F19 registration: WRITE-ONLY against tenant tables. `Guarded<T>` protects DISCLOSURE -- it makes it impossible to hand tenant content to a requester without a decision. This path discloses nothing: at the moment it runs the organization does not exist yet and there is no requester to judge, because the caller is an anonymous visitor holding an invite code. Wrapping an INSERT in a permission decision would mean asking 'may this person read the row they are creating', which has no answer. ⚠ The exemption is valid ONLY while the file stays write-only, so it is not left as a claim: tests/auth/registration-repo-is-write-only.test.ts parses the file and fails if any statement naming a tenant table is not an INSERT. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/context-pack/pg-context-pack-store.ts",
    "F13 context_packs is a FROZEN AUDIT RECORD, and the decision `disclose()` would attach is the wrong one -- re-authorising a run's segments at replay time mints new permissionDecisionIds (so I-11's 'follow the id to the judgement that applied' lands on the wrong record) and lets a since-revoked permission SHRINK a pinned pack, which is I-7 broken by the mechanism meant to protect it. Same shape as the provenance exemption: the trail cannot be gated on the answer it supplies. What replaces the per-segment decision is coarser and enforced in the class: a run is readable back only by the principal it was assembled FOR (`recorded.query.principalId === requesterId`), on top of RLS and an explicit org_id predicate. ⚠ The exemption is valid ONLY while that check exists, so it is not left as a claim: tests/kernel/context-pack-pinned-replay.test.ts asserts another principal gets RUN_NOT_FOUND, and asserts the check is load-bearing by removing it. If that test is deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/provenance/pg-provenance-repository.ts",
    "provenance_events (and provenance_notifications, which holds only 'who was told about which event') is the AUDIT TRAIL, not tenant content: an append-only record of who touched what. Guarding it with the same filter would be circular in the same way the identity repository is -- the trail is what you consult to answer 'was that read authorised', so it cannot itself require the answer first. Who may READ the trail is enforced one layer up, in application/provenance/query-provenance.ts (project lead sees their project, everyone sees their own, nobody sees a stranger's), and that rule has its own tests.",
  ],
  [
    "src/infrastructure/auth/pg-org-invite-repository.ts",
    "F10 org-member activation: the row it reads from `org_invites` is the AUTHORITY FOR THE GRANT, not content being disclosed to a requester -- and on this path there is no requester to judge, because the caller is an anonymous visitor holding an activation token who does not yet belong to any organization. `disclose()` demands a requester and produces a decision; 'may this person read the row that decides what they are about to be granted' has no answer, so guarding it would be circular in exactly the way the identity repository's entry describes. What replaces the decision is that the invite row's CONTENT never leaves the file: `activate()` returns only the grant (userId / orgId / orgRole / teamId), never `email` and never `invited_by`; the email is used solely as an INSERT parameter for the credential row the activation creates. ⚠ The exemption is valid ONLY while that stays true, so it is not left as a claim: tests/auth/member-invite-activation.test.ts asserts the returned grant carries no invite-content field, and asserts it is load-bearing by widening the return. If that test is deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/model/pg-admission-test-repository.ts",
    "F49 model_admission_tests: `guard()` cannot express this ref, and forcing it would ALLOW EVERYONE. `ObjectRef` is project|artifact|segment|capability|organization|interview; a model is none of them, and a model has no `acl_bindings` row -- so a `model` ref pushed through `authorize` would find no binding, fall back to DEFAULT_SCOPE (org-wide), see a non-null org role and return `allowed: true` for every member. That is precisely the failure `toAclRef` throws on for `capability`, `organization` and `interview`, and adding a fourth ref kind here would be creating it rather than avoiding it. Who may read a model's admission verdicts is an ORG-ADMIN question -- the contract's `recordAdmissionTest` / `enableModel` both carry `NOT_ORG_ADMIN` and nothing finer -- decided one layer up, exactly as the provenance entry describes for its trail. ⚠ The exemption is valid ONLY while this file has no disclosure surface above it, so it is not left as a claim: tests/capability/model/admission-test-gate.test.ts asserts (a) every statement in the file names only `model_admission_tests`, (b) it never uses `withoutTenant`, (c) it returns no key outside `AdmissionTestRecord ∪ {seq}` (no credential, no endpoint, no other table's row), and (d) NOTHING under src/interface/ reaches it -- so the day a controller is added, that test goes red and whoever adds it must attach the org-admin decision there. If that test is deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-project-repository.ts",
    "F117 createProject: a WRITE path plus ONE echo of the caller's own request. `Guarded<T>` protects DISCLOSURE, and this file discloses nothing to anybody but the actor who wrote the row: three of its four statements are INSERTs (projects / the subtype table / project_creation_requests), and the fourth is the replay SELECT, keyed by `fingerprint = $1 AND actor_id = $2`. Asking `disclose()` 'may this person read the container they are creating right now' has no answer -- the container does not exist yet and, per Q-4(2), the creator deliberately holds NO project role over it, so a decision would come back NO_PROJECT_ROLE for the row the caller just wrote. Same shape as the registration entry above. ⚠ The exemption is valid ONLY while every tenant-table statement here is an INSERT or that actor-scoped SELECT, so it is not left as a claim: tests/project/create-project-idempotent.test.ts parses the file and fails if any other statement names a tenant table, and asserts the actor scoping is load-bearing (a second lead submitting the identical request gets a NEW container, never the first one's). If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-agenda-segment-repository.ts",
    "F119 advanceAgendaSegment (UC-P7): a WRITE path (the current segment's state/merged_into, and -- within the same transaction -- the next pending segment's state) plus the SELECTs needed to find those two rows. `authorize({action:'agendaSegment.advance'})` already ran, and refused, one layer up in `advance-agenda-segment.ts` BEFORE this repository is ever called (same ordering as `bindToProjectStep`: permission before existence) -- so every row this file returns is exactly the segment the caller was just authorized to change, not an arbitrary read surface. `disclose()` has no question to ask here for the same reason the F117 entry above gives: the decision was already made against `object:{kind:'project', id: workshopId}` before the repository ran. ⚠ The exemption is valid ONLY while this file names no tenant table other than `agenda_segments`, so it is not left as a claim: tests/project/advance-segment-repo-guard.test.ts parses the file and fails if any other tenant table appears in a FROM/JOIN/INTO/UPDATE. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-project-list-repository.ts",
    "F122 listProjects (UC-P2): its two segments are judged by `project_memberships` (member) and `org_memberships.org_role` (managed) -- the IDENTITY DATA a decision would be made from, not `acl_bindings`. Guarding it with `authorize()`/`disclose()` would be circular in exactly the way the `pg-identity-repository.ts` entry above describes, and pushing a `project` ref through `authorize` for a listing whose whole point is 'which containers does this membership/role make visible' would ask the wrong question. D-18 already draws the line this file stays on: appearing in `managed` is NOT content read access, so the five fields it returns (id/name/kind/status/orgStatus) carry no content, no summary, no count -- only container identity and the two facts (`status`, `orgStatus`) `domain/project/readonly-reason.ts` needs to derive `readOnlyReason`. ⚠ The exemption is valid only while this file stays a pure projection of those two membership/role tables plus `organizations.status` -- adding any artifact/segment/content read here would need its own decision through `guard()`.",
  ],
  [
    "src/infrastructure/project/pg-project-overview-repository.ts",
    "F123 getProjectOverview (UC-P3): reads `projects` / `agenda_segments` / `project_memberships` for three of the whitelist's four fields (container identity, the current agenda segment, the four role COUNTS) -- the fourth, backflow, is read elsewhere via the already-guarded `listBackflow`, not here. None of what THIS file returns is `acl_bindings`-governed content: a container's own name/kind/status, an agenda segment's scheduling metadata, and a GROUP BY count are not Artifact/Segment content, same D-18 line `pg-project-list-repository.ts` draws above. `application/project/get-project-overview.ts` also already calls `authorize()` against the same `{kind:'project', id}` object BEFORE this repository is ever reached, so this is not a second, undecided door -- it only runs once that one has already opened. And `project_memberships` here is read the same way `pg-identity-repository.ts`'s entry describes: it is IDENTITY DATA a decision is made from (grouped into counts, not disclosed row-by-row), so guarding it with the decision it feeds would be circular. ⚠ The exemption is valid only while this file stays a projection of those three tables into container/segment/count shapes -- adding any artifact or segment CONTENT read here would need its own decision through `guard()`.",
  ],
  [
    "src/infrastructure/project/pg-project-archive-repository.ts",
    "F124 archiveProject/unarchiveProject: a WRITE path (projects.status) plus the reads needed to decide whether that write is allowed. `application/project/archive-project.ts` already calls `canCreateProject`/`findOrgMembership` (the same org-role gate `createProject` uses) BEFORE this repository runs, so this is not a second, undecided door -- same ordering the F119 agenda-segment entry above describes. What this file returns is never Artifact/Segment CONTENT: `ArchiveOutcome`/`UnarchiveOutcome` carry only a `kind` tag plus the projectId the caller already supplied and the status the write just produced -- the same 'actor's own write echoed back' shape as the F117 project-repository entry. The `agenda_segments` read is a boolean `EXISTS (...)` used only to decide whether U-2(2) blocks the archive, never a segment row. ⚠ The exemption is valid ONLY while this file names no tenant table other than `projects`/`agenda_segments` and returns no field beyond {kind, projectId, status}, so it is not left as a claim: tests/project/archive-readonly-and-readable.test.ts asserts the file's statements are limited to those two tables. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-project-membership-repository.ts",
    "F125 addProjectMember/changeProjectRole/removeProjectMember: `application/project/member-authorization.ts` already runs the two-layer OR gate (facilitator via `member.manage`, or org role `lead` per Q-4(2)) BEFORE this repository is ever called -- same ordering as the F119/F124 entries above. What this file writes/echoes is only the caller's OWN grant on `project_memberships` (the row it just inserted/updated/deleted), never a disclosure of somebody else's content; `removeMember`'s one extra read is `projects.status`, a boolean used only to distinguish the archived case from a plain 'not a member' (DELETE's RESTRICTIVE policy uses USING, which filters silently rather than throwing, unlike INSERT/UPDATE's WITH CHECK -- see the file's own header). ⚠ The exemption is valid ONLY while this file names no tenant table other than `project_memberships`/`projects` and returns no field beyond `ProjectMembershipSnapshot`'s four columns, so it is not left as a claim: tests/project/member-two-entries-one-usecase.test.ts and tests/project/display-alias-not-persisted.test.ts exercise this file directly. If those tests are ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-invite-token-member-resolver.ts",
    "F125 addProjectMember's `inviteToken` entry: reads `invite_links` for a token ALREADY consumed by F15's existing `consumeInviteLink` path (`used_by IS NOT NULL`) -- this is the AUTHORITY FOR THE GRANT that token holder already redeemed, not content disclosed to a requester picking whose grant to read (the only input is the token itself, which is what F15's consume already bound to exactly one `used_by`). Same shape as `pg-org-invite-repository.ts`'s exemption above. ⚠ The exemption is valid ONLY while this file stays a read of `invite_links` gated on `used_by IS NOT NULL`, returning only that row's own grant fields (userId/projectId/projectRole/groupId) -- never another row's, and never the link's `contact`/`created_by`. If a future test asserting that scope is ever deleted, this entry must be re-justified.",
  ],
  [
    "src/infrastructure/identity/pg-temporary-grant-repository.ts",
    "F127 grantTemporaryRead/checkTemporaryGrantAccess/advanceAgendaSegment: `create()` only ever writes the row the caller (already authorized by `grant-temporary-read.ts`'s own facilitator/lead gate, run BEFORE this repository is reached) just asked to create, echoed back -- same shape as `pg-project-repository.ts`'s F117 entry. `findActive` answers 'does THIS grantee still have THIS scope' for the grantee named in the request, never a stranger's grant picked off a list; `findActiveBySegment` is read only by `advance-agenda-segment.ts`, which has already run `authorize({action:'agendaSegment.advance'})` one layer up (same ordering the F119 `pg-agenda-segment-repository.ts` entry above documents) -- both reads feed a revoke decision, never a response field disclosed to a requester. `markRevoked` only flips the caller's own already-identified row. ⚠ The exemption is valid ONLY while this file names no tenant table other than `temporary_grants`, so it is not left as a claim: tests/auth/temp-grant-pg-repo-guard.test.ts parses the file and fails if any other tenant table appears in a FROM/JOIN/INTO/UPDATE. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/auth/pg-team-repository.ts",
    "F11 MutateTeam: `Guarded<T>` protects DISCLOSURE, and the rows this file reads are never handed to a requester as content -- they are (a) the OCCUPANCY COUNT that decides whether a delete is allowed (I-7: does any org_memberships / acl_bindings row still point at this team), which is the same shape as the identity repository's exemption -- the thing consulted to make an authorization-adjacent decision cannot itself be gated by that decision -- and (b) the team's own id/name being created, renamed or deleted, which is the actor's OWN write echoed back, same shape as the project-repository entry above. What actually reaches the HTTP response is `TeamOccupancyItem[]` (kind/id/label triples built for the 'who is using it' message the design-signoff explicitly requires), never a raw member or binding row with any other field. ⚠ The exemption is valid ONLY while that stays true, so it is not left as a claim: tests/auth/team-crud-occupancy-check.test.ts asserts the delete-blocked response's occupancy items carry exactly kind/id/label and that the team row is untouched when blocked (no partial delete). If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/auth/pg-org-member-repository.ts",
    "F11 RemoveOrgMember: same shape as `pg-org-invite-repository.ts`'s exemption above, which this file sits right next to. It DELETEs the caller's own `org_memberships` row (an admin acting inside their own organization, already authorized one layer up in the use case) and UPDATEs that member's own `pending` org_invites to `revoked` -- neither statement discloses a row's CONTENT to anyone: the method's return shape is two counts (`removed`, `revokedInvites`), never a row. The one SELECT (`credentials.email`, used only to find which invites belong to this user) never leaves the file. ⚠ The exemption is valid ONLY while `remove()` returns nothing but those counts, so it is not left as a claim: tests/auth/member-removal-preserves-attribution.test.ts asserts the use case's output shape and separately asserts the removed member's `credentials` row (their attribution) is untouched. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/files/pg-quarantine-repository.ts",
    "F35 malware quarantine trail (uc-22-2 E2): `Guarded<T>` protects DISCLOSURE, and this file has no read method at all -- `record()` is the only export and it is a single INSERT. A malware-scan verdict is also not tenant CONTENT in the sense R7 is about: it is a security/audit fact about bytes that were REFUSED (no artifact, no artifact_version, nothing UC-0.3 R7 propagation reaches), same category as the provenance-repository exemption above -- the record exists so 'was this file caught' has an answer, not to be served back to a requester through the normal content path. ⚠ The exemption is valid ONLY while this file stays INSERT-only, so it is not left as a claim: tests/files/quarantine-repo-is-write-only.test.ts asserts every tenant-table reference in it is an INSERT INTO. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/chat/pg-chat-preset-repository.ts",
    "F115 preset dispatch/usage: this file reads `chat_presets` content (openingPrompt/skills/agents) but never hands that content to a requester as a response field. `upsertPreset`/`dispatchPreset`/`startPresetInstance`/`getPresetUsage` (application/chat/*.ts) return {presetId,version} / {dispatchId,targetCount} / {threadId,instanceId} / {usageCount} respectively -- never the preset row. The internal reads of `chat_presets` are (a) the actor's OWN write echoed back (upsertPreset, same shape as the project-repository entry above), or (b) consumed only to compute a derived value (dispatchPreset's scope check against org_agents/org_skills, startPresetInstance building a thread title actor cannot see unless isActorDispatchTarget already passed, getPresetUsage's aggregate usageCount over chat_preset_instances). `project_memberships` / `org_agents` / `org_skills` reads are IDENTITY/CATALOG DATA a decision is made from, same shape as the identity-repository exemption -- circular to gate with the decision they produce. `chat_preset_dispatches` / `chat_preset_instances` rows carry no content beyond ids/counts/actor ids, and `chat_threads` is written here with the SAME visibilityScope='private' mechanism F108/F109 already gate reads of (this file only INSERTs the thread row; reading it back goes through the existing `pg-chat-repository.ts` guarded path, not this file). ⚠ The exemption is valid ONLY while no method here returns `openingPrompt`/`skills`/`agents` to a caller, so it is not left as a claim: tests/chat/preset-content-echo-only.test.ts asserts every one of the four application-layer preset functions' result shape excludes those three keys, using an in-memory fake repository. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/interview/pg-template-repository.ts",
    "F82 access-templates data model: `guard()`/`disclose()` cannot be attached here for a reason stated in the design material itself, not invented for this entry -- `contracts/interview/domain.md` lists the template's visibility range (org-wide share / team-private / personal draft) as `[待定 D-16]`, still undecided at signoff time. Writing a `decideTemplateVisibility` now would mean fabricating the very rule the design-signoff explicitly deferred, which is worse than the gap it would paper over: it reads as covered when it is not, exactly the failure mode `toAclRef`'s `organization`/`interview` guards exist to name loudly instead of silently over-granting. So this file's actual exposure today is bounded to the SAME thing RLS already guarantees -- one organization's rows, nothing coarser and nothing finer -- and is not allowed to become anything looser than that while it sits here unguarded. ⚠ The exemption is valid ONLY while every statement stays scoped by an explicit `org_id` predicate/column and the file never calls `withoutTenant`: tests/itv/template-repo-org-scoped-only.test.ts parses the file and fails on either violation. The day D-16 is decided, this entry must be replaced by a real `decideTemplateVisibility` + `discloseDecided()` path, not renewed.",
  ],
  [
    "src/infrastructure/interview/pg-template-draft-repository.ts",
    "F83 reverse-extraction drafts: same D-16 gap as `pg-template-repository.ts` above, and the same shape -- a template's visibility range is undecided, and a draft is a not-yet-a-template of exactly that same undecided kind. Its exposure is bounded to the same thing RLS already guarantees. ⚠ Valid ONLY while every statement stays org_id-scoped and never calls `withoutTenant`: tests/itv/template-draft-repo-org-scoped-only.test.ts parses the file and fails on either violation. Replace with a real decision path if/when D-16 is decided, together with the template repository's entry.",
  ],
  [
    "src/infrastructure/interview/pg-source-interview-reader.ts",
    "F83 extractTemplateDraft's source-material read: NOT a second undecided door. `application/interview/extract-template-draft.ts` calls `InterviewScopeRepository.findVisibleById` + `decideInterviewVisibility` (F80's existing guarded path, the same one `getInterview` uses) for every `sourceInterviewId` BEFORE this reader is ever invoked -- same ordering as the `pg-agenda-segment-repository.ts` (F119) and `pg-project-archive-repository.ts` (F124) entries above: authorization already happened one layer up, this file only continues an already-approved action. What it reads (`interview_consent_submissions`, `interview_template_applications`) is consumed only to derive `aiAnalysisAllowed` (a boolean, O-05) and the applied sections/dataFields (structural content already known to have been produced by the same interview the caller was just cleared to see) -- it never reads `interview_sessions` itself, so it adds no visibility surface beyond what the use case already decided. ⚠ Valid ONLY while this file names no tenant table other than those two and never calls `withoutTenant`: tests/itv/source-interview-reader-org-scoped-only.test.ts parses the file and fails on either violation. If the use case is ever changed to call this reader without the scope check first, that check's removal is the thing to catch, not this entry.",
  ],
  [
    "src/infrastructure/files/pg-ingestion-repository.ts",
    "F36 ingestion outbox/history (uc-22-2 R8): `guard()`/`disclose()` protect ARTIFACT CONTENT reaching a requester, and nothing this file returns is that -- `ingestion_outbox` rows are job-queue metadata (org/artifact/version id, which STEP, `status`/`attempts`/`locked_by`), and `ingestion_history` rows are a state name plus a timestamp. Neither carries a title, a mime type, bytes, or segment text; same category as the quarantine-repository entry above (a security/pipeline FACT about a version, not the version's content), not the `acl_bindings`-governed thing R7 is about. It is also, structurally, a worker's-eye view: `claimNext`/`completeAndAdvance` exist to let a background process advance a state machine, not to answer 'may THIS requester see THIS artifact' -- there is no requester in that call at all. ⚠ The exemption is valid ONLY while no method here returns a field outside {id, orgId, artifactId, artifactVersionId, step, status, attempts, lastError} ∪ {status, occurredAt} (history), and every statement stays scoped by an explicit `org_id` predicate (no `withoutTenant`): tests/files/ingestion-repo-metadata-only.test.ts parses the file and fails on either violation. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/chat/pg-approval-model-registry.ts",
    "F112 approval-card model registry read: same shape as `pg-admission-test-repository.ts`'s exemption above, and for the same reason -- `guard()` cannot express this ref. `ObjectRef` is project|artifact|segment|capability|organization|interview; a MODEL is none of them and has no `acl_bindings` row, so pushing a `model` ref through `authorize` would find no binding, fall back to DEFAULT_SCOPE (org-wide), see a non-null org role and return `allowed: true` for every member -- exactly the failure `toAclRef` refuses to paper over for `capability`/`organization`/`interview`. Who may see a model's kind/price is not a per-artifact question at all: `models` is ORGANIZATION CONFIGURATION (migration `0019-f48-model-pool.sql`'s own header), the same category the admission-test entry draws its line around. This file additionally reads STRICTLY FEWER columns than that migration grants to `app_rw` on `models` -- `id, kind, display_name, unit_price`, never anything from `model_secrets` (which has no SELECT grant on `ciphertext` to any role, guarded at the database, not here). ⚠ The exemption is valid ONLY while this file's one query stays limited to those four `models` columns, so it is not left as a claim: tests/chat/approval-model-registry-no-secret-columns.test.ts parses the file and fails if any other column or any `model_secrets`/credential-shaped identifier appears in it. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/interview/pg-consent-gate-reader.ts",
    "F88 开始访谈的硬门禁: this is a SYSTEM CHECK, not a viewer-facing read -- `application/interview/consent-gate.ts`'s own header explains why it deliberately does not go through `guard()`/`disclose()`: the gate must see the TRUE submission state of every required subject regardless of who happens to be asking, so filtering it by a viewer's `PermissionDecision` would let 'this viewer cannot see subject X' silently open the gate for X -- the opposite of what a hard gate is for. Nothing this file returns reaches a requester as content: `rosterWithConsent` feeds only `evaluateConsentGate` (`consent-gate.ts`), which reduces the three tables to a boolean (`blocked`) plus subjectIds already known to the caller (they are the same subjectIds `SubjectRepository.attachToSession` -- itself already-guarded elsewhere -- put in this session's roster). No display_name/role_title/contact/consent-bit VALUE crosses this file's boundary into a use case result; `startSession`'s output is `{startedAt, excludedSubjectIds}`, ids only, same category as the `pg-project-list-repository.ts`/`pg-agenda-segment-repository.ts` entries above (container/id facts, not `acl_bindings`-governed content). ⚠ The exemption is valid ONLY while this file names no tenant table other than `interview_session_subjects`/`interview_subjects`/`interview_consent_submissions`, every statement stays `org_id`-scoped (no `withoutTenant`), and no method returns anything beyond `{subjectId, mode, bits}`: tests/itv/consent-gate-reader-ids-and-bits-only.test.ts parses the file and fails on any of the three violations. If that test is ever deleted, this entry must go with it.",
  ],
]);

/** Parse the migrations for tenant-carrying table names. */
function tenantTables() {
  const tables = new Set();
  const roots = new Set();
  if (!existsSync(MIGRATIONS)) return tables;
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, name, body] = m;
      if (!/^\s*org_id\b/m.test(body)) continue;
      tables.add(name.toLowerCase());
      // Whatever org_id points at is the tenant root -- `organizations` is discovered, not typed.
      for (const r of body.matchAll(/^\s*org_id\b[^,]*?REFERENCES\s+(\w+)/gim)) roots.add(r[1].toLowerCase());
    }
  }
  for (const r of roots) tables.add(r);
  return tables;
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

const TABLES = tenantTables();
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : [join(API, "src")];

let fail = 0;
let scanned = 0;

// `FROM x` / `JOIN x` / `INTO x` / `UPDATE x` / `DELETE FROM x`. Deliberately SQL-keyword
// anchored: a bare identifier match would fire on the word `projects` in prose. This
// project has two precedents for a noisy gate being muted, so over-firing is treated as a
// failure mode of equal weight.
const SQL_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

for (const root of ROOTS) {
  const abs = root.startsWith("/") ? root : join(API, "..", "..", root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  for (const file of walk(abs)) {
    scanned++;
    const rel = relative(API, file);
    if (ALLOWLIST.has(rel)) continue;
    const body = readFileSync(file, "utf8");
    const guarded = body.includes(FILTER_MODULE);
    const inInfra = rel.includes("/infrastructure/") || rel.startsWith("infrastructure/");

    body.split("\n").forEach((line, i) => {
      // A comment naming a table is documentation of the rule, not a violation of it
      // (same exemption lint-error-leak makes, for the same reason).
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
      for (const m of line.matchAll(SQL_REF)) {
        const t = m[1].toLowerCase();
        if (!TABLES.has(t)) continue;
        if (inInfra && guarded) return;
        console.error(`✗ ${rel}:${i + 1}  reads tenant table \`${t}\` outside the guarded read path`);
        console.error(
          inInfra
            ? `    It is in infrastructure/ but does not import ${FILTER_MODULE}: it returns raw rows, so whatever calls it has nothing forcing a permission decision.`
            : `    Tenant data must be read in infrastructure/ and returned as Guarded<T> (${FILTER_MODULE}).`,
        );
        console.error(
          `    Why: UC-0.3 R7 -- a scope on an Artifact must reach its segments, embeddings, graph nodes, cache entries and Context Pack items. An unguarded read is how "you cannot see the original but the summary launders it out" happens.`,
        );
        fail++;
        return;
      }
    });
  }
}

console.log(
  fail === 0
    ? `✅ lint-permission-paths: every tenant-table read goes through the guarded read path`
    : `\n❌ ${fail} unguarded tenant read(s). See UC-0.3 R7 / coherence X-1.`,
);
// Machine-readable, asserted by permission-propagation-six-paths.test.ts. Against an empty
// tree, or with a table list that failed to parse, this gate exits 0 while testing nothing
// -- so the test asserts these numbers, not the exit code.
console.log(`scanned=${scanned} tenant-tables=${TABLES.size} allowlisted=${ALLOWLIST.size}`);
process.exit(fail === 0 ? 0 : 1);
