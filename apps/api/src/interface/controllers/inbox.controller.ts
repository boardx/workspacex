/**
 * UC-17.8 B3.2 —— `inbox` 束的两条路由。
 *
 * ## 为什么是独立 controller
 *
 * 收件箱的主语是「聚合视图」，不是反馈也不是系统异常——它读两个已有束
 * （`feedback-loop` / `system-error-logs`）已经正确实现的仓储/端口，自己不持有
 * 任何存储。挂到 `FeedbackController`（已经 750+ 行）只会让那个文件替一个
 * 与反馈本身无关的读模型背依赖；`SystemErrorLogController` 同理。
 *
 * ## 鉴权分两层，跟契约头注一致
 *
 *   1. **整条收件箱**只要求调用方是本组织成员（D8 ③，2026-09-05 人类裁决）——
 *      不是本组织成员时 `listInbox`/`getInboxCounts` 用例抛 `InboxPermissionRevokedError`
 *      ⇒ 403。正文按 D3 逐行判（非管理员、非提交人 ⇒ `body: null`），分诊动作仍走
 *      `triageFeedback` 自己的 `canTriage`。
 *   2. **系统异常那一半**单独判——不是超管就不查那一半（`sources.exception:
 *      "withheld"`），不是把整条请求拒掉。判法**逐行复用**
 *      `isRequestorPlatformOperator`（与 `PlatformOperatorGuard` 同一个域函数 +
 *      同两个仓储，见该文件头注）。
 */
import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query, Req } from "@nestjs/common";
import { inbox as C } from "@repo/contracts";
import { PRODUCT_FEEDBACK_REPOSITORY, type ProductFeedbackRepositoryFactory } from "../../application/feedback/ports";
import {
  FEEDBACK_ATTACHMENT_REPOSITORY,
  type FeedbackAttachmentRepository,
} from "../../application/feedback/attachment-ports";
import { FEEDBACK_SUBMITTER_DIRECTORY, type FeedbackSubmitterDirectory } from "../../application/feedback/notification-ports";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { ERROR_LOG_PORT, type ErrorLogPort } from "../../application/ports/error-log.port";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { traceIdOf } from "../middleware/trace";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { PLATFORM_ADMIN_REPOSITORY, type PlatformAdminRepository } from "../../application/system/platform-admin-ports";
import {
  DESIGN_PROJECT_REPOSITORY,
  type DesignProjectRepositoryFactory,
} from "../../application/design-workbench/project-ports";
import { isRequestorPlatformOperator } from "../../application/system/platform-operator-check";
import { getInboxCounts } from "../../application/inbox/get-inbox-counts";
import { InboxPermissionRevokedError, listInbox } from "../../application/inbox/list-inbox";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const LIST_INBOX_SCHEMA = C.operations.listInbox.in;

@Controller()
export class InboxController {
  constructor(
    @Inject(PRODUCT_FEEDBACK_REPOSITORY) private readonly feedback: ProductFeedbackRepositoryFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(FEEDBACK_SUBMITTER_DIRECTORY) private readonly submitterDirectory: FeedbackSubmitterDirectory,
    @Inject(FEEDBACK_ATTACHMENT_REPOSITORY) private readonly attachments: FeedbackAttachmentRepository,
    @Inject(ERROR_LOG_PORT) private readonly errorLog: ErrorLogPort,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY) private readonly platformAdmins: PlatformAdminRepository,
    @Inject(DESIGN_PROJECT_REPOSITORY) private readonly designProjects: DesignProjectRepositoryFactory,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  /** B4.3——设计方案那一半的依赖，全组织可读，不像 `errorLog` 那样需要按请求者身份判断给不给。 */
  private designDeps(principal: Principal) {
    return {
      projects: this.designProjects.forOrg(principal.orgId),
      orgId: toOrgId(principal.orgId),
      submitters: this.submitterDirectory,
    };
  }

  private async viewerRole(principal: Principal) {
    const membership = await this.identity.findOrgMembership(principal.userId, principal.orgId);
    return { orgRole: membership?.orgRole ?? null, teamId: membership?.teamId ?? null };
  }

  /** `undefined` ⟺ 这次调用方不是平台运营准入——两条路由都据此不查系统异常那一半。 */
  private async errorLogForRequestor(principal: Principal): Promise<ErrorLogPort | undefined> {
    const isOperator = await isRequestorPlatformOperator(
      { credentials: this.credentials, platformAdmins: this.platformAdmins },
      principal.userId,
    );
    return isOperator ? this.errorLog : undefined;
  }

  @Get("/inbox")
  async list(
    @Req() req: unknown,
    @CurrentPrincipal() principal: Principal,
    @Query("kind") kind: string | undefined,
    @Query("stage") stage: string | undefined,
    @Query("q") q: string | undefined,
    @Query("limit") limitParam: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ) {
    assertPrincipal(principal);
    const parsedLimit = limitParam === undefined ? undefined : Number(limitParam);
    const parsed = LIST_INBOX_SCHEMA.safeParse({
      kind,
      stage,
      q,
      limit: parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      cursor,
    });
    if (!parsed.success) throw new BadRequestException("validation_failed");

    const { orgRole, teamId } = await this.viewerRole(principal);
    try {
      return await listInbox(
        {
          feedback: {
            repo: this.feedback.forOrg(principal.orgId),
            newDecisionId: () => this.decisions.next(),
            attachments: this.attachments,
            orgId: toOrgId(principal.orgId),
            submitters: this.submitterDirectory,
          },
          errorLog: await this.errorLogForRequestor(principal),
          design: this.designDeps(principal),
          logger: this.logger,
          traceId: traceIdOf(req),
        },
        {
          viewerId: principal.userId,
          viewerOrgRole: orgRole,
          viewerTeamId: teamId,
          kind: parsed.data.kind,
          stage: parsed.data.stage,
          q: parsed.data.q,
          limit: parsed.data.limit ?? C.INBOX_LIST_DEFAULT_LIMIT,
          cursor: parsed.data.cursor,
        },
      );
    } catch (e) {
      if (e instanceof InboxPermissionRevokedError) throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
      throw e;
    }
  }

  @Get("/inbox/counts")
  async counts(@Req() req: unknown, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const { orgRole, teamId } = await this.viewerRole(principal);
    try {
      return await getInboxCounts(
        {
          feedback: {
            repo: this.feedback.forOrg(principal.orgId),
            newDecisionId: () => this.decisions.next(),
            attachments: this.attachments,
            orgId: toOrgId(principal.orgId),
            submitters: this.submitterDirectory,
          },
          errorLog: await this.errorLogForRequestor(principal),
          design: this.designDeps(principal),
          logger: this.logger,
          traceId: traceIdOf(req),
        },
        { viewerId: principal.userId, viewerOrgRole: orgRole, viewerTeamId: teamId },
      );
    } catch (e) {
      if (e instanceof InboxPermissionRevokedError) throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
      throw e;
    }
  }
}
