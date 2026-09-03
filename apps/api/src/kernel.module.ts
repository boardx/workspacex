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
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { DATABASE_PORT, DIAGNOSTICS_READER_DB_PORT } from "./application/ports/database.port";
import { LOGGER_PORT, type LoggerPort } from "./application/ports/logger.port";
import { PRINCIPAL_RESOLVER_PORT } from "./application/ports/principal-resolver.port";

import { appConfig, diagnosticsReaderConfig } from "./infrastructure/db/pg-config";
import { PgDatabase, pgHealthProbe } from "./infrastructure/db/pg-database";
import { ConsoleLogger } from "./infrastructure/logging/console-logger";
import { ERROR_LOG_PORT } from "./application/ports/error-log.port";
import { PgErrorLogWriter } from "./infrastructure/logging/pg-error-log-writer";
import { RATE_LIMITER_PORT } from "./application/ports/rate-limiter.port";
import { InMemoryRateLimiter } from "./infrastructure/system/in-memory-rate-limiter";
import { PlatformSuperuserGuard } from "./interface/guards/platform-superuser.guard";
import { ClientErrorReportRateLimitGuard } from "./interface/guards/client-error-report-rate-limit.guard";

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
  type DecisionIdFactory,
  type IdentityRepository,
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
import { SkillUrlImportController } from "./interface/controllers/skill-url-import.controller";
import {
  composeImportSkillFromUrlDeps,
  composeDiscoverSkillsFromUrlDeps,
} from "./infrastructure/skill/url-import-composition";
import { IMPORT_SKILL_FROM_URL_DEPS_FACTORY } from "./application/skill-import/import-skill-from-url";
import { DISCOVER_SKILLS_FROM_URL_DEPS_FACTORY } from "./application/skill-import/discover-skills-from-url";
import { AgentUrlImportController } from "./interface/controllers/agent-url-import.controller";
import { composeImportAgentFromUrlDeps } from "./infrastructure/agent-import/import-agent-from-url-composition";
import { IMPORT_AGENT_FROM_URL_DEPS_FACTORY } from "./application/agent-import/import-agent-from-url";
import { McpRemoteDiscoveryController } from "./interface/controllers/mcp-remote-discovery.controller";
import { McpServersController } from "./interface/controllers/mcp-servers.controller";
import { composeDiscoverRemoteMcpToolsDeps } from "./infrastructure/mcp/discover-remote-mcp-tools-composition";
import { createInMemoryMcpToolStore } from "./infrastructure/mcp/in-memory-mcp-tool-store";
import { DISCOVER_REMOTE_MCP_TOOLS_DEPS_FACTORY } from "./application/mcp/discover-remote-server";
import { MCP_TOOL_STORE, MCP_SERVER_STORE, type CredentialCipher } from "./application/mcp/ports";
import { createPgMcpServerStore } from "./infrastructure/mcp/pg-mcp-server-store";
import {
  AGENT_STARTER_IMPORT_REPOSITORY,
  AGENT_STARTER_PACK_SOURCE,
} from "./application/agent-import/ports";
import { FileAgentStarterPackSource } from "./infrastructure/agent/file-agent-starter-pack-source";
import { PgAgentStarterImportRepository } from "./infrastructure/agent/pg-agent-starter-import-repository";
import { AgentStarterImportController } from "./interface/controllers/agent-starter-import.controller";
import { AGENT_SKILL_PINS_REPOSITORY } from "./application/agent-skill-pins/set-agent-skill-pins";
import { PgAgentSkillPinsRepository } from "./infrastructure/agent/pg-agent-skill-pins-repository";
import { AgentSkillPinsController } from "./interface/controllers/agent-skill-pins.controller";
import { SKILL_VERSION_EDIT_REPOSITORY } from "./application/skill/edit-skill-version-content";
import { PgSkillVersionEditRepository } from "./infrastructure/skill/pg-skill-version-edit-repository";
import { SkillVersionEditController } from "./interface/controllers/skill-version-edit.controller";
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
// F973 (plan-control 契约束).
import {
  PLAN_LEDGER_REPOSITORY, PLAN_RUN_STATUS_READER,
  type PlanLedgerRepository, type PlanRunStatusReader,
} from "./application/plan-control/ports";
import { PgPlanLedgerRepository } from "./infrastructure/plan-control/pg-plan-ledger-repository";
// F975/F976 (plan-control 契约束) —— UC-7/UC-9/UC-10/UC-13 的两个横切端口。两个 infra 实现
// （AcceptMessagePlanRunCreator / DeepAgentEngineRunController）在合入时就已写好，只是从未
// 被绑进这个容器——issue（本 PR 描述）：接线 copilotkit-v2-panel 时发现除 UC-1 外的全部
// plan-control 写操作在真实 app 里没有 HTTP 面，只在测试里手工 new 过依赖。
import { PLAN_RUN_CREATOR } from "./application/plan-control/plan-run-creator-port";
import { ENGINE_RUN_CONTROLLER } from "./application/plan-control/engine-run-controller-port";
import { AcceptMessagePlanRunCreator } from "./infrastructure/plan-control/accept-message-plan-run-creator";
import { DeepAgentEngineRunController } from "./infrastructure/plan-control/deep-agent-engine-run-controller";
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
import { DigitalInterviewController } from "./interface/controllers/digital-interview.controller";
// F01 (phase-06 · 06-itv insight sub-bundle): 洞察写路径持久化——extractQuotes /
// generateCandidateInsights / confirmInsight 三个算子真正接线到 Postgres。
import { InterviewInsightController } from "./interface/controllers/interview-insight.controller";
import {
  CANDIDATE_INSIGHT_GENERATOR,
  CONSENT_DECLINE_READER,
  INSIGHT_CANDIDATE_STORE,
  INSIGHT_CONTEXT_API,
  INSIGHT_REPOSITORY,
  QUOTE_REPOSITORY,
  SEGMENT_READER,
} from "./application/interview/insight-ports";
import { PgInterviewQuoteRepository } from "./infrastructure/interview/pg-interview-quote-repository";
import { PgInterviewInsightRepository } from "./infrastructure/interview/pg-interview-insight-repository";
import { PgSegmentReader } from "./infrastructure/interview/pg-segment-reader";
import { PgConsentDeclineReader } from "./infrastructure/interview/pg-consent-decline-reader";
import { ContextApiInsightMaterialReader } from "./infrastructure/interview/context-api-insight-material-reader";
import { InMemoryInsightCandidateStore } from "./infrastructure/interview/in-memory-insight-candidate-store";
import { HeuristicCandidateInsightGenerator } from "./infrastructure/interview/heuristic-candidate-insight-generator";
import { GuidedResearchController } from "./interface/controllers/guided-research.controller";
import { GUIDED_RESEARCH_SESSION_REPOSITORY } from "./application/research/guided-session-ports";
import { GUIDED_RESEARCH_WORKFLOW_SERVICE, GuidedResearchWorkflowService } from "./application/research/guided-workflow-service";
import { GUIDED_RESEARCH_NODE_RECEIPT_REPOSITORY, type GuidedResearchNodeReceiptRepository } from "./application/research/guided-workflow-receipt-ports";
import { PgGuidedResearchNodeReceiptRepository } from "./infrastructure/research/pg-guided-research-node-receipt-repository";
import { createGuidedResearchCheckpointer } from "./infrastructure/research/langgraph-guided-research-runtime";
import {
  GUIDED_RESEARCH_DIRECTION_GENERATOR,
  ModelGuidedResearchDirectionGenerator,
  type GuidedResearchDirectionGenerator,
} from "./application/research/guided-direction-generator";
import {
  GUIDED_RESEARCH_OUTLINE_GENERATOR,
  ModelGuidedResearchOutlineGenerator,
  type GuidedResearchOutlineGenerator,
} from "./application/research/guided-outline-generator";
import { PgGuidedResearchSessionRepository } from "./infrastructure/research/pg-guided-research-session-repository";
import { DeterministicGuidedResearchCheckpointGenerator, GUIDED_RESEARCH_CHECKPOINT_GENERATOR } from "./domain/research/guided-research-checkpoint-generator";
import { DIGITAL_EXPERT_CONTEXT_API, DIGITAL_INTERVIEW_REPOSITORY } from "./application/interview/digital-interview-ports";
import {
  DIGITAL_INTERVIEW_EFFECTS,
  type DigitalInterviewEffects,
} from "./application/interview/workflow/digital-interview-effects.port";
import {
  DIGITAL_INTERVIEW_RUNTIME,
} from "./application/interview/workflow/digital-interview-runtime.port";
import { PgDigitalInterviewRepository } from "./infrastructure/interview/pg-digital-interview-repository";
import { PgDigitalInterviewEffects } from "./infrastructure/interview/workflow/pg-digital-interview-effects";
import { readDigitalInterviewModelConfig } from "./infrastructure/interview/workflow/digital-interview-model-config";
import {
  createDigitalInterviewCheckpointer,
  LangGraphDigitalInterviewRuntime,
} from "./infrastructure/interview/workflow/langgraph-digital-interview-runtime";
import { ContextApiDigitalExpertMaterialReader } from "./infrastructure/interview/context-api-digital-expert-material-reader";
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
import { CHAT_PRESET_REPOSITORY, CHAT_REPOSITORY, type ChatRepository } from "./application/chat/ports";
import { ARTIFACT_LANDING_REPOSITORY } from "./application/chat/artifact-landing-ports";
import { PgChatRepository } from "./infrastructure/chat/pg-chat-repository";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY,
  DEFAULT_AGENT_RESOLVER,
  ENABLED_SKILL_VERSION_READER,
  PUBLISHED_AGENT_READER,
  THREAD_MOUNTED_SKILL_READER,
  type ChatMessageCommandRepository,
  type EnabledSkillVersionReader,
  type PublishedAgentReader,
  type ThreadMountedSkillReader,
} from "./application/chat/message-command-ports";
import {
  PgChatMessageCommandRepository,
  PgPublishedAgentReader,
} from "./infrastructure/chat/pg-chat-message-command-repository";
import { PgThreadMountedSkillReader } from "./infrastructure/chat/pg-thread-mounted-skill-reader";
import { PgEnabledSkillVersionReader } from "./infrastructure/skill/pg-enabled-skill-version-reader";
import { PgChatPresetRepository } from "./infrastructure/chat/pg-chat-preset-repository";
import { PgArtifactLandingRepository } from "./infrastructure/chat/pg-artifact-landing-repository";
// #946 · V9-a F150：对话附件上传——独立仓储 + 独立控制器（不塞进 1130 行的 ChatController）。
import { CHAT_ATTACHMENT_COMMAND_REPOSITORY } from "./application/chat/upload-attachment";
import { PgChatAttachmentRepository } from "./infrastructure/chat/pg-chat-attachment-repository";
import {
  ATTACHMENT_TO_MARKDOWN, type AttachmentToMarkdownPort,
} from "./application/chat/attachment-to-markdown.port";
import {
  ATTACHMENT_VISION, type AttachmentVisionPort,
} from "./application/chat/attachment-vision.port";
import {
  ATTACHMENT_EXTRACTION_STORE, type AttachmentExtractionStore,
} from "./application/chat/attachment-extraction-store";
import { ATTACHMENT_EXTRACTION_EXECUTOR } from "./application/chat/attachment-extraction-executor.port";
import { AnydocAttachmentToMarkdown } from "./infrastructure/chat/anydoc-attachment-to-markdown";
import { BailianVisionExtractor } from "./infrastructure/chat/bailian-vision-extractor";
import { PgAttachmentExtractionRepository } from "./infrastructure/chat/pg-attachment-extraction-repository";
import { AttachmentExtractionExecutor } from "./infrastructure/chat/attachment-extraction-executor";
import { ChatAttachmentController } from "./interface/controllers/chat-attachment.controller";
// F112：批准闸门的 model registry 读口——见该文件头，窄读 F48 的 `models` 表，
// 不是 agent-runtime 束 `ModelPoolRepository` 的第二份实现。
import { APPROVAL_MODEL_REGISTRY_READER } from "./application/chat/approval-model-registry";
import { PgApprovalModelRegistryReader } from "./infrastructure/chat/pg-approval-model-registry";
import { ChatController } from "./interface/controllers/chat.controller";
// #414（Wave 2 delta §5）：最小无工具 AgentRun 的执行与轮询读。
// 快照来自 #415 在受理时写下的 run 行；本束不解析 Agent head，也不做 provider fallback。
import {
  AGENT_RUN_EXECUTOR, AGENT_RUN_STORE, MODEL_CALL_PORT, TOKEN_USAGE_METER,
  type AgentRunExecutorPort, type AgentRunStore, type ModelCallPort, type TokenUsageMeterPort,
} from "./application/agent-run/ports";
import { PgAgentRunRepository } from "./infrastructure/agent-run/pg-agent-run-repository";
import { AGENT_RUN_CONTEXT_SNAPSHOT } from "./application/agent-run/context-snapshot";
import { PgFileRetrieval } from "./infrastructure/agent-run/pg-file-retrieval";
import { PgAgentRunContextSnapshot } from "./infrastructure/agent-run/pg-agent-run-context-snapshot";
import { PgRunImageInput } from "./infrastructure/agent-run/pg-run-image-input";
import { PgToolTraceContext } from "./infrastructure/agent-run/pg-tool-trace-context";
import { createCanvasTemplateGuidancePort } from "./application/agent-run/canvas-template-guidance";
import { PgTokenUsageRepository } from "./infrastructure/auth/pg-token-usage-repository";
import {
  ConfiguredModelProvider, readModelProviderConfig,
} from "./infrastructure/agent-run/configured-model-provider";
import {
  DEEP_RESEARCH_PROVIDER_NAME, DeepResearchModelProvider, readDeepResearchProviderConfig,
} from "./infrastructure/agent-run/deep-research-model-provider";
import {
  DEEP_AGENT_PROVIDER_NAME, DeepAgentModelProvider, readDeepAgentProviderConfig,
} from "./infrastructure/agent-run/deep-agent-model-provider";
import {
  BAILIAN_IMAGE_PROVIDER_NAME, BailianImageProvider, readBailianImageProviderConfig,
} from "./infrastructure/agent-run/bailian-image-provider";
import { RoutingModelCallPort } from "./infrastructure/agent-run/routing-model-call-port";
import { AgentRunExecutor } from "./infrastructure/agent-run/agent-run-executor";
import { AgentRunController } from "./interface/controllers/agent-run.controller";
import { CopilotkitAguiController } from "./interface/controllers/copilotkit-agui.controller";
import { PlanControlController } from "./interface/controllers/plan-control.controller";
import { BoardController } from "./interface/controllers/board.controller";
import { TASK_REPOSITORY, TASK_STATUS_AUDIT_WRITER } from "./application/board/ports";
import { PgTaskRepository, PgTaskStatusAuditWriter } from "./infrastructure/board/pg-task-repository";
import { AgentTrialRunController } from "./interface/controllers/agent-trial-run.controller";
import { ChatFollowUpSuggestionsController } from "./interface/controllers/chat-followup-suggestions.controller";
import { FOLLOWUP_MODEL_CONFIG } from "./application/chat/generate-followup-suggestions";
import { readFollowUpSuggestionsModelConfig } from "./infrastructure/chat/followup-suggestions-model-config";
import { THREAD_TITLE_MODEL_CONFIG, type ThreadTitleModelConfig } from "./application/chat/generate-thread-title";
import { readThreadTitleModelConfig } from "./infrastructure/chat/thread-title-model-config";
import { SkillTrialRunController, SKILL_TRIALRUN_MODEL_ID } from "./interface/controllers/skill-trial-run.controller";
import { ORG_AGENT_MODEL_READER } from "./application/skill/trial-run-skill";
import type { OrgAgentModelReader } from "./application/skill/trial-run-skill";
// F962（design-delta `skill-sandbox-execution`）：端口在 application，实现在 infrastructure，
// controller 只认端口 —— 与 ORG_AGENT_MODEL_READER 同一条洋葱先例（lint-arch-deps 机械门控）。
import { SKILL_SANDBOX_PORT, type SkillSandboxPort } from "./application/skill/skill-sandbox-port";
import {
  SKILL_TRIAL_RUN_EXECUTOR,
  SKILL_TRIAL_RUN_STORE,
  type SkillTrialRunStore,
} from "./application/skill/trial-run-async-ports";
import {
  HttpSkillSandbox, configuredSkillSandboxAddress,
} from "./infrastructure/skill/http-skill-sandbox";
import { PgSkillTrialRunStore } from "./infrastructure/skill/pg-skill-trial-run-store";
import { SkillTrialRunExecutor } from "./infrastructure/skill/skill-trial-run-executor";
import { PgOrgAgentModelReader } from "./infrastructure/skill/pg-org-agent-model-reader";
// #617：`createAgent`（POST /agents）——F55 领域模型的第一条真实 HTTP 写入口。
import { CREATE_AGENT_REPOSITORY } from "./application/agent/create-agent";
import { AGENT_PUBLISH_REPOSITORY, AGENT_REVIEWER_FUNCTION_PORT } from "./application/agent/agent-publish";
import { PgAgentPublishRepository, PgAgentReviewerFunctionPort } from "./infrastructure/agent/pg-agent-publish-repository";
import { SELF_PUBLISH_AGENT_REPOSITORY } from "./application/agent/self-publish-toolless-agent";
import { SET_AGENT_INSTRUCTIONS_REPOSITORY } from "./application/agent/set-agent-instructions";
import { SET_AGENT_ROLE_LABEL_REPOSITORY } from "./application/agent/set-agent-role-label";
import { ENSURE_DEFAULT_AGENT_REPOSITORY } from "./application/agent/ensure-default-agent";
import { ENSURE_DEEP_RESEARCH_AGENT_REPOSITORY } from "./application/agent/ensure-deep-research-agent";
import { ENSURE_IMAGE_GEN_AGENT_REPOSITORY } from "./application/agent/ensure-image-gen-agent";
import { PgDefaultAgentRepository } from "./infrastructure/agent/pg-default-agent-repository";
import { PgDeepResearchAgentRepository } from "./infrastructure/agent/pg-deep-research-agent-repository";
import { PgImageGenAgentRepository } from "./infrastructure/agent/pg-image-gen-agent-repository";
import { PgSelfPublishAgentRepository } from "./infrastructure/agent/pg-self-publish-agent-repository";
import { PgSetAgentInstructionsRepository } from "./infrastructure/agent/pg-create-agent-repository";
import { PgCreateAgentRepository } from "./infrastructure/agent/pg-create-agent-repository";
import { PgSetAgentRoleLabelRepository } from "./infrastructure/agent/pg-set-agent-role-label-repository";
import { AgentController } from "./interface/controllers/agent.controller";
import { AgentPublishController } from "./interface/controllers/agent-publish.controller";
// #459：声明式契约 skill 的存储与 HTTP 边界（建草稿 / 列表 / 详情 / 停用被拒）。
// ⚠ 没有「启用」路由——`SKILLS_FORBIDDEN_ROUTES` 逐字禁止它，见 controller 文件头。
import {
  MESSAGE_RATING_REPOSITORY,
  SKILL_CONTRACT_REPOSITORY, SKILL_SECURITY_AUDIT, SKILL_SUBMITTER_GRANTS, THREAD_MOUNT_STORE,
} from "./application/skill/ports";
// F176：消息级评价的落库面与 HTTP 边界——给 F68 那条已签核契约补地基。
// ⚠ 归因由 `MessageAttributionPort` 从 agent_runs 查出来，路由不接受任何外部归因输入。
import { PgMessageRatingRepository } from "./infrastructure/skill/pg-message-rating-repository";
import { MessageRatingController } from "./interface/controllers/message-rating.controller";
import { PgProductFeedbackRepository } from "./infrastructure/feedback/pg-product-feedback-repository";
import { PRODUCT_FEEDBACK_REPOSITORY } from "./application/feedback/ports";
import { FeedbackController } from "./interface/controllers/feedback.controller";
import { SystemErrorLogController } from "./interface/controllers/system-error-log.controller";
// 2026-08-30：反馈"转开发"建 GitHub issue + 任意分诊转移发状态变更邮件的两个 egress seam。
// 见 `application/feedback/notification-ports.ts` 与
// `application/notifications/transactional-mail-ports.ts` 头注（ADR-108）。
import {
  FEEDBACK_SUBMITTER_DIRECTORY,
  GITHUB_ISSUE_CREATOR,
} from "./application/feedback/notification-ports";
import { PgFeedbackSubmitterDirectory } from "./infrastructure/feedback/pg-feedback-submitter-directory";
import {
  FetchGithubIssueCreator,
  GITHUB_ISSUE_CONFIG,
  lazyGithubIssueConfig,
  type GithubIssueConfig,
} from "./infrastructure/feedback/github-issue-creator";
import { TRANSACTIONAL_MAIL_TRANSPORT } from "./application/notifications/transactional-mail-ports";
import {
  CloudflareTransactionalEmailTransport,
  TRANSACTIONAL_MAIL_CONFIG,
  lazyTransactionalMailConfig,
  type TransactionalMailConfig,
} from "./infrastructure/notifications/cloudflare-transactional-email-transport";
// FB-5（2026-09-02）：图片附件仓储 + 语音转录整理的固定模型配置。见两个用例的头注
// （`upload-feedback-attachment.ts` / `structure-feedback-draft.ts`）与
// `pg-feedback-attachment-repository.ts`。
import { FEEDBACK_ATTACHMENT_REPOSITORY } from "./application/feedback/attachment-ports";
import { PgFeedbackAttachmentRepository } from "./infrastructure/feedback/pg-feedback-attachment-repository";
import { FEEDBACK_STRUCTURE_MODEL_CONFIG } from "./application/feedback/structure-feedback-draft";
import { readFeedbackStructureModelConfig } from "./infrastructure/feedback/feedback-structure-model-config";
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
// shared-invite-links delta（人类 2026-08-13 三条拍板）：组织共享邀请链接。
// ⚠ 与单人邀请分端口分仓储：两套令牌语义刻意不同（一次性明文 vs 多次 hash），见端口头注。
import { ORG_INVITE_LINK_REPOSITORY } from "./application/auth/org-invite-link-ports";
import { PgOrgInviteLinkRepository } from "./infrastructure/auth/pg-org-invite-link-repository";
import { OrgInviteLinkController } from "./interface/controllers/org-invite-link.controller";
// F05（phase-10 group-checkin 束）：分组签到聚合视图的 HTTP 边界——用例/仓储早就在
// （F16 / UC-1.3 R8），只是没有路由到得了它，见 checkin-board.controller.ts 头注。
import { LIVE_SESSION_REPOSITORY } from "./application/auth/live-session-ports";
import { PgLiveSessionRepository } from "./infrastructure/auth/pg-live-session-repository";
import { newLiveSessionId } from "./domain/auth/live-session";
import { CheckinBoardController } from "./interface/controllers/checkin-board.controller";
// F11（phase-01 / UC-1.6 R10）：双人复核 + 配额硬阻断 + 团队增删改 + 成员移除。
// ⚠ 建在 F10 的 org_invites 之上，不重开新地基：`ORG_INVITE_REPOSITORY` 复用同一个实例
//   （`PgOrgInviteRepository` 新增了 `reviewAdminInvite` 方法，不是第二个仓储）。
import { TEAM_REPOSITORY } from "./application/auth/team-ports";
import { AVATAR_REPOSITORY } from "./application/identity/avatar-ports";
import { PgAvatarRepository } from "./infrastructure/auth/pg-avatar-repository";
import { PgTeamRepository } from "./infrastructure/auth/pg-team-repository";
import { ORG_MEMBER_REPOSITORY } from "./application/auth/org-member-ports";
import { PgOrgMemberRepository } from "./infrastructure/auth/pg-org-member-repository";
// org-profile-membership delta（#363 收拢）：成员/邀请列表读 + 组织资料编辑。
// ⚠ 复用 OBJECT_STORE（F04 既有 provider）而不是新起一套对象存储绑定——头像字节与
//   材料字节走同一个 `ObjectStore` 实例，键前缀 `org-avatars/` 区分即可。
import { ORG_PROFILE_REPOSITORY } from "./application/auth/org-profile-ports";
import { PgOrgProfileRepository } from "./infrastructure/auth/pg-org-profile-repository";
import { LIMIT_RULE_REPOSITORY, TOKEN_QUOTA_REPOSITORY } from "./application/auth/token-quota-ports";
import { PgLimitRuleRepository } from "./infrastructure/auth/pg-limit-rule-repository";
import { PgTokenQuotaRepository } from "./infrastructure/auth/pg-token-quota-repository";
import { OrgAdminManagementController } from "./interface/controllers/org-admin-management.controller";
// member-role-management delta：平台级成员名册与角色调整（组织级在 OrgAdminManagementController）。
import { PLATFORM_MEMBER_REPOSITORY } from "./application/system/platform-member-ports";
import { PgPlatformMemberRepository } from "./infrastructure/system/pg-platform-member-repository";
import { PlatformMemberController } from "./interface/controllers/platform-member.controller";
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
// issue #652：F46 `getRetentionPolicy` / `setRetentionPolicy` 的 HTTP 边界。⚠ 没有新
// provider —— 复用上面已经绑好的 `RETENTION_POLICY_REPOSITORY`（05-rec 的
// `retentionResolver` 也在读同一个实例），本次只是给它接第一条从浏览器可达的路。
import { FilesRetentionController } from "./interface/controllers/files-retention.controller";
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
  BLUEPRINT_REFERENCE_REPOSITORY,
  PROJECT_ARCHIVE_REPOSITORY,
  PROJECT_LIST_REPOSITORY,
  PROJECT_OVERVIEW_REPOSITORY,
  PROJECT_REPOSITORY,
  PROJECT_TAGS_REPOSITORY,
  type ProjectRepository,
  PROJECT_NAME_LOOKUP,
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
// BP-08（本次新增）：`BLUEPRINT_REFERENCE_REPOSITORY`——只读，独立 provider（`createProject`
// 判 blueprintVersionId 合不合法时用）；见 `application/project/ports.ts` 与
// `pg-blueprint-reference-repository.ts` 的注释。
import { PgBlueprintReferenceRepository } from "./infrastructure/project/pg-blueprint-reference-repository";
import { PgProjectTagsRepository } from "./infrastructure/project/pg-project-tags-repository";
import { PgProjectNameLookup } from "./infrastructure/project/pg-project-name-lookup";
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
  type AssetFileRepository,
} from "./application/asset/ports";
import { FixtureAssetFileRepository } from "./infrastructure/asset/fixture-asset-file-repository";
// #785: real Postgres backing for `skill`. Non-skill kinds (`agent` included, see its own
// header -- #787) still delegate to the fixture above.
import { PgAssetFileRepository } from "./infrastructure/asset/pg-asset-file-repository";
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
// #1493（UC-7.3 第一块）：画布实例源码链（instantiateForSegment / getSource / updateSource）。
import {
  CANVAS_INSTANCE_REPOSITORY,
  type CanvasInstanceRepository,
} from "./application/canvas/instance-ports";
import { PgCanvasInstanceRepository } from "./infrastructure/canvas/pg-canvas-instance-repository";
import { CanvasInstanceController } from "./interface/controllers/canvas-instance.controller";
// F173（BP-01）：templates 束**第一条**接上电的路由。此前该束是「34 个契约 operation
// + 32 个纯用例，零控制器零表零仓储」（#991 勘探），应用层写好了却没人调得到。
import { BlueprintController } from "./interface/controllers/blueprint.controller";
import {
  BLUEPRINT_PERSISTENCE_PORT,
  type BlueprintPersistencePort,
} from "./application/templates/blueprint-persistence-ports";
import { PgBlueprintRepository } from "./infrastructure/templates/pg-blueprint-repository";
// F23/F29 补实现（issue #1667）：`applyBlueprint`/`computeDeviations`/
// `submitBlueprintChangeRequest` 首次接上电——此前三个契约 operation 有完整应用层
// + 单测，零 controller、零 infra（issue #1667 勘探）。
import { ApplyBlueprintController } from "./interface/controllers/apply-blueprint.controller";
import { BlueprintChangeRequestController } from "./interface/controllers/blueprint-change-request.controller";
import {
  APPLY_BLUEPRINT_REPOSITORY,
  type ApplyBlueprintRepository,
} from "./application/templates/apply-blueprint-ports";
import {
  APPLY_BLUEPRINT_RESOLVER_PORT,
  type ApplyBlueprintResolverPort,
} from "./application/templates/apply-blueprint-resolver-ports";
import {
  COMPUTE_DEVIATIONS_REPOSITORY,
  type ComputeDeviationsRepository,
} from "./application/templates/compute-deviations-ports";
import {
  SUBMIT_CHANGE_REQUEST_REPOSITORY,
  type SubmitChangeRequestRepository,
} from "./application/templates/submit-change-request-ports";
import {
  LIST_PENDING_CHANGES_REPOSITORY,
  type ListPendingChangesRepository,
} from "./application/templates/list-pending-changes-ports";
import { PgApplyBlueprintRepository } from "./infrastructure/templates/pg-apply-blueprint-repository";
import { PgApplyBlueprintResolver } from "./infrastructure/templates/pg-apply-blueprint-resolver";
import { PgComputeDeviationsRepository } from "./infrastructure/templates/pg-compute-deviations-repository";
import { PgSubmitChangeRequestRepository } from "./infrastructure/templates/pg-submit-change-request-repository";
import { PgListPendingChangesRepository } from "./infrastructure/templates/pg-list-pending-changes-repository";
// F950（2026-08-16 delta）：定题/分组/筹备计数三条端点第一次接上真实 Postgres——
// F24/F25 签的契约此前只有内存假仓储撑单元测试，controller 从未挂过路由。
import { PROJECT_PREP_REPOSITORY, type ProjectPrepRepository } from "./application/templates/project-prep-ports";
import { PgProjectPrepRepository } from "./infrastructure/templates/pg-project-prep-repository";
import {
  PROJECT_TOPIC_REPOSITORY,
  type ProjectTopicRepository,
} from "./application/templates/save-and-sync-topic-ports";
import { PgProjectTopicRepository } from "./infrastructure/templates/pg-project-topic-repository";
import { GROUPING_REPOSITORY, type GroupingRepository } from "./application/templates/grouping-ports";
import { PgGroupingRepository } from "./infrastructure/templates/pg-grouping-repository";
import {
  INTERVIEW_SUBJECTS_REPOSITORY,
  type InterviewSubjectsRepository,
} from "./application/templates/interview-subjects-ports";
import { PgInterviewSubjectsRepository } from "./infrastructure/templates/pg-interview-subjects-repository";
// #1680 gap-fill：F26 三个用例（saveAsOrgTemplate/switchWorkflowTemplate/getWorkflowOrchestration）
// 首次接上真实 Postgres——此前只有内存 Fake 撑单测，`infrastructure/` 零实现、零路由、零 DI。
import {
  ORCHESTRATION_REPOSITORY_FACTORY,
  ORG_TEMPLATE_CREATE_PORT,
  WORKFLOW_TEMPLATE_CATALOG_FACTORY,
  type OrchestrationRepositoryFactory,
  type OrgTemplateCreatePort,
  type WorkflowTemplateCatalogFactory,
} from "./application/templates/workflow-orchestration-ports";
import {
  PgOrchestrationRepository,
  PgOrgTemplateCreateRepository,
  PgWorkflowTemplateCatalogRepository,
} from "./infrastructure/templates/pg-workflow-orchestration-repository";
// #548（模型池 A 组）：契约十条早已签核、domain + application 十四个文件都在，但
// `infrastructure` 一个实现都没有（只有 F49 的 `PgAdmissionTestRepository` 现成），
// 于是 interface 无从接线 —— 后果是**外部模型凭据没有任何合法入口**。
// 本次补齐 `registerModel` 那条链的四个实现并接出一条路由；其余九条各缺自己的端口实现，
// 理由逐条写在 `model.controller.ts` 文件头。
import {
  COMPLIANCE_VOCABULARY_READER,
  MODEL_CREDENTIAL_CIPHER,
  MODEL_POOL_CLOCK,
  MODEL_POOL_REPOSITORY,
} from "./application/model/ports";
import { PgModelPoolRepository } from "./infrastructure/model/pg-model-pool-repository";
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
import { PERSONAL_TRANSCRIPTION_REPOSITORY } from "./application/recording/personal-transcription-ports";
import { PgPersonalTranscriptionRepository } from "./infrastructure/recording/pg-personal-transcription-repository";
import { ASR_USAGE_METER, REALTIME_ASR_TICKET_STORE } from "./application/recording/personal-realtime-asr";
import { PgAsrUsageMeter, PgRealtimeAsrTicketStore } from "./infrastructure/recording/pg-realtime-asr-repository";

