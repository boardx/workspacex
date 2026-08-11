/**
 * F11 的三条路由（UC-1.6 R10 / O-28 ⑥ / O-29 ②④⑤）+ #363 补接的两条孤儿契约操作
 * + team-crud delta（#639）迭代 2 的四条团队自助路由。协议适配，判断全在 `application`。
 *
 *   POST /organizations/:orgId/invites/:inviteId/review     另一名管理员批准/拒绝管理员邀请
 *   POST /organizations/:orgId/invites/:inviteId/resend     重发邀请（#363，I-6）
 *   POST /organizations/:orgId/invites/:inviteId/revoke     撤销邀请（#363）
 *   GET  /organizations/:orgId/teams                        团队列表只读（#639 迭代 1）
 *   POST /organizations/:orgId/teams                        旧：团队增/删/改（`mutateTeam`，幂等重放语义）
 *   POST /organizations/:orgId/teams/create                 新：建团队（`createTeam`，撞重名真拒绝）
 *   PATCH /organizations/:orgId/teams/:teamId                新：改名（`renameTeam`，撞重名真拒绝）
 *   POST /organizations/:orgId/teams/:teamId/delete          新：删除（`deleteTeam`，非空真拒绝）
 *   POST /organizations/:orgId/members/:userId/remove       移除组织成员
 *
 * `mutateTeam` 与 `createTeam`/`renameTeam`/`deleteTeam` 为什么并存而不是二选一合并，
 * 见 `org-admin.ts` 里 `createTeam` 操作的文档注释。
 *
 * 全部路由都受 Guard 保护（无 `@Public()`），且都要求调用者在**本组织**的角色——
 * 与 `org-invite.controller.ts` 同一处置：从库里读 `actorOrgRole`，不从请求体读。
 *
 * ## #363：resend / revoke 的防枚举靠的是**判定顺序**，不是错误码长得像
 *
 * `requireAdminRole` 在**任何一次按 inviteId 的查库之前**跑完，且用例第一行再判一次
 * 组织角色（`resend-org-invite.ts` / `revoke-org-invite.ts`）。所以：
 * · 非本组织成员 → 403 `NO_ORG_MEMBERSHIP`，与 inviteId 存不存在无关；
 * · 本组织的非管理员 → 403 `PROJECT_ROLE_INSUFFICIENT`，同样与 inviteId 无关；
 * · 管理员拿别人组织的 inviteId → 仓储在 RLS 租户上下文里查，零行 ⇒ 与「这个 id
 *   根本不存在」**由构造**产生同一个 `INVITE_NOT_FOUND`（V10）。
 *
 * ⚠ 令牌回传口径（invite-link-and-reads delta ①，coord-main 2026-08-11 裁决 A）：
 *   `resend` 的响应体带 `activationToken`——**签发那一次，且只有那一次**。由刚触发
 *   签发的 admin 转交受邀人，是邮件通道接通前链接送达的唯一诚实通道；能发起/重发
 *   邀请的本来就是 admin，一次性回传不等于「任何管理员随时可读他人链接」。
 *   仍然封死的面：`listOrgInvites` 恒不含 token（契约 `.strict()`），`revoke`/`review`
 *   不回传，仓储的返回值里根本没有 token 字段——「随时可再读」在三层都造不出来。
 *
 * ⚠ 路由是 `POST …/remove` 不是 `DELETE /organizations/:orgId/members/:userId`：
 *   契约 `ORG_ADMIN_FORBIDDEN_ROUTES` 的长注解释了为什么——`no-forbidden-routes.test.ts`
 *   的 `^DELETE\s+\/organizations` 前缀禁令会误伤它。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { orgAdmin as C } from "@repo/contracts";
import { listTeams } from "../../application/auth/list-teams";
import { mutateTeam, TeamInUseError } from "../../application/auth/mutate-team";
import { createTeam } from "../../application/auth/create-team";
import { renameTeam } from "../../application/auth/rename-team";
import { deleteTeam } from "../../application/auth/delete-team";
import { removeOrgMember } from "../../application/auth/remove-org-member";
import { resendOrgInvite } from "../../application/auth/resend-org-invite";
import { revokeOrgInvite } from "../../application/auth/revoke-org-invite";
import { reviewAdminInvite } from "../../application/auth/review-admin-invite";
import { listOrgMembers } from "../../application/auth/list-org-members";
import { listOrgInvites } from "../../application/auth/list-org-invites";
import { updateOrganization } from "../../application/auth/update-organization";
import { uploadOrgAvatar } from "../../application/auth/upload-org-avatar";
import { OrgAdminError } from "../../application/auth/org-invite-errors";
import {
  ORG_INVITE_REPOSITORY,
  type OrgInviteRepository,
} from "../../application/auth/org-invite-ports";
import { ORG_MEMBER_REPOSITORY, type OrgMemberRepository } from "../../application/auth/org-member-ports";
import { TEAM_REPOSITORY, type TeamRepository } from "../../application/auth/team-ports";
import { ORG_PROFILE_REPOSITORY, type OrgProfileRepository } from "../../application/auth/org-profile-ports";
import { SESSION_TOKEN_STORE, type SessionTokenStore } from "../../application/auth/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const REVIEW_ADMIN_INVITE_SCHEMA = C.operations.reviewAdminInvite.in;
/** #363。导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const RESEND_ORG_INVITE_SCHEMA = C.operations.resendOrgInvite.in;
export const REVOKE_ORG_INVITE_SCHEMA = C.operations.revokeOrgInvite.in;
export const MUTATE_TEAM_SCHEMA = C.operations.mutateTeam.in;
export const CREATE_TEAM_SCHEMA = C.operations.createTeam.in;
export const RENAME_TEAM_SCHEMA = C.operations.renameTeam.in;
export const DELETE_TEAM_SCHEMA = C.operations.deleteTeam.in;
export const REMOVE_ORG_MEMBER_SCHEMA = C.operations.removeOrgMember.in;
/** org-profile-membership delta（#363 收拢）。同上，导出以证明是同一个对象。 */
export const UPDATE_ORGANIZATION_SCHEMA = C.operations.updateOrganization.in;
export const UPLOAD_ORG_AVATAR_SCHEMA = C.operations.uploadOrgAvatar.in;

