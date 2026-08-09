/**
 * Identity routes. Protocol adaptation only -- every judgement happens in `application`.
 *
 * Each route's request body is validated by the schema FROM THE CONTRACT, never a local
 * copy (`lint-contract-source` enforces that, and it now scans this package).
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers,
  HttpCode, HttpStatus, Inject, NotFoundException, Param, Patch, Post, Query, Res,
  UnprocessableEntityException, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  authorize,
  authorizeBatch,
  type AuthorizeDeps,
} from "../../application/identity/authorize";
import {
  NoOrgMembershipError,
  resolveIdentity,
  switchOrganization,
} from "../../application/identity/switch-organization";
import {
  ContentDeniedError,
  ContentNotFoundError,
  readContent,
} from "../../application/identity/read-content";
import { getPersonalLayerSummary } from "../../application/identity/personal-layer-summary";
import { resolveModelConstraint } from "../../application/identity/resolve-model-constraint";
import { UpdateOwnProfileError, updateOwnProfile } from "../../application/identity/update-own-profile";
import {
  CAPABILITY_REPOSITORY,
  type CapabilityRepository,
} from "../../application/identity/capability-ports";
import {
  CREDENTIAL_REPOSITORY, SESSION_TOKEN_STORE, PASSWORD_HASHER,
  type CredentialRepository, type SessionTokenStore, type PasswordHasher,
} from "../../application/auth/ports";
import {
  CONTENT_REPOSITORY,
  type ContentRepository,
} from "../../application/identity/content-ports";
import {
  PROVENANCE_WRITER, PROVENANCE_READER,
  type ProvenanceWriter, type ProvenanceReader,
} from "../../application/provenance/ports";
import { AVATAR_REPOSITORY, type AvatarRepository } from "../../application/identity/avatar-ports";
import { OBJECT_STORE, ObjectExistsError, type ObjectStore } from "../../application/artifact/ports";
import { UploadOwnAvatarError, uploadOwnAvatar } from "../../application/identity/upload-own-avatar";
import { ChangeOwnPasswordError, changeOwnPassword } from "../../application/identity/change-own-password";
import { listOwnActivity } from "../../application/identity/list-own-activity";
import {
  AUTHORIZATION_CACHE,
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  SESSION_STORE,
  type AuthorizationCache,
  type DecisionIdFactory,
  type IdentityRepository,
  type SessionStore,
} from "../../application/identity/ports";
import type { ReadPurpose } from "../../domain/identity/admin-boundary";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const AUTHORIZE_SCHEMA = C.operations.authorize.in;
export const AUTHORIZE_BATCH_SCHEMA = C.operations.authorizeBatch.in;
export const SWITCH_ORG_SCHEMA = C.operations.switchOrganization.in;
export const READ_CONTENT_SCHEMA = C.operations.readContent.in;
export const MODEL_CONSTRAINT_SCHEMA = C.operations.resolveModelConstraint.in;
export const UPDATE_OWN_PROFILE_SCHEMA = C.operations.updateOwnProfile.in;
export const UPLOAD_OWN_AVATAR_SCHEMA = C.operations.uploadOwnAvatar.in;
export const CHANGE_OWN_PASSWORD_SCHEMA = C.operations.changeOwnPassword.in;
export const LIST_OWN_ACTIVITY_SCHEMA = C.operations.listOwnActivity.in;

type AuthorizeBody = { orgId: string; projectId?: string; object: { kind: "project" | "artifact" | "segment"; id: string }; action: string };
type AuthorizeBatchBody = { orgId: string; projectId?: string; objects: { kind: "project" | "artifact" | "segment"; id: string }[]; action: string };
type ReadContentBody = { orgId: string; projectId: string; itemId: string; purpose: ReadPurpose };
type ModelConstraintBody = { orgId: string; dataScope: { itemId: string; confidential: boolean }[] };
type UpdateOwnProfileBody = { displayName?: string; avatarArtifactId?: string | null };

@Controller()
export class IdentityController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(AUTHORIZATION_CACHE) private readonly cache: AuthorizationCache,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(CAPABILITY_REPOSITORY) private readonly capabilities: CapabilityRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(SESSION_TOKEN_STORE) private readonly tokenStore: SessionTokenStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AVATAR_REPOSITORY) private readonly avatars: AvatarRepository,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    @Inject(PROVENANCE_READER) private readonly provenanceReader: ProvenanceReader,
  ) {}

  private get deps(): AuthorizeDeps {
    return { repo: this.repo, ids: this.ids };
  }

  /**
   * Always 200, even when denied.
   *
   * A denial is a RESULT here, not an error -- returning 403 would throw away the layered
   * explanation the UI needs to say "this is an org-level restriction, not a project one".
   * The endpoints that ACT on a resource are the ones that return 403; this one reports.
   */
  @Post("/identity/authorize")
  async authorize(
    @CurrentPrincipal() principal: Principal,
    // The pipe is attached to the PARAMETER, not the method.
    //
    // `@UsePipes` at method level runs against EVERY parameter, including custom param
    // decorators -- so the contract schema would also be applied to the principal, which
    // fails it, and every request 400s. The symptom looks like a bad request body, so the
    // first instinct is to go debug the client.
    @Body(new ZodBodyPipe(AUTHORIZE_SCHEMA)) body: AuthorizeBody,
  ) {
    assertPrincipal(principal);
    return authorize(this.deps, {
      userId: principal.userId,
      orgId: toOrgId(body.orgId),
      projectId: body.projectId,
      object: body.object,
      action: body.action,
    });
  }

  @Post("/identity/authorize-batch")
  async authorizeBatch(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(AUTHORIZE_BATCH_SCHEMA)) body: AuthorizeBatchBody,
  ) {
    assertPrincipal(principal);
    // Same length, same order as the input -- callers must never have to match by id.
    return authorizeBatch(this.deps, {
      userId: principal.userId,
      orgId: toOrgId(body.orgId),
      projectId: body.projectId,
      objects: body.objects,
      action: body.action,
    });
  }

  /**
   * The read path the admin boundary is actually about (F03 / D-18).
   *
   * ## The status codes here are the requirement, not a detail
   *
   *   403 + reasonCode  the caller may not read this, and the UI can say which layer
   *                     closed the door (UC-0.3 R8 -- never a bare "no permission")
   *   404               the item does not exist, OR it is somebody else's draft. These are
   *                     deliberately the same response: 403 on a draft answers the question
   *                     "is there something here", and for a draft that answer is the leak
   *                     (uc-0-1 V4)
   *   404 on NO_ORG_MEMBERSHIP  a denial must not reveal that the organization exists
   *
   * ## Why the schema is on the parameter
   *
   * A method-level `@UsePipes` runs against EVERY parameter including `@CurrentPrincipal`,
   * so the contract schema would be applied to the principal, fail, and 400 every request.
   * The symptom reads as a malformed body, which sends you to debug the client.
   */
  // 200, not Nest's default 201 for POST. The verb is POST because the operation has a
  // side effect (the audit row), but nothing is CREATED from the caller's point of view --
  // and a client that branches on 201 would treat every read as a write.
  @HttpCode(HttpStatus.OK)
  @Post("/identity/content/read")
  async readContent(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(READ_CONTENT_SCHEMA)) body: ReadContentBody,
  ) {
    assertPrincipal(principal);
    try {
      return await readContent(
        { repo: this.repo, ids: this.ids, content: this.content, provenance: this.provenance },
        {
          userId: principal.userId,
          orgId: toOrgId(body.orgId),
          projectId: body.projectId,
          itemId: body.itemId,
          purpose: body.purpose,
        },
      );
    } catch (e) {
      if (e instanceof ContentNotFoundError) throw new NotFoundException();
      if (e instanceof ContentDeniedError) {
        if (e.reasonCode === "NO_ORG_MEMBERSHIP") throw new NotFoundException();
        // The reason code travels in the body, not in the status. Four denial reasons
        // collapsed into one 403 is exactly the "just show 'no permission'" that R8 rules
        // out -- the user cannot tell an org-layer restriction from a project-layer one.
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * Counts, and nothing else -- invariant I-8.
   *
   * There is no sibling route that returns personal-layer content, and that absence is the
   * design: the only way to read someone's personal item is `/identity/content/read`,
   * which refuses it for anyone but the owner regardless of org role or stated purpose.
   */
  @Get("/identity/personal-layer/summary")
  async personalLayerSummary(
    @CurrentPrincipal() principal: Principal,
    @Query("orgId") orgId: string,
    @Query("userId") userId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getPersonalLayerSummary(
        { repo: this.repo, content: this.content },
        { requesterId: principal.userId, orgId: toOrgId(orgId), userId },
      );
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  @Get("/identity/me")
  async me(
    @CurrentPrincipal() principal: Principal,
    @Query("orgId") orgId: string,
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    try {
      const r = await resolveIdentity(this.repo, this.credentials, {
        userId: principal.userId,
        orgId: toOrgId(orgId),
        projectId,
      });
      return r;
    } catch (e) {
      // 404, not 403: a denial must not reveal whether the organization exists.
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * `updateOwnProfile`（#638 delta，迭代 1）—— 目前只有 `displayName` 真的落库。
   *
   * `avatarArtifactId` 非 null 一律 400 `INVALID_INPUT`——`uploadOwnAvatar` 本轮
   * 未实现，见 `application/identity/update-own-profile.ts` 头部注释。
   */
  @Patch("/identity/me")
  async updateMe(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(UPDATE_OWN_PROFILE_SCHEMA)) body: UpdateOwnProfileBody,
  ) {
    assertPrincipal(principal);
    try {
      return await updateOwnProfile(
        { credentials: this.credentials, avatars: this.avatars },
        { userId: principal.userId, displayName: body.displayName, avatarArtifactId: body.avatarArtifactId },
      );
    } catch (e) {
      if (e instanceof UpdateOwnProfileError) {
        if (e.reasonCode === "AVATAR_ARTIFACT_NOT_OWNED") throw new ForbiddenException({ reasonCode: e.reasonCode });
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Post("/identity/switch-org")
  async switchOrg(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(SWITCH_ORG_SCHEMA)) body: { toOrgId: string },
  ) {
    assertPrincipal(principal);
    try {
      return await switchOrganization(
        {
          repo: this.repo,
          sessions: this.sessions,
          cache: this.cache,
          // Switching organizations returns the NEW organization's whole configuration --
          // that post-effect is contract text, not an optimisation (O-12 + F15).
          capabilities: this.capabilities,
          ids: this.ids,
        },
        { userId: principal.userId, toOrgId: toOrgId(body.toOrgId) },
      );
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * The ONE place that answers "must this round stay local, and why" (coherence B-3 / X-5).
   *
   * POST rather than GET because `dataScope` is a list that can be long and describes what is
   * about to be processed -- a request body, not a bookmarkable address. It has no side
   * effect.
   *
   * ⚠ `source` is the load-bearing half of the response, not `localOnly`: a personal-local
   * organization's `promise` and a real organization's `policy` produce the same boolean and
   * differ in whether anybody can switch them off (uc-0-5 R10 ruling / V12).
   */
  @HttpCode(HttpStatus.OK)
  @Post("/identity/model-constraint")
  async modelConstraint(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(MODEL_CONSTRAINT_SCHEMA)) body: ModelConstraintBody,
  ) {
    assertPrincipal(principal);
    try {
      return await resolveModelConstraint(this.repo, {
        userId: principal.userId,
        orgId: toOrgId(body.orgId),
        dataScope: body.dataScope,
      });
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * Session snapshot.
   *
   * Deliberately under `/kernel/probe/`, not `/identity/`: it is NOT contract surface. The
   * contract defines nine identity operations and this is not one of them, so putting it at
   * `/identity/session` would quietly grow the public API past what was signed off.
   *
   * It exists because O-12's post-effects ("project context cleared, no cached verdict
   * reused") are only assertable if something can observe them -- same reasoning as the
   * `rls_probe` table. An unobservable requirement stops being true without anyone noticing.
   */
  @Get("/kernel/probe/identity-session")
  async session(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return {
      ...(await this.sessions.get(principal.userId)),
      cachedDecisions: await this.cache.size(principal.userId),
    };
  }

  /**
   * `uploadOwnAvatar`（#638 delta，迭代 2）—— `multipart/form-data`：一个 `meta` 字段
   * （JSON，须过 `UPLOAD_OWN_AVATAR_SCHEMA`）+ 一个 `file` 字段（二进制）。契约的 `in`
   * 只描述 `meta` 那部分——见该操作的文档注释。用 memoryStorage 而不是落盘再读：头像上限
   * 5MB，内存里转一手不是问题，也省一次多余的磁盘往返。
   */
  // ⚠ multer 的 `limits.fileSize` 故意设得比业务上限（5MB，见
  // `upload-own-avatar.ts` 的 `AVATAR_SIZE_LIMIT_BYTES`）更宽松：这一层只是防
  // 真正离谱的负载把内存打爆的兜底，`FILE_TOO_LARGE` 这个契约码的判定必须落在
  // 服务端应用层（`uploadOwnAvatar`），因为那里才知道"5MB"这个数字、才能给出
  // 契约里约定的 reasonCode——multer 撞线时抛的是没有 reasonCode 的 413，
  // 客户端拿不到可展示的错误信息。
  @Post("/identity/me/avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadAvatar(
    @CurrentPrincipal() principal: Principal,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body("meta") metaRaw: string | undefined,
  ) {
    assertPrincipal(principal);
    if (!file || !metaRaw) throw new BadRequestException({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    let meta: unknown;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      throw new BadRequestException({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    }
    const parsed = UPLOAD_OWN_AVATAR_SCHEMA.safeParse(meta);
    if (!parsed.success) {
      // `meta.sizeBytes` 本身超过契约的 `.max(5MB)` 时，zod 在这一步就先失败了——
      // 服务端对**实际字节**的 `FILE_TOO_LARGE` 判断在 `uploadOwnAvatar()` 里，但那一步
      // 根本走不到（`parsed.success` 已经是 false）。这里必须按失败字段分流，否则一个
      // "meta 里的 sizeBytes 太大" 与"contentType 声明有问题"会被压成同一个
      // `UNSUPPORTED_CONTENT_TYPE`——本机真实 HTTP 实测踩到过这个坑（发一个真的 5MB+
      // 文件，界面上却显示"类型不支持"而不是"文件太大"）。
      const hitsSizeField = parsed.error.issues.some((issue) => issue.path[0] === "sizeBytes");
      throw new BadRequestException({ reasonCode: hitsSizeField ? "FILE_TOO_LARGE" : "UNSUPPORTED_CONTENT_TYPE" });
    }

    try {
      return await uploadOwnAvatar(
        { store: this.objectStore, avatars: this.avatars, credentials: this.credentials },
        { userId: principal.userId, declaredContentType: parsed.data.contentType, bytes: new Uint8Array(file.buffer) },
      );
    } catch (e) {
      if (e instanceof UploadOwnAvatarError) {
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      if (e instanceof ObjectExistsError) {
        // 极小概率的 id 碰撞（`uploadOwnAvatar` 用 96 位随机 id）；重试即可，不是客户端的错。
        throw new ConflictException({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
      }
      throw e;
    }
  }

  /**
   * 头像字节的下载路由。**不在契约里**（同 `files-delivery.controller.ts` 的
   * `GET /downloads/:token` 那条先例：`avatarUrl` 是一个 bare 字符串，没有配套的
   * "redeem" 契约操作）——`uploadOwnAvatar.out.avatarUrl` 得指向某处，这里就是那个某处。
   *
   * ⚠ 任何已认证身份都能读，不额外做"是否本人"的所有权校验：头像和显示名一样是要在
   * 产品里到处展示给别人看的东西（团队列表、@提及…），不是机密内容——所有权校验只发生
   * 在**写**路径（`updateOwnProfile` 的 `AVATAR_ARTIFACT_NOT_OWNED`）。
   */
  @Get("/identity/me/avatar/:artifactId")
  async downloadAvatar(
    @CurrentPrincipal() principal: Principal,
    @Param("artifactId") artifactId: string,
    @Res() res: Response,
  ): Promise<void> {
    assertPrincipal(principal);
    // `findAnyById`——已认证的任何人都能看（见上方文档注释），不限"是不是自己的"，
    // 所以这里不能用只返回"属于该 userId"的 `findOwned`。
    const row = await this.avatars.findAnyById(artifactId);
    if (row === null) {
      res.status(404).end();
      return;
    }
    const bytes = await this.objectStore.get(row.objectKey);
    if (bytes === null) {
      res.status(404).end();
      return;
    }
    // ⚠ `@Res()` 不带 `{ passthrough: true }`——本路由自己接管整个响应生命周期
    // （`res.end(buffer)`），不让 Nest 的默认返回值处理再插一手把 `Buffer` 当成
    // JSON 结构重新序列化（那条路径会把图片字节变成 `{"type":"Buffer","data":[...]}`
    // 的文本，字节数完全对不上——本机实测踩过这个坑）。
    res.set("Content-Type", row.contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.status(200).end(Buffer.from(bytes));
  }

  /**
   * `changeOwnPassword`（#638 delta，迭代 2）—— 成功后吊销除**当前会话**外的全部会话。
   * "当前会话"从 `Authorization` 头重新解析——`Principal` 只有 `userId`/`orgId`，不带
   * `sessionId`（见 ports.ts `revokeAllForUserExcept` 的文档注释），所以这里再查一次
   * token store，而不是给 `Principal` 加一个全局都要背的字段。
   */
  @Post("/identity/me/password")
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(CHANGE_OWN_PASSWORD_SCHEMA)) body: { currentPassword: string; newPassword: string },
    @Headers("authorization") authHeader: string | undefined,
  ) {
    assertPrincipal(principal);
    const token = bearerToken(authHeader);
    const session = token ? await this.tokenStore.findByToken(token) : null;
    if (!session) throw new ForbiddenException({ reasonCode: "CURRENT_PASSWORD_INVALID" });

    try {
      return await changeOwnPassword(
        { credentials: this.credentials, hasher: this.hasher, sessions: this.tokenStore, clock: { now: () => new Date() } },
        {
          userId: principal.userId,
          currentSessionId: session.id,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        },
      );
    } catch (e) {
      if (e instanceof ChangeOwnPasswordError) {
        if (e.reasonCode === "CURRENT_PASSWORD_INVALID") {
          throw new ForbiddenException({ reasonCode: e.reasonCode });
        }
        throw new UnprocessableEntityException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /** `listOwnActivity`（#638 delta，迭代 2）—— cursor 分页，`err` 恒空（契约逐字）。 */
  @Get("/identity/me/activity")
  async ownActivity(
    @CurrentPrincipal() principal: Principal,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ) {
    assertPrincipal(principal);
    const input = LIST_OWN_ACTIVITY_SCHEMA.parse({
      cursor: cursor ?? null,
      limit: limitRaw ? Number(limitRaw) : 20,
    });
    return await listOwnActivity(
      { reader: this.provenanceReader },
      { userId: principal.userId, orgId: toOrgId(principal.orgId), cursor: input.cursor, limit: input.limit },
    );
  }
}

/**
 * `Authorization: Bearer <token>`——同 `session-token-principal-resolver.ts` 的同名函数，
 * 这里不导入那份（它在 `infrastructure` 层，interface 不该反向依赖），是一次刻意的小重复：
 * 两处都只有三行，值不回抽一个共享工具模块。
 */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}
