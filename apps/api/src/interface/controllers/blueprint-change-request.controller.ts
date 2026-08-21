/**
 * `templates.computeDeviations` + `templates.submitBlueprintChangeRequest` 控制器
 * （F29 补实现 / issue #1667）——本仓第一条把这两个纯用例接上电的 HTTP 路由。
 *
 *   GET  /projects/:projectId/blueprint-deviations         computeDeviations
 *   POST /projects/:projectId/blueprint-change-requests     submitBlueprintChangeRequest
 *
 * `submitBlueprintChangeRequest` 的契约 `in` 只有 `{projectId, selections}`——没有
 * `blueprintId`/`baseVersionId`/`deviations`。这三样是「提交」这一步真正依赖但
 * 契约没有要求调用方传的东西，本控制器在提交前**内部先跑一次** `computeDeviations`
 * 拿到它们，同一次请求里两个用例串行调用（不是让前端先 GET 再把结果整个搬进
 * POST body——那样一次「偏离清单在两次请求之间被别人改动」的竞态就有了可乘之机，
 * 服务端自己重新算一遍更安全，也更贴合契约字面：POST 只收 `selections`）。
 *
 * ⚠ `findCurrentProjectContent` 今天诚实只对 `flow-agenda` 一项有真实数据源
 *   （见 `pg-compute-deviations-repository.ts` 头注）——其余各项恒无偏离，
 *   这是当前项目侧配置编辑路径尚未落地的诚实反映，不是本 controller 的缺陷。
 */
import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Body,
  Param,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { templates as C } from "@repo/contracts";
import type { z } from "zod";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { CurrentPrincipal } from "../current-principal.decorator";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId, type OrgId } from "../../domain/org-id";
import { computeDeviationsUseCase, ComputeDeviationsError } from "../../application/templates/compute-deviations";
import {
  COMPUTE_DEVIATIONS_REPOSITORY,
  type ComputeDeviationsRepository,
} from "../../application/templates/compute-deviations-ports";
import {
  submitBlueprintChangeRequestUseCase,
  SubmitChangeRequestError,
} from "../../application/templates/submit-blueprint-change-request";
import {
  SUBMIT_CHANGE_REQUEST_REPOSITORY,
  type SubmitChangeRequestRepository,
} from "../../application/templates/submit-change-request-ports";
import {
  LIST_PENDING_CHANGES_REPOSITORY,
  type ListPendingChangesRepository,
} from "../../application/templates/list-pending-changes-ports";
import { siblingsOnSameKey } from "../../domain/templates/pending-change";
import { IDENTITY_REPOSITORY } from "../../application/identity/ports";
import type { IdentityRepository } from "../../application/identity/ports";
import { ID_FACTORY } from "../../application/artifact/ports";
import type { IdFactory } from "../../application/artifact/ports";

const SUBMIT_BODY_SCHEMA = C.operations.submitBlueprintChangeRequest.in.omit({ projectId: true });
type SubmitBody = z.infer<typeof SUBMIT_BODY_SCHEMA>;

@Controller()
export class BlueprintChangeRequestController {
  constructor(
    @Inject(COMPUTE_DEVIATIONS_REPOSITORY) private readonly deviationsRepo: ComputeDeviationsRepository,
    @Inject(SUBMIT_CHANGE_REQUEST_REPOSITORY) private readonly submitRepo: SubmitChangeRequestRepository,
    @Inject(LIST_PENDING_CHANGES_REPOSITORY) private readonly listRepo: ListPendingChangesRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
  ) {}

  /**
   * `templates.listPendingChanges`（F29 补实现 / #1667）——本仓第一次能把「提交回蓝本」
   * 写进去的记录真实读回来。权限门槛用契约字面的 `NO_ORG_ROLE`（同组织任意角色可看，
   * 「谁能合并」是另一条更窄的门，属 `mergePendingChange`，本 feature 不实现那个 controller）。
   */
  @Get("/blueprints/:blueprintId/pending-changes")
  async list(@Param("blueprintId") blueprintId: string, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);