type ReviewBody = { orgId: string; inviteId: string; decision: "approve" | "reject"; reason: string | null };
type InviteRefBody = { orgId: string; inviteId: string };
type MutateTeamBody = {
  orgId: string;
  op: "create" | "rename" | "delete";
  teamId: string | null;
  name: string | null;
};
type RemoveMemberBody = { orgId: string; userId: string };
type UpdateOrganizationBody = {
  orgId: string;
  name?: string;
  description?: string;
  avatarArtifactId?: string | null;
};

/**
 * 读整个请求体的原始字节。`uploadOrgAvatar` 的图片字节走这条路，见契约文件头的两步说明。
 *
 * ⚠ 2026-08-11 devapp 实测加固：人类在生产上传头像，按钮永远停在「上传中…」——
 * fetch 不 settle 意味着服务端从未响应。原实现只监听 data/end/error 三个事件：
 * 请求流若在 end 之前断开（客户端中断、反代转发的体不完整、h2/h3 流被重置），
 * Node 只发 `close` 不一定发 `error`，这个 Promise 就**永远**不 settle——请求
 * 原地挂死，日志里一个字都没有。⇒ 两条兜底，保证有限时间内必然 settle：
 *   ① `close` 且流未正常结束 → reject 400（体不完整）；
 *   ② 硬超时 30s（体上限 5MB，活着的连接绰绰有余）→ reject 408。
 * settle 之后的迟到事件被 `settled` 标志吞掉，不会二次 settle。
 * 本地 HTTP 层反证：tests/org-admin/upload-org-avatar-http-route.test.ts。
 */
const RAW_BODY_TIMEOUT_MS = 30_000;

