/**
 * 画布实例的五条路由（#1493 / UC-7.3 第一、二块）。协议适配，判定全在 `application`。
 *
 *   POST /canvas/agenda-segments/:agendaSegmentId/instances   现场实例化（幂等重放）
 *   GET  /canvas/instances/:instanceId/source                 [源码] 读取
 *   PUT  /canvas/instances/:instanceId/source                 源码手改（乐观并发）
 *   GET  /canvas/instances/:instanceId/render                 渲染面（第二块，I-8）
 *   POST /canvas/instances/:instanceId/export-source          几何归区导出（第二块，I-9）
 *   POST /canvas/instances/:instanceId/classify-change        判定表暴露（第三块，I-15/O-32）
 *   POST /canvas/instances/:instanceId/sticky-changes         便签级 LWW（第三块，D-09/I-19）
 *
 * ## 状态码映射（`run()` 一处，不各写 catch）
 *
 * · `INSTANCE_NOT_FOUND` → 404（不泄露「不存在」与「别的组织」的差别，契约文件头逐字要求）
 * · `VERSION_CHANGED`    → 409（乐观并发失败，E4）
 * · `NO_PROJECT_ROLE` / `NOT_IN_GROUP` / `ROLE_INSUFFICIENT` → 403
 * · `DEPENDENCY_UNAVAILABLE` → 503
 * · 环节不存在（instantiate）→ 裸 404（契约 `instantiateForSegment.err` 里没有码，
 *   同 `canvas-template.controller.ts` 对 `CanvasSegmentNotFoundError` 的处置）
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { canvas as C } from "@repo/contracts";
import type { z } from "zod";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import { applyStickyChange } from "../../application/canvas/apply-sticky-change";
import { classifyCanvasChange } from "../../application/canvas/classify-canvas-change";
import {
  CanvasError,
  CanvasStickyNotFoundError,
  CanvasUnknownSectionError,
  CanvasUnknownStickyColorError,
} from "../../application/canvas/errors";
import { exportCanvasSource } from "../../application/canvas/export-canvas-source";
import { getCanvasSource } from "../../application/canvas/get-canvas-source";
import { renderCanvas } from "../../application/canvas/render-canvas";
import {
  CANVAS_INSTANCE_REPOSITORY,
  type CanvasInstanceRepository,
} from "../../application/canvas/instance-ports";
import { instantiateCanvasesForSegment } from "../../application/canvas/instantiate-canvases-for-segment";
import { CanvasSegmentNotFoundError } from "../../application/canvas/segment-binding-errors";
import {
  CANVAS_TEMPLATE_REPOSITORY,
  type CanvasTemplateRepository,
} from "../../application/canvas/template-ports";
import { updateCanvasSource } from "../../application/canvas/update-canvas-source";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 contract-single-source 类测试断言与契约是**同一个对象**而非长得像。 */
export const INSTANTIATE_FOR_SEGMENT_SCHEMA = C.operations.instantiateForSegment.in;
export const GET_CANVAS_SOURCE_SCHEMA = C.operations.getSource.in;
export const UPDATE_CANVAS_SOURCE_SCHEMA = C.operations.updateSource.in;
export const RENDER_CANVAS_SCHEMA = C.operations.renderCanvas.in;
export const EXPORT_CANVAS_SOURCE_SCHEMA = C.operations.exportSource.in;
export const CLASSIFY_CHANGE_SCHEMA = C.operations.classifyChange.in;
export const APPLY_STICKY_CHANGE_SCHEMA = C.operations.applyStickyChange.in;

type InstantiateBody = z.infer<typeof C.operations.instantiateForSegment.in>;
type UpdateSourceBody = z.infer<typeof C.operations.updateSource.in>;
type ExportSourceBody = z.infer<typeof C.operations.exportSource.in>;
type ClassifyChangeBody = z.infer<typeof C.operations.classifyChange.in>;
type ApplyStickyChangeBody = z.infer<typeof C.operations.applyStickyChange.in>;

