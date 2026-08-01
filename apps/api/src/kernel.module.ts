/**
 * Composition root -- deliberately NOT part of any layer.
 *
 * The onion rule is "dependencies point inward", but something has to wire ports to
 * implementations. That is the composition root. Importing both `infrastructure` and
 * `interface` here is legitimate, because this is not business code -- it is assembly
 * instructions.
 *
 * This is the only exemption from the layering rule, which is why it is EXPLICITLY
 * registered in the `COMPOSITION_ROOT` allowlist in `lint-arch-deps.mjs`, and that
 * allowlist holds exactly two files. Without registration, `src/` root would become a
 * backdoor around the layering check: "put the code in a directory with no layer name"
 * would evade the gate, and nothing would report it.
 */
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { DATABASE_PORT } from "./application/ports/database.port";
import { LOGGER_PORT } from "./application/ports/logger.port";
import { PRINCIPAL_RESOLVER_PORT } from "./application/ports/principal-resolver.port";

import { appConfig } from "./infrastructure/db/pg-config";
import { PgDatabase, pgHealthProbe } from "./infrastructure/db/pg-database";
import { ConsoleLogger } from "./infrastructure/logging/console-logger";

// F20/F21 auth. `HeaderPrincipalResolver` is no longer wired: it was the test-injection
// PLACEHOLDER F18 shipped while the credential format was undecided (UC-0.6 A-3), and the
// format is now decided (opaque token + Redis). The file stays -- its injection path lives
// on inside `SessionTokenPrincipalResolver`, which sixteen existing kernel test files
// depend on -- but the composition root now names the real resolver.
import {
  CLOCK, CREDENTIAL_REPOSITORY, LOGIN_ATTEMPT_REPOSITORY, MAILER, PASSWORD_HASHER,
  RESET_TOKEN_REPOSITORY, SESSION_TOKEN_STORE, TOKEN_FACTORY,
  type SessionTokenStore,
} from "./application/auth/ports";
import { BcryptPasswordHasher } from "./infrastructure/auth/bcrypt-password-hasher";
import {
  PgCredentialRepository, PgLoginAttemptRepository, PgResetTokenRepository,
} from "./infrastructure/auth/pg-credential-repository";
import { RedisSessionTokenStore, redisConfig } from "./infrastructure/auth/redis-session-token-store";
import { SessionTokenPrincipalResolver } from "./infrastructure/auth/session-token-principal-resolver";
import { SystemClock, UuidTokenFactory } from "./infrastructure/auth/system-clock";
import { OutboxMailer } from "./infrastructure/auth/outbox-mailer";
import { AuthController } from "./interface/controllers/auth.controller";
import type { Clock } from "./application/auth/ports";

import { AllExceptionsFilter } from "./interface/filters/all-exceptions.filter";
import { PrincipalGuard } from "./interface/guards/principal.guard";
import { HealthController } from "./interface/controllers/health.controller";
import { KernelProbeController } from "./interface/controllers/kernel-probe.controller";
import { HEALTH_PROBE_FACTORY } from "./interface/ports.di";

