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
import { LOGGER_PORT, type LoggerPort } from "./application/ports/logger.port";
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
import {
  SKILL_STARTER_IMPORT_REPOSITORY,
  SKILL_STARTER_PACK_SOURCE,
} from "./application/skill-import/ports";
import { FileSkillStarterPackSource } from "./infrastructure/skill/file-skill-starter-pack-source";
import { PgSkillStarterImportRepository } from "./infrastructure/skill/pg-skill-starter-import-repository";
import { SkillStarterImportController } from "./interface/controllers/skill-starter-import.controller";
import {
  AGENT_STARTER_IMPORT_REPOSITORY,
  AGENT_STARTER_PACK_SOURCE,
} from "./application/agent-import/ports";
import { FileAgentStarterPackSource } from "./infrastructure/agent/file-agent-starter-pack-source";
import { PgAgentStarterImportRepository } from "./infrastructure/agent/pg-agent-starter-import-repository";
import { AgentStarterImportController } from "./interface/controllers/agent-starter-import.controller";
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
import {
  EMAIL_VERIFICATION_REPOSITORY,
  EMAIL_VERIFICATION_TOKEN_CODEC,
  VERIFICATION_MAIL_TRANSPORT,
  type EmailVerificationRepository,
} from "./application/auth/email-verification-ports";
import { PgEmailVerificationRepository } from "./infrastructure/auth/pg-email-verification-repository";
import {
  CloudflareEmailTransport,
  cloudflareEmailConfig,
  lazyCloudflareEmailConfig,
  type CloudflareEmailConfig,
} from "./infrastructure/auth/cloudflare-email-transport";
import {
  CLOUDFLARE_EMAIL_CONFIG,
  MailOutboxWorker,
} from "./infrastructure/auth/mail-outbox-worker";
import {
  HmacEmailVerificationTokenCodec,
  emailVerificationSecret,
} from "./infrastructure/auth/email-verification-token-codec";
import { EmailVerificationController } from "./interface/controllers/email-verification.controller";
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
// F86 (#356): consent-token 真实持久化——替换原 in-memory-consent-token-repository.ts。
// ⚠ 尚无 controller 调用这三个仓储背后的用例（issue-signing-token 等）：见该文件顶部
// 与迁移文件头，F86 五个用例目前没有任何 interface 层入口，绑好 provider 只是把
// 「持久化层」这一半从内存换成真实数据库，不代表这条能力端到端可达。
import {
  CONSENT_SNAPSHOT_REPOSITORY,
  PORTAL_TOKEN_REPOSITORY,
  SIGNING_TOKEN_REPOSITORY,
} from "./application/interview/consent-token-ports";
import {
  PgConsentSnapshotRepository,
  PgPortalTokenRepository,
  PgSigningTokenRepository,
} from "./infrastructure/interview/pg-consent-token-repository";
// F108（phase-01 chat 束）：对话可见性。⚠ 只有**读**端口——线程的新建/改名/删除属 F109，
// 这里没有它们的 provider，是因为给一个不存在的能力留绑定，会让下一个人以为它已经在跑了。
import { CHAT_PRESET_REPOSITORY, CHAT_REPOSITORY } from "./application/chat/ports";
import { ARTIFACT_LANDING_REPOSITORY } from "./application/chat/artifact-landing-ports";
import { PgChatRepository } from "./infrastructure/chat/pg-chat-repository";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY,
  PUBLISHED_AGENT_READER,
} from "./application/chat/message-command-ports";
import {
  PgChatMessageCommandRepository,
  PgPublishedAgentReader,
} from "./infrastructure/chat/pg-chat-message-command-repository";
import { PgChatPresetRepository } from "./infrastructure/chat/pg-chat-preset-repository";
import { PgArtifactLandingRepository } from "./infrastructure/chat/pg-artifact-landing-repository";
// F112：批准闸门的 model registry 读口——见该文件头，窄读 F48 的 `models` 表，
// 不是 agent-runtime 束 `ModelPoolRepository` 的第二份实现。
import { APPROVAL_MODEL_REGISTRY_READER } from "./application/chat/approval-model-registry";
import { PgApprovalModelRegistryReader } from "./infrastructure/chat/pg-approval-model-registry";
import { ChatController } from "./interface/controllers/chat.controller";
// #414（Wave 2 delta §5）：最小无工具 AgentRun 的执行与轮询读。
// 快照来自 #415 在受理时写下的 run 行；本束不解析 Agent head，也不做 provider fallback。
import {
  AGENT_RUN_EXECUTOR, AGENT_RUN_STORE, MODEL_CALL_PORT,
  type AgentRunStore, type ModelCallPort,
} from "./application/agent-run/ports";
import { PgAgentRunRepository } from "./infrastructure/agent-run/pg-agent-run-repository";
import {
  ConfiguredModelProvider, readModelProviderConfig,
} from "./infrastructure/agent-run/configured-model-provider";
import { AgentRunExecutor } from "./infrastructure/agent-run/agent-run-executor";
import { AgentRunController } from "./interface/controllers/agent-run.controller";
// #459：声明式契约 skill 的存储与 HTTP 边界（建草稿 / 列表 / 详情 / 停用被拒）。
// ⚠ 没有「启用」路由——`SKILLS_FORBIDDEN_ROUTES` 逐字禁止它，见 controller 文件头。
import {
  SKILL_CONTRACT_REPOSITORY, SKILL_SECURITY_AUDIT, SKILL_SUBMITTER_GRANTS, THREAD_MOUNT_STORE,
} from "./application/skill/ports";
import { PgSkillContractRepository } from "./infrastructure/skill/pg-skill-contract-repository";
import {
  FailClosedSubmitterGrants, LoggingSkillSecurityAudit,
} from "./infrastructure/skill/skill-gate-adapters";
import { SkillController } from "./interface/controllers/skill.controller";
// #552：双重门禁的 HTTP 边界（安全扫描 / 提交评审 / 人工审核 approve·reject）。
// ⚠ 补的是**评审**这条边界，**不是**启用路由：`SKILLS_FORBIDDEN_ROUTES` 仍然禁止
//   `POST /skills/:skillId/enable`，`已启用` 只能由 approve 分支产生。见该 controller 文件头。
import { SkillReviewController } from "./interface/controllers/skill-review.controller";
// #467 / #509：对话内临时挂载 skill 的存储与 HTTP 边界（F65）。
// ⚠ 三条路径全部来自契约的 `operations`；`resolveMountedSkills` / `listMountableSkills`
//   刻意**不接**——它们要读的蓝本编排今天没有适配器，接出来只会是恒失败的假入口。
import { PgThreadMountStore } from "./infrastructure/skill/pg-thread-mount-store";
import { SkillMountController } from "./interface/controllers/skill-mount.controller";
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
// F127（本次新增）：`TEMPORARY_GRANT_REPOSITORY`——F05 交付了判定逻辑但故意不建的存储层，
// 接进 `advanceAgendaSegment` 的 `revokedTemporaryGrants`。见
// `application/identity/temporary-grant-ports.ts` / `pg-temporary-grant-repository.ts` 的注释。
import { TEMPORARY_GRANT_REPOSITORY } from "./application/identity/temporary-grant-ports";
import { PgTemporaryGrantRepository } from "./infrastructure/identity/pg-temporary-grant-repository";
import { ProjectController } from "./interface/controllers/project.controller";
// F141 (asset-governance bundle): the asset directory's two READ routes (`GetAssetDirectory` /
// `ReadAssetFile`). Scope is 2/6 AssetKinds (skill / agent, AG4) -- see the fixture repository's
// header for why phase-1 has no persisted file store to back this yet.
import {
  ASSET_FILE_REPOSITORY,
  ASSET_GATE_STATUS_PORT,
  ASSET_GOVERNANCE_REPOSITORY,
  ASSET_OWNER_STATUS_PORT,
  ASSET_RUNTIME_LOADER_PORT,
  REVIEW_CLOCK_REPOSITORY,
} from "./application/asset/ports";
import { FixtureAssetFileRepository } from "./infrastructure/asset/fixture-asset-file-repository";
// F143: I-6's runtime-load seam -- see `application/asset/ports.ts`'s `AssetRuntimeLoaderPort`
// header for why this delegates straight to the same `AssetFileRepository`.
import { DirectoryBackedAssetRuntimeLoader } from "./infrastructure/asset/directory-backed-asset-runtime-loader";
import { AssetDirectoryController } from "./interface/controllers/asset-directory.controller";
// F134 (asset-governance bundle): the six-kind-uniform governance config screen (`uc-23-4` R3) --
// `GetAssetGovernance` / `SetAssetGovernance`. No persisted store exists yet for this shape
// across all six AssetKinds (AG1), so this is in-memory -- see the repository's header for why.
import { InMemoryAssetGovernanceRepository } from "./infrastructure/asset/in-memory-asset-governance-repository";
// F138: in-memory (no persisted store for review clocks yet) -- see the repository's class header.
import { InMemoryReviewClockRepository } from "./infrastructure/asset/in-memory-review-clock-repository";
// F137: `PublishAsset`'s `GATE_NOT_PASSED` seam -- see `application/asset/ports.ts`'s
// `AssetGateStatusPort` header for why phase-1 wires an always-"no blocking gate" stand-in.
import { AlwaysPassingAssetGateStatus } from "./infrastructure/asset/always-passing-asset-gate-status";
import { AlwaysActiveAssetOwnerStatus } from "./infrastructure/asset/always-active-asset-owner-status";
import { AssetGovernanceController } from "./interface/controllers/asset-governance.controller";
// #463 (canvas bundle): the template registry's HTTP boundary. `domain/canvas/` has existed
// since F100/F101 with 18 green test files; nothing served it, and no table stored a
// template. This is the application + interface + storage half.
// ⚠ No `CANVAS_TEMPLATE_DRAFT_*` provider: the signed contract has no create operation
//   (see `application/canvas/template-ports.ts`). A binding for a capability that does not
//   exist is how the next person concludes it merely has not been called yet.
import {
  CANVAS_TEMPLATE_REPOSITORY,
  type CanvasTemplateRepository,
} from "./application/canvas/template-ports";
import { PgCanvasTemplateRepository } from "./infrastructure/canvas/pg-canvas-template-repository";
import { CanvasTemplateController } from "./interface/controllers/canvas-template.controller";
// #548（模型池 A 组）：契约十条早已签核、domain + application 十四个文件都在，但
// `infrastructure` 一个实现都没有（只有 F49 的 `PgAdmissionTestRepository` 现成），
// 于是 interface 无从接线 —— 后果是**外部模型凭据没有任何合法入口**。
// 本次补齐 `registerModel` 那条链的四个实现并接出两条路由；其余八条各缺自己的端口实现，
// 理由逐条写在 `model.controller.ts` 文件头。
import {
  ADMISSION_TEST_REPOSITORY,
  COMPLIANCE_VOCABULARY_READER,
  MODEL_CREDENTIAL_CIPHER,
  MODEL_POOL_CLOCK,
  MODEL_POOL_REPOSITORY,
} from "./application/model/ports";
import { PgModelPoolRepository } from "./infrastructure/model/pg-model-pool-repository";
import { PgAdmissionTestRepository } from "./infrastructure/model/pg-admission-test-repository";
import { OrgComplianceVocabulary } from "./infrastructure/model/org-compliance-vocabulary";
import { SystemModelPoolClock } from "./infrastructure/model/system-model-pool-clock";
import { credentialCipherFromEnv } from "./infrastructure/model/aes-credential-cipher";
import { ModelController } from "./interface/controllers/model.controller";
// #465 (recording bundle): the session lifecycle's HTTP boundary. `domain/recording/` (10
// files) and `application/recording/` (11 files) have existed since F69-F79 and NOTHING
// served them -- from outside the process the whole capability was zero. This wires the four
// routes the contract's capture lifecycle needs, plus the persistence F69 deliberately
// deferred (migration `20260805100000_i465_recording_capture_persistence.sql`).
// ⚠ `RETENTION_POLICY_REPOSITORY` (F46) is bound here for the first time: recording's
//   `RetentionResolver` reads it rather than a table of its own, because
//   `application/recording/retention-ports.ts` is explicit that a second store for "how many
//   days" defeats the one invariant the retention feature exists to keep.
import {
  RECORDING_ID_GENERATOR,
  RECORDING_UNIT_OF_WORK,
  TRANSCRIPTION_POLICY_PROVIDER,
} from "./application/recording/session-lifecycle-ports";
import {
  RETENTION_POLICY_REPOSITORY,
  type RetentionPolicyRepository,
} from "./application/files/retention-policy-ports";
import { PgRetentionPolicyRepository } from "./infrastructure/files/pg-retention-policy-repository";
import {
  PgRecordingUnitOfWork,
  UuidRecordingIdGenerator,
} from "./infrastructure/recording/pg-recording-repository";
import { EnvTranscriptionPolicyProvider } from "./infrastructure/recording/env-transcription-policy";
import { ASR_PROVIDER } from "./application/recording/asr-ports";
import { ConfiguredRealtimeAsrProvider } from "./infrastructure/recording/configured-realtime-asr-provider";
import { RecordingController } from "./interface/controllers/recording.controller";
import type { IdGenerator as RecordingIdGenerator } from "./application/recording/ports";

