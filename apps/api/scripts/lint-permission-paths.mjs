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
    "src/infrastructure/model/pg-model-pool-repository.ts",
    "F48 models / model_composite_members / model_secrets (#548): `guard()` cannot express this ref, and forcing it would ALLOW EVERYONE -- the SAME argument the F49 admission entry below spells out, because it is the same subject. `ObjectRef` is project|artifact|segment|capability|organization|interview; a model is none of them and has no `acl_bindings` row, so a `model` ref pushed through `authorize` would find no binding, fall back to DEFAULT_SCOPE (org-wide), see a non-null org role and return `allowed: true` for every member. Who may touch the pool is an ORG-ADMIN question -- `registerModel.err` carries `NOT_ORG_ADMIN` and nothing finer -- and that decision IS attached, one layer up, in `model.controller.ts`'s `requireOrgAdmin` (org role must be exactly `admin`), before this repository is ever reached. What the file itself does: three INSERTs (the row, its ordered composite members, its sealed secrets) plus ONE read, `listForOrg`. That read has no disclosure surface above it today and cannot grow one by accident -- the contract declares NO pool-listing operation at all (`domain/model/registry.ts`'s `POOL_LISTING_GAP`, pinned by `registry-fields.test.ts`), so a route that discloses these rows cannot exist until a human signs one. ⚠ It also never reads a secret: `credentialConfigured` is an `EXISTS`, never a select of `ciphertext`, which 0019 grants to nobody anyway. ⚠ The exemption is valid ONLY while all of that holds, so it is not left as a claim: tests/capability/model/model-pool-repo-guard.test.ts asserts (a) the file names no tenant table beyond those three, (b) it never uses `withoutTenant`, (c) `ciphertext` never appears in a SELECT and no method returns it, and (d) the controller above it still carries the org-admin decision -- each paired with a mutation proving it is load-bearing. If that test is deleted, this entry must go with it.",
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
    "src/infrastructure/skill/pg-thread-mount-store.ts",
    "#467 thread_skill_mounts (F65, in-thread temporary skill mounts): authorization happens BEFORE this repository runs, and what it returns is not content. `skill-mount.controller.ts` resolves `project_memberships` on all three routes first -- the write paths through the domain predicate `isSelfMountAllowed` (mount inside `mountSkillToThread`, unmount through `assertMayWriteMounts`), the read path through `assertProjectMember` -- so every row this file returns belongs to a thread the caller was already judged for. Same ordering as the F119 / F124 / F125 entries above: permission first, repository second. `disclose()` also has no question to ask here: a `threadSkillMount` is not one of `ObjectRef`'s kinds, and pushing it through `authorize` as a `project` ref would ask the wrong question (whether you may read the CONTAINER, not whether this mount list is yours) -- the F49 entry describes that failure mode. And the six fields it hands back (mountId / threadId / skillId / versionId / mountedAt / removedAt) are identifiers and timestamps: no Artifact, no Segment, no prompt text -- the skill's own contract body is disclosed elsewhere, through `getSkillDetail`, which DOES go through `decideCapabilityVisibility` + `discloseDecided`. That same guarded path is what `mountSkillToThread` consults before a mount can be created at all (`visibilityPort` in the controller). ⚠ The exemption is valid ONLY while this file names no tenant table other than `thread_skill_mounts` and returns no field beyond those six, so it is not left as a claim: tests/skill/thread-mount-repo-guard.test.ts parses the file and fails on a second table, on `withoutTenant`, on a seventh key, and on the controller losing any of its three pre-checks. If that test is ever deleted, this entry must go with it.",
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
    "src/infrastructure/chat/pg-artifact-landing-repository.ts",
    "F114 chat_artifact_landings: NOT a second undecided door, in two different ways for its two kinds of reads. `create` and `listByThread` (in `land-as-artifact.ts` / `list-thread-artifacts.ts`) run AFTER `resolveVisibility()` has already allowed the request against the landing's own `threadId` -- same ordering as the F119 agenda-segment and F124 project-archive entries above, permission decided one layer up. `findByArtifactId` (in `check-downstream-eligibility.ts`) necessarily runs BEFORE `resolveVisibility`, for the same reason `pg-identity-repository.ts`'s entry gives: the decision needs the row's `threadId` to even ask the question, so gating this read on that decision would be circular -- `check-downstream-eligibility.ts` calls `resolveVisibility` immediately after, on the very next line, before returning anything to the caller. What the repository returns is also not Artifact CONTENT in the R7 sense -- `ArtifactLandingRow` carries only the landing's own pointers and verdict (artifactId/versionId/mode/hasSource/title/createdBy/createdAt), never a citation's `sourceFullName`/anchor or the artifact's materialized bytes; `list-thread-artifacts.ts` additionally re-applies I-36's draft-creator-only filter on top of the already-guarded thread-level decision, exactly as `pg-chat-repository.ts`'s existing reads do. ⚠ The exemption is valid ONLY while `land-as-artifact.ts` and `list-thread-artifacts.ts` call `resolveVisibility` before any `landings.` call, and `check-downstream-eligibility.ts` calls `resolveVisibility` before returning its result: tests/chat/artifact-landing-repo-resolve-before-read.test.ts parses the three application files and fails on either violation. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/chat/pg-approval-model-registry.ts",
    "F112 approval-card model registry read: same shape as `pg-admission-test-repository.ts`'s exemption above, and for the same reason -- `guard()` cannot express this ref. `ObjectRef` is project|artifact|segment|capability|organization|interview; a MODEL is none of them and has no `acl_bindings` row, so pushing a `model` ref through `authorize` would find no binding, fall back to DEFAULT_SCOPE (org-wide), see a non-null org role and return `allowed: true` for every member -- exactly the failure `toAclRef` refuses to paper over for `capability`/`organization`/`interview`. Who may see a model's kind/price is not a per-artifact question at all: `models` is ORGANIZATION CONFIGURATION (migration `0019-f48-model-pool.sql`'s own header), the same category the admission-test entry draws its line around. This file additionally reads STRICTLY FEWER columns than that migration grants to `app_rw` on `models` -- `id, kind, display_name, unit_price`, never anything from `model_secrets` (which has no SELECT grant on `ciphertext` to any role, guarded at the database, not here). ⚠ The exemption is valid ONLY while this file's one query stays limited to those four `models` columns, so it is not left as a claim: tests/chat/approval-model-registry-no-secret-columns.test.ts parses the file and fails if any other column or any `model_secrets`/credential-shaped identifier appears in it. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/interview/pg-consent-gate-reader.ts",
    "F88 开始访谈的硬门禁: this is a SYSTEM CHECK, not a viewer-facing read -- `application/interview/consent-gate.ts`'s own header explains why it deliberately does not go through `guard()`/`disclose()`: the gate must see the TRUE submission state of every required subject regardless of who happens to be asking, so filtering it by a viewer's `PermissionDecision` would let 'this viewer cannot see subject X' silently open the gate for X -- the opposite of what a hard gate is for. Nothing this file returns reaches a requester as content: `rosterWithConsent` feeds only `evaluateConsentGate` (`consent-gate.ts`), which reduces the three tables to a boolean (`blocked`) plus subjectIds already known to the caller (they are the same subjectIds `SubjectRepository.attachToSession` -- itself already-guarded elsewhere -- put in this session's roster). No display_name/role_title/contact/consent-bit VALUE crosses this file's boundary into a use case result; `startSession`'s output is `{startedAt, excludedSubjectIds}`, ids only, same category as the `pg-project-list-repository.ts`/`pg-agenda-segment-repository.ts` entries above (container/id facts, not `acl_bindings`-governed content). ⚠ The exemption is valid ONLY while this file names no tenant table other than `interview_session_subjects`/`interview_subjects`/`interview_consent_submissions`, every statement stays `org_id`-scoped (no `withoutTenant`), and no method returns anything beyond `{subjectId, mode, bits}`: tests/itv/consent-gate-reader-ids-and-bits-only.test.ts parses the file and fails on any of the three violations. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/files/pg-legal-hold-write-repository.ts",
    "F46 applyLegalHold/releaseLegalHold: `authorize({action:'artifact.complianceOps'})` already ran in `application/files/apply-legal-hold.ts`/`release-legal-hold.ts` BEFORE this repository is ever reached (same ordering the F124/F125 project-bundle entries above document) -- this is not a second, undecided door. What it reads/writes is the `legal_holds` row itself (holdId/artifactId/reason/appliedBy/appliedAt/releasedBy/releasedAt/releaseReason), the hold record the caller was JUST authorized to create or release, never other artifact content -- the same 'echo the write the caller was already cleared to make' shape `pg-project-archive-repository.ts`'s entry describes. F45's sibling `PgLegalHoldGate` (same table, read-only `isActive`) lives in `pg-deletion-repository.ts` and is unflagged there only because that file also defines `PgDeleteImpactRepository`, which imports `guard()` for a DIFFERENT method -- this file needed its own entry since it has no such import.",
  ],
  [
    "src/infrastructure/files/pg-trash-queue-repository.ts",
    "F46 listTrashQueue: `authorize({action:'artifact.complianceOps', object:{kind:'project', ...}})` already ran in `application/files/list-trash-queue.ts` BEFORE this repository is called, same ordering as the project-bundle entries above (F119/F124/F125). What it returns is `{taskIds: string[]}` ONLY -- no artifact title, no reason text, no timestamps -- the compliance view fetches each task's actual detail through the ALREADY-GUARDED `getDeletionTask`/`get-deletion-receipt.ts` path one call at a time, never through this list. The `artifacts` join exists solely to filter by `project_id`; no column from that table is selected.",
  ],
  [
    "src/infrastructure/files/pg-retry-revoke-repository.ts",
    "F46 retryCascade/revokeDeletion: both use cases call `authorize`-gated lookups (`DeletionTaskRepository.getTask`, `LegalHoldGate.isActive`) and the compliance-only `artifact.complianceOps` action one layer up (`retry-cascade.ts`/`revoke-deletion.ts`) BEFORE this repository runs. What it does here is WRITE-ONLY against `deletion_cascade_results`/`deletion_tasks` (re-running the six-category cascade's outcome, flipping status) and `artifacts.deleted_at` (undoing cascade ① on revoke) -- no SELECT anywhere in this file discloses content to a requester; every statement is an INSERT/UPDATE echoing a decision already made upstream, the same shape `pg-project-archive-repository.ts`'s entry describes for `projects.status`.",
  ],
  [
    "src/infrastructure/files/pg-retention-policy-repository.ts",
    "F46 getRetentionPolicy/setRetentionPolicy: `authorize()` already ran in `application/files/get-retention-policy.ts` (`read.published`) / `set-retention-policy.ts` (`member.manage`) BEFORE this repository is reached, same ordering as the F119/F124/F125 entries above. `retention_policies` holds five day-count integers per project -- O-01 configuration, not Artifact/Segment content `acl_bindings` governs -- the same 'organization configuration, not a per-artifact question' category `pg-admission-test-repository.ts`'s entry draws its line around for `models`.",
  ],
  [
    "src/infrastructure/files/pg-physical-delete-repository.ts",
    "F46's physical-delete worker (`run-physical-deletion.ts`) is a SYSTEM PROCESS, not a viewer-facing read -- same category `pg-consent-gate-reader.ts`'s entry above describes: there is no requester to judge, because nobody is asking to SEE anything; the worker is enumerating tasks past their grace period and purging object-store bytes. Every SELECT here (`artifact_versions`/`derived_representations` object keys+hashes, `deletion_tasks` candidates) feeds ONLY the purge operation and the receipt this feature writes (`deletion_receipts`) -- `getDeletionReceipt` (the viewer-facing read of the RESULT) is a separate, already-authorized-upstream path (`get-deletion-receipt.ts`) that does not touch this file. `markPhysicallyDeleted` only flips the caller's own task's status/receipt_id, the same 'write echoing an already-decided action' shape the retry/revoke entry above describes.",
  ],
  [
    "src/infrastructure/skill/pg-skill-starter-import-repository.ts",
    "#412 explicit starter-pack import: `import-skill-starter-pack.ts` proves current-org admin membership BEFORE any source/repository call. This repository then performs one administrator-requested write transaction, conflict checks, failed-attempt provenance, and exact idempotency replay to that same administrator; it never exposes Skill file bytes through a read endpoint. A content `guard()` would ask the wrong question before the imported capability exists. ⚠ Valid ONLY while the use case keeps the admin check first, the repository stays tenant-session scoped and names only the five import/catalog persistence tables, and its result remains IDs plus pack provenance. `tests/skills/explicit-starter-import.test.ts` mechanically asserts those constraints as well as HTTP 403/no-write behavior. If those assertions are removed, this entry must go too.",
  ],
  [
    "src/infrastructure/recording/pg-recording-repository.ts",
    "#465 录音会话生命周期（start / ingest / end / materialize）：这是一条 WRITE 路径加上「决定这次写允不允许」的那几条读，与上面 `pg-agenda-segment-repository.ts` / `pg-project-archive-repository.ts` / `pg-project-membership-repository.ts` 三条同型同理由 —— `NO_PROJECT_ROLE` 已经在 `recording.controller.ts` 里经 `IdentityRepository.findProjectMembership` 判完并拒绝，本文件才会被调到；这不是第二道没人判的门。它读回来的东西也从来不是「别人的内容」：`recording_sessions` / `recording_tracks` 是调用者刚创建的那场会话本身（`pg-project-repository.ts` F117 那条『把调用者自己的写回显给他』的形状），`recording_segments` 只经 `append`（追加，迁移里对 app_rw 只授 SELECT/INSERT）与 `ofSession`（物化时把这场会话自己的转写渲染成 `transcript.jsonl`，而那份文件随即以**普通 artifact** 身份登记进 `artifacts`/`artifact_versions` —— 也就是说读它的人下一步走的正是 F31 文件浏览器那条**已经被 guard 的**路，I-28 明令本束不得另建索引）。`recording_consent_cells` 与 `pg-consent-gate-reader.ts` 那条完全同型：它是**硬门禁的系统检查**，必须看见全部在场者的真实授权状态，用某个查看者的 `PermissionDecision` 去过滤它，等于「这个查看者看不见 X」悄悄替 X 把门打开 —— 硬门禁要防的恰好是这个；它出门的只有一个 boolean。`recording_operation_idempotency` 存的是调用者自己那次请求的摘要与结果，重放只回给同一个 key 的持有者。⚠ 该豁免**仅在**本文件只出现这五张表、且从不调用 `withoutTenant`、且 `src/interface/` 下没有任何文件直接 import 它时成立，所以它不是一句声明：`tests/rec/recording-repo-scope-guard.test.ts` 逐条机械断言这三点（并带一条正向控制，避免解析不到时空过）。那个测试若被删除，本条也必须一起删除。",
  ],
  [
    "src/infrastructure/agent/pg-agent-starter-import-repository.ts",
    "#417 explicit Agent import: `import-agent-starter-pack.ts` proves current-org admin membership before every pack/repository call. The repository then performs one administrator-requested write transaction, validates tenant-owned immutable Skill dependencies, records failed provenance, and replays only IDs plus pack provenance to that same administrator. `tests/agents/explicit-agent-import.test.ts` mechanically locks the authorization order, tenant-session boundary, table scope, no-write rejection, and cross-tenant failure. Valid only while those assertions remain.",
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
