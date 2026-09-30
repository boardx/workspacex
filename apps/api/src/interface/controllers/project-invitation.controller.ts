/**
 * 通用项目邀请（#4787）的八条路由。协议适配，判断全在 `application`。
 *
 *   负责人一侧（受全局 Guard 保护；与 `addNonWorkshopMember` 同一道 owner 门）
 *     POST /projects/:projectId/invitations                          批量邮箱邀请
 *     POST /projects/:projectId/invitations/link                     签发 / 重置邀请链接
 *     GET  /projects/:projectId/invitations                          列表
 *     POST /projects/:projectId/invitations/:invitationId/resend     重发（限频）
 *     POST /projects/:projectId/invitations/:invitationId/revoke     撤销
 *   受邀人一侧
 *     POST /project-invitations/preview    落地页预览（`@Public()`，带会话时按会话给下一步）
 *     POST /project-invitations/accept     已登录接受（受 Guard 保护）
 *     POST /project-invitations/activate   全新用户激活（`@Public()`）
 *
 * ## 为什么预览 / 激活是 `@Public()`
 *
 * 受邀人此刻可能没有账号、也不属于任何组织：**令牌本身就是这两条端点的授权**，所以它们的失败面是
 * 防枚举的（不存在 / 过期 / 撤销 / 已用 ⇒ 同一个结果）。令牌走 POST body，不进 URL 与访问日志。
 *
 * ## 错误体
 *
 * `{ reasonCode, message }`：`message` 取自契约的 `PROJECT_INVITATION_REASON_TEXT`（人话，中文），
 * 前端可直接展示。`lint-error-leak`：这里从不读 `err.message`。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { projectInvitation as C } from "@repo/contracts";
import type { z } from "zod";
import { AuthError, PasswordPolicyError } from "../../application/auth/errors";
import {
  PASSWORD_HASHER,
  SESSION_TOKEN_STORE,
  TOKEN_FACTORY,
  type PasswordHasher,
  type SessionTokenStore,
  type TokenFactory,
} from "../../application/auth/ports";
import {
  EMAIL_VERIFICATION_TOKEN_CODEC,
  type EmailVerificationTokenCodec,
} from "../../application/auth/email-verification-ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import {
  TRANSACTIONAL_MAIL_TRANSPORT,
  type TransactionalMailTransport,
} from "../../application/notifications/transactional-mail-ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { PRINCIPAL_RESOLVER_PORT, type PrincipalResolverPort } from "../../application/ports/principal-resolver.port";
import { ProjectError, ProjectKindMismatchError } from "../../application/project/errors";
import {
  activateProjectInvitation,
  acceptProjectInvitation,
  previewProjectInvitation,
} from "../../application/project/accept-project-invitation";
import {
  createProjectInvitations,
  issueProjectInviteLink,
  listProjectInvitations,
  resendProjectInvitation,
  revokeProjectInvitation,
} from "../../application/project/manage-project-invitations";
import {
  NON_WORKSHOP_MEMBER_REPOSITORY,
  type NonWorkshopMemberRepository,
} from "../../application/project/non-workshop-member-ports";
import { ProjectInvitationError } from "../../application/project/project-invitation-errors";
import {
  APP_PUBLIC_URL_PROVIDER,
  PROJECT_INVITATION_REPOSITORY,
  type AppPublicUrlProvider,
  type ProjectInvitationRepository,
} from "../../application/project/project-invitation-ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ContractValidationError, ZodBodyPipe } from "../pipes/zod-body.pipe";
import { Public } from "../public.decorator";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const CREATE_PROJECT_INVITATIONS_SCHEMA = C.operations.createProjectInvitations.in;
export const ISSUE_PROJECT_INVITE_LINK_SCHEMA = C.operations.issueProjectInviteLink.in;
export const LIST_PROJECT_INVITATIONS_SCHEMA = C.operations.listProjectInvitations.in;
export const RESEND_PROJECT_INVITATION_SCHEMA = C.operations.resendProjectInvitation.in;
export const REVOKE_PROJECT_INVITATION_SCHEMA = C.operations.revokeProjectInvitation.in;
export const PREVIEW_PROJECT_INVITATION_SCHEMA = C.operations.previewProjectInvitation.in;
export const ACCEPT_PROJECT_INVITATION_SCHEMA = C.operations.acceptProjectInvitation.in;
export const ACTIVATE_PROJECT_INVITATION_SCHEMA = C.operations.activateProjectInvitation.in;

type CreateBody = z.infer<typeof CREATE_PROJECT_INVITATIONS_SCHEMA>;
type TokenBody = z.infer<typeof PREVIEW_PROJECT_INVITATION_SCHEMA>;
type ActivateBody = z.infer<typeof ACTIVATE_PROJECT_INVITATION_SCHEMA>;
type Reason = z.infer<typeof C.ProjectInvitationReason>;

function errorBody(code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const known = C.ProjectInvitationReason.safeParse(code);
  // 闸门（`authorizeNonWorkshopMember`）可能抛契约外的项目层码：统一落成「没有权限」那句人话。
  const reasonCode: Reason = known.success ? known.data : "ORG_ROLE_INSUFFICIENT";
  return { reasonCode, message: C.PROJECT_INVITATION_REASON_TEXT[reasonCode], ...extra };
}

const STATUS: Readonly<Record<Reason, number>> = {
  NO_PROJECT_ROLE: 403,
  PROJECT_ROLE_INSUFFICIENT: 403,
  ORG_ROLE_INSUFFICIENT: 403,
  AUTH_SERVICE_UNAVAILABLE: 503,
  PROJECT_ARCHIVED: 409,
  INVITATION_NOT_FOUND: 404,
  INVITATION_NOT_RESENDABLE: 409,
  INVITATION_EXPIRED: 409,
  INVITATION_ALREADY_ACCEPTED: 409,
  RESEND_TOO_SOON: 429,
  RESEND_LIMIT_REACHED: 409,
  DAILY_CAP_REACHED: 429,
  INVITATION_INVALID: 400,
  INVITATION_EMAIL_MISMATCH: 403,
  LOGIN_REQUIRED: 409,
  EMAIL_REQUIRED: 400,
  EMAIL_INVALID: 400,
  SEAT_QUOTA_EXHAUSTED: 409,
};

function rethrow(e: unknown): never {
  if (e instanceof ProjectKindMismatchError) throw new BadRequestException("project_kind_mismatch");
  if (e instanceof ProjectError) {
    const body = errorBody(e.reasonCode);
    throw new HttpException(body, STATUS[body.reasonCode as Reason]);
  }
  if (e instanceof ProjectInvitationError) {
    const extra = e.retryAfterSeconds === null ? {} : { retryAfterSeconds: e.retryAfterSeconds };
    throw new HttpException(errorBody(e.reasonCode, extra), STATUS[e.reasonCode]);
  }
  if (e instanceof PasswordPolicyError) {
    // 字段级校验失败，不是邀请失效（同组织激活那条）：把它折成「邀请无效」会让只是口令太弱的人去找邀请人重发。
    throw new ContractValidationError([{ path: "password", code: e.rejection }]);
  }
  if (e instanceof AuthError && e.reason === "AUTH_SERVICE_UNAVAILABLE") {
    throw new HttpException(errorBody("AUTH_SERVICE_UNAVAILABLE"), 503);
  }
  throw e;
}

@Controller()
export class ProjectInvitationController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(NON_WORKSHOP_MEMBER_REPOSITORY) private readonly members: NonWorkshopMemberRepository,
    @Inject(PROJECT_INVITATION_REPOSITORY) private readonly invitations: ProjectInvitationRepository,
    @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly mail: TransactionalMailTransport,
    @Inject(APP_PUBLIC_URL_PROVIDER) private readonly publicUrl: AppPublicUrlProvider,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(TOKEN_FACTORY) private readonly tokens: TokenFactory,
    @Inject(EMAIL_VERIFICATION_TOKEN_CODEC) private readonly verificationTokens: EmailVerificationTokenCodec,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Inject(PRINCIPAL_RESOLVER_PORT) private readonly principals: PrincipalResolverPort,
  ) {}

  private get manageDeps() {
    return {
      identity: this.identity,
      ids: this.decisions,
      members: this.members,
      invitations: this.invitations,
      mail: this.mail,
      // 惰性取：生产配置缺项时 `get()` 才会抛。
      appPublicUrl: () => this.publicUrl.get(),
    };
  }

  private log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: "project-invitation", err: detail.err ?? message });
  };

  /* ═══════════════════════ 负责人一侧 ═══════════════════════ */

  @Post(C.operations.createProjectInvitations.path)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(CREATE_PROJECT_INVITATIONS_SCHEMA)) body: CreateBody,
  ): Promise<z.infer<typeof C.operations.createProjectInvitations.out>> {
    assertPrincipal(principal);
    if (body.projectId !== projectId) throw new BadRequestException("project_id_mismatch");
    try {
      const out = await createProjectInvitations(this.manageDeps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        projectId,
        emails: body.emails,
      });
      return C.operations.createProjectInvitations.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  @Post(C.operations.issueProjectInviteLink.path)
  async issueLink(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ): Promise<z.infer<typeof C.operations.issueProjectInviteLink.out>> {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(ISSUE_PROJECT_INVITE_LINK_SCHEMA).transform({ projectId }) as { projectId: string };
    try {
      const out = await issueProjectInviteLink(this.manageDeps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        projectId: input.projectId,
      });
      return C.operations.issueProjectInviteLink.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  @Get(C.operations.listProjectInvitations.path)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ): Promise<z.infer<typeof C.operations.listProjectInvitations.out>> {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(LIST_PROJECT_INVITATIONS_SCHEMA).transform({ projectId }) as { projectId: string };
    try {
      const out = await listProjectInvitations(this.manageDeps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        projectId: input.projectId,
      });
      return C.operations.listProjectInvitations.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  @Post(C.operations.resendProjectInvitation.path)
  @HttpCode(200)
  async resend(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Param("invitationId") invitationId: string,
  ): Promise<z.infer<typeof C.operations.resendProjectInvitation.out>> {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(RESEND_PROJECT_INVITATION_SCHEMA).transform({ projectId, invitationId }) as {
      projectId: string;
      invitationId: string;
    };
    try {
      const out = await resendProjectInvitation(this.manageDeps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        projectId: input.projectId,
        invitationId: input.invitationId,
      });
      return C.operations.resendProjectInvitation.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  @Post(C.operations.revokeProjectInvitation.path)
  @HttpCode(200)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Param("invitationId") invitationId: string,
  ): Promise<z.infer<typeof C.operations.revokeProjectInvitation.out>> {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(REVOKE_PROJECT_INVITATION_SCHEMA).transform({ projectId, invitationId }) as {
      projectId: string;
      invitationId: string;
    };
    try {
      const out = await revokeProjectInvitation(this.manageDeps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        projectId: input.projectId,
        invitationId: input.invitationId,
      });
      return C.operations.revokeProjectInvitation.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  /* ═══════════════════════ 受邀人一侧 ═══════════════════════ */

  /**
   * 预览是 `@Public()`，而 `PrincipalGuard` 对公开路由直接放行、不解析身份——所以「带会话时按会话给下一步」
   * 要在这里用**同一个** `PRINCIPAL_RESOLVER_PORT`（Guard 用的那一个，不是第二套身份判定）自己取一次。
   * 取不到（没带凭据 / 凭据无效 / 解析依赖不可用）一律按匿名处理：预览不因身份解析失败而失败，
   * 最坏的结果是落地页多走一步「去登录」。
   */
  @Public()
  @Post(C.operations.previewProjectInvitation.path)
  @HttpCode(200)
  async preview(
    @Body(new ZodBodyPipe(PREVIEW_PROJECT_INVITATION_SCHEMA)) body: TokenBody,
    @Req() req: { headers: Record<string, string | string[] | undefined> },
  ): Promise<z.infer<typeof C.operations.previewProjectInvitation.out>> {
    let viewerUserId: string | null = null;
    try {
      viewerUserId = (await this.principals.resolve(req.headers))?.userId ?? null;
    } catch {
      viewerUserId = null;
    }
    try {
      const out = await previewProjectInvitation({ invitations: this.invitations }, { token: body.token, viewerUserId });
      return C.operations.previewProjectInvitation.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  @Post(C.operations.acceptProjectInvitation.path)
  @HttpCode(200)
  async accept(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(ACCEPT_PROJECT_INVITATION_SCHEMA)) body: TokenBody,
  ): Promise<z.infer<typeof C.operations.acceptProjectInvitation.out>> {
    assertPrincipal(principal);
    try {
      const out = await acceptProjectInvitation(
        { invitations: this.invitations, provenance: this.provenance, log: this.log },
        { token: body.token, userId: principal.userId },
      );
      return C.operations.acceptProjectInvitation.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }

  @Public()
  @Post(C.operations.activateProjectInvitation.path)
  async activate(
    @Body(new ZodBodyPipe(ACTIVATE_PROJECT_INVITATION_SCHEMA)) body: ActivateBody,
  ): Promise<z.infer<typeof C.operations.activateProjectInvitation.out>> {
    try {
      const out = await activateProjectInvitation(
        {
          invitations: this.invitations,
          hasher: this.hasher,
          sessions: this.sessions,
          tokens: this.tokens,
          verificationTokens: this.verificationTokens,
          provenance: this.provenance,
          log: this.log,
        },
        { token: body.token, name: body.name, password: body.password, email: body.email ?? null },
      );
      return C.operations.activateProjectInvitation.out.parse(out);
    } catch (e) {
      rethrow(e);
    }
  }
}