@Module({
  controllers: [
    HealthController,
    KernelProbeController,
    IdentityController,
    ProvenanceController,
    CapabilityController,
    SkillStarterImportController,
    AgentStarterImportController,
    LocalOrgController,
    LocalExportController,
    ArtifactBindingController,
    AuthRegistrationController,
    EmailVerificationController,
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
    CanvasTemplateController,
    RecordingController,
    AgentRunController,
    SkillController,
    SkillReviewController,
    SkillMountController,
    ModelController,
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
    /* ── #548 模型池 ───────────────────────────────────────────────────────── */
    {
      provide: MODEL_POOL_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgModelPoolRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ADMISSION_TEST_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAdmissionTestRepository(db),
      inject: [DATABASE_PORT],
    },
    { provide: COMPLIANCE_VOCABULARY_READER, useFactory: () => new OrgComplianceVocabulary() },
    { provide: MODEL_POOL_CLOCK, useFactory: () => new SystemModelPoolClock() },
    // ⚠ `useFactory`（惰性）而不是 `useValue`：`credentialCipherFromEnv` 在缺
    // `MODEL_CREDENTIAL_KEY` 时抛错，而 `useValue` 会在**模块被 import 时**求值——
    // 于是每一个只是 import 了 kernel.module 的测试都会在收集阶段炸掉，与本条无关。
    // 惰性之后，缺 key 只影响真正要用它的那次注入，且仍然是启动失败而不是静默降级。
    { provide: MODEL_CREDENTIAL_CIPHER, useFactory: () => credentialCipherFromEnv() },
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
    // Wave 2 #412. No default root and no embedded pack list: deployment explicitly
    // configures the verified pack source, while an unset source resolves no packs.
    {
      provide: SKILL_STARTER_PACK_SOURCE,
      useFactory: () => new FileSkillStarterPackSource(process.env.SKILL_STARTER_PACK_ROOT),
    },
    {
      provide: SKILL_STARTER_IMPORT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSkillStarterImportRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: AGENT_STARTER_PACK_SOURCE,
      useFactory: () => new FileAgentStarterPackSource(process.env.AGENT_STARTER_PACK_ROOT),
    },
    {
      provide: AGENT_STARTER_IMPORT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAgentStarterImportRepository(db),
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
    {
      provide: EMAIL_VERIFICATION_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgEmailVerificationRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: EMAIL_VERIFICATION_TOKEN_CODEC,
      useFactory: () => new HmacEmailVerificationTokenCodec(emailVerificationSecret()),
    },
    // ⚠ lazy：配置校验推迟到**第一次真正用到**时。用 `cloudflareEmailConfig()`
    //   会让整个 API 在 DI 阶段因为一个可能用不到的子系统而起不来（见该函数注释）。
    { provide: CLOUDFLARE_EMAIL_CONFIG, useFactory: () => lazyCloudflareEmailConfig() },
    {
      provide: VERIFICATION_MAIL_TRANSPORT,
      useFactory: (config: CloudflareEmailConfig) => new CloudflareEmailTransport(config),
      inject: [CLOUDFLARE_EMAIL_CONFIG],
    },
    MailOutboxWorker,
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
      provide: CHAT_MESSAGE_COMMAND_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgChatMessageCommandRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: PUBLISHED_AGENT_READER,
      useFactory: (db: DatabasePort) => new PgPublishedAgentReader(
        db,
        process.env.KERNEL_ALLOW_TEST_PRINCIPAL === "1"
          ? process.env.KERNEL_AGENT_CATALOG_SCHEMA
          : undefined,
      ),
      inject: [DATABASE_PORT],
    },
    // #414. 三个 provider，职责各一：run 状态与 append-only 步骤的持久化、
    // **唯一**已配置 provider 的模型调用、以及受理后触发执行的执行器。
    {
      provide: AGENT_RUN_STORE,
      useFactory: (db: DatabasePort) => new PgAgentRunRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      // ⚠ 配置在合成时读一次。运行中改环境变量不得换掉某次 run 的 provider——
      // 那会让「快照固定」这句话依赖于进程当时的环境，而不是 run 行本身。
      provide: MODEL_CALL_PORT,
      useFactory: () => new ConfiguredModelProvider(readModelProviderConfig()),
    },
    {
      provide: AGENT_RUN_EXECUTOR,
      useFactory: (runs: AgentRunStore, model: ModelCallPort, logger: LoggerPort) =>
        new AgentRunExecutor(runs, model, logger, process.env.KERNEL_AGENT_RUN_AUTOSTART !== "0"),
      inject: [AGENT_RUN_STORE, MODEL_CALL_PORT, LOGGER_PORT],
    },
    // F115. 独立的仓储实现，不塞进 PgChatRepository——预设/下发/实例是三张新表，
    // 与线程/消息的读写路径没有共享逻辑，合并只会让一个文件同时长两组不相关的方法。
    {
      provide: CHAT_PRESET_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgChatPresetRepository(db),
      inject: [DATABASE_PORT],
    },
    // F114. 落地记录只记指针 + 判定结果，字节与版本血缘仍全部在 phase-00 artifact——
    // 见 `chat_artifact_landings` 迁移文件头。
    {
      provide: ARTIFACT_LANDING_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgArtifactLandingRepository(db),
      inject: [DATABASE_PORT],
    },
    // F112. 批准卡的模型/单价数据窄读 F48 的 `models` 表——见该 provider 实现文件头。
    {
      provide: APPROVAL_MODEL_REGISTRY_READER,
      useFactory: (db: DatabasePort) => new PgApprovalModelRegistryReader(db),
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
    // F86 (#356)：consent-token 真实持久化，替换 in-memory 版本。
    {
      provide: SIGNING_TOKEN_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSigningTokenRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: PORTAL_TOKEN_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgPortalTokenRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: CONSENT_SNAPSHOT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgConsentSnapshotRepository(db),
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
    // F137: always-"no blocking gate" (the six gates themselves stay in phase-2, Q-0) -- see
    // the class header for why.
    { provide: ASSET_GATE_STATUS_PORT, useFactory: () => new AlwaysPassingAssetGateStatus() },
    // F138: in-memory (no persisted store for review clocks yet) -- see the repository's class
    // header. Shared by PublishAsset (writes the initial clock), ReviewAsset, GetReviewClock,
    // and ScanReviewClocks.
    { provide: REVIEW_CLOCK_REPOSITORY, useFactory: () => new InMemoryReviewClockRepository() },
    // F143: delegates to the SAME `AssetFileRepository` instance -- see the class header for
    // why this is I-6's actual fix, not a shortcut.
    {
      provide: ASSET_RUNTIME_LOADER_PORT,
      useFactory: (assets: FixtureAssetFileRepository) => new DirectoryBackedAssetRuntimeLoader(assets),
      inject: [ASSET_FILE_REPOSITORY],
    },
    // F140: no "deactivated account" signal exists in this org model yet -- see the class
    // header for why this always answers "still active".
    { provide: ASSET_OWNER_STATUS_PORT, useFactory: () => new AlwaysActiveAssetOwnerStatus() },
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
    // F127：独立 provider，见 `pg-temporary-grant-repository.ts` 文件头。
    // `temporary-grant-ports.ts` 头部把这张表标为「F05 故意没建」的缺口——本 provider
    // 是 F127 补上的存储层，接进 `advanceAgendaSegment` 的 `revokedTemporaryGrants`。
    {
      provide: TEMPORARY_GRANT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgTemporaryGrantRepository(db),
      inject: [DATABASE_PORT],
    },
    // #463：canvas 模板注册表。独立 provider，读写的是 `canvas_templates` 与
    // `canvas_template_bindings` 两张新表，与任何既有仓储没有共享的读写路径。
    {
      provide: CANVAS_TEMPLATE_REPOSITORY,
      useFactory: (db: DatabasePort): CanvasTemplateRepository =>
        new PgCanvasTemplateRepository(db),
      inject: [DATABASE_PORT],
    },
    // #465: recording session lifecycle.
    {
      provide: RETENTION_POLICY_REPOSITORY,
      useFactory: (db: DatabasePort): RetentionPolicyRepository =>
        new PgRetentionPolicyRepository(db),
      inject: [DATABASE_PORT],
    },
    { provide: RECORDING_ID_GENERATOR, useFactory: () => new UuidRecordingIdGenerator() },
    {
      provide: RECORDING_UNIT_OF_WORK,
      useFactory: (
        db: DatabasePort,
        policies: RetentionPolicyRepository,
        ids: RecordingIdGenerator,
      ) => new PgRecordingUnitOfWork(db, policies, ids),
      inject: [DATABASE_PORT, RETENTION_POLICY_REPOSITORY, RECORDING_ID_GENERATOR],
    },
    // ⚠ Constructing the provider does NOT read the environment; `policy()` does, per call.
    //   Reading it here would freeze whatever the process started with, and the one thing
    //   this provider exists to guarantee is that an unconfigured deployment refuses to
    //   ingest rather than silently flagging nothing (see `env-transcription-policy.ts`).
    { provide: TRANSCRIPTION_POLICY_PROVIDER, useFactory: () => new EnvTranscriptionPolicyProvider() },
    // #466: the realtime ASR upstream. ONE adapter, selected explicitly by
    // `KERNEL_ASR_PROVIDER`; unconfigured means `ASR_NOT_CONFIGURED` reaches the browser,
    // never a silent fallback to some other provider. See the adapter's header for why
    // that is a structural property here and not a promise.
    { provide: ASR_PROVIDER, useFactory: () => new ConfiguredRealtimeAsrProvider() },
    // #459: declarative-contract Skills. The provider hands out a *factory* -- the scoped
    // repository cannot be constructed without a tenant, so there is no "untenanted skill
    // repository" object for a forgetful caller to reach for.
    {
      provide: SKILL_CONTRACT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSkillContractRepository(db),
      inject: [DATABASE_PORT],
    },
    // #459: both of these stand in for data sources that do not exist anywhere in the repo
    // yet (submitter data-scope grants; a durable security-audit table). Neither fails open
    // -- see the reasoning in `infrastructure/skill/skill-gate-adapters.ts`.
    { provide: SKILL_SUBMITTER_GRANTS, useFactory: () => new FailClosedSubmitterGrants() },
    // #467: same factory shape and same reason as SKILL_CONTRACT_REPOSITORY above --
    // a thread mount store that is not bound to a tenant must not be constructible.
    {
      provide: THREAD_MOUNT_STORE,
      useFactory: (db: DatabasePort) => new PgThreadMountStore(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SKILL_SECURITY_AUDIT,
      useFactory: (logger: LoggerPort) => new LoggingSkillSecurityAudit(logger),
      inject: [LOGGER_PORT],
    },
    // Guard registered GLOBALLY. Per-route mounting means one missed route is a silent
    // authorization hole, and nothing would ever report it.
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class KernelModule {}