import {
  AUTHORIZATION_CACHE,
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  SESSION_STORE,
} from "./application/identity/ports";
import { PgIdentityRepository } from "./infrastructure/identity/pg-identity-repository";
import {
  InMemoryAuthorizationCache,
  InMemorySessionStore,
  UuidDecisionIdFactory,
} from "./infrastructure/identity/in-memory-session-store";
import { IdentityController } from "./interface/controllers/identity.controller";
// F16: the personal-local organization. The egress guard is wired here rather than imported
// by a use case, because it patches `net.Socket.prototype.connect` for the whole process --
// that is a deployment decision, and the composition root is where deployment decisions live.
import { LocalOrgController } from "./interface/controllers/local-org.controller";
import { EGRESS_GUARD, EXPORT_TRANSPORT, LOCAL_MODEL_RUNTIME } from "./application/identity/local-org-ports";
import { ProcessEgressGuard } from "./infrastructure/egress/local-egress-guard";
import { HttpLocalModelRuntime } from "./infrastructure/identity/http-local-model-runtime";
// F17: 隐私承诺的唯一豁口。
import { LocalExportController } from "./interface/controllers/local-export.controller";
import { LOCAL_EXPORT_REPOSITORY } from "./application/identity/local-export-ports";
import { PgLocalExportRepository } from "./infrastructure/identity/pg-local-export-repository";
import { ObjectStoreExportTransport } from "./infrastructure/identity/object-store-export-transport";
import { OBJECT_STORE, type ObjectStore } from "./application/artifact/ports";
import { FsObjectStore } from "./infrastructure/storage/fs-object-store";
import { objectStoreRoot } from "./infrastructure/storage/object-store-root";
import { CapabilityController } from "./interface/controllers/capability.controller";
import {
  CAPABILITY_REPOSITORY,
  IN_FLIGHT_CALLS,
} from "./application/identity/capability-ports";
import { PgCapabilityRepository } from "./infrastructure/identity/pg-capability-repository";
import { InMemoryInFlightCalls } from "./infrastructure/identity/in-memory-in-flight-calls";
import { ProvenanceController } from "./interface/controllers/provenance.controller";
import { ArtifactBindingController } from "./interface/controllers/artifact-binding.controller";
import { ArtifactReferenceController } from "./interface/controllers/artifact-reference.controller";
import { ARTIFACT_REPOSITORY, ID_FACTORY } from "./application/artifact/ports";
import { BINDING_REPOSITORY } from "./application/artifact/binding-ports";
import { DOWNSTREAM_REFERENCE_REPOSITORY } from "./application/artifact/reference-ports";
import { PgArtifactRepository } from "./infrastructure/artifact/pg-artifact-repository";
import { PgBindingRepository } from "./infrastructure/artifact/pg-binding-repository";
import { PgDownstreamReferenceRepository } from "./infrastructure/artifact/pg-downstream-reference-repository";
import { UuidIdFactory } from "./infrastructure/artifact/uuid-id-factory";
import { CONTENT_REPOSITORY } from "./application/identity/content-ports";
import {
  PROVENANCE_READER,
  PROVENANCE_WRITER,
  REVIEW_NOTIFIER,
} from "./application/provenance/ports";
import { EvidenceWithdrawalController } from "./interface/controllers/evidence-withdrawal.controller";
import { PgContentRepository } from "./infrastructure/content/pg-content-repository";
import { PgProvenanceRepository } from "./infrastructure/provenance/pg-provenance-repository";
import type { DatabasePort } from "./application/ports/database.port";
// F19 (auth bundle). Kept as one contiguous block so the parallel auth features can add
// their providers next to it without three-way merges in the middle of an existing list.
import { REGISTRATION_REPOSITORY } from "./application/auth/ports";
import { PgRegistrationRepository } from "./infrastructure/auth/pg-registration-repository";
import { AuthRegistrationController } from "./interface/controllers/auth-registration.controller";
// F22 (auth bundle, continued): 多组织归属 + 组织停用只读降级。
// ⚠ 冻结本身**不在这里**——它是迁移 0012 的 RESTRICTIVE 策略。这个 repository 只打标记。
import { ORG_LIFECYCLE_REPOSITORY } from "./application/auth/ports";
import { PgOrgLifecycleRepository } from "./infrastructure/auth/pg-org-lifecycle-repository";
import { AuthOrgController } from "./interface/controllers/auth-org.controller";
// phase-01 F07 (org-admin bundle): 资源可见性范围过滤。
// ⚠ 没有新的 provider —— 它复用 phase-00 的 IDENTITY_REPOSITORY / CAPABILITY_REPOSITORY /
//   DECISION_ID_FACTORY。新加一个 provider 会是「第二个判定实现」的第一步，而 usecases.md
//   逐字写着这一条是 identity 的调用契约，不是第二个实现。
import { OrgAdminScopeController } from "./interface/controllers/org-admin-scope.controller";
// F80 (phase-01 · 06-itv): 访谈范围模型。project_id 可空 + 两种权限投影 + 服务端过滤。
import { INTERVIEW_SCOPE_REPOSITORY } from "./application/interview/ports";
import { INTERVIEW_ATTACHMENT_REPOSITORY } from "./application/interview/attachment-ports";
import { PgInterviewScopeRepository } from "./infrastructure/interview/pg-interview-scope-repository";
import { PgInterviewAttachmentRepository } from "./infrastructure/interview/pg-interview-attachment-repository";
import { InterviewScopeController } from "./interface/controllers/interview-scope.controller";
// F108（phase-01 chat 束）：对话可见性。⚠ 只有**读**端口——线程的新建/改名/删除属 F109，
// 这里没有它们的 provider，是因为给一个不存在的能力留绑定，会让下一个人以为它已经在跑了。
import { CHAT_PRESET_REPOSITORY, CHAT_REPOSITORY } from "./application/chat/ports";
import { PgChatRepository } from "./infrastructure/chat/pg-chat-repository";
import { PgChatPresetRepository } from "./infrastructure/chat/pg-chat-preset-repository";
import { ChatController } from "./interface/controllers/chat.controller";
// F10（phase-01 / UC-1.6）：组织成员邀请与激活。
// ⚠ 建在 phase-00 的 auth 地基上，不另起一套：credentials / org_memberships / 会话端口全部复用。
import { ORG_INVITE_REPOSITORY } from "./application/auth/org-invite-ports";
import { PgOrgInviteRepository } from "./infrastructure/auth/pg-org-invite-repository";
import { OrgInviteController } from "./interface/controllers/org-invite.controller";
// F11（phase-01 / UC-1.6 R10）：双人复核 + 配额硬阻断 + 团队增删改 + 成员移除。
// ⚠ 建在 F10 的 org_invites 之上，不重开新地基：`ORG_INVITE_REPOSITORY` 复用同一个实例
//   （`PgOrgInviteRepository` 新增了 `reviewAdminInvite` 方法，不是第二个仓储）。
import { TEAM_REPOSITORY } from "./application/auth/team-ports";
import { PgTeamRepository } from "./infrastructure/auth/pg-team-repository";
import { ORG_MEMBER_REPOSITORY } from "./application/auth/org-member-ports";
import { PgOrgMemberRepository } from "./infrastructure/auth/pg-org-member-repository";
import { OrgAdminManagementController } from "./interface/controllers/org-admin-management.controller";
// F31 (files bundle): the project file browser's three READ routes.
// ⚠ Its per-row permission predicate is `wsx_visible_artifacts()` in migration 0023, not
// anything wired here. The repository provided below is the only reader of it, and the
// application layer deliberately does NOT filter a second time -- see the port's header.
import {
  ARTIFACT_BROWSER_REPOSITORY,
  OBJECT_STORE_PROBE,
} from "./application/files/ports";
import { PgArtifactBrowserRepository } from "./infrastructure/files/pg-artifact-browser-repository";
import { ObjectStoreHeadProbe } from "./infrastructure/files/object-store-head-probe";
import { FilesBrowserController } from "./interface/controllers/files-browser.controller";
// F32：五类预览器 + 单个下载（短时效 · 一次性 · 绑定 principal · 写审计）。
// ⚠ 它的版本查找走的是 F31 **同一个** `wsx_visible_artifacts()`，不是第二份谓词——
//   浏览器里看不见的版本必须预览不了也下载不了，而那要靠「只有一处判定」而不是靠约定。
import {
  DOWNLOAD_GRANT_REPOSITORY,
  DOWNLOAD_URL_BUILDER,
} from "./application/files/download-ports";
import { PgDownloadGrantRepository } from "./infrastructure/files/pg-download-grant-repository";
import { IsolatedDownloadUrlBuilder } from "./infrastructure/files/isolated-download-url-builder";
import { FilesDeliveryController } from "./interface/controllers/files-delivery.controller";
// F33 (files bundle): 批量 zip 导出。⚠ Reads through the SAME `wsx_visible_artifacts()` F31/F32
// already use (`PgExportContentRepository`, see its header) -- an export must not reach
// further than the browser already can. `EXPORT_JOB_REPOSITORY` is a separate, plain record
// store (no shared visibility predicate to protect), so it is its own provider rather than
// forced to share an instance with the content repository for no reason.
import {
  EXPORT_CONTENT_REPOSITORY,
  EXPORT_JOB_REPOSITORY,
  ZIP_BUILDER,
} from "./application/files/export-ports";
import {
  PgExportContentRepository,
  PgExportJobRepository,
} from "./infrastructure/files/pg-export-repository";
import { NodeZipBuilder } from "./infrastructure/files/zip-codec";
import { FilesExportController } from "./interface/controllers/files-export.controller";
// F34 (V8·22-1): the real byte-level SHA-256 check `issueDownloadUrl` runs before minting.
import { OBJECT_INTEGRITY_CHECKER } from "./application/files/ports";
import { ObjectStoreIntegrityChecker } from "./infrastructure/files/object-store-integrity-checker";
// F34 (N-23 / V11·22-1): renameArtifact / resolveArtifactAlias -- migration 0033's
// `artifact_aliases`. One repository behind both, same reason F31/F32 have one each: two
// providers would be the first step toward two answers to "what was this artifact called".
import { ARTIFACT_RENAME_REPOSITORY } from "./application/files/rename-ports";
import { PgArtifactRenameRepository } from "./infrastructure/files/pg-artifact-rename-repository";
import { FilesRenameController } from "./interface/controllers/files-rename.controller";
// F03：设置 → 设备与会话。会话存储与 phase-00 是同一个，未新增任何 provider。
import { DeviceSessionController } from "./interface/controllers/device-session.controller";
// F117（phase-01 project 束）：createProject —— 全仓唯一一条创建项目容器的路径。
// F117：`PROJECT_REPOSITORY`，只有 `create` 一个方法。
// F122（本次新增）：`PROJECT_LIST_REPOSITORY`，独立 provider——两者的
// `lint-permission-paths` 豁免各自成立，见 `application/project/ports.ts` 的注释。
// F119：`AGENDA_SEGMENT_REPOSITORY`；F123：`PROJECT_OVERVIEW_REPOSITORY`；
// F124（本次新增）：`PROJECT_ARCHIVE_REPOSITORY`——独立 provider，见
// `application/project/ports.ts` 与各自 `pg-agenda-segment-repository.ts` /
// `pg-project-overview-repository.ts` / `pg-project-archive-repository.ts` 的注释。
import {
  AGENDA_SEGMENT_REPOSITORY,
  PROJECT_ARCHIVE_REPOSITORY,
  PROJECT_LIST_REPOSITORY,
  PROJECT_OVERVIEW_REPOSITORY,
  PROJECT_REPOSITORY,
} from "./application/project/ports";
// F125（本次新增）：`PROJECT_MEMBERSHIP_REPOSITORY` / `MEMBER_SUBJECT_RESOLVER`——
// 独立 provider，见 `application/project/member-ports.ts` 与
// `pg-project-membership-repository.ts` / `pg-invite-token-member-resolver.ts` 的注释。
import { MEMBER_SUBJECT_RESOLVER, PROJECT_MEMBERSHIP_REPOSITORY } from "./application/project/member-ports";
import { PgProjectRepository } from "./infrastructure/project/pg-project-repository";
import { PgProjectListRepository } from "./infrastructure/project/pg-project-list-repository";
import { PgAgendaSegmentRepository } from "./infrastructure/project/pg-agenda-segment-repository";
import { PgProjectOverviewRepository } from "./infrastructure/project/pg-project-overview-repository";
import { PgProjectArchiveRepository } from "./infrastructure/project/pg-project-archive-repository";
import { PgProjectMembershipRepository } from "./infrastructure/project/pg-project-membership-repository";
import { PgInviteTokenMemberResolver } from "./infrastructure/project/pg-invite-token-member-resolver";
import { ProjectController } from "./interface/controllers/project.controller";
// F141 (asset-governance bundle): the asset directory's two READ routes (`GetAssetDirectory` /
// `ReadAssetFile`). Scope is 2/6 AssetKinds (skill / agent, AG4) -- see the fixture repository's
// header for why phase-1 has no persisted file store to back this yet.
import { ASSET_FILE_REPOSITORY, ASSET_GOVERNANCE_REPOSITORY } from "./application/asset/ports";
import { FixtureAssetFileRepository } from "./infrastructure/asset/fixture-asset-file-repository";
import { AssetDirectoryController } from "./interface/controllers/asset-directory.controller";
// F134 (asset-governance bundle): the six-kind-uniform governance config screen (`uc-23-4` R3) --
// `GetAssetGovernance` / `SetAssetGovernance`. No persisted store exists yet for this shape
// across all six AssetKinds (AG1), so this is in-memory -- see the repository's header for why.
import { InMemoryAssetGovernanceRepository } from "./infrastructure/asset/in-memory-asset-governance-repository";
import { AssetGovernanceController } from "./interface/controllers/asset-governance.controller";

