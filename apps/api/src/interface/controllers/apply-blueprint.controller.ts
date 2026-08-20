/**
 * `templates.applyBlueprint` 控制器（F23 补实现 / issue #1667）——
 * **本仓第一条**把 `applyBlueprintUseCase` 接上电的 HTTP 路由。
 *
 * 六类初始化写入 / 幂等 / 快照绑定的编排全部在
 * `application/templates/apply-blueprint.ts`；本文件只做三件事：
 *   ① 解析组织角色（`identity` 束）
 *   ② 调 `ApplyBlueprintResolverPort` 拿齐用例需要的全部事实（存在性/可见性/目标版本/
 *      档位/已填 facet keys/`flow-agenda` 原始内容）
 *   ③ 把用例抛出的 `ApplyBlueprintError` 翻成契约 `err` 对应的 HTTP 状态码
 *
 * 见文件头引用的 `apply-blueprint.ts`/`apply-blueprint-ports.ts`/
 * `apply-blueprint-resolver-ports.ts` 三份头注，理解为什么端口是这样切的。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { templates as C } from "@repo/contracts";
import type { z } from "zod";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { CurrentPrincipal } from "../current-principal.decorator";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { applyBlueprintUseCase, ApplyBlueprintError } from "../../application/templates/apply-blueprint";
import { APPLY_BLUEPRINT_REPOSITORY, type ApplyBlueprintRepository } from "../../application/templates/apply-blueprint-ports";
import {
  APPLY_BLUEPRINT_RESOLVER_PORT,
  type ApplyBlueprintResolverPort,
} from "../../application/templates/apply-blueprint-resolver-ports";
import { IDENTITY_REPOSITORY } from "../../application/identity/ports";
import type { IdentityRepository } from "../../application/identity/ports";

const APPLY_BODY_SCHEMA = C.operations.applyBlueprint.in.omit({ orgId: true, blueprintId: true });
type ApplyBody = z.infer<typeof APPLY_BODY_SCHEMA>;

@Controller()
export class ApplyBlueprintController {
  constructor(
    @Inject(APPLY_BLUEPRINT_REPOSITORY) private readonly repo: ApplyBlueprintRepository,
    @Inject(APPLY_BLUEPRINT_RESOLVER_PORT) private readonly resolver: ApplyBlueprintResolverPort,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  @Post("/blueprints/:blueprintId/apply")
  async apply(
    @Param("blueprintId") blueprintId: string,
    @Body(new ZodBodyPipe(APPLY_BODY_SCHEMA)) body: ApplyBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);

    let membership;
    try {
      membership = await this.identity.findOrgMembership(principal.userId, orgId);
    } catch {
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
    const actorOrgRole = membership?.orgRole ?? null;

    const resolved = await this.resolver.resolve(
      orgId,
      blueprintId,
      body.versionId,
      actorOrgRole,
      membership?.teamId ?? null,
    );

    try {
      const out = await applyBlueprintUseCase(
        { repo: this.repo },
        {
          orgId,
          actorId: principal.userId,
          actorOrgRole,
          blueprintId,
          blueprintExists: resolved.blueprintExists,
          visibleToActor: resolved.visibleToActor,
          resolvedVersion: resolved.resolvedVersion,
          filledFacetKeys: resolved.filledFacetKeys,
          tier: body.tier ?? resolved.tier,
          projectName: body.projectName,
          idempotencyKey: body.idempotencyKey,
          flowAgendaContent: resolved.flowAgendaContent,
        },
      );
      return out;
    } catch (e) {
      if (!(e instanceof ApplyBlueprintError)) throw e;
      switch (e.reasonCode) {
        case "NO_ORG_ROLE":
        case "ROLE_INSUFFICIENT":
          throw new ForbiddenException({ reasonCode: e.reasonCode });
        case "BLUEPRINT_NOT_FOUND":
        case "BLUEPRINT_NOT_VISIBLE":
          // ⚠ 两者都映射成 404——不越过存在性/可见性泄露给非授权调用方（同契约
          //   `BLUEPRINT_NOT_FOUND` 注释「不存在或越权可见，两者必须不可区分」的立场）。
          throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
        case "BLUEPRINT_NOT_PUBLISHED":
        case "BLUEPRINT_VERSION_ARCHIVED":
          throw new UnprocessableEntityException({ reasonCode: e.reasonCode });
        case "INITIALIZATION_FAILED":
          throw new UnprocessableEntityException({
            reasonCode: e.reasonCode,
            detail: { failedCategory: e.failedCategory },
          });
        case "DEPENDENCY_UNAVAILABLE":
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        default:
          throw new BadRequestException({ reasonCode: e.reasonCode });
      }
    }
  }
}