    let membership;
    try {
      membership = await this.identity.findOrgMembership(principal.userId, orgId);
    } catch {
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_ROLE" });

    const all = await this.listRepo.list(orgId, blueprintId);
    // 契约 `ChangeRequest` 是 `.strict()` 的四要素形状，不含 `status`（那是本域内部
    // 的生命周期字段，见 `pending-change.ts` 头注「PendingChangeRecord = ChangeRequest +
    // status」）——出门前剥掉，不把内部字段泄漏进响应体。
    const strip = (r: (typeof all)[number]) => {
      const { status: _status, ...rest } = r;
      return rest;
    };
    return all.map((r) => ({
      changeRequest: strip(r),
      siblingsOnSameKey: siblingsOnSameKey(r, all).map(strip),
    }));
  }

  @Get("/projects/:projectId/blueprint-deviations")
  async computeDeviations(@Param("projectId") projectId: string, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const actorProjectRole = await this.resolveProjectRole(principal.userId, projectId, orgId);

    try {
      return await computeDeviationsUseCase(
        { repo: this.deviationsRepo },
        { orgId, projectId, actorProjectRole },
      );
    } catch (e) {
      throw this.mapComputeError(e);
    }
  }

  @Post("/projects/:projectId/blueprint-change-requests")
  async submit(
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(SUBMIT_BODY_SCHEMA)) body: SubmitBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const actorProjectRole = await this.resolveProjectRole(principal.userId, projectId, orgId);

    let deviationsOut;
    try {
      deviationsOut = await computeDeviationsUseCase(
        { repo: this.deviationsRepo },
        { orgId, projectId, actorProjectRole },
      );
    } catch (e) {
      throw this.mapComputeError(e);
    }

    try {
      return await submitBlueprintChangeRequestUseCase(
        {
          repo: this.submitRepo,
          ids: { next: () => this.ids.next("chreq") },
          clock: { now: () => new Date().toISOString() },
        },
        {
          orgId,
          actorProjectRole,
          actorId: principal.userId,
          projectId,
          blueprintId: (await this.deviationsRepo.findProjectBinding(orgId, projectId))?.blueprintId ?? "",
          baseVersionId: deviationsOut.baseVersionId,
          deviations: deviationsOut.deviations,
          selections: body.selections,
        },
      );
    } catch (e) {
      if (!(e instanceof SubmitChangeRequestError)) throw e;
      switch (e.reasonCode) {
        case "NO_PROJECT_ROLE":
        case "ROLE_INSUFFICIENT":
          throw new ForbiddenException({ reasonCode: e.reasonCode });
        case "RATIONALE_REQUIRED":
          throw new BadRequestException({ reasonCode: e.reasonCode });
        case "VERSION_CHANGED":
          throw new ConflictException({ reasonCode: e.reasonCode });
        case "DEPENDENCY_UNAVAILABLE":
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        default:
          throw new UnprocessableEntityException({ reasonCode: e.reasonCode });
      }
    }
  }

  private async resolveProjectRole(userId: string, projectId: string, orgId: OrgId) {
    try {
      const membership = await this.identity.findProjectMembership(userId, projectId, orgId);
      return membership?.projectRole ?? null;
    } catch {
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
  }

  private mapComputeError(e: unknown): Error {
    // 非本域错误原样冒泡（同 `all-exceptions.filter.ts` 的既有兜底逻辑，接口层
    // 不拼错误文本进响应——`lint-error-leak.mjs` 逐字禁止 `String(err)` 这类写法）。
    if (!(e instanceof ComputeDeviationsError)) {
      return e instanceof Error ? e : new Error("computeDeviations: non-Error value thrown");
    }
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE":
      case "ROLE_INSUFFICIENT":
        return new ForbiddenException({ reasonCode: e.reasonCode });
      case "NO_DEVIATIONS":
        return new UnprocessableEntityException({ reasonCode: e.reasonCode });
      case "DEPENDENCY_UNAVAILABLE":
        return new ServiceUnavailableException({ reasonCode: e.reasonCode });
      default:
        return new BadRequestException({ reasonCode: e.reasonCode });
    }
  }
}
