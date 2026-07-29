/**
 * 导出豁口的两条路由（F17）。协议适配，判定全在用例里。
 *
 * ## 状态码
 *
 *   404 NO_ORG_MEMBERSHIP          不是两边之一的成员。⚠ 与 F16 同理由用 404 而非 403：
 *                                  403 会确认「那个组织存在」，而本地组织的存在本身
 *                                  就是被隐藏的东西之一
 *   403 EXPORT_DIRECTION_FORBIDDEN 方向错了。这个能说，因为调用方已经证明自己是两边的成员，
 *                                  「这两个组织的类型不允许这个方向」不再泄漏任何东西
 *   409 EXPORT_PREVIEW_REQUIRED    没预览 / 过期 / 已用掉 / 清单对不上。⚠ 四种归一，
 *                                  因为用户要做的事**完全一样**：回去再看一眼清单并确认。
 *                                  分开报只会引来一个「换个 token 再试」的客户端
 *
 * ## ⚠ 刻意**没有**反向路由
 *
 * 契约里没有「从正式组织导入到本地组织」的操作，这里也不会有一条「返回 403」的占位路由。
 * 占位路由读作「这个功能还没做」，而真相是**它永远不会做**——它会让「这里只有我」变成假话。
 */
import {
  Body, ConflictException, Controller, ForbiddenException, HttpCode, HttpStatus,
  Inject, NotFoundException, Post,
} from "@nestjs/common";
import { identity as C } from "@repo/contracts";
import {
  ExportDirectionForbiddenError,
  ExportPreviewRequiredError,
  NoOrgMembershipError,
} from "../../application/identity/errors";
import {
  exportToOrganization,
  previewExport,
  type ExportDeps,
} from "../../application/identity/export-to-organization";
import {
  LOCAL_EXPORT_REPOSITORY,
  type LocalExportRepository,
} from "../../application/identity/local-export-ports";
import {
  EGRESS_GUARD,
  EXPORT_TRANSPORT,
  type EgressGuard,
  type ExportTransport,
} from "../../application/identity/local-org-ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const PREVIEW_EXPORT_SCHEMA = C.operations.previewExport.in;
export const EXPORT_TO_ORGANIZATION_SCHEMA = C.operations.exportToOrganization.in;

type PreviewBody = { fromLocalOrgId: string; toOrgId: string; artifactIds: string[] };
type ExportBody = PreviewBody & { confirmedPreviewToken: string };

@Controller()
export class LocalExportController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(LOCAL_EXPORT_REPOSITORY) private readonly exports: LocalExportRepository,
    @Inject(EGRESS_GUARD) private readonly egress: EgressGuard,
    @Inject(EXPORT_TRANSPORT) private readonly transport: ExportTransport,
    // The export reads tenant content and shows titles back, so it goes through the guarded
    // read path like everything else -- and that path mints a decision id per item.
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  private get deps(): ExportDeps {
    return {
      repo: this.repo,
      ids: this.ids,
      exports: this.exports,
      egress: this.egress,
      transport: this.transport,
      now: () => Date.now(),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post("/identity/export/preview")
  async preview(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(PREVIEW_EXPORT_SCHEMA)) body: PreviewBody,
  ) {
    assertPrincipal(principal);
    try {
      return await previewExport(this.deps, {
        userId: principal.userId,
        fromLocalOrgId: toOrgId(body.fromLocalOrgId),
        toOrgId: toOrgId(body.toOrgId),
        artifactIds: body.artifactIds,
      });
    } catch (e) {
      throw translate(e);
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post("/identity/export")
  async export(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(EXPORT_TO_ORGANIZATION_SCHEMA)) body: ExportBody,
  ) {
    assertPrincipal(principal);
    try {
      return await exportToOrganization(this.deps, {
        userId: principal.userId,
        fromLocalOrgId: toOrgId(body.fromLocalOrgId),
        toOrgId: toOrgId(body.toOrgId),
        artifactIds: body.artifactIds,
        confirmedPreviewToken: body.confirmedPreviewToken,
      });
    } catch (e) {
      throw translate(e);
    }
  }
}

/**
 * One mapping for both routes.
 *
 * ⚠ Shared deliberately: the two operations declare overlapping `err` sets, and two copies
 * of this switch would be two places for "which status does EXPORT_DIRECTION_FORBIDDEN get"
 * to drift. The preview and the export must fail the SAME way for the same reason, or a
 * client learns to treat one as retryable and the other as not.
 */
function translate(e: unknown): unknown {
  if (e instanceof NoOrgMembershipError) return new NotFoundException();
  if (e instanceof ExportDirectionForbiddenError) {
    return new ForbiddenException({ reasonCode: "EXPORT_DIRECTION_FORBIDDEN" });
  }
  if (e instanceof ExportPreviewRequiredError) {
    return new ConflictException({ reasonCode: "EXPORT_PREVIEW_REQUIRED" });
  }
  // ⚠ `ExportItemNotApprovedError` / `ExportApertureClosedError` deliberately fall through to
  // a 500. They are not conditions a client can be in -- reaching them means our own code
  // tried to move something the human did not confirm, or used the aperture after it closed.
  // Giving them a wire code would dress a defect up as a handleable outcome.
  return e;
}