@Controller()
export class CanvasInstanceController {
  constructor(
    @Inject(CANVAS_INSTANCE_REPOSITORY) private readonly instances: CanvasInstanceRepository,
    @Inject(CANVAS_TEMPLATE_REPOSITORY) private readonly templates: CanvasTemplateRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
  ) {}

  /**
   * ⚠ 200 而不是 Nest 对 POST 的缺省 201：幂等重放（同 key 第二次调用）**不创建**任何
   *   资源，而两次调用必须逐字节同响应——同一条路由按「这次真建了吗」切状态码，
   *   调用方就得实现两套分支。契约 out 里也没有 Location/资源自描述（同 `bindTemplate`
   *   回 200 的理由）。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/agenda-segments/:agendaSegmentId/instances")
  async instantiate(
    @Param("agendaSegmentId") agendaSegmentId: string,
    @Body(new ZodBodyPipe(INSTANTIATE_FOR_SEGMENT_SCHEMA)) body: InstantiateBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // 路径参数与 body 打架时拒绝，不静默挑一个（同 `bindTemplate`）。
    if (agendaSegmentId !== body.agendaSegmentId) {
      throw new BadRequestException("agenda_segment_id_mismatch");
    }
    return this.run(async () =>
      C.operations.instantiateForSegment.out.parse(
        await instantiateCanvasesForSegment(
          {
            auth: { repo: this.identity, ids: this.decisions },
            templates: this.templates,
            instances: this.instances,
            newId: (prefix) => this.ids.next(prefix),
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            agendaSegmentId: body.agendaSegmentId,
            groupIds: body.groupIds,
            idempotencyKey: body.idempotencyKey,
          },
        ),
      ),
    );
  }

  @Get("/canvas/instances/:instanceId/source")
  async getSource(
    @Param("instanceId") instanceId: string,
    @Query("versionId") versionId: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // GET 也过契约校验（同 `canvas-template.controller.ts` 的 list）。
    const input = new ZodBodyPipe(GET_CANVAS_SOURCE_SCHEMA).transform({
      instanceId,
      ...(versionId === undefined ? {} : { versionId }),
    }) as z.infer<typeof C.operations.getSource.in>;

    return this.run(async () =>
      C.operations.getSource.out.parse(
        await getCanvasSource(
          {
            auth: { repo: this.identity, ids: this.decisions },
            instances: this.instances,
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            instanceId: input.instanceId,
            ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
          },
        ),
      ),
    );
  }

  @Put("/canvas/instances/:instanceId/source")
  async updateSource(
    @Param("instanceId") instanceId: string,
    @Body(new ZodBodyPipe(UPDATE_CANVAS_SOURCE_SCHEMA)) body: UpdateSourceBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    if (instanceId !== body.instanceId) {
      throw new BadRequestException("instance_id_mismatch");
    }
    return this.run(async () =>
      C.operations.updateSource.out.parse(
        await updateCanvasSource(
          {
            identity: this.identity,
            instances: this.instances,
            newVersionId: () => this.ids.next("cvver"),
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            instanceId: body.instanceId,
            markdown: body.markdown,
            expectedHeadVersion: body.expectedHeadVersion,
          },
        ),
      ),
    );
  }

  @Get("/canvas/instances/:instanceId/render")
  async render(
    @Param("instanceId") instanceId: string,
    @Query("versionId") versionId: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // GET 也过契约校验（同 getSource）。
    const input = new ZodBodyPipe(RENDER_CANVAS_SCHEMA).transform({
      instanceId,
      ...(versionId === undefined ? {} : { versionId }),
    }) as z.infer<typeof C.operations.renderCanvas.in>;

    return this.run(async () =>
      C.operations.renderCanvas.out.parse(
        await renderCanvas(
          {
            auth: { repo: this.identity, ids: this.decisions },
            instances: this.instances,
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            instanceId: input.instanceId,
            ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
          },
        ),
      ),
    );
  }

  /**
   * ⚠ 200 而不是 POST 缺省 201：导出不创建任何资源（out 里没有版本推进，
   *   写回是调用方拿着结果再走 updateSource）——同 instantiate 回 200 的理由。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/instances/:instanceId/export-source")
  async exportSource(
    @Param("instanceId") instanceId: string,
    @Body(new ZodBodyPipe(EXPORT_CANVAS_SOURCE_SCHEMA)) body: ExportSourceBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    if (instanceId !== body.instanceId) {
      throw new BadRequestException("instance_id_mismatch");
    }
    return this.run(async () =>
      C.operations.exportSource.out.parse(
        await exportCanvasSource(
          {
            identity: this.identity,
            instances: this.instances,
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            instanceId: body.instanceId,
            stickyPositions: body.stickyPositions,
          },
        ),
      ),
    );
  }

  /**
   * ⚠ 200 而不是 POST 缺省 201：归类是纯判定，不创建任何资源（同 exportSource 的理由）。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/instances/:instanceId/classify-change")
  async classifyChange(
    @Param("instanceId") instanceId: string,
    @Body(new ZodBodyPipe(CLASSIFY_CHANGE_SCHEMA)) body: ClassifyChangeBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    if (instanceId !== body.instanceId) {
      throw new BadRequestException("instance_id_mismatch");
    }
    return this.run(async () =>
      C.operations.classifyChange.out.parse(
        await classifyCanvasChange(
          { instances: this.instances },
          {
            orgId: principal.orgId,
            instanceId: body.instanceId,
            changeKind: body.change.kind,
          },
        ),
      ),
    );
  }

  /**
   * ⚠ 200 而不是 POST 缺省 201：LWW 覆盖语义下同一张便签被反复写，out 里没有可寻址的
   *   新资源自描述（修订 id 只在 `supersededRevisionId` 回查链里出现）——同上理由。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/instances/:instanceId/sticky-changes")
  async applyStickyChange(
    @Param("instanceId") instanceId: string,
    @Body(new ZodBodyPipe(APPLY_STICKY_CHANGE_SCHEMA)) body: ApplyStickyChangeBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    if (instanceId !== body.instanceId) {
      throw new BadRequestException("instance_id_mismatch");
    }
    return this.run(async () =>
      C.operations.applyStickyChange.out.parse(
        await applyStickyChange(
          {
            identity: this.identity,
            instances: this.instances,
            newVersionId: () => this.ids.next("cvver"),
            newRevisionId: () => this.ids.next("cvrev"),
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            instanceId: body.instanceId,
            stickyId: body.stickyId,
            patch: body.patch,
            clientTs: body.clientTs,
          },
        ),
      ),
    );
  }

  /** 应用层错误 → HTTP，一处（见文件头映射表）。 */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CanvasError) {
        if (e.reasonCode === "INSTANCE_NOT_FOUND") {
          throw new NotFoundException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "VERSION_CHANGED") {
          throw new ConflictException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        // NO_PROJECT_ROLE / NOT_IN_GROUP / ROLE_INSUFFICIENT —— 都是权限裁定。
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      if (e instanceof CanvasSegmentNotFoundError) {
        throw new NotFoundException("agenda_segment_not_found");
      }
      // ── 第三块的三个契约缺口出口（errors.ts 各类文件注释里论证）：裸码，不借契约码 ──
      if (e instanceof CanvasStickyNotFoundError) {
        throw new NotFoundException("sticky_not_found");
      }
      if (e instanceof CanvasUnknownStickyColorError) {
        throw new BadRequestException("unknown_sticky_color");
      }
      if (e instanceof CanvasUnknownSectionError) {
        throw new BadRequestException("unknown_target_section");
      }
      throw e;
    }
  }
}
