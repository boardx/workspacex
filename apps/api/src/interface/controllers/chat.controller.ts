/**
 * 对话可见性路由（F108）。协议适配而已——每一个判断都发生在 `application`。
 *
 * ## 状态码就是需求本身
 *
 *   404  不可见 **或** 不存在。两者**逐字节相同**（I-3）：403 会回答「这里是不是有东西
 *        我看不到」，而对私聊/别组线程来说，那个回答本身就是泄露。
 *   503  判定依赖不可用（`AUTHZ_UNAVAILABLE`）。**拒绝，不降级放行**（uc-8-5 V10）。
 *   403  不是组织管理员（审计端口）。这一档可以说实话：它与资源是否存在无关。
 *
 * ⚠ `deniedLayer` **不进对外响应**（契约 `resolveVisibility` 注释逐字如此）。
 *   它是内部判定记录与审计里的字段；放进响应体，I-3 就白做了——
 *   「组织层拒的」与「项目层拒的」这两种回答本身就能反推出资源存在。
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, GoneException, HttpCode,
  HttpStatus, Inject, NotFoundException, Param, Post, Query, ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { chat as C } from "@repo/contracts";
import {
  adminAuditRead,
  NotOrgAdminError,
} from "../../application/chat/admin-audit-read";
import { getThread, ThreadNotVisibleError } from "../../application/chat/get-thread";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  AuthzUnavailableError,
  resolveVisibility,
} from "../../application/chat/resolve-visibility";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import {
  PROVENANCE_READER,
  PROVENANCE_WRITER,
  type ProvenanceReader,
  type ProvenanceWriter,
} from "../../application/provenance/ports";
import {
  expandToolCallChain,
  ProvenanceUnavailableError,
} from "../../application/chat/expand-tool-call-chain";
import {
  AnchorUnresolvableError,
  CitationNotFoundError,
  locateCitation,
  SourceArtifactDeletedError,
} from "../../application/chat/locate-citation";
import { listThreads } from "../../application/chat/list-threads";
import { listPersonalThreads } from "../../application/chat/list-personal-threads";
import {
  mutateThread,
  NoWriteRoleError,
  ThreadArchivedReadonlyError,
  TitleInvalidError,
  VersionChangedError,
} from "../../application/chat/mutate-thread";
import {
  FileNotMaterializedError,
  getThreadMessagesFile,
} from "../../application/chat/get-thread-messages-file";
import { getAgentPanel } from "../../application/chat/get-agent-panel";
import {
  AgentNotFoundError,
  AgentOutOfScopeError,
  updateAgentRoster,
} from "../../application/chat/update-agent-roster";
import { CLOCK, type Clock } from "../../application/auth/ports";
import {
  ARTIFACT_REPOSITORY, ID_FACTORY, OBJECT_STORE,
  type ArtifactRepository, type IdFactory, type ObjectStore,
} from "../../application/artifact/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { CHAT_PRESET_REPOSITORY, type ChatPresetRepository } from "../../application/chat/ports";
import {
  NoProjectRoleError as UpsertPresetNoProjectRoleError,
  PresetVersionChangedError as UpsertPresetVersionChangedError,
  upsertPreset,
} from "../../application/chat/upsert-preset";
import {
  AgentOutOfScopeError as PresetAgentOutOfScopeError,
  NoProjectRoleError as DispatchPresetNoProjectRoleError,
  PresetNotFoundError as DispatchPresetNotFoundError,
  PresetVersionChangedError as DispatchPresetVersionChangedError,
  SkillOutOfScopeError as PresetSkillOutOfScopeError,
  dispatchPreset,
} from "../../application/chat/dispatch-preset";
import {
  NotDispatchedToActorError,
  PresetNotFoundError as StartInstancePresetNotFoundError,
  startPresetInstance,
} from "../../application/chat/start-preset-instance";
import {
  PresetNotFoundError as GetUsagePresetNotFoundError,
  PresetNotVisibleError,
  getPresetUsage,
} from "../../application/chat/get-preset-usage";
import {
  createApprovalRequest,
  ModelPolicyViolationError,
  RegistryUnavailableError,
} from "../../application/chat/create-approval-request";
import {
  ApprovalExpiredError,
  ApprovalNotFoundError,
  ApprovalStatusChangedError,
  decideApproval,
} from "../../application/chat/decide-approval";
import {
  BackgroundTaskNotFoundError,
  getBackgroundTask,
} from "../../application/chat/get-background-task";
import {
  APPROVAL_MODEL_REGISTRY_READER,
  type ApprovalModelRegistryReader,
} from "../../application/chat/approval-model-registry";
import {
  ARTIFACT_LANDING_REPOSITORY,
  type ArtifactLandingRepository,
} from "../../application/chat/artifact-landing-ports";
import {
  CitationUnresolvableRequiresDraftError,
  landAsArtifact,
  MaterializationFailedError as LandMaterializationFailedError,
  MissingProvenanceBacklinkError,
  NoWriteRoleError as LandNoWriteRoleError,
} from "../../application/chat/land-as-artifact";
import { summarizePersonaFromThread } from "../../application/chat/summarize-persona-from-thread";
import {
  ArtifactLandingNotFoundError,
  checkDownstreamEligibility,
  RequiresPinnedError,
  type ChatDownstreamPurposeName,
} from "../../application/chat/check-downstream-eligibility";
import { listThreadArtifacts } from "../../application/chat/list-thread-artifacts";
import type { LandingModeName } from "../../domain/chat/artifact-landing";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY,
  PUBLISHED_AGENT_READER,
  type ChatMessageCommandRepository,
  type PublishedAgentReader,
} from "../../application/chat/message-command-ports";
import {
  acceptHumanMessage,
  AgentNotPublishedError,
  InvalidMessageCursorError,
  listMessagePage,
  MessageAttachmentNotPendingError,
  MessageIdempotencyConflictError,
  MessageNoWriteRoleError,
  MessageThreadArchivedError,
  MessageThreadNotVisibleError,
} from "../../application/chat/message-roundtrip";
import {
  AGENT_RUN_EXECUTOR, type AgentRunExecutorPort,
} from "../../application/agent-run/ports";

export const RESOLVE_VISIBILITY_SCHEMA = C.operations.resolveVisibility.in;
export const ADMIN_AUDIT_READ_SCHEMA = C.operations.adminAuditRead.in;
export const MUTATE_THREAD_SCHEMA = C.operations.mutateThread.in;
export const UPDATE_AGENT_ROSTER_SCHEMA = C.operations.updateAgentRoster.in;
export const UPSERT_PRESET_SCHEMA = C.operations.upsertPreset.in;
export const DISPATCH_PRESET_SCHEMA = C.operations.dispatchPreset.in;
export const START_PRESET_INSTANCE_SCHEMA = C.operations.startPresetInstance.in;
export const CREATE_APPROVAL_REQUEST_SCHEMA = C.operations.createApprovalRequest.in;
export const DECIDE_APPROVAL_SCHEMA = C.operations.decideApproval.in;
export const LAND_AS_ARTIFACT_SCHEMA = C.operations.landAsArtifact.in;
export const SUMMARIZE_PERSONA_SCHEMA = C.operations.summarizePersonaFromThread.in;
export const CHECK_DOWNSTREAM_ELIGIBILITY_SCHEMA = C.operations.checkDownstreamEligibility.in;

type ResolveBody = { actorId: string; projectId: string | null; threadId: string | null; resourceKind: "thread" | "message" | "transcript" | "file" };
type AdminAuditBody = { threadId: string; projectId: string; layer: "project" | "personal" };
type MutateThreadBody = {
  op: "create" | "rename" | "delete";
  projectId: string | null;
  threadId: string | null;
  groupId: string | null;
  title: string | null;
  visibilityScope: "member-private" | "group-shared" | "plenary" | "team-visible" | "private" | null;
  expectedVersion: number | null;
  reason: string | null;
};
type UpdateAgentRosterBody = {
  threadId: string;
  add: string[];
  remove: string[];
  expectedRosterVersion: number;
};
type UpsertPresetBody = {
  projectId: string;
  presetId: string | null;
  openingPrompt: string;
  skills: string[];
  agents: string[];
  expectedVersion: number | null;
};
type DispatchPresetBody = {
  presetId: string;
  targets: { plenary: boolean | null; groupIds: string[] | null; roles: ("facilitator" | "groupLead" | "member" | "observer")[] | null };
};
type StartPresetInstanceBody = { presetId: string };
type CreateApprovalRequestBody = {
  threadId: string;
  agentId: string;
  action: string;
  dataScope: { name: string; confidential: boolean }[];
  proposedModels: string[];
  estimatedTokens: number;
};
type DecideApprovalBody = {
  requestId: string;
  exit: "approve" | "reparam" | "decline";
  expectedStatus: "paused";
  newModels: string[] | null;
  newBudget: { tokens: number; amount: number; currency: string } | null;
  newDataScope: { name: string; confidential: boolean }[] | null;
};
type LandAsArtifactBody = {
  threadId: string;
  messageId: string;
  mode: LandingModeName;
  title: string;
  payloadRef: string;
};
type SummarizePersonaBody = {
  threadId: string;
  messageId: string;
};
type CheckDownstreamEligibilityBody = {
  artifactId: string;
  purpose: ChatDownstreamPurposeName;
};
type CreateMessageBody = { clientMessageId?: string; text?: string; agentId?: string; attachmentIds?: string[] };

@Controller()
export class ChatController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(PROVENANCE_READER) private readonly provenanceReader: ProvenanceReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
    @Inject(ID_FACTORY) private readonly artifactIds: IdFactory,
    @Inject(CHAT_PRESET_REPOSITORY) private readonly chatPresets: ChatPresetRepository,
    @Inject(APPROVAL_MODEL_REGISTRY_READER) private readonly modelRegistry: ApprovalModelRegistryReader,
    @Inject(ARTIFACT_LANDING_REPOSITORY) private readonly landings: ArtifactLandingRepository,
    @Inject(CHAT_MESSAGE_COMMAND_REPOSITORY) private readonly messageCommands: ChatMessageCommandRepository,
    @Inject(PUBLISHED_AGENT_READER) private readonly publishedAgents: PublishedAgentReader,
    // #414. 受理之后触发这个租户的执行；**不等待**——见 `agent-run-executor.ts` 文件头：
    // §2 规定本请求返回 202 + `runStatus: "queued"`，绝不内联回复，所以模型慢或挂
    // 都不许把这条写入拖慢或拖挂。
    @Inject(AGENT_RUN_EXECUTOR) private readonly agentRuns: AgentRunExecutorPort,
  ) {}

  private get deps() {
    return { repo: this.repo, ids: this.ids, chat: this.chat };
  }

  private get messageDeps() {
    return { ...this.deps, commands: this.messageCommands, publishedAgents: this.publishedAgents };
  }

  /**
   * 判定一次读取。**每个读端口的前置**，这里把它也暴露成路由，供界面预先禁用入口。
   *
   * ⚠ 拒绝时返回的 `scope` 恒为最严的 `private`，`deniedLayer` 恒为 `null`：
   *   把真实 scope 或拒绝层写进拒绝响应，等于用另一个字段回答了 I-3 禁止回答的问题。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/visibility/resolve")
  async resolve(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(RESOLVE_VISIBILITY_SCHEMA)) body: ResolveBody,
  ) {
    assertPrincipal(principal);
    if (body.threadId === null) throw new NotFoundException();
    try {
      const outcome = await resolveVisibility(this.deps, {
        // 以**登录主体**为准，不以请求体里的 actorId 为准。
        // 否则任何人都能填别人的 id 去问「他能不能看见」，那是一个免费的权限探测器。
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: body.projectId,
        threadId: body.threadId,
      });
      if (outcome.kind !== "allow") {
        return { allowed: false, scope: "private" as const, decisionId: outcome.decisionId, deniedLayer: null };
      }
      return {
        allowed: true,
        scope: outcome.decision.scope,
        decisionId: outcome.decisionId,
        deniedLayer: null,
      };
    } catch (e) {
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 线程详情（含四视角投影）。观察者拿到的是**服务端已经删过**的那一份（I-5）。
   *
   * 🔴 #594：`projectId` 查询参数不再要求非空——NestJS 对缺省的 `@Query` 给的是
   * `undefined`，这里显式折成 `null`（不是空字符串，空字符串会被当成一个真实的
   * "projectId 是空串"的项目 id 传下去，那不是"没有项目"，是"项目 id 无效"，
   * 两者对下游的判定分支是完全不同的输入）。
   */
  @Get("/chat/threads/:threadId")
  async thread(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") rawProjectId?: string,
  ) {
    assertPrincipal(principal);
    const projectId = rawProjectId === undefined || rawProjectId === "" ? null : rawProjectId;
    try {
      return await getThread(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId,
        threadId,
      });
    } catch (e) {
      // 不可见与不存在同一个出口，且**不带任何 body**：带了 reasonCode 就分得出来了。
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /** Wave 2 stable keyset page. The limit is capped, not rejected, at 100. */
  @Get("/chat/threads/:threadId/messages")
  async messages(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ) {
    assertPrincipal(principal);
    const parsedLimit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
      throw new BadRequestException("limit_invalid");
    }
    try {
      return await listMessagePage(this.messageDeps, {
        userId: principal.userId, orgId: toOrgId(principal.orgId), threadId, cursor,
        limit: parsedLimit,
      });
    } catch (e) {
      if (e instanceof MessageThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof InvalidMessageCursorError) throw new BadRequestException("cursor_invalid");
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /** Wave 2 acceptance only: durable human message + queued run, never model execution. */
  @HttpCode(HttpStatus.ACCEPTED)
  @Post("/chat/threads/:threadId/messages")
  async createMessage(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: CreateMessageBody,
  ) {
    assertPrincipal(principal);
    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      throw new UnprocessableEntityException("AGENT_NOT_FOUND");
    }
    const parsed = C.operations.createMessage.in.safeParse({ ...body, threadId });
    if (!parsed.success) throw new UnprocessableEntityException("MESSAGE_INVALID");
    try {
      const accepted = await acceptHumanMessage(this.messageDeps, {
        userId: principal.userId, orgId: toOrgId(principal.orgId), threadId,
        clientMessageId: parsed.data.clientMessageId, text: parsed.data.text,
        agentId: parsed.data.agentId, attachmentIds: parsed.data.attachmentIds,
      });
      this.agentRuns.kick(toOrgId(principal.orgId));
      return {
        message: {
          id: accepted.id, authorKind: "human" as const, authorId: accepted.authorId,
          agentId: null, text: accepted.text, clientMessageId: accepted.clientMessageId,
          agentRunId: null, replyToMessageId: null, createdAt: accepted.createdAt,
        },
        agentRunId: accepted.agentRunId,
        runStatus: accepted.runStatus,
      };
    } catch (e) {
      if (e instanceof MessageThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof MessageNoWriteRoleError) throw new ForbiddenException("NO_WRITE_ROLE");
      if (e instanceof MessageThreadArchivedError) {
        throw new ConflictException({ reasonCode: "THREAD_ARCHIVED_READONLY" });
      }
      if (e instanceof AgentNotPublishedError) throw new UnprocessableEntityException("AGENT_NOT_FOUND");
      if (e instanceof MessageAttachmentNotPendingError) {
        throw new UnprocessableEntityException({ reasonCode: "ATTACHMENT_NOT_PENDING" });
      }
      if (e instanceof MessageIdempotencyConflictError) {
        throw new ConflictException({ reasonCode: "IDEMPOTENCY_CONFLICT" });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 管理员审计读。**返回内容不是 403**（I-8 / O-04），且必然留痕。
   *
   * POST 而非 GET：它有副作用（那条审计事件）。200 而非 201：
   * 从调用方看没有任何东西被创建，客户端若按 201 分支会把一次读当成一次写。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/:threadId/admin-audit-read")
  async adminAudit(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(ADMIN_AUDIT_READ_SCHEMA)) body: AdminAuditBody,
  ) {
    assertPrincipal(principal);
    try {
      return await adminAuditRead(
        { repo: this.repo, chat: this.chat, provenance: this.provenance, ids: this.ids },
        {
          adminId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId: body.projectId,
          threadId: body.threadId,
          layer: body.layer,
        },
      );
    } catch (e) {
      // 403，不是 404：这一档与「资源是否存在」无关，它讲的是调用者的组织角色。
      if (e instanceof NotOrgAdminError) throw new ForbiddenException();
      throw e;
    }
  }

  /* ── F109 ──────────────────────────────────────────────────────────── */

  /**
   * 线程列表（今天/本周分组）。
   *
   * ⚠ 过滤发生在 `application`，逐条经 `resolveVisibility`——**响应体里就没有**
   *   不该有的条目，不是发出去再由前端隐藏。断言查的是这个响应的 JSON。
   * ⚠ 无可见对话时返回 `groups: []`，**不返回「还有 N 条你看不到」**（uc-8-5 V9）。
   */
  @Get("/chat/projects/:projectId/threads")
  async threads(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Query("includeArchived") includeArchived?: string,
    @Query("filter") filter?: string,
  ) {
    assertPrincipal(principal);
    try {
      return await listThreads(
        { ...this.deps, clock: this.clock },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId,
          filter: filter as "all" | "project" | "my-agents" | undefined,
          includeArchived: includeArchived === "true",
        },
      );
    } catch (e) {
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 🔴 #594 —— 个人线程（无项目）列表。⚠ 路由必须放在 `/chat/threads/:threadId`
   * 之外的独立方法（不是同一个 `@Get` 上加可选参数）——`/chat/threads`（无 id 段）
   * 与 `/chat/threads/:threadId`（有 id 段）是两个不同形状的路径，Nest 按段数区分，
   * 不会互相吞掉，但共用一个处理函数会让「这次是列表请求还是详情请求」变成
   * 靠猜参数形状分岔，比两个方法各管一段路径更容易在将来的改动里被弄混。
   */
  @Get("/chat/threads")
  async personalThreads(
    @CurrentPrincipal() principal: Principal,
    @Query("includeArchived") includeArchived?: string,
  ) {
    assertPrincipal(principal);
    try {
      return await listPersonalThreads(
        { ...this.deps, clock: this.clock },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          includeArchived: includeArchived === "true",
        },
      );
    } catch (e) {
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 新建 / 改名 / 删除。
   *
   * 状态码：
   *   404  不可见或不存在（I-3，与读路径同一个出口）
   *   403  有项目角色但无写权（观察者）。这一档说实话不泄露存在性：
   *        它讲的是调用者能做什么，而调用者已经能看见这条线程了。
   *   409  `VERSION_CHANGED`——**不静默覆盖**（V7）。
   *   422  标题非法。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/mutate")
  async mutate(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(MUTATE_THREAD_SCHEMA)) body: MutateThreadBody,
  ) {
    assertPrincipal(principal);
    try {
      return await mutateThread(
        {
          ...this.deps,
          provenance: this.provenance,
          artifactIds: this.artifactIds,
        },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          op: body.op,
          projectId: body.projectId,
          threadId: body.threadId,
          groupId: body.groupId,
          title: body.title,
          visibilityScope: body.visibilityScope,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
        },
      );
    } catch (e) {
      // ⚠ **裸 404，不带 reasonCode** —— 与读路径逐字相同（I-3）。
      //   带上码就等于回答了「这里是不是有个东西你看不到」，而那正是 I-3 禁止回答的问题。
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      // 以下四档**带 reasonCode**：调用方已经看得见这条线程了，这些码讲的是
      // 「你这个动作为什么不行」，不是「这个东西存不存在」。
      // 它们是 `chat.ChatError` 的成员，由 `all-exceptions.filter.ts` 第九条 safeParse
      // 对着那个封闭枚举 parse 后放行——枚举之外的字符串一个都过不来。
      if (e instanceof NoWriteRoleError) throw new ForbiddenException({ reasonCode: "NO_WRITE_ROLE" });
      if (e instanceof ThreadArchivedReadonlyError) {
        throw new ForbiddenException({ reasonCode: "THREAD_ARCHIVED_READONLY" });
      }
      if (e instanceof VersionChangedError) throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      if (e instanceof TitleInvalidError) {
        throw new UnprocessableEntityException({ reasonCode: "TITLE_INVALID" });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 线程的 `messages.jsonl`（file-first）。
   *
   * ⚠ 它的越权出口与 `getThread` **逐字相同**（同一个 404、同一个 `resolveVisibility`）。
   *   文件浏览器不是权限旁路（I-12 / X-5）——这句话在代码里的形式就是这里没有第二套判权。
   */
  @Get("/chat/threads/:threadId/messages-file")
  async messagesFile(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getThreadMessagesFile(
        {
          ...this.deps,
          materialize: { store: this.store, repo: this.artifacts, ids: this.artifactIds },
        },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), projectId, threadId },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof FileNotMaterializedError) throw new NotFoundException("file_not_materialized");
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /* ── F110：AI 团队面板 / 编制 ──────────────────────────────────────── */

  /**
   * AI 团队面板。**依赖失败返回 503，不是空面板**——空数组会被读成
   *   「这个线程没有 agent」，见 `get-agent-panel.ts` 文件头。
   */
  @Get("/chat/threads/:threadId/agents")
  async agentPanel(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getAgentPanel(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId,
        threadId,
      });
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 改编制（`[编制]`）。状态码：
   *   404  不可见或不存在（I-3，与读路径同一个出口）
   *   403  观察者恒无写权
   *   409  `VERSION_CHANGED`——**部分成功即整体拒绝**，见 `update-agent-roster.ts` 文件头
   *   422  `AGENT_OUT_OF_SCOPE` / `AGENT_NOT_FOUND`——请求形状合法但内容不满足业务前置，
   *        与 `TITLE_INVALID` 同一档（`mutate-thread.ts` 的既有用法）
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/:threadId/agents")
  async updateRoster(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string,
    @Body(new ZodBodyPipe(UPDATE_AGENT_ROSTER_SCHEMA)) body: UpdateAgentRosterBody,
  ) {
    assertPrincipal(principal);
    try {
      return await updateAgentRoster(
        { ...this.deps, provenance: this.provenance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId,
          threadId,
          add: body.add,
          remove: body.remove,
          expectedRosterVersion: body.expectedRosterVersion,
        },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof NoWriteRoleError) throw new ForbiddenException({ reasonCode: "NO_WRITE_ROLE" });
      if (e instanceof ThreadArchivedReadonlyError) {
        throw new ForbiddenException({ reasonCode: "THREAD_ARCHIVED_READONLY" });
      }
      if (e instanceof VersionChangedError) throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      if (e instanceof AgentOutOfScopeError) {
        throw new UnprocessableEntityException({ reasonCode: "AGENT_OUT_OF_SCOPE" });
      }
      if (e instanceof AgentNotFoundError) {
        throw new UnprocessableEntityException({ reasonCode: "AGENT_NOT_FOUND" });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /* ── F115：预设对话（uc-8-4）──────────────────────────────────────── */

  /**
   * 创建 / 编辑预设。**引导师专属**（uc-8-4 UC-23 `pre`），不是「任意有写权限的角色」。
   * ⚠ `PRESET_PREAPPROVAL_FORBIDDEN` / `PRESET_SCOPE_BYPASS_FORBIDDEN` 在契约的
   *   `.strict()` 输入形状下结构性不可达——见 `upsert-preset.ts` 文件头。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/projects/:projectId/presets")
  async upsertPresetRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(UPSERT_PRESET_SCHEMA)) body: UpsertPresetBody,
  ) {
    assertPrincipal(principal);
    try {
      return await upsertPreset(
        { repo: this.repo, chatPresets: this.chatPresets, presetIds: this.artifactIds },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId,
          presetId: body.presetId,
          openingPrompt: body.openingPrompt,
          skills: body.skills,
          agents: body.agents,
          expectedVersion: body.expectedVersion,
        },
      );
    } catch (e) {
      if (e instanceof UpsertPresetNoProjectRoleError) {
        throw new ForbiddenException({ reasonCode: "NO_PROJECT_ROLE" });
      }
      if (e instanceof UpsertPresetVersionChangedError) {
        throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      }
      throw e;
    }
  }

  /**
   * 下发预设：引导师 → 组长/组员。**下发不创建任何实例**，`out` 只有
   * `targetCount`——见 `dispatch-preset.ts` 文件头三条逐字答死的语义。
   * 越范围（AGENT_OUT_OF_SCOPE / SKILL_OUT_OF_SCOPE）在这一层拒绝，422：
   * 与 `updateRoster` 的 `AGENT_OUT_OF_SCOPE` 同一档——请求形状合法但内容
   * 不满足业务前置。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/presets/:presetId/dispatch")
  async dispatchPresetRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("presetId") presetId: string,
    @Query("projectId") projectId: string,
    @Body(new ZodBodyPipe(DISPATCH_PRESET_SCHEMA)) body: DispatchPresetBody,
  ) {
    assertPrincipal(principal);
    try {
      return await dispatchPreset(
        { repo: this.repo, chatPresets: this.chatPresets },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId,
          presetId,
          targets: body.targets,
          expectedVersion: null,
        },
      );
    } catch (e) {
      if (e instanceof DispatchPresetNoProjectRoleError) {
        throw new ForbiddenException({ reasonCode: "NO_PROJECT_ROLE" });
      }
      if (e instanceof DispatchPresetNotFoundError) throw new NotFoundException("preset_not_found");
      if (e instanceof DispatchPresetVersionChangedError) {
        throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      }
      if (e instanceof PresetAgentOutOfScopeError) {
        throw new UnprocessableEntityException({ reasonCode: "AGENT_OUT_OF_SCOPE" });
      }
      if (e instanceof PresetSkillOutOfScopeError) {
        throw new UnprocessableEntityException({ reasonCode: "SKILL_OUT_OF_SCOPE" });
      }
      throw e;
    }
  }

  /**
   * 开始一个预设实例。**由取用者本人触发**，幂等——同一人重复点「开始」
   * 返回同一 `instanceId`（I-38）。实例的可见性走既有 F108 判定，
   * 与「预设本身可见」是两条独立路径（I-39），见 `start-preset-instance.ts` 文件头。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/presets/:presetId/instances")
  async startPresetInstanceRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("presetId") presetId: string,
    @Query("projectId") projectId: string,
    @Body(new ZodBodyPipe(START_PRESET_INSTANCE_SCHEMA)) _body: StartPresetInstanceBody,
  ) {
    assertPrincipal(principal);
    try {
      return await startPresetInstance(
        { chatPresets: this.chatPresets, threadIds: this.artifactIds },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), projectId, presetId },
      );
    } catch (e) {
      if (e instanceof StartInstancePresetNotFoundError) throw new NotFoundException("preset_not_found");
      if (e instanceof NotDispatchedToActorError) {
        throw new ForbiddenException({ reasonCode: "NOT_DISPATCHED_TO_ACTOR" });
      }
      throw e;
    }
  }

  /**
   * 读预设使用计数。`usageCount` 恒等于真实实例数（I-38），不是下发人数——
   * 见 `get-preset-usage.ts`。
   */
  @Get("/chat/presets/:presetId/usage")
  async presetUsage(
    @CurrentPrincipal() principal: Principal,
    @Param("presetId") presetId: string,
    @Query("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getPresetUsage(
        { repo: this.repo, chatPresets: this.chatPresets },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), projectId, presetId },
      );
    } catch (e) {
      if (e instanceof GetUsagePresetNotFoundError) throw new NotFoundException("preset_not_found");
      if (e instanceof PresetNotVisibleError) throw new NotFoundException();
      throw e;
    }
  }

  /* ── F111：工具调用链与引用（uc-8-2 UC-14/UC-15）─────────────────────── */

  /**
   * 展开工具调用链。**是 `provenance_events` 的投影**（I-22）——见
   * `expand-tool-call-chain.ts` 文件头。失败条不隐藏（I-25），运行中态是正常返回值。
   */
  @Get("/chat/messages/:messageId/tool-calls")
  async toolCalls(
    @CurrentPrincipal() principal: Principal,
    @Param("messageId") messageId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await expandToolCallChain(
        { ...this.deps, provenance: this.provenanceReader },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), messageId },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      if (e instanceof ProvenanceUnavailableError) {
        throw new ServiceUnavailableException("provenance_unavailable");
      }
      throw e;
    }
  }

  /**
   * 定位一条引用。状态码：
   *   404  不可见或不存在（I-3，与其余读路径同一个出口）
   *   422  `ANCHOR_UNRESOLVABLE`——**这条引用不合格**，不是"暂时找不到"（I-24），
   *        与 `mutate-thread.ts` 的 `TITLE_INVALID` 同一档：请求形状合法，内容不满足业务前置。
   *   410  `SOURCE_ARTIFACT_DELETED`——来源材料已不在，与"引用本身写错了"（422）
   *        是两种不同的不合格,用 Gone 区分"曾经存在、现在没了"。
   */
  @Get("/chat/citations/:citationId")
  async citation(
    @CurrentPrincipal() principal: Principal,
    @Param("citationId") citationId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await locateCitation(
        this.deps,
        { userId: principal.userId, orgId: toOrgId(principal.orgId), citationId },
      );
    } catch (e) {
      if (e instanceof CitationNotFoundError) throw new NotFoundException();
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      if (e instanceof AnchorUnresolvableError) {
        throw new UnprocessableEntityException({ reasonCode: "ANCHOR_UNRESOLVABLE" });
      }
      if (e instanceof SourceArtifactDeletedError) {
        throw new GoneException({ reasonCode: "SOURCE_ARTIFACT_DELETED" });
      }
      throw e;
    }
  }

  /* ── F112：批准闸门（uc-8-2 R3 步骤 6 / R11，产品的信任核心）─────────────── */

  /**
   * 高影响动作 → 批准请求。恒以 `paused` 落库（I-27），六项披露全非空（I-28）。
   * ⚠ `MODEL_POLICY_VIOLATION` / `REGISTRY_UNAVAILABLE` 都是 422：两者都是「请求形状
   *   合法，但内容不满足业务前置」，与 `mutate-thread.ts` 的 `TITLE_INVALID` 同一档。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/:threadId/approval-requests")
  async createApprovalRequestRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body(new ZodBodyPipe(CREATE_APPROVAL_REQUEST_SCHEMA)) body: CreateApprovalRequestBody,
  ) {
    assertPrincipal(principal);
    try {
      return await createApprovalRequest(
        {
          chat: this.chat,
          registry: this.modelRegistry,
          provenance: this.provenance,
          ids: this.artifactIds,
          clock: this.clock,
        },
        {
          orgId: toOrgId(principal.orgId),
          threadId: body.threadId ?? threadId,
          agentId: body.agentId,
          action: body.action,
          dataScope: body.dataScope,
          proposedModels: body.proposedModels,
          estimatedTokens: body.estimatedTokens,
        },
      );
    } catch (e) {
      if (e instanceof ModelPolicyViolationError) {
        throw new UnprocessableEntityException({ reasonCode: "MODEL_POLICY_VIOLATION", detail: e.detail });
      }
      if (e instanceof RegistryUnavailableError) {
        throw new UnprocessableEntityException({ reasonCode: "REGISTRY_UNAVAILABLE" });
      }
      throw e;
    }
  }

  /**
   * 三出口之一。状态码：
   *   404  请求不存在（与其余读路径同一个「不可见与不存在同出口」精神，此端口无可见性判定，
   *        故裸 404）
   *   409  `APPROVAL_STATUS_CHANGED`——已终态不可再转（I-29），见 `decide-approval.ts` 文件头
   *        关于本实现取哪一种并发语义的登记
   *   410  `APPROVAL_EXPIRED`——超时不得静默执行
   *   422  `MODEL_POLICY_VIOLATION`——改参后的新模型集合仍然违反 D-U1
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/approval-requests/:requestId/decide")
  async decideApprovalRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("requestId") requestId: string,
    @Body(new ZodBodyPipe(DECIDE_APPROVAL_SCHEMA)) body: DecideApprovalBody,
  ) {
    assertPrincipal(principal);
    try {
      return await decideApproval(
        {
          chat: this.chat,
          registry: this.modelRegistry,
          provenance: this.provenance,
          ids: this.artifactIds,
          clock: this.clock,
        },
        {
          orgId: toOrgId(principal.orgId),
          actorId: principal.userId,
          requestId: body.requestId ?? requestId,
          exit: body.exit,
          newModels: body.newModels,
          newBudget: body.newBudget,
          newDataScope: body.newDataScope,
        },
      );
    } catch (e) {
      if (e instanceof ApprovalNotFoundError) throw new NotFoundException();
      if (e instanceof ApprovalStatusChangedError) {
        throw new ConflictException({ reasonCode: "APPROVAL_STATUS_CHANGED" });
      }
      if (e instanceof ApprovalExpiredError) throw new GoneException({ reasonCode: "APPROVAL_EXPIRED" });
      if (e instanceof ModelPolicyViolationError) {
        throw new UnprocessableEntityException({ reasonCode: "MODEL_POLICY_VIOLATION", detail: e.detail });
      }
      if (e instanceof RegistryUnavailableError) {
        throw new UnprocessableEntityException({ reasonCode: "REGISTRY_UNAVAILABLE" });
      }
      throw e;
    }
  }

  /** 查后台任务回流。见 `get-background-task.ts` 文件头：11-task 落地前的最小占位实现。 */
  @Get("/chat/tasks/:taskId")
  async backgroundTask(
    @CurrentPrincipal() principal: Principal,
    @Param("taskId") taskId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getBackgroundTask(
        { chat: this.chat },
        { orgId: toOrgId(principal.orgId), taskId },
      );
    } catch (e) {
      if (e instanceof BackgroundTaskNotFoundError) throw new NotFoundException();
      throw e;
    }
  }

  /* ── F114：产出落地（uc-8-3 UC-20/21/22）─────────────────────────────── */

  /**
   * 把一条结论 / 产物卡落地为 Artifact。状态码：
   *   404  不可见或不存在（I-3，与其余读路径同一个出口）
   *   403  观察者恒无写权
   *   422  `MISSING_PROVENANCE_BACKLINK` / `CITATION_UNRESOLVABLE_REQUIRES_DRAFT`——
   *        请求形状合法，内容不满足业务前置（与 `TITLE_INVALID` 同一档）
   *   503  物化失败（对象存储/依赖不可用）——见 `land-as-artifact.ts` 文件头
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/:threadId/artifacts")
  async landAsArtifactRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body(new ZodBodyPipe(LAND_AS_ARTIFACT_SCHEMA)) body: LandAsArtifactBody,
  ) {
    assertPrincipal(principal);
    try {
      return await landAsArtifact(
        {
          ...this.deps,
          artifacts: this.artifacts,
          store: this.store,
          artifactIds: this.artifactIds,
          landings: this.landings,
          provenance: this.provenance,
        },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          threadId: body.threadId ?? threadId,
          messageId: body.messageId,
          mode: body.mode,
          title: body.title,
          payloadRef: body.payloadRef,
        },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof LandNoWriteRoleError) throw new ForbiddenException({ reasonCode: "NO_WRITE_ROLE" });
      if (e instanceof MissingProvenanceBacklinkError) {
        throw new UnprocessableEntityException({ reasonCode: "MISSING_PROVENANCE_BACKLINK" });
      }
      if (e instanceof CitationUnresolvableRequiresDraftError) {
        throw new UnprocessableEntityException({ reasonCode: "CITATION_UNRESOLVABLE_REQUIRES_DRAFT" });
      }
      if (e instanceof LandMaterializationFailedError) {
        throw new ServiceUnavailableException({ reasonCode: "STORAGE_UNAVAILABLE" });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 把内置 canvas 模板 `persona` 接到 chat 里：扫描线程正文里已经真实写出的画像信息，
   * 落地成一份 Artifact（`summarizePersonaFromThread`，🟡 待人类补签，见
   * `KNOWN_CONTRACT_GAPS.C_CHAT_11`）。状态码同 `landAsArtifactRoute`——本操作只是
   * `landAsArtifact` 前面多一段「从线程正文里如实收敛出 title/payloadRef」，错误
   * 出口是同一批。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/:threadId/persona-summary")
  async summarizePersonaRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body(new ZodBodyPipe(SUMMARIZE_PERSONA_SCHEMA)) body: SummarizePersonaBody,
  ) {
    assertPrincipal(principal);
    try {
      return await summarizePersonaFromThread(
        {
          ...this.deps,
          artifacts: this.artifacts,
          store: this.store,
          artifactIds: this.artifactIds,
          landings: this.landings,
          provenance: this.provenance,
        },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          threadId: body.threadId ?? threadId,
          messageId: body.messageId,
        },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof LandNoWriteRoleError) throw new ForbiddenException({ reasonCode: "NO_WRITE_ROLE" });
      if (e instanceof LandMaterializationFailedError) {
        throw new ServiceUnavailableException({ reasonCode: "STORAGE_UNAVAILABLE" });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 引用资格门（UC-21）。状态码：
   *   404  不可见或不存在
   *   422  `REQUIRES_PINNED`——需先定版为固定快照（I-34）
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/artifacts/:artifactId/downstream-eligibility")
  async checkDownstreamEligibilityRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("artifactId") artifactId: string,
    @Body(new ZodBodyPipe(CHECK_DOWNSTREAM_ELIGIBILITY_SCHEMA)) body: CheckDownstreamEligibilityBody,
  ) {
    assertPrincipal(principal);
    try {
      return await checkDownstreamEligibility(
        { ...this.deps, landings: this.landings },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          artifactId: body.artifactId ?? artifactId,
          purpose: body.purpose,
        },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof ArtifactLandingNotFoundError) throw new NotFoundException();
      if (e instanceof RequiresPinnedError) throw new UnprocessableEntityException({ reasonCode: "REQUIRES_PINNED" });
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /** 右栏「产物」列表（UC-22）。草稿仅创建者可见——见 `list-thread-artifacts.ts` 文件头。 */
  @Get("/chat/threads/:threadId/artifacts")
  async threadArtifacts(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await listThreadArtifacts(
        { ...this.deps, landings: this.landings },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), projectId, threadId },
      );
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }
}