function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(new HttpException({ reasonCode: "REQUEST_BODY_TIMEOUT" }, HttpStatus.REQUEST_TIMEOUT)),
        ),
      RAW_BODY_TIMEOUT_MS,
    );
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => settle(() => resolve(Buffer.concat(chunks))));
    req.on("error", (e) => settle(() => reject(e)));
    req.on("close", () => {
      if (!req.readableEnded) {
        settle(() =>
          reject(new HttpException({ reasonCode: "REQUEST_BODY_INCOMPLETE" }, HttpStatus.BAD_REQUEST)),
        );
      }
    });
  });
}

@Controller()
export class OrgAdminManagementController {
  constructor(
    @Inject(ORG_INVITE_REPOSITORY) private readonly invites: OrgInviteRepository,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(ORG_MEMBER_REPOSITORY) private readonly members: OrgMemberRepository,
    @Inject(ORG_PROFILE_REPOSITORY) private readonly profiles: OrgProfileRepository,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
  ) {}

  private async requireAdminRole(principal: Principal, orgIdParam: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(orgIdParam);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });
    return { orgId, orgRole: membership.orgRole };
  }

  @Post("/organizations/:orgId/invites/:inviteId/review")
  async review(
    @Param("orgId") orgIdParam: string,
    @Param("inviteId") inviteIdParam: string,
    @Body(new ZodBodyPipe(REVIEW_ADMIN_INVITE_SCHEMA)) body: ReviewBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await reviewAdminInvite(
        { repo: this.invites },
        {
          orgId,
          reviewerId: principal.userId,
          reviewerOrgRole: orgRole,
          inviteId: inviteIdParam,
          decision: body.decision,
        },
      );
      return { status: out.status, tokenIssued: out.tokenIssued };
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * #363 / I-6：重发 = 签发新令牌 + 作废旧令牌。**不幂等**，故受 `RATE_LIMITED` 保护。
   *
   * ⚠ `inviteId` 取**路径参数**，不取 body 里那个同名字段——与 `invite` 那条
   *   「路径参数赢」同一处置。body 里的 orgId/inviteId 是契约里的回声，
   *   拿它当权威就等于让请求体决定动哪一行。
   */
  @Post("/organizations/:orgId/invites/:inviteId/resend")
  async resend(
    @Param("orgId") orgIdParam: string,
    @Param("inviteId") inviteIdParam: string,
    @Body(new ZodBodyPipe(RESEND_ORG_INVITE_SCHEMA)) _body: InviteRefBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await resendOrgInvite(
        { repo: this.invites },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, inviteId: inviteIdParam },
      );
      // 契约 `out` 逐字三个字段（invite-link-and-reads delta ①）：`activationToken`
      // 只在这一次重发响应里出现——旧令牌已作废（I-6），列表/重放拿不到它。
      // 回传给刚触发签发的 admin 一次，是邮件通道接通前链接送达受邀人的唯一诚实通道。
      return {
        newTokenIssued: out.newTokenIssued,
        cooldownSec: out.cooldownSec,
        activationToken: out.activationToken,
      };
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /** #363：撤销一条尚未激活的邀请。**幂等**——重复撤销返回同一 `revoked`。 */
  @Post("/organizations/:orgId/invites/:inviteId/revoke")
  async revoke(
    @Param("orgId") orgIdParam: string,
    @Param("inviteId") inviteIdParam: string,
    @Body(new ZodBodyPipe(REVOKE_ORG_INVITE_SCHEMA)) _body: InviteRefBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await revokeOrgInvite(
        { repo: this.invites },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, inviteId: inviteIdParam },
      );
      return { status: out.status };
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * `listTeams`（#639 delta，迭代 1）—— 只读，任何组织成员可调用。
   *
   * `requireAdminRole` 在这里只用来确认调用者是**本组织成员**（它不检查
   * `orgRole === "admin"`，越权收窄只在 `mutateTeam` 的用例层做）——命名沿用既有方法，
   * 语义与 `NO_ORG_MEMBERSHIP`-only 的契约 `err` 一致。
   */
  @Get("/organizations/:orgId/teams")
  async list(@Param("orgId") orgIdParam: string, @CurrentPrincipal() principal: Principal) {
    const { orgId } = await this.requireAdminRole(principal, orgIdParam);
    const out = await listTeams({ repo: this.teams }, { orgId });
    return { teams: out.teams };
  }

  @Post("/organizations/:orgId/teams")
  async mutate(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(MUTATE_TEAM_SCHEMA)) body: MutateTeamBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await mutateTeam(
        { repo: this.teams },
        { orgId, actorOrgRole: orgRole, op: body.op, teamId: body.teamId, name: body.name },
      );
      return { team: out.team, blocked: out.blocked };
    } catch (e) {
      if (e instanceof TeamInUseError) {
        throw new ConflictException({ reasonCode: e.reasonCode, blocked: e.occupancy });
      }
      throw toHttpException(e);
    }
  }

  /**
   * `createTeam`（team-crud delta #639，迭代 2）—— `POST .../teams/create`, not the same
   * literal path as `mutateTeam` above. The delta's draft originally reused
   * `POST /organizations/:orgId/teams`; that collided with `tests/contract-shape.test.ts`'s
   * mechanical "no two operations share a method+path" gate (both within `org-admin` and
   * across every bundle), caught by running it for real rather than left for the next
   * person. See `org-admin.ts`'s `createTeam` doc comment for the full account.
   */
  @Post("/organizations/:orgId/teams/create")
  async create(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(CREATE_TEAM_SCHEMA)) body: { name: string },
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      return await createTeam(
        { repo: this.teams, provenance: this.provenance },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, name: body.name },
      );
    } catch (e) {
      throw toHttpException(e);
    }
  }

  @Patch("/organizations/:orgId/teams/:teamId")
  async patchTeam(
    @Param("orgId") orgIdParam: string,
    @Param("teamId") teamIdParam: string,
    @Body(new ZodBodyPipe(RENAME_TEAM_SCHEMA)) body: { name: string },
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      return await renameTeam(
        { repo: this.teams, provenance: this.provenance },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, teamId: teamIdParam, name: body.name },
      );
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * ⚠ `POST .../delete`，不是 `DELETE`——`no-forbidden-routes.test.ts` 的
   * `^DELETE\s+\/organizations` 门禁会连带挡住这条，见 `deleteTeam` 契约操作的文档注释
   * （与 `removeOrgMember` 当年撞到同一堵墙的处置一致）。
   */
  @Post("/organizations/:orgId/teams/:teamId/delete")
  async deleteTeamRoute(
    @Param("orgId") orgIdParam: string,
    @Param("teamId") teamIdParam: string,
    @Body(new ZodBodyPipe(DELETE_TEAM_SCHEMA)) _body: Record<string, never>,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      return await deleteTeam(
        { repo: this.teams, provenance: this.provenance },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, teamId: teamIdParam },
      );
    } catch (e) {
      throw toHttpException(e);
    }
  }

  @Post("/organizations/:orgId/members/:userId/remove")
  async remove(
    @Param("orgId") orgIdParam: string,
    @Param("userId") userIdParam: string,
    @Body(new ZodBodyPipe(REMOVE_ORG_MEMBER_SCHEMA)) _body: RemoveMemberBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await removeOrgMember(
        { repo: this.members, sessions: this.sessions },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, userId: userIdParam },
      );
      return out;
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * `listOrgMembers`（#363 delta）—— 只读，任何组织成员可调用。同 `list`（listTeams）
   * 一样，`requireAdminRole` 这里只用来确认成员资格。
   */
  @Get("/organizations/:orgId/members")
  async listMembers(@Param("orgId") orgIdParam: string, @CurrentPrincipal() principal: Principal) {
    const { orgId } = await this.requireAdminRole(principal, orgIdParam);
    const out = await listOrgMembers({ repo: this.profiles }, { orgId });
    return { members: out.members };
  }

  /** `listOrgInvites`（#363 delta）—— **仅组织 admin**，与 `listMembers` 不共用授权判定。 */
  @Get("/organizations/:orgId/invites")
  async listInvites(@Param("orgId") orgIdParam: string, @CurrentPrincipal() principal: Principal) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await listOrgInvites({ repo: this.profiles }, { orgId, actorOrgRole: orgRole });
      return { invites: out.invites };
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /** `updateOrganization`（#363 delta）—— 组织资料编辑，**仅组织 admin**。 */
  @Patch("/organizations/:orgId")
  async updateProfile(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(UPDATE_ORGANIZATION_SCHEMA)) body: UpdateOrganizationBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await updateOrganization(
        { repo: this.profiles },
        {
          orgId,
          actorOrgRole: orgRole,
          name: body.name,
          description: body.description,
          avatarArtifactId: body.avatarArtifactId,
        },
      );
      return out;
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * `uploadOrgAvatar`（#363 delta）—— 组织头像上传第一步，**仅组织 admin**。
   *
   * ⚠ 契约的 `in` 只有声明的元数据，没有字节字段（org-admin.ts 文件头 + `KNOWN_CONTRACT_
   *   GAPS.OA11` ②已记录这处裁定）：元数据经查询串传入并按契约 schema 校验，
   *   图片的原始字节是这次 POST 请求体本身——不复用 `ZodBodyPipe`（它假设 JSON body），
   *   而是手动读原始流（`readRawBody`），因为本仓没有 multer/`FileInterceptor` 依赖，
   *   加一个新依赖不是这条 delta 该做的决定。
   */
  @Post("/organizations/:orgId/avatar")
  async uploadAvatar(
    @Param("orgId") orgIdParam: string,
    @Query("filename") filename: string | undefined,
    @Query("sizeBytes") sizeBytesParam: string | undefined,
    @Query("sha256") sha256: string | undefined,
    @Query("contentType") contentType: string | undefined,
    @Req() req: Request,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);

    const parsed = UPLOAD_ORG_AVATAR_SCHEMA.safeParse({
      orgId: orgIdParam,
      filename,
      sizeBytes: Number(sizeBytesParam),
      sha256,
      contentType,
    });
    if (!parsed.success) {
      /**
       * D4（2026-08-09 复核）：`sizeBytes`/`contentType` 的元数据校验发生在
       * `readRawBody`/用例的真实字节校验**之前**——一个超过 5MB 的声明值会在这里
       * 被 zod 拦下，落成一个裸 400 `{ fields: [...] }`，用例里 `OrgAdminError
       * ("FILE_TOO_LARGE")` 那条分支根本没机会跑，前端对应的 `FILE_TOO_LARGE`
       * 文案分支因此变成死代码，用户只看到「上传失败：400」。
       *
       * ⇒ 元数据层判定出的「太大/格式不对」，走同一条 `toHttpException` 改写成
       * 用例真实拒绝时会给的那个响应形状（reasonCode + 413/415），而不是自成一套
       * 没有 reasonCode 的 400——同一个业务失败只应该有一种响应形状，不分「元数据
       * 层截住的」和「用例层截住的」两种。其余字段的校验失败（`filename`/`sha256`/
       * `orgId` 缺失或不合法）不是这两个已知业务码能表达的情况，维持原样 400。
       */
      const sizeTooBig = parsed.error.issues.some((i) => i.path.join(".") === "sizeBytes");
      if (sizeTooBig) throw toHttpException(new OrgAdminError("FILE_TOO_LARGE"));
      const badContentType = parsed.error.issues.some((i) => i.path.join(".") === "contentType");
      if (badContentType) throw toHttpException(new OrgAdminError("UNSUPPORTED_CONTENT_TYPE"));
      throw new HttpException(
        { fields: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", code: i.code })) },
        HttpStatus.BAD_REQUEST,
      );
    }

    const bytes = new Uint8Array(await readRawBody(req));
    try {
      const out = await uploadOrgAvatar(
        { repo: this.profiles },
        {
          orgId,
          actorId: principal.userId,
          actorOrgRole: orgRole,
          bytes,
          declaredSizeBytes: parsed.data.sizeBytes,
          declaredContentType: parsed.data.contentType,
          declaredSha256: parsed.data.sha256,
        },
      );
      return out;
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * 头像字节服务。**不是契约操作**——`uploadOrgAvatar`/`updateOrganization` 返回的
   * `avatarUrl` 指向这条路由。
   *
   * ⚠ 2026-08-09 复核核实过一次「注释说任何成员可读，代码却调用 requireAdminRole，
   * 是不是不一致」——不是。`requireAdminRole` 这个方法名具误导性：它只在调用方
   * 读了返回值里的 `orgRole` 并自己拿去判断时才构成"仅 admin"（`uploadAvatar`/
   * `updateOrganization` 都是这么用的）；这里和 `listOrgMembers`（`orgId` 之外的
   * `orgRole` 未被使用）一样，只借它做**membership** 校验——非本组织成员会拿到
   * `NO_ORG_MEMBERSHIP` 403，本组织的非 admin 成员能读到。这与 contract.md §2
   * 的原则一致（listOrgMembers/listOrgInvites 一类"看到组织里有什么"不是敏感操作，
   * 比它更敏感的操作才收紧到 admin）——头像展示的敏感度不高于成员名单，理应同一
   * 开放程度，任何组织成员可读是这里**故意**的行为，不是漏改。
   *
   * 真正的门是 Guard 本身：未鉴权（拿不出合法 `Authorization: Bearer` 的调用）会在
   * 到达这个方法之前就被拒——裸 `<img src>` 发不出这个头，是 D9 那个 401/裂图的
   * 根因，前端侧的修法见 `apps/web/components/org-admin/org-admin-screen.tsx` 的
   * `useAuthedImageSrc`。
   */
  @Get("/organizations/:orgId/avatar-file/:avatarArtifactId")
  @Header("Cache-Control", "private, max-age=300")
  async avatarFile(
    @Param("orgId") orgIdParam: string,
    @Param("avatarArtifactId") avatarArtifactId: string,
    @CurrentPrincipal() principal: Principal,
    @Res() res: Response,
  ) {
    const { orgId } = await this.requireAdminRole(principal, orgIdParam);
    const found = await this.profiles.readAvatarBytes(orgId, avatarArtifactId);
    if (found === null) throw new NotFoundException();
    res.setHeader("Content-Type", found.contentType);
    res.send(Buffer.from(found.bytes));
  }
}

/**
 * `OrgAdminError` -> HTTP。⚠ 只有一个越权码需要 403，其余全部 409——同
 * `org-invite.controller.ts` 的处置：状态码是粗粒度的，细粒度的原因在
 * `reasonCode`（`AllExceptionsFilter` 会把它铺进响应体）。
 */
function toHttpException(e: unknown) {
  if (e instanceof OrgAdminError) {
    if (e.reasonCode === "PROJECT_ROLE_INSUFFICIENT" || e.reasonCode === "FORBIDDEN") {
      return new ForbiddenException({ reasonCode: e.reasonCode });
    }
    // #363：`RATE_LIMITED` 是这一族里第二个不该被折进 409 的码。
    // 409 CONFLICT 对一次「冷却还没过」是误导性的——客户端读到冲突会去重试或提示用户
    // 「状态已变」，而正确的反应是**等一会儿再来**，那正是 429 的语义。
    // ⚠ 它只出现在 `resendOrgInvite.err` 里，所以这一行影响不到本文件其余四条路由。
    if (e.reasonCode === "RATE_LIMITED") {
      return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // #363：`uploadOrgAvatar` 的两个服务端拒绝码同样不该折进 409——它们不是「状态已变」，
    // 是「这个请求本身不合法」，413/415 让客户端一眼看出该改的是文件本身，不是重试。
    if (e.reasonCode === "FILE_TOO_LARGE") {
      return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    if (e.reasonCode === "UNSUPPORTED_CONTENT_TYPE") {
      return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    // team-crud delta（#639）迭代 2：指向的团队不存在 —— 404，不是 409。
    // `mutateTeam` 没有专属码时借用 `VERSION_CHANGED`（走 409）；这三条新操作有专属码，
    // 用它本来的语义即可，不必也折进 409。
    if (e.reasonCode === "TEAM_NOT_FOUND") {
      return new NotFoundException({ reasonCode: e.reasonCode });
    }
    return new ConflictException({ reasonCode: e.reasonCode });
  }
  return e;
}
