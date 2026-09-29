/**
 * 组织首页配置（ad-hoc feature，Refs #4634）。
 *
 *   GET /organizations/:orgId/home-config   任意组织成员可读
 *   PUT /organizations/:orgId/home-config   仅组织 admin
 *
 * 授权两个私有方法逐字照抄 `org-admin-management.controller.ts` 的
 * `requireAdminRole`/`requireOrgAdmin`——本仓约定是每个 controller 自己判一次
 * 成员资格，不共用一个跨 controller 的 helper（同该文件头注「无 `@Public()`」的先例）。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { z } from "zod";
import { homeConfig as C } from "@repo/contracts";
import { getHomeConfig } from "../../application/home/get-home-config";
import { updateHomeConfig } from "../../application/home/update-home-config";
import { uploadHomeBanner } from "../../application/home/upload-home-banner";
import { HomeConfigDomainError } from "../../application/home/home-config-errors";
import { MAX_AVATAR_BYTES } from "../../application/auth/upload-org-avatar";
import { readRawBody } from "./org-admin-management.controller";
import { HOME_CONFIG_REPOSITORY, type HomeConfigRepository } from "../../application/home/home-config-ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 契约 `in` 按本仓惯例含路径参数 `orgId`（同 `apply-blueprint.controller.ts`）；
 *  body 里不收它——orgId 只取路径，body 带 orgId 会被 `.strict()` 拒成 400。 */
export const UPDATE_HOME_CONFIG_SCHEMA = C.operations.updateHomeConfig.in.omit({ orgId: true });
type UpdateHomeConfigBody = z.infer<typeof UPDATE_HOME_CONFIG_SCHEMA>;
const UPLOAD_HOME_BANNER_SCHEMA = C.operations.uploadHomeBanner.in;

/** 业务拒绝码 → HTTP：体积/格式是「请求本身不合法」（413/415），其余是 409 状态冲突。 */
function toHttpException(e: unknown): unknown {
  if (e instanceof HomeConfigDomainError) {
    if (e.reasonCode === "FILE_TOO_LARGE") {
      return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    if (e.reasonCode === "UNSUPPORTED_CONTENT_TYPE") {
      return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.CONFLICT);
  }
  return e;
}

@Controller()
export class HomeConfigController {
  constructor(
    @Inject(HOME_CONFIG_REPOSITORY) private readonly repo: HomeConfigRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  private async requireAdminRole(principal: Principal, orgIdParam: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(orgIdParam);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });
    return { orgId, orgRole: membership.orgRole };
  }

  private async requireOrgAdmin(principal: Principal, orgIdParam: string) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    if (orgRole !== "admin") throw new ForbiddenException({ reasonCode: "FORBIDDEN" });
    return { orgId };
  }

  @Get("/organizations/:orgId/home-config")
  async get(@Param("orgId") orgIdParam: string, @CurrentPrincipal() principal: Principal) {
    const { orgId } = await this.requireAdminRole(principal, orgIdParam);
    return getHomeConfig({ repo: this.repo }, orgId);
  }

  @Put("/organizations/:orgId/home-config")
  async update(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(UPDATE_HOME_CONFIG_SCHEMA)) body: UpdateHomeConfigBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId } = await this.requireOrgAdmin(principal, orgIdParam);
    try {
      return await updateHomeConfig(
        { repo: this.repo },
        {
          orgId,
          title: body.title,
          tagline: body.tagline,
          bannerHeadline: body.bannerHeadline,
          bannerTagline: body.bannerTagline,
          bannerPreset: body.bannerPreset,
          bannerColor: body.bannerColor,
          bannerImageArtifactId: body.bannerImageArtifactId,
          quickActions: body.quickActions,
          recommendedCapabilities: body.recommendedCapabilities,
          recommendedAgents: body.recommendedAgents,
          sections: body.sections,
          updatedBy: principal.userId,
        },
      );
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /**
   * 横幅图片上传（仅组织 admin）。元数据走查询串、字节是请求体本身——理由与 `readRawBody`
   * 的加固同 `OrgAdminManagementController.uploadAvatar`（本仓没有 multer 依赖）。
   */
  @Post("/organizations/:orgId/home-banner")
  async uploadBanner(
    @Param("orgId") orgIdParam: string,
    @Query("filename") filename: string | undefined,
    @Query("sizeBytes") sizeBytesParam: string | undefined,
    @Query("sha256") sha256: string | undefined,
    @Query("contentType") contentType: string | undefined,
    @Req() req: Request,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId } = await this.requireOrgAdmin(principal, orgIdParam);
    const parsed = UPLOAD_HOME_BANNER_SCHEMA.safeParse({
      orgId: orgIdParam,
      filename,
      sizeBytes: Number(sizeBytesParam),
      sha256,
      contentType,
    });
    if (!parsed.success) {
      // 声明层的「太大/格式不对」与用例层同一响应形状（同 uploadAvatar D4 的处置）。
      if (parsed.error.issues.some((i) => i.path.join(".") === "sizeBytes")) {
        throw toHttpException(new HomeConfigDomainError("FILE_TOO_LARGE"));
      }
      if (parsed.error.issues.some((i) => i.path.join(".") === "contentType")) {
        throw toHttpException(new HomeConfigDomainError("UNSUPPORTED_CONTENT_TYPE"));
      }
      throw new BadRequestException({ fields: parsed.error.issues.map((i) => i.path.join(".") || "(root)") });
    }
    const bytes = new Uint8Array(await readRawBody(req, MAX_AVATAR_BYTES));
    try {
      return await uploadHomeBanner(
        { repo: this.repo },
        {
          orgId,
          actorId: principal.userId,
          bytes,
          declaredContentType: parsed.data.contentType,
          declaredSha256: parsed.data.sha256,
        },
      );
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /** 横幅图片字节：任意组织成员可读（首页给全员看），同头像文件路由的授权口径。 */
  @Get("/organizations/:orgId/home-banner-file/:bannerArtifactId")
  @Header("Cache-Control", "private, max-age=300")
  async bannerFile(
    @Param("orgId") orgIdParam: string,
    @Param("bannerArtifactId") bannerArtifactId: string,
    @CurrentPrincipal() principal: Principal,
    @Res() res: Response,
  ) {
    const { orgId } = await this.requireAdminRole(principal, orgIdParam);
    const found = await this.repo.readBannerBytes(orgId, bannerArtifactId);
    if (found === null) throw new NotFoundException();
    res.setHeader("Content-Type", found.contentType);
    res.send(Buffer.from(found.bytes));
  }
}
