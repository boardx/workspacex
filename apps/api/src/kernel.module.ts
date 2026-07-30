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
import { PgInterviewScopeRepository } from "./infrastructure/interview/pg-interview-scope-repository";
import { InterviewScopeController } from "./interface/controllers/interview-scope.controller";
// F108（phase-01 chat 束）：对话可见性。⚠ 只有**读**端口——线程的新建/改名/删除属 F109，
// 这里没有它们的 provider，是因为给一个不存在的能力留绑定，会让下一个人以为它已经在跑了。
import { CHAT_REPOSITORY } from "./application/chat/ports";
import { PgChatRepository } from "./infrastructure/chat/pg-chat-repository";
import { ChatController } from "./interface/controllers/chat.controller";

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
    {
      provide: ORG_LIFECYCLE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgOrgLifecycleRepository(db),
      inject: [DATABASE_PORT],
    },
    // F80. ⚠ 没有 `INTERVIEW_WRITE_*` 之类的 provider：F80 只建范围与可见性两条读路径，
    // 新建向导是 F84、挂载是 F81。给一个还不存在的能力留个绑定，
    // 会让下一个接界面的人以为它已经在跑了。
    {
      provide: INTERVIEW_SCOPE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgInterviewScopeRepository(db),
      inject: [DATABASE_PORT],
    },
    // Guard registered GLOBALLY. Per-route mounting means one missed route is a silent
    // authorization hole, and nothing would ever report it.
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class KernelModule {}