@Module({
  controllers: [
    HealthController,
    KernelProbeController,
    IdentityController,
    ProvenanceController,
    CapabilityController,
    LocalOrgController,
    LocalExportController,
    ArtifactBindingController,
    AuthRegistrationController,
    AuthController,
    ArtifactReferenceController,
    EvidenceWithdrawalController,
    AuthOrgController,
    OrgAdminScopeController,
    InterviewScopeController,
    ChatController,
    OrgInviteController,
    OrgAdminManagementController,
    FilesBrowserController,
    FilesDeliveryController,
    FilesExportController,
    FilesRenameController,
    DeviceSessionController,
    ProjectController,
    AssetDirectoryController,
    AssetGovernanceController,
  ],
  providers: [
    { provide: DATABASE_PORT, useFactory: () => new PgDatabase(appConfig()) },
    { provide: LOGGER_PORT, useFactory: () => new ConsoleLogger() },
    {
      provide: PRINCIPAL_RESOLVER_PORT,
      useFactory: (sessions: SessionTokenStore, clock: Clock) =>
        new SessionTokenPrincipalResolver({ sessions, clock }),
      inject: [SESSION_TOKEN_STORE, CLOCK],
    },
    { provide: HEALTH_PROBE_FACTORY, useValue: pgHealthProbe },
    // Constructing it installs the patch. Eager, not lazy: a guard that installs itself on
    // first use is a guard that is absent for everything that happened before first use.
    { provide: EGRESS_GUARD, useFactory: () => new ProcessEgressGuard() },
    { provide: LOCAL_MODEL_RUNTIME, useFactory: () => new HttpLocalModelRuntime() },
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgIdentityRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: CONTENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgContentRepository(db),
      inject: [DATABASE_PORT],
    },
    // One instance behind both tokens, on purpose: the writer and the reader are two
    // views of ONE table with ONE query surface (X-2). Two providers would be the first
    // step toward two implementations, and then toward two tables.
    {
      provide: PROVENANCE_WRITER,
      useFactory: (db: DatabasePort) => new PgProvenanceRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: PROVENANCE_READER,
      useExisting: PROVENANCE_WRITER,
    },
    // Third view of the same instance (F08). A notice is a pointer into the trail and its
    // FK says so; a separate provider would be the first step toward a notification store
    // that can name events which do not exist.
    {
      provide: REVIEW_NOTIFIER,
      useExisting: PROVENANCE_WRITER,
    },
    {
      provide: CAPABILITY_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgCapabilityRepository(db),
      inject: [DATABASE_PORT],
    },
    // Process-local, and honestly so: nothing in phase-00 starts a model call, so every
    // count is really zero. The path exists end to end so 04-agent reports into it rather
    // than inventing a number for `affectedInFlightCalls` (see the port's note).
    { provide: IN_FLIGHT_CALLS, useClass: InMemoryInFlightCalls },
    // ⚠ `ObjectStore` USED to be deliberately unprovided ("no route writes bytes, because
    // `saveDraft` / `pinVersion` still have no request shape able to carry them" -- coherence
    // D-2). That note was accurate and is now out of date: F17's export MOVES BYTES, and it
    // is the first route that does. The reason for the original absence was "a provider for
    // a port nothing injects suggests a capability that is not there", which is the opposite
    // of the situation now.
    //
    // ⚠ `saveDraft` / `pinVersion` still have no request shape -- providing the store does
    // NOT open those paths, and nothing here should be read as saying it does.
    { provide: OBJECT_STORE, useFactory: () => new FsObjectStore(objectStoreRoot()) },
    // F17. Called INSIDE the aperture (see `export-to-organization.ts` step 5), so a future
    // cross-deployment transport inherits the approval check instead of having to remember it.
    {
      provide: EXPORT_TRANSPORT,
      useFactory: (store: ObjectStore) => new ObjectStoreExportTransport(store),
      inject: [OBJECT_STORE],
    },
    {
      provide: LOCAL_EXPORT_REPOSITORY,
      // Takes the provenance WRITER, not its own INSERT: `provenance_events` is one table
      // with one writer (X-2), and the export needs an append inside a transaction it owns.
      useFactory: (db: DatabasePort, prov: PgProvenanceRepository) =>
        new PgLocalExportRepository(db, prov),
      inject: [DATABASE_PORT, PROVENANCE_WRITER],
    },
    {
      provide: ARTIFACT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgArtifactRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: BINDING_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgBindingRepository(db),
      inject: [DATABASE_PORT],
    },
    // F07. The single door every downstream citation passes through -- see 0010's header
    // and coverage gap ③: the five consumers live in other bundles, so the gate is a table
    // with a trigger rather than a check inside one use case.
    {
      provide: DOWNSTREAM_REFERENCE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgDownstreamReferenceRepository(db),
      inject: [DATABASE_PORT],
    },
    { provide: ID_FACTORY, useClass: UuidIdFactory },
    // F31. One repository behind the browser's list, tree and search, on purpose: three
    // providers would be the first step toward three visibility predicates, and "可见集合 ≡
    // 检索可见集合" is exactly the property that cannot survive that.
    {
      provide: ARTIFACT_BROWSER_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgArtifactBrowserRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: OBJECT_STORE_PROBE,
      useFactory: (store: ObjectStore) => new ObjectStoreHeadProbe(store),
      inject: [OBJECT_STORE],
    },
    // F32. One repository behind both the version lookup and the grant, for the same reason
    // F31 has one behind list/tree/search: two providers would be the first step toward two
    // visibility predicates.
    {
      provide: DOWNLOAD_GRANT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgDownloadGrantRepository(db),
      inject: [DATABASE_PORT],
    },
    // F34 (V8·22-1). Same `ObjectStore` instance as everything else that reads bytes -- not a
    // second store, just a second thing done with it.
    {
      provide: OBJECT_INTEGRITY_CHECKER,
      useFactory: (store: ObjectStore) => new ObjectStoreIntegrityChecker(store),
      inject: [OBJECT_STORE],
    },
    // F34 (N-23 / V11·22-1).
    {
      provide: ARTIFACT_RENAME_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgArtifactRenameRepository(db),
      inject: [DATABASE_PORT],
    },
    // ⚠ The isolated origin is a security boundary, not cosmetics -- an uploaded .html or a
    // scripted .svg served from the main origin runs there. See the builder's header.
    { provide: DOWNLOAD_URL_BUILDER, useClass: IsolatedDownloadUrlBuilder },
    // F33.
    {
      provide: EXPORT_CONTENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgExportContentRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: EXPORT_JOB_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgExportJobRepository(db),
      inject: [DATABASE_PORT],
    },
    { provide: ZIP_BUILDER, useClass: NodeZipBuilder },
    // ⚠ Still process-local, and that is CORRECT -- do not "fix" it by pointing it at Redis.
    //
    // This is `identity`'s SessionStore: the per-user project-scoped CONTEXT that
    // `switchOrganization` clears (O-12). It is NOT the session-token store; that one is
    // `SESSION_TOKEN_STORE` below, and it IS Redis-backed as of F20. The two share a word
    // and nothing else. Gap A-3 ("session storage is still in-process") was about the token
    // store, and it is closed.
    { provide: SESSION_STORE, useClass: InMemorySessionStore },

    /* ── F20 / F21 auth ─────────────────────────────────────────────────────── */
    {
      provide: CREDENTIAL_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgCredentialRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: LOGIN_ATTEMPT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgLoginAttemptRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: RESET_TOKEN_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgResetTokenRepository(db),
      inject: [DATABASE_PORT],
    },
    // Opaque token + Redis (domain §3 ①): JWT cannot satisfy I-5 "all existing sessions
    // invalid immediately" without a blacklist, which is this with extra steps.
    { provide: SESSION_TOKEN_STORE, useFactory: () => new RedisSessionTokenStore(redisConfig()) },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: TOKEN_FACTORY, useClass: UuidTokenFactory },
    { provide: CLOCK, useClass: SystemClock },
    // ⚠ Records, does not send. Mail is EGRESS (X-3) and gap A-4 -- whether a local
    // organization may use password login at all is still an open product question, and
    // wiring an SMTP client here would answer it by accident. See outbox-mailer.ts.
    { provide: MAILER, useClass: OutboxMailer },
    { provide: AUTHORIZATION_CACHE, useClass: InMemoryAuthorizationCache },
    { provide: DECISION_ID_FACTORY, useClass: UuidDecisionIdFactory },
    // F19. ⚠ No `SESSION_STORE` here: F20 owns session issuance, and the identity bundle's
    // binding above is the one that exists. Two features each providing it would be two
    // session stores, which is indistinguishable from one until a user is logged out at
    // random.
    {
      provide: REGISTRATION_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgRegistrationRepository(db),
      inject: [DATABASE_PORT],
    },
    // F22. ⚠ 没有 `purge` 之类的 provider：phase-00 里没有任何东西会在留存期届满后销毁数据
    // （契约 KNOWN_CONTRACT_GAPS.C13）。给一个不存在的能力留个绑定，
    // 会让下一个接管理界面的人以为它已经在跑了。
    // F108. 仓储只负责取数，可见性判定在 domain 一处——见 pg-chat-repository 头部。
    {
      provide: CHAT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgChatRepository(db),
      inject: [DATABASE_PORT],
    },
    // F115. 独立的仓储实现，不塞进 PgChatRepository——预设/下发/实例是三张新表，
    // 与线程/消息的读写路径没有共享逻辑，合并只会让一个文件同时长两组不相关的方法。
    {
      provide: CHAT_PRESET_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgChatPresetRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ORG_LIFECYCLE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgOrgLifecycleRepository(db),
      inject: [DATABASE_PORT],
    },
    // F80. ⚠ 没有 `INTERVIEW_WRITE_*` 之类的 provider：F80 只建范围与可见性两条读路径，
    // 新建向导是 F84。给一个还不存在的能力留个绑定，
    // 会让下一个接界面的人以为它已经在跑了。
    {
      provide: INTERVIEW_SCOPE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgInterviewScopeRepository(db),
      inject: [DATABASE_PORT],
    },
    // F81：挂到项目环节（固定快照绑定）。
    {
      provide: INTERVIEW_ATTACHMENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgInterviewAttachmentRepository(db),
      inject: [DATABASE_PORT],
    },
    // F10：组织成员邀请与激活（UC-1.6）。
    {
      provide: ORG_INVITE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgOrgInviteRepository(db),
      inject: [DATABASE_PORT],
    },
    // F11：团队增删改（占用校验）+ 成员移除（停用访问，不删产出）。两个独立 provider——
    // 它们分别锁定 `teams` 与 `org_memberships` 两张不同的表，不是同一个仓储的两个方法。
    {
      provide: TEAM_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgTeamRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ORG_MEMBER_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgOrgMemberRepository(db),
      inject: [DATABASE_PORT],
    },
    // F117。⚠ 复用 `ID_FACTORY` 而不是新造一个 id 工厂：容器 id 会出现在
    // `acl_bindings.object_id` 与 provenance 的 target 里，两处 id 形状不同的那一天，
    // 「按对象检索审计」会静默地少返回一半。
    {
      provide: PROJECT_REPOSITORY,
      useFactory: (db: DatabasePort, ids: UuidIdFactory) => new PgProjectRepository(db, ids),
      inject: [DATABASE_PORT, ID_FACTORY],
    },
    // F122：独立 provider，见 `pg-project-list-repository.ts` 文件头。
    {
      provide: PROJECT_LIST_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectListRepository(db),
      inject: [DATABASE_PORT],
    },
    // F119：独立 provider——见 `application/project/ports.ts` 里 `AgendaSegmentRepository`
    // 那条「故意不是 ProjectRepository 的第三个方法」的注释。
    {
      provide: AGENDA_SEGMENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAgendaSegmentRepository(db),
      inject: [DATABASE_PORT],
    },
    // F123：独立 provider，见 `pg-project-overview-repository.ts` 文件头。
    {
      provide: PROJECT_OVERVIEW_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectOverviewRepository(db),
      inject: [DATABASE_PORT],
    },
    // F141: fixture-backed (2/6 AssetKinds, AG4) -- see the class header for why.
    { provide: ASSET_FILE_REPOSITORY, useFactory: () => new FixtureAssetFileRepository() },
    // F134: in-memory (no persisted store across all six AssetKinds yet, AG1) -- see the
    // repository's class header for why.
    { provide: ASSET_GOVERNANCE_REPOSITORY, useFactory: () => new InMemoryAssetGovernanceRepository() },
    // F124：独立 provider，见 `pg-project-archive-repository.ts` 文件头。
    {
      provide: PROJECT_ARCHIVE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectArchiveRepository(db),
      inject: [DATABASE_PORT],
    },
    // F125：独立 provider，见 `pg-project-membership-repository.ts` 文件头。
    {
      provide: PROJECT_MEMBERSHIP_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectMembershipRepository(db),
      inject: [DATABASE_PORT],
    },
    // F125：独立 provider，见 `pg-invite-token-member-resolver.ts` 文件头。
    {
      provide: MEMBER_SUBJECT_RESOLVER,
      useFactory: (db: DatabasePort) => new PgInviteTokenMemberResolver(db),
      inject: [DATABASE_PORT],
    },
    // Guard registered GLOBALLY. Per-route mounting means one missed route is a silent
    // authorization hole, and nothing would ever report it.
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class KernelModule {}