@Module({
  controllers: [
    HealthController,
    KernelProbeController,
    IdentityController,
    ProvenanceController,
    CapabilityController,
    SkillStarterImportController,
    SkillUrlImportController,
    AgentUrlImportController,
    McpRemoteDiscoveryController,
    McpServersController,
    AgentStarterImportController,
    AgentSkillPinsController,
    SkillVersionEditController,
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
    DigitalInterviewController,
    GuidedResearchController,
    InterviewScopeController,
    InterviewInsightController,
    ChatController,
    ChatFollowUpSuggestionsController,
    ChatAttachmentController,
    OrgInviteController,
    OrgInviteLinkController,
    CheckinBoardController,
    OrgAdminManagementController,
    PlatformMemberController,
    FilesBrowserController,
    FilesDeliveryController,
    FilesExportController,
    FilesRenameController,
    FilesRetentionController,
    DeviceSessionController,
    ProjectController,
    AssetDirectoryController,
    AssetGovernanceController,
    CanvasTemplateController,
    CanvasInstanceController,
    BlueprintController,
    ApplyBlueprintController,
    BlueprintChangeRequestController,
    RecordingController,
    AgentRunController,
    CopilotkitAguiController,
    // F977 (plan-control 契约束).
    PlanControlController,
    // F02/F06 (board 契约束).
    BoardController,
    AgentTrialRunController,
    SkillTrialRunController,
    AgentController,
    AgentPublishController,
    SkillController,
    MessageRatingController,
    FeedbackController,
    SystemErrorLogController,
    SkillReviewController,
    SkillMountController,
    ModelController,
  ],
  providers: [
    { provide: DATABASE_PORT, useFactory: () => new PgDatabase(appConfig()) },
    // `app_diag_ro` -- a genuinely separate credential from `app_rw` (see `pg-config.ts`'s
    // and `pg-error-log-writer.ts`'s headers). Only `PgErrorLogWriter.list()` ever touches
    // this pool.
    { provide: DIAGNOSTICS_READER_DB_PORT, useFactory: () => new PgDatabase(diagnosticsReaderConfig()) },
    { provide: LOGGER_PORT, useFactory: () => new ConsoleLogger() },
    {
      provide: ERROR_LOG_PORT,
      useFactory: (db: DatabasePort, readDb: DatabasePort) => new PgErrorLogWriter(db, readDb),
      inject: [DATABASE_PORT, DIAGNOSTICS_READER_DB_PORT],
    },
    {
      provide: RATE_LIMITER_PORT,
      useFactory: (clock: Clock) => new InMemoryRateLimiter(clock),
      inject: [CLOCK],
    },
    PlatformSuperuserGuard,
    ClientErrorReportRateLimitGuard,
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
    // F973 (plan-control 契约束) -- one instance behind both tokens: `PlanLedgerRepository`
    // and `PlanRunStatusReader` are two views of the same class, same discipline as
    // `PROVENANCE_WRITER` above.
    {
      provide: PLAN_LEDGER_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgPlanLedgerRepository(db),
      inject: [DATABASE_PORT],
    },
    // F02/F06 (board 契约束) -- F01 shipped these ports with no infra binding
    // ("纯 API/状态机断言，不锚 UI"); this is the first controller wiring them up.
    { provide: TASK_REPOSITORY, useClass: PgTaskRepository },
    { provide: TASK_STATUS_AUDIT_WRITER, useClass: PgTaskStatusAuditWriter },
    {
      provide: PLAN_RUN_STATUS_READER,
      useExisting: PLAN_LEDGER_REPOSITORY,
    },
    // F975/F976 (plan-control 契约束) —— 见上方 import 处的注记：这两个 infra 实现早就
    // 写好，只是从没绑进容器。`AcceptMessagePlanRunCreator` 复用既有的「人类消息入口」
    // 依赖集合（与 `ChatController.messageDeps` 同一组 token），不新造第二套。
    // issue #2250 -- 额外注入 `AGENT_RUN_STORE`/`LOGGER_PORT`：confirm/resume/retry 触发的
    // 续跑不再是纯 fire-and-forget 的 `kick`，还需要回读这条 run 自己的 steps 把
    // `write_todos` 结果喂回 `chat_plan_ledgers`（见该类文件头长注）。`runs` 的类型加宽到
    // `PlanLedgerRepository & PlanRunStatusReader`——`PLAN_RUN_STATUS_READER` 这个 token
    // 背后就是同一个 `PgPlanLedgerRepository` 实例（本文件上面 `useExisting` 那行的
    // 注记），不是新绑一个 provider。
    {
      provide: PLAN_RUN_CREATOR,
      useFactory: (
        repo: IdentityRepository, ids: DecisionIdFactory, chat: ChatRepository,
        commands: ChatMessageCommandRepository, publishedAgents: PublishedAgentReader,
        threadMounts: ThreadMountedSkillReader, enabledSkills: EnabledSkillVersionReader,
        executor: AgentRunExecutorPort,
        runs: PlanLedgerRepository & PlanRunStatusReader, agentRunStore: AgentRunStore,
        model: ModelCallPort, titleModel: ThreadTitleModelConfig, logger: LoggerPort,
      ) => new AcceptMessagePlanRunCreator({
        repo, ids, chat, commands, publishedAgents, threadMounts, enabledSkills, executor, runs, agentRunStore, logger,
        model, titleModel,
        // 同 ChatController.log 的既有先例（server-side only 适配器）。
        log: (message: string, detail: Record<string, unknown>) => {
          logger.error(message, { traceId: randomUUID(), err: detail.detail ?? message, ...detail });
        },
      }),
      inject: [
        IDENTITY_REPOSITORY, DECISION_ID_FACTORY, CHAT_REPOSITORY,
        CHAT_MESSAGE_COMMAND_REPOSITORY, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER,
        ENABLED_SKILL_VERSION_READER,
        AGENT_RUN_EXECUTOR, PLAN_RUN_STATUS_READER, AGENT_RUN_STORE,
        MODEL_CALL_PORT, THREAD_TITLE_MODEL_CONFIG, LOGGER_PORT,
      ],
    },
    {
      provide: ENGINE_RUN_CONTROLLER,
      useFactory: () => new DeepAgentEngineRunController(),
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
    /**
     * #595 URL 导入的 deps 工厂 —— **生产到底把什么绑给了 controller**。
     *
     * ⚠ 这里出现 `composeImportSkillFromUrlDeps` 是**刻意的且唯一的**：装配本身仍然只在
     *   `infrastructure/skill/url-import-composition.ts` 里发生，本处只是把它接上 DI。
     *   controller 不能自己 import 它——实测 `lint-arch-deps` 会红
     *   （interface 层不许 import infrastructure 层），那条洋葱约束不绕。
     *
     * ⚠ 返回**工厂**而不是现成的 deps：`localOnlyOrg` 逐请求变化，而 provider 是单例。
     *   固化它 = 让一个组织的出站策略泄漏给另一个组织，且**不会有任何东西报错**。
     *
     * ⚠ 这一层 lambda **不破坏同一性断言**：它把 `localOnlyOrg` 透传给装配函数，
     *   装配出来的 `deps.fetch` 仍然是 `fetchImportSource` 这个函数对象本身。
     *   `url-import-binding-guard.test.ts` 会**从真实 Nest 容器里解析这个 token** 并核对，
     *   ⇒ 钉住的是「生产绑了谁」，不是「代码看起来在调用谁」（反证⑮ 的教训）。
     */
    {
      provide: IMPORT_SKILL_FROM_URL_DEPS_FACTORY,
      useFactory: (db: DatabasePort, identities: IdentityRepository) =>
        (input: { readonly localOnlyOrg: boolean }) =>
          composeImportSkillFromUrlDeps({ db, identities, localOnlyOrg: input.localOnlyOrg }),
      inject: [DATABASE_PORT, IDENTITY_REPOSITORY],
    },
    /**
     * #1865 —— 扫描用例的 deps 工厂。同一条纪律（工厂而不是现成 deps，`localOnlyOrg`
     * 逐请求推导）；这条不需要 `DATABASE_PORT`，因为扫描只读不落库。
     */
    {
      provide: DISCOVER_SKILLS_FROM_URL_DEPS_FACTORY,
      useFactory: (identities: IdentityRepository) => (input: { readonly localOnlyOrg: boolean }) =>
        composeDiscoverSkillsFromUrlDeps({ identities, localOnlyOrg: input.localOnlyOrg }),
      inject: [IDENTITY_REPOSITORY],
    },
    /**
     * #1415 —— agent 版的上一条，同一条纪律（工厂而不是现成 deps，`localOnlyOrg`
     * 逐请求推导）。装配本身只发生在 `infrastructure/agent-import/import-agent-from-url-composition.ts` 里。
     */
    {
      provide: IMPORT_AGENT_FROM_URL_DEPS_FACTORY,
      useFactory: (db: DatabasePort, identities: IdentityRepository) =>
        (input: { readonly localOnlyOrg: boolean }) =>
          composeImportAgentFromUrlDeps({ db, identities, localOnlyOrg: input.localOnlyOrg }),
      inject: [DATABASE_PORT, IDENTITY_REPOSITORY],
    },
    /**
     * issue #1852 —— `McpGateway` 的第一个真实实现接线。
     * issue #1928 —— `MCP_TOOL_STORE` 不再是进程内存单例：`composeDiscoverRemoteMcpToolsDeps`
     * 现在按 `orgId` 逐请求现造一个 `PgMcpToolStore`（见该文件头注），`MCP_TOOL_STORE` 这个
     * token 仍保留、绑给旧的内存实现，供仍需要一个不区分组织的单例 store 的调用方使用
     * （目前没有——保留是因为删掉一个公开 DI token 属于范围外的清理）。
     * `MCP_SERVER_STORE` 是新的 Postgres 实现，供 `GET /mcp-servers` 只读列表用。
     * `credentialCipher` 复用 `MODEL_CREDENTIAL_CIPHER` 那把密钥（见组合文件头注）。
     */
    {
      provide: MCP_TOOL_STORE,
      useFactory: () => createInMemoryMcpToolStore(),
    },
    {
      provide: MCP_SERVER_STORE,
      useFactory: (db: DatabasePort) => createPgMcpServerStore(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: DISCOVER_REMOTE_MCP_TOOLS_DEPS_FACTORY,
      useFactory: (db: DatabasePort, identities: IdentityRepository, credentialCipher: CredentialCipher) =>
        composeDiscoverRemoteMcpToolsDeps({ db, identities, credentialCipher }),
      inject: [DATABASE_PORT, IDENTITY_REPOSITORY, MODEL_CREDENTIAL_CIPHER],
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
    {
      provide: CREATE_AGENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgCreateAgentRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: AGENT_PUBLISH_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAgentPublishRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: AGENT_REVIEWER_FUNCTION_PORT,
      useFactory: (db: DatabasePort) => new PgAgentReviewerFunctionPort(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SET_AGENT_INSTRUCTIONS_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSetAgentInstructionsRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SET_AGENT_ROLE_LABEL_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSetAgentRoleLabelRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SELF_PUBLISH_AGENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSelfPublishAgentRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ENSURE_DEFAULT_AGENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgDefaultAgentRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ENSURE_DEEP_RESEARCH_AGENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgDeepResearchAgentRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ENSURE_IMAGE_GEN_AGENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgImageGenAgentRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: AGENT_SKILL_PINS_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAgentSkillPinsRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SKILL_VERSION_EDIT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgSkillVersionEditRepository(db),
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
      // #946 · V9-a F150：附件 pending 计数 + 落行。复用 OBJECT_STORE / ID_FACTORY / CLOCK
      // （见 ChatAttachmentController 的注入），不新造对象存储或 id 工厂——与 land-as-artifact
      // 同一套字节落地设施。
      provide: CHAT_ATTACHMENT_COMMAND_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgChatAttachmentRepository(db),
      inject: [DATABASE_PORT],
    },
    // #946 · F153/W1（V9-b）：附件内容抽取（anydoc）。三件：转换端口实现、outbox+结果仓储、
    // 执行器（kick 排空，autostart 同 agent-run 由 env 关）。复用 OBJECT_STORE / LOGGER_PORT。
    { provide: ATTACHMENT_TO_MARKDOWN, useClass: AnydocAttachmentToMarkdown },
    // #1560 P1：图片走 VLM 视觉理解（百炼 Qwen-VL，复用 KERNEL_MODEL_API_KEY）。key 缺失时它
    // 如实回 visionNotConfigured → 附件落 failed + 该原因，不静默留空、不假装抽到内容。
    { provide: ATTACHMENT_VISION, useClass: BailianVisionExtractor },
    {
      provide: ATTACHMENT_EXTRACTION_STORE,
      useFactory: (db: DatabasePort) => new PgAttachmentExtractionRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ATTACHMENT_EXTRACTION_EXECUTOR,
      useFactory: (
        store: ObjectStore, extraction: AttachmentExtractionStore,
        converter: AttachmentToMarkdownPort, vision: AttachmentVisionPort, logger: LoggerPort,
      ) => new AttachmentExtractionExecutor(
        store, extraction, converter, vision, logger,
        process.env.KERNEL_ATTACHMENT_EXTRACTION_AUTOSTART !== "0",
      ),
      inject: [OBJECT_STORE, ATTACHMENT_EXTRACTION_STORE, ATTACHMENT_TO_MARKDOWN, ATTACHMENT_VISION, LOGGER_PORT],
    },
    {
      // #1559：会话内临时挂载（F65）进入 run 快照的读口。没有它，挂载被记录、被展示，
      // 却从不进入任何一次 run——那是 #1559 逐字记录的形态。
      provide: THREAD_MOUNTED_SKILL_READER,
      useFactory: (db: DatabasePort) => new PgThreadMountedSkillReader(db),
      inject: [DATABASE_PORT],
    },
    {
      // #2514：agent 默认加载全部已启用 skill（2026-09-02 裁决）进入 run 快照的读口。
      provide: ENABLED_SKILL_VERSION_READER,
      useFactory: (db: DatabasePort) => new PgEnabledSkillVersionReader(db),
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
    {
      // #2038 —— 与 PUBLISHED_AGENT_READER 同一个实例（PgPublishedAgentReader 同时
      // 实现两个接口），不开第二条 SQL 旁路；见 DefaultAgentResolver 端口文档。
      provide: DEFAULT_AGENT_RESOLVER,
      useExisting: PUBLISHED_AGENT_READER,
    },
    // #414. 三个 provider，职责各一：run 状态与 append-only 步骤的持久化、
    // **唯一**已配置 provider 的模型调用、以及受理后触发执行的执行器。
    {
      provide: AGENT_RUN_STORE,
      useFactory: (db: DatabasePort) => new PgAgentRunRepository(db),
      inject: [DATABASE_PORT],
    },
    /**
     * F157 —— 独立注册一份 `PgAgentRunContextSnapshot`，供
     * `GET /agent-runs/:runId/context-snapshot`（`AgentRunController`）读用。此前这个
     * 类只在 `AGENT_RUN_EXECUTOR` 的 `useFactory` 里 `new` 过一次（写入侧），从未作为
     * 可注入的 provider 存在——F157 落地时只接了写，没接读端点，`readAgentRunContext
     * Snapshot` 这个用例因此从未被任何 controller 调用过。两处各自 `new` 同一个无状态
     * 包装类（构造参数只有 `DatabasePort`）不是"同一份状态两处持有"，同 `AGENT_RUN_STORE`
     * 与下面 `AGENT_RUN_EXECUTOR` useFactory 里各自持有仓储引用的既有形状。
     */
    {
      provide: AGENT_RUN_CONTEXT_SNAPSHOT,
      useFactory: (db: DatabasePort) => new PgAgentRunContextSnapshot(db),
      inject: [DATABASE_PORT],
    },
    {
      // ⚠ 配置在合成时读一次。运行中改环境变量不得换掉某次 run 的 provider——
      // 那会让「快照固定」这句话依赖于进程当时的环境，而不是 run 行本身。
      //
      // 四个 provider 并存（2026-08-07 加入 open-deep-research + bailian-image；
      // 2026-08-08 加入 deep-agent，#740）：`RoutingModelCallPort` 按 run 快照里 pin 的
      // `modelProvider` 字符串分派，不是"配一个、其它 fallback 过去"——见该类头注，这是
      // `ConfiguredModelProvider` "no fallback" 纪律在多 provider 场景下的延伸，不是放弃它。
      provide: MODEL_CALL_PORT,
      useFactory: () => {
        const chatConfig = readModelProviderConfig();
        return new RoutingModelCallPort(new Map<string, ModelCallPort>([
          [chatConfig.provider, new ConfiguredModelProvider(chatConfig)],
          [DEEP_RESEARCH_PROVIDER_NAME, new DeepResearchModelProvider(readDeepResearchProviderConfig())],
          [DEEP_AGENT_PROVIDER_NAME, new DeepAgentModelProvider(readDeepAgentProviderConfig())],
          [BAILIAN_IMAGE_PROVIDER_NAME, new BailianImageProvider(readBailianImageProviderConfig())],
        ]));
      },
    },
    {
      // 追问建议（`ChatFollowUpSuggestionsController`）固定走这个标准 provider，不看
      // 被选中 Agent 的 modelProvider——见 `generate-followup-suggestions.ts` 头注
      // 「用哪个 provider 调用」（deep-agent 线程追问建议仍是模板 的根因修复）。
      provide: FOLLOWUP_MODEL_CONFIG,
      useFactory: () => readFollowUpSuggestionsModelConfig(),
    },
    {
      // 线程自动命名的模型摘要（`chat.controller.ts` / `copilotkit-agui.controller.ts`
      // 都经由 `acceptHumanMessage`）固定走这个标准 provider，同上一条 FOLLOWUP_MODEL_CONFIG
      // 的理由——见 `generate-thread-title.ts` 头注「固定走 deps.titleModel」。
      provide: THREAD_TITLE_MODEL_CONFIG,
      useFactory: () => readThreadTitleModelConfig(),
    },
    {
      /**
       * 模型 A skill 试跑（`SkillTrialRunController`）要一个 modelId——skill 本身没有
       * `model_provider`/`model_id` 列（那是 agent 才有的字段），trial-run-skill.ts
       * 头注解释了为什么。provider 复用**同一个**已配置的 chat provider（不新开
       * 第二条模型接入面），modelId 是一个独立、可选的部署配置——空串 = 这个
       * 部署没打开这条能力，`trial-run-skill.ts` 在调用时诚实报 `MODEL_UNAVAILABLE`，
       * 不在这里让整个进程启动失败（那会把「一个能力没配」变成「全组织 API 起不来」）。
       */
      provide: SKILL_TRIALRUN_MODEL_ID,
      useFactory: () => ({
        provider: readModelProviderConfig().provider,
        modelId: process.env.KERNEL_SKILL_TRIALRUN_MODEL_ID ?? "",
      }),
    },
    /**
     * 人类反馈（2026-08-17，两次）：devapp 上试跑报 `MODEL_UNAVAILABLE`——见
     * `application/skill/trial-run-skill.ts` 与 `PgOrgAgentModelReader` 的头注。
     * 自愈式回退：`SkillTrialRunController` 优先用这个组织已发布 agent 正在用的模型，
     * 没有已发布 agent 才退回上面那条 `SKILL_TRIALRUN_MODEL_ID` 静态配置。
     *
     * ⚠ 第二个构造参数是"借用"的边界——只信任 `RoutingModelCallPort` 那个通用
     *   provider（与上面 `MODEL_CALL_PORT` 注册表里 `chatConfig.provider` **同一次**
     *   `readModelProviderConfig()` 调用，不重新读一次造成两次读值可能不同步），
     *   `deep-agent`/`deep-research`/`bailian-image` 都不在这条回退的借用范围内。
     */
    {
      provide: ORG_AGENT_MODEL_READER,
      useFactory: (db: DatabasePort) =>
        new PgOrgAgentModelReader(db, readModelProviderConfig().provider),
      inject: [DATABASE_PORT],
    },
    /**
     * F962（design-delta `skill-sandbox-execution`）—— 试跑接真执行的三个 provider。
     *
     * ⚠ 沙箱地址**没有内建默认值**：两个 env 都不给 ⇒ `HttpSkillSandbox` 在**调用时**
     *   抛 `SANDBOX_UNAVAILABLE`，而不是在 boot 时崩溃，也不是静默降级成"假装执行成功"。
     *   与上面 `SKILL_TRIALRUN_MODEL_ID` 空串的处理同一条纪律：一个能力没配，不该让
     *   全组织 API 起不来；但也绝不能让它看起来像配好了。
     *
     * · `KERNEL_SKILL_SANDBOX_SOCKET`   生产形态（容器 `network: none` + 共享 volume 上的 UDS）
     * · `KERNEL_SKILL_SANDBOX_BASE_URL` 本地开发与 loopback 替身（TCP 回环）
     */
    {
      provide: SKILL_SANDBOX_PORT,
      // 地址判定的唯一事实源是 `configuredSkillSandboxAddress()`（见那个函数的头注）：
      // 没配 ⇒ 传空配置，`HttpSkillSandbox` 在**调用时**如实抛 `SANDBOX_UNAVAILABLE`。
      useFactory: () => new HttpSkillSandbox(configuredSkillSandboxAddress() ?? {}),
    },
    {
      provide: SKILL_TRIAL_RUN_STORE,
      useFactory: (db: DatabasePort) => new PgSkillTrialRunStore(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SKILL_TRIAL_RUN_EXECUTOR,
      useFactory: (
        store: SkillTrialRunStore,
        runs: AgentRunStore,
        model: ModelCallPort,
        sandbox: SkillSandboxPort,
        objects: ObjectStore,
        orgAgentModel: OrgAgentModelReader,
        logger: LoggerPort,
      ) =>
        new SkillTrialRunExecutor(
          {
            store,
            runs,
            model,
            sandbox,
            objects,
            orgAgentModel,
            // 静态兜底，与 SKILL_TRIALRUN_MODEL_ID 同源同值；组织里有已发布 agent 时
            // 由 orgAgentModel 覆盖（自愈式回退，见 trial-run-skill.ts 头注）。
            modelProvider: readModelProviderConfig().provider,
            modelId: process.env.KERNEL_SKILL_TRIALRUN_MODEL_ID ?? "",
          },
          logger,
          process.env.KERNEL_SKILL_TRIALRUN_AUTOSTART !== "0",
        ),
      inject: [
        SKILL_TRIAL_RUN_STORE,
        AGENT_RUN_STORE,
        MODEL_CALL_PORT,
        SKILL_SANDBOX_PORT,
        OBJECT_STORE,
        ORG_AGENT_MODEL_READER,
        LOGGER_PORT,
      ],
    },
    {
      provide: AGENT_RUN_EXECUTOR,
      // #741: `KERNEL_TOOL_CALLING_ENABLED` retired along with the TS tool loop it gated
      // (see `execute-run.ts`'s own header) -- `AgentRunExecutor` no longer takes that
      // fourth argument at all.
      // F155：L3 文件式检索在这里注入——`ExecuteAgentRunDeps.files` 是可选的，所以
      // 「生产 run 到底有没有 L3」由这一行、而不是由某个运行期开关决定（同 `usage` 的先例）。
      // F157：可审计上下文快照同一条先例——生产合成必定注入 `PgAgentRunContextSnapshot`。
      // F190：工具调用轨迹跨 run 回喂上下文同一条先例——生产合成必定注入 `PgToolTraceContext`。
      // issue #1493：canvas 模板指引同一条先例——`createCanvasTemplateGuidancePort` 用与
      // `CanvasTemplateController` 完全相同的三个依赖（identity/templates/ids）组装，不新开
      // 第二条查询路径（见 `canvas-template-guidance.ts` 文件头）。没有独立缓存 provider：
      // 每次 run 都现查一次这张表，见该文件对「为什么不加缓存」的解释。
      // P2（#1561）：推理侧图像通道同一条先例——生产合成必定注入 `PgRunImageInput`，
      // 所以「这个部署的模型能不能看到用户传的图」由这一行决定，不是运行期的偶然。
      // 它复用既有的 OBJECT_STORE（附件字节本来就存在那里），不新起一套存储绑定。
      useFactory: (
        runs: AgentRunStore, model: ModelCallPort, logger: LoggerPort, usage: TokenUsageMeterPort,
        db: DatabasePort, identity: IdentityRepository, templates: CanvasTemplateRepository,
        decisions: DecisionIdFactory, store: ObjectStore, sandbox: SkillSandboxPort,
      ) =>
        new AgentRunExecutor(
          runs, model, logger, process.env.KERNEL_AGENT_RUN_AUTOSTART !== "0", usage,
          new PgFileRetrieval(db), new PgAgentRunContextSnapshot(db), new PgToolTraceContext(db),
          createCanvasTemplateGuidancePort({ identity, templates, ids: decisions }),
          new PgRunImageInput(db, store),
          // #1624：chat 里挂了 skill 之后模型写的脚本真的在沙箱里跑。同一条既有先例——
          // 「这个部署的 chat 能不能真的产出文件」由这一行决定，不是运行期的偶然。
          // 复用**同一个** SKILL_SANDBOX_PORT（试跑那条链已经在用它），不起第二套沙箱绑定；
          // 产物字节复用既有 OBJECT_STORE（附件字节本来就存在那里）。
          //
          // ⚠ #1652：**没配沙箱地址就不注入**。`SKILL_SANDBOX_PORT` 这个 provider 永远存在
          //   （试跑那条链需要它在调用时诚实报 `SANDBOX_UNAVAILABLE`），所以这里若无条件
          //   把它传下去，`execute-run.ts` 的 `deps.sandbox && ...` 就恒真——于是没接沙箱的
          //   部署里 system prompt 照旧多出执行协议、模型照旧吐 `run_script` 块、上层照旧去
          //   执行，最后给用户一条本来好好的回复追加上 `SANDBOX_UNAVAILABLE` 失败横幅。
          //   这不是推测：`tests/chat/chat-skill-sandbox-unconfigured-no-regression.test.ts`
          //   在这一行加上之前实测就是那个样子。
          configuredSkillSandboxAddress() === null ? undefined : sandbox,
          store,
          // F975 (plan-control 契约束, UC-12)：与上面每一个同一条既有先例——生产合成必定
          // 注入，"这次 run 会不会带上计划送达" 因此是合成期的选择，不是运行期的偶然。
          new PgPlanLedgerRepository(db),
          // design-delta `skill-lazy-loading`：与本文件其它地方判断"这个部署要不要流式"
          // 用的是**同一个** `readModelProviderConfig()`（本文件 1273/1300/1318/1364 行
          // 已经这么调），不在这里重新解析 `KERNEL_MODEL_STREAM_ENABLED` 造第二份读法。
          readModelProviderConfig().streamEnabled,
          // 2026-08-30：`reclaimStaleRunning` 阈值，同上面 `KERNEL_AGENT_RUN_AUTOSTART`
          // 一样直接在合成点读 env（不新开一条 config 读法）。未设置/非法数字/非正数
          // 时落回 `AgentRunExecutor` 自己声明的默认值（其构造签名的默认参数），不是
          // 在这里再定义第二份"20 分钟"——`??`/`||` 都拿不到"这个 undefined 是不是要
          // 触发默认参数"的正确语义，所以用一个真正的三元式挑出非法值直接传 undefined。
          (() => {
            const raw = Number(process.env.KERNEL_AGENT_RUN_STALE_RUNNING_MS);
            return Number.isFinite(raw) && raw > 0 ? raw : undefined;
          })(),
        ),
      inject: [
        AGENT_RUN_STORE, MODEL_CALL_PORT, LOGGER_PORT, TOKEN_USAGE_METER, DATABASE_PORT,
        IDENTITY_REPOSITORY, CANVAS_TEMPLATE_REPOSITORY, DECISION_ID_FACTORY, OBJECT_STORE,
        SKILL_SANDBOX_PORT,
      ],
    },
    // F159. 计量的唯一写入实现。挂在执行器上而不是 provider 上：provider 只知道
    // 「这次返回了多少 token」，不知道这次调用属于哪个组织的哪个人——那是 run 才有的事实。
    {
      provide: TOKEN_USAGE_METER,
      useFactory: (db: DatabasePort) => new PgTokenUsageRepository(db),
      inject: [DATABASE_PORT],
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
    {
      provide: DIGITAL_INTERVIEW_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgDigitalInterviewRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: DIGITAL_INTERVIEW_EFFECTS,
      useFactory: (
        db: DatabasePort,
        ids: import("./application/artifact/ports").IdFactory,
        repo: import("./application/interview/digital-interview-ports").DigitalInterviewRepository,
        model: ModelCallPort,
      ) => {
        const config = readDigitalInterviewModelConfig();
        return new PgDigitalInterviewEffects(db, ids, repo, model, config.provider, config.modelId);
      },
      inject: [DATABASE_PORT, ID_FACTORY, DIGITAL_INTERVIEW_REPOSITORY, MODEL_CALL_PORT],
    },
    {
      provide: DIGITAL_INTERVIEW_RUNTIME,
      useFactory: (
        effects: DigitalInterviewEffects,
        repo: import("./application/interview/digital-interview-ports").DigitalInterviewRepository,
        scope: import("./application/interview/ports").InterviewScopeRepository,
        decisions: import("./application/identity/ports").DecisionIdFactory,
        ids: import("./application/artifact/ports").IdFactory,
        model: ModelCallPort,
      ) => new LangGraphDigitalInterviewRuntime({
        effects,
        checkpointer: createDigitalInterviewCheckpointer(appConfig()),
        repo,
        scope,
        decisions,
        ids,
        model,
        skillModelProvider: readDigitalInterviewModelConfig().provider,
        skillModelId: readDigitalInterviewModelConfig().modelId,
      }),
      inject: [
        DIGITAL_INTERVIEW_EFFECTS,
        DIGITAL_INTERVIEW_REPOSITORY,
        INTERVIEW_SCOPE_REPOSITORY,
        DECISION_ID_FACTORY,
        ID_FACTORY,
        MODEL_CALL_PORT,
      ],
    },
    {
      provide: DIGITAL_EXPERT_CONTEXT_API,
      useFactory: (db: DatabasePort, identities: IdentityRepository) =>
        new ContextApiDigitalExpertMaterialReader(db, identities),
      inject: [DATABASE_PORT, IDENTITY_REPOSITORY],
    },
    // F01 (phase-06): 洞察写路径。QUOTE_REPOSITORY / INSIGHT_REPOSITORY 是真实持久化；
    // INSIGHT_CONTEXT_API 复用 Context Pack 既有授权 API（同 DIGITAL_EXPERT_CONTEXT_API
    // 一样的适配形状）；INSIGHT_CANDIDATE_STORE 进程内周转（契约「候选不直接入库」）；
    // CANDIDATE_INSIGHT_GENERATOR 是确定性启发式，非真实模型调用（见该文件文件头）。
    {
      provide: QUOTE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgInterviewQuoteRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: INSIGHT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgInterviewInsightRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: SEGMENT_READER,
      useFactory: (db: DatabasePort) => new PgSegmentReader(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: CONSENT_DECLINE_READER,
      useFactory: (db: DatabasePort) => new PgConsentDeclineReader(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: INSIGHT_CONTEXT_API,
      useFactory: (db: DatabasePort, identities: IdentityRepository) =>
        new ContextApiInsightMaterialReader(db, identities),
      inject: [DATABASE_PORT, IDENTITY_REPOSITORY],
    },
    {
      provide: INSIGHT_CANDIDATE_STORE,
      useFactory: () => new InMemoryInsightCandidateStore(),
      inject: [],
    },
    {
      provide: CANDIDATE_INSIGHT_GENERATOR,
      useFactory: () => new HeuristicCandidateInsightGenerator(),
      inject: [],
    },
    {
      provide: GUIDED_RESEARCH_SESSION_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgGuidedResearchSessionRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: GUIDED_RESEARCH_WORKFLOW_SERVICE,
      useFactory: (
        receipts: GuidedResearchNodeReceiptRepository,
        directions: GuidedResearchDirectionGenerator,
        outlines: GuidedResearchOutlineGenerator,
      ) => new GuidedResearchWorkflowService(receipts, createGuidedResearchCheckpointer(appConfig()), directions, outlines),
      inject: [
        GUIDED_RESEARCH_NODE_RECEIPT_REPOSITORY,
        GUIDED_RESEARCH_DIRECTION_GENERATOR,
        GUIDED_RESEARCH_OUTLINE_GENERATOR,
      ],
    },
    {
      provide: GUIDED_RESEARCH_NODE_RECEIPT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgGuidedResearchNodeReceiptRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: GUIDED_RESEARCH_DIRECTION_GENERATOR,
      useFactory: (model: ModelCallPort) => new ModelGuidedResearchDirectionGenerator(model),
      inject: [MODEL_CALL_PORT],
    },
    {
      provide: GUIDED_RESEARCH_OUTLINE_GENERATOR,
      useFactory: (model: ModelCallPort) => new ModelGuidedResearchOutlineGenerator(model),
      inject: [MODEL_CALL_PORT],
    },
    {
      provide: GUIDED_RESEARCH_CHECKPOINT_GENERATOR,
      useFactory: () => new DeterministicGuidedResearchCheckpointGenerator(),
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
    // shared-invite-links delta：组织共享邀请链接（多次使用、hash 落库）。
    {
      provide: ORG_INVITE_LINK_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgOrgInviteLinkRepository(db),
      inject: [DATABASE_PORT],
    },
    // F05（phase-10 group-checkin 束）：`LiveSessionRepository` 的生产实现——
    // `checkin-board.controller.ts` 消费的 `board()` 就是这里落的库。
    {
      provide: LIVE_SESSION_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgLiveSessionRepository(db, newLiveSessionId),
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
    // member-role-management delta：平台级名册只读端口；改角色复用上面的 ORG_MEMBER_REPOSITORY。
    {
      provide: PLATFORM_MEMBER_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgPlatformMemberRepository(db),
      inject: [DATABASE_PORT],
    },
    // F160（token-quota-and-usage delta）。额度读写与计量写入分成两个仓储：
    // 后者（PgTokenUsageRepository）是账的唯一写入点，前者只读账、写额度。
    // F162 限额策略。与额度仓储分开：规则是配置，额度是数额，两者的读写路径没有共享逻辑。
    {
      provide: LIMIT_RULE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgLimitRuleRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: TOKEN_QUOTA_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgTokenQuotaRepository(db),
      inject: [DATABASE_PORT],
    },
    // org-profile-membership delta（#363）。
    {
      provide: ORG_PROFILE_REPOSITORY,
      useFactory: (db: DatabasePort, store: ObjectStore) => new PgOrgProfileRepository(db, store),
      inject: [DATABASE_PORT, OBJECT_STORE],
    },
    // #638 delta，迭代 2：`uploadOwnAvatar`/`updateOwnProfile` 的头像元数据仓储。
    {
      provide: AVATAR_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAvatarRepository(db),
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
    // BP-08：只读，独立 provider，见 `pg-blueprint-reference-repository.ts` 文件头。
    {
      provide: BLUEPRINT_REFERENCE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgBlueprintReferenceRepository(db),
      inject: [DATABASE_PORT],
    },
    // F122：独立 provider，见 `pg-project-list-repository.ts` 文件头。
    {
      provide: PROJECT_LIST_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectListRepository(db),
      inject: [DATABASE_PORT],
    },
    // F119：独立 provider——见 `application/project/ports.ts` 里 `AgendaSegmentRepository`
    // 那条「故意不是 ProjectRepository 的第三个方法」的注释。
    // #627：加了 create()，仓储需要 IdFactory 生成新环节的 id——同 `PROJECT_REPOSITORY`
    // 那条「复用 ID_FACTORY 不新造一个」的理由（见其上方注释）。
    {
      provide: AGENDA_SEGMENT_REPOSITORY,
      useFactory: (db: DatabasePort, ids: UuidIdFactory) => new PgAgendaSegmentRepository(db, ids),
      inject: [DATABASE_PORT, ID_FACTORY],
    },
    // F123：独立 provider，见 `pg-project-overview-repository.ts` 文件头。
    {
      provide: PROJECT_OVERVIEW_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectOverviewRepository(db),
      inject: [DATABASE_PORT],
    },
    // F141 → #785: `skill` now reads/writes real Postgres (`skills`/`skill_versions`/
    // `skill_version_files`, model A) via `PgAssetFileRepository`; every other kind (incl.
    // `agent`, AG4) still delegates to the fixture -- see `pg-asset-file-repository.ts`'s
    // class header for why `agent` stays fixture-backed for now (#787).
    {
      provide: ASSET_FILE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgAssetFileRepository(db, new FixtureAssetFileRepository()),
      inject: [DATABASE_PORT],
    },
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
      useFactory: (assets: AssetFileRepository) => new DirectoryBackedAssetRuntimeLoader(assets),
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
    // F185（2026-08-16 delta）：独立 provider，见 `pg-project-tags-repository.ts` 文件头。
    {
      provide: PROJECT_TAGS_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProjectTagsRepository(db),
      inject: [DATABASE_PORT],
    },
    // #728 D4：独立 provider，见 `pg-project-name-lookup.ts` 文件头。
    {
      provide: PROJECT_NAME_LOOKUP,
      useFactory: (db: DatabasePort) => new PgProjectNameLookup(db),
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
    // #1493：画布实例 + immutable 版本链。读写 `canvas_instances` 与
    // `canvas_instance_versions` 两张新表，与任何既有仓储没有共享的读写路径。
    {
      provide: CANVAS_INSTANCE_REPOSITORY,
      useFactory: (db: DatabasePort): CanvasInstanceRepository =>
        new PgCanvasInstanceRepository(db),
      inject: [DATABASE_PORT],
    },
    // F173（BP-01）：蓝本落库。读写 `blueprints` 与 `blueprint_design_facets` 两张新表，
    // 与既有仓储没有共享读写路径。
    {
      provide: BLUEPRINT_PERSISTENCE_PORT,
      useFactory: (db: DatabasePort): BlueprintPersistencePort =>
        new PgBlueprintRepository(db),
      inject: [DATABASE_PORT],
    },
    // F23 补实现（#1667）：只读解析（存在性/可见性/目标版本/档位/flow-agenda 内容）。
    {
      provide: APPLY_BLUEPRINT_RESOLVER_PORT,
      useFactory: (db: DatabasePort): ApplyBlueprintResolverPort => new PgApplyBlueprintResolver(db),
      inject: [DATABASE_PORT],
    },
    // F23 补实现（#1667）：写路径。注入既有 `PROJECT_REPOSITORY`——不新开第二处
    // `INSERT INTO projects`，见 `pg-apply-blueprint-repository.ts` 文件头。
    {
      provide: APPLY_BLUEPRINT_REPOSITORY,
      useFactory: (db: DatabasePort, projects: ProjectRepository, ids: UuidIdFactory): ApplyBlueprintRepository =>
        new PgApplyBlueprintRepository(db, projects, ids),
      inject: [DATABASE_PORT, PROJECT_REPOSITORY, ID_FACTORY],
    },
    // F29 补实现（#1667）：diff 基准读取，见 `pg-compute-deviations-repository.ts` 文件头。
    {
      provide: COMPUTE_DEVIATIONS_REPOSITORY,
      useFactory: (db: DatabasePort): ComputeDeviationsRepository => new PgComputeDeviationsRepository(db),
      inject: [DATABASE_PORT],
    },
    // F29 补实现（#1667）：待审改动写入，见 `pg-submit-change-request-repository.ts` 文件头。
    {
      provide: SUBMIT_CHANGE_REQUEST_REPOSITORY,
      useFactory: (db: DatabasePort): SubmitChangeRequestRepository => new PgSubmitChangeRequestRepository(db),
      inject: [DATABASE_PORT],
    },
    // F29 补实现（#1667）：只读，见 `pg-list-pending-changes-repository.ts` 文件头。
    {
      provide: LIST_PENDING_CHANGES_REPOSITORY,
      useFactory: (db: DatabasePort): ListPendingChangesRepository => new PgListPendingChangesRepository(db),
      inject: [DATABASE_PORT],
    },
    // F950（2026-08-16 delta）：三个独立 provider，各自的 `lint-permission-paths` 豁免
    // 各自成立，见各自 `pg-*.ts` 文件头。
    {
      provide: PROJECT_PREP_REPOSITORY,
      useFactory: (db: DatabasePort): ProjectPrepRepository => new PgProjectPrepRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: PROJECT_TOPIC_REPOSITORY,
      useFactory: (db: DatabasePort): ProjectTopicRepository => new PgProjectTopicRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: GROUPING_REPOSITORY,
      useFactory: (db: DatabasePort): GroupingRepository => new PgGroupingRepository(db),
      inject: [DATABASE_PORT],
    },
    // F960（2026-08-17 delta）：观察/访谈对象表读写。同 F950 一批新仓储的先例，
    // 与既有仓储没有共享读写路径。
    {
      provide: INTERVIEW_SUBJECTS_REPOSITORY,
      useFactory: (db: DatabasePort): InterviewSubjectsRepository => new PgInterviewSubjectsRepository(db),
      inject: [DATABASE_PORT],
    },
    // #1680 gap-fill：读写 `project_workflow_orchestration` / `workflow_template_catalog`
    // 两张新表，与既有仓储没有共享读写路径。`OrchestrationRepository`/`WorkflowTemplateCatalogPort`
    // 的方法签名不带 `orgId`，所以这两个 provider 的令牌是「工厂」而不是端口本身
    // （见 `workflow-orchestration-ports.ts` 里两个 factory 接口的文件头注）；
    // `OrgTemplateCreatePort` 的入参本就带 `orgId`，直接注册端口本身。
    {
      provide: ORCHESTRATION_REPOSITORY_FACTORY,
      useFactory: (db: DatabasePort): OrchestrationRepositoryFactory => new PgOrchestrationRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: WORKFLOW_TEMPLATE_CATALOG_FACTORY,
      useFactory: (db: DatabasePort): WorkflowTemplateCatalogFactory =>
        new PgWorkflowTemplateCatalogRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: ORG_TEMPLATE_CREATE_PORT,
      useFactory: (
        db: DatabasePort,
        ids: import("./application/artifact/ports").IdFactory,
      ): OrgTemplateCreatePort => new PgOrgTemplateCreateRepository(db, ids),
      inject: [DATABASE_PORT, ID_FACTORY],
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
    {
      provide: PERSONAL_TRANSCRIPTION_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgPersonalTranscriptionRepository(db),
      inject: [DATABASE_PORT],
    },
    { provide: REALTIME_ASR_TICKET_STORE, useFactory: (db: DatabasePort) => new PgRealtimeAsrTicketStore(db), inject: [DATABASE_PORT] },
    { provide: ASR_USAGE_METER, useFactory: (db: DatabasePort) => new PgAsrUsageMeter(db), inject: [DATABASE_PORT] },
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
    // F176: same factory shape and same reason as the two above -- `rateMessage.in` has no
    // `orgId` (only `messageId`), so a rating repository not bound to a tenant would be a
    // thing that can write a rating into somebody else's organization.
    {
      provide: MESSAGE_RATING_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgMessageRatingRepository(db),
      inject: [DATABASE_PORT],
    },
    // FB-2: same factory shape and same reason as the three above -- `submitFeedback.in` has
    // no `orgId` (it comes from the principal), so a feedback repository not bound to a
    // tenant would be a thing that can write feedback into somebody else's organization.
    {
      provide: PRODUCT_FEEDBACK_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgProductFeedbackRepository(db),
      inject: [DATABASE_PORT],
    },
    // 2026-08-30："转开发"建 GitHub issue + 任意分诊转移发状态变更邮件（ADR-108）。
    // ⚠ 两个配置都走 lazy Proxy——同 `CLOUDFLARE_EMAIL_CONFIG` 那一条：它们是可选子
    // 系统，没有任何一次部署要求"进程启动时就必须能建 issue / 发反馈通知邮件"。
    {
      provide: GITHUB_ISSUE_CONFIG,
      useFactory: () => lazyGithubIssueConfig(),
    },
    {
      provide: GITHUB_ISSUE_CREATOR,
      useFactory: (config: GithubIssueConfig) => new FetchGithubIssueCreator(config),
      inject: [GITHUB_ISSUE_CONFIG],
    },
    {
      provide: FEEDBACK_SUBMITTER_DIRECTORY,
      useFactory: (db: DatabasePort) => new PgFeedbackSubmitterDirectory(db),
      inject: [DATABASE_PORT],
    },
    // FB-5：附件仓储不按组织构造（同 `MESSAGE_RATING_REPOSITORY`）——每个方法自己接收
    // `orgId` 参数,见 `attachment-ports.ts` 与 `pg-feedback-attachment-repository.ts`。
    {
      provide: FEEDBACK_ATTACHMENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgFeedbackAttachmentRepository(db),
      inject: [DATABASE_PORT],
    },
    // FB-5：语音转录整理用例的固定模型配置——同 `THREAD_TITLE_MODEL_CONFIG` 既有先例,
    // 用户点击触发,不需要"是否启用"这道开关(那道开关是给"每条消息都可能触发"的场景用的)。
    {
      provide: FEEDBACK_STRUCTURE_MODEL_CONFIG,
      useFactory: () => readFeedbackStructureModelConfig(),
    },
    {
      provide: TRANSACTIONAL_MAIL_CONFIG,
      useFactory: () => lazyTransactionalMailConfig(),
    },
    {
      provide: TRANSACTIONAL_MAIL_TRANSPORT,
      useFactory: (config: TransactionalMailConfig) => new CloudflareTransactionalEmailTransport(config),
      inject: [TRANSACTIONAL_MAIL_CONFIG],
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
