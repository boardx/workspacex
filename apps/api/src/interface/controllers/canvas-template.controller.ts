/**
 * canvas 模板注册表的五条路由（#463）。协议适配，判断全在 `application`。
 *
 *   GET  /canvas/templates                     后台模板库 / 绑定选择器（共用一个端口，I-5）
 *   POST /canvas/templates/:key/publish        三段发布流程第三段（I-4）
 *   POST /canvas/templates/:key/trial          第二段
 *   POST /canvas/templates/:key/archive        O-10 归档（confirmed=false 为预检）
 *   POST /canvas/templates/:key/restore        恢复
 *
 * ## 🔴 这里**没有**创建模板的路由，而那不是遗漏
 *
 * 签核过的 `canvas.ts` 契约里没有创建操作：`publishTemplate.in` 是
 * `{key, version, visibility}`，不带 `displayName` / `sections` / `underlyingType`，
 * 且其 `err` 含 `TEMPLATE_NOT_FOUND` —— 它读一行已存在的，不造一行。#463 的范围描述里
 * 写了「创建」，但契约是单一事实源且已签核，所以缺口报上去，不在这里发明一条
 * `POST /canvas/templates`。见 `application/canvas/template-ports.ts` 的文件头。
 *
 * ## GET 也过契约校验
 *
 * 与 `project.controller.ts` 的 `listProjects` 同一条理由：跳过它，`GET /canvas/templates`
 * 就是唯一一个没有任何东西校验入参的 canvas 操作。查询串永远是字符串，而契约的
 * `forBinding` 是 `z.boolean()`，所以下面先把它翻成布尔再交给契约——
 * ⚠ 翻译只认 `"true"` / `"false"` 两个字面量，其余原样交给 zod 去拒。
 *   写成 `Boolean(raw)` 会让 `forBinding=false` 变成 true，而绑定选择器多显示几个
 *   归档模板不会有任何东西报警。
 *
 * ## 路径参数与 body 打架时拒绝
 *
 * 四条 POST 的契约 `in` 里都有 `key`，路径里也有。两者不一致时 400，不静默挑一个——
 * 同 `advanceAgendaSegment` 那条 `workshop_or_segment_id_mismatch`。
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { canvas as C } from "@repo/contracts";
import type { z } from "zod";
import { archiveTemplate } from "../../application/canvas/archive-template";
import { bindTemplateToSegment } from "../../application/canvas/bind-template-to-segment";
import {
  CanvasSegmentBindingExistsError,
  CanvasSegmentNotFoundError,
} from "../../application/canvas/segment-binding-errors";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import {
  CanvasError,
  CanvasIllegalTransitionError,
  CanvasPublishedVersionConflictError,
} from "../../application/canvas/errors";
import { listTemplates } from "../../application/canvas/list-templates";
import { publishTemplate } from "../../application/canvas/publish-template";
import { restoreTemplate } from "../../application/canvas/restore-template";
import {
  CANVAS_TEMPLATE_REPOSITORY,
  type CanvasTemplateRepository,
} from "../../application/canvas/template-ports";
import { trialTemplate } from "../../application/canvas/trial-template";
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

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const LIST_CANVAS_TEMPLATES_SCHEMA = C.operations.listTemplates.in;
export const PUBLISH_CANVAS_TEMPLATE_SCHEMA = C.operations.publishTemplate.in;
export const TRIAL_CANVAS_TEMPLATE_SCHEMA = C.operations.trialTemplate.in;
export const ARCHIVE_CANVAS_TEMPLATE_SCHEMA = C.operations.archiveTemplate.in;
export const RESTORE_CANVAS_TEMPLATE_SCHEMA = C.operations.restoreTemplate.in;
export const BIND_CANVAS_TEMPLATE_SCHEMA = C.operations.bindTemplateToSegment.in;

type PublishBody = z.infer<typeof C.operations.publishTemplate.in>;
type TrialBody = z.infer<typeof C.operations.trialTemplate.in>;
type ArchiveBody = z.infer<typeof C.operations.archiveTemplate.in>;
type RestoreBody = z.infer<typeof C.operations.restoreTemplate.in>;
type BindBody = z.infer<typeof C.operations.bindTemplateToSegment.in>;

/** 只认两个字面量，其余原样下传给 zod 拒绝 —— 见文件头。 */
function queryBoolean(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

@Controller()
export class CanvasTemplateController {
  constructor(
    @Inject(CANVAS_TEMPLATE_REPOSITORY) private readonly templates: CanvasTemplateRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
  ) {}

  @Get("/canvas/templates")
  async list(
    @Query("orgId") orgId: string | undefined,
    @Query("filter") filter: string | undefined,
    @Query("forBinding") forBinding: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(LIST_CANVAS_TEMPLATES_SCHEMA).transform({
      orgId,
      ...(filter === undefined ? {} : { filter }),
      ...(forBinding === undefined ? {} : { forBinding: queryBoolean(forBinding) }),
    }) as z.infer<typeof C.operations.listTemplates.in>;

    return this.run(async () => {
      const out = await listTemplates(
        { identity: this.identity, templates: this.templates, ids: this.decisions },
        {
          userId: principal.userId,
          orgId: toOrgId(input.orgId),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.forBinding === undefined ? {} : { forBinding: input.forBinding }),
        },
      );
      // 出门也过契约。全局 ValidationPipe 只校验进来的方向；没有这一句，服务端可以发出
      // 一个契约没描述的响应体而所有门控保持绿色 —— 前端的类型来自同一份契约，
      // 只是与现实不符（`contract-response.test.ts` 存在的原因）。
      return C.operations.listTemplates.out.parse(out);
    });
  }

  // ⚠ 200，不是 Nest 对 POST 的缺省 201。这四条都是**状态转移**，没有任何资源被创建——
  //   201 会让调用方（以及未来任何按状态码分支的客户端）以为发布/归档产生了一行新东西，
  //   而这个束里真正会创建行的操作在契约里根本不存在（见文件头）。
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/templates/:key/publish")
  async publish(
    @Param("key") key: string,
    @Body(new ZodBodyPipe(PUBLISH_CANVAS_TEMPLATE_SCHEMA)) body: PublishBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    return this.run(async () =>
      C.operations.publishTemplate.out.parse(
        await publishTemplate(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            version: body.version,
            visibility: body.visibility,
          },
        ),
      ),
    );
  }

  // ⚠ 200，不是 Nest 对 POST 的缺省 201。这四条都是**状态转移**，没有任何资源被创建——
  //   201 会让调用方（以及未来任何按状态码分支的客户端）以为发布/归档产生了一行新东西，
  //   而这个束里真正会创建行的操作在契约里根本不存在（见文件头）。
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/templates/:key/trial")
  async trial(
    @Param("key") key: string,
    @Body(new ZodBodyPipe(TRIAL_CANVAS_TEMPLATE_SCHEMA)) body: TrialBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    return this.run(async () =>
      C.operations.trialTemplate.out.parse(
        await trialTemplate(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            version: body.version,
            projectId: body.projectId,
          },
        ),
      ),
    );
  }

  // ⚠ 200，不是 Nest 对 POST 的缺省 201。这四条都是**状态转移**，没有任何资源被创建——
  //   201 会让调用方（以及未来任何按状态码分支的客户端）以为发布/归档产生了一行新东西，
  //   而这个束里真正会创建行的操作在契约里根本不存在（见文件头）。
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/templates/:key/archive")
  async archive(
    @Param("key") key: string,
    @Body(new ZodBodyPipe(ARCHIVE_CANVAS_TEMPLATE_SCHEMA)) body: ArchiveBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    return this.run(async () =>
      C.operations.archiveTemplate.out.parse(
        await archiveTemplate(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            version: body.version,
            confirmed: body.confirmed,
          },
        ),
      ),
    );
  }

  // ⚠ 200，不是 Nest 对 POST 的缺省 201。这四条都是**状态转移**，没有任何资源被创建——
  //   201 会让调用方（以及未来任何按状态码分支的客户端）以为发布/归档产生了一行新东西，
  //   而这个束里真正会创建行的操作在契约里根本不存在（见文件头）。
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/templates/:key/restore")
  async restore(
    @Param("key") key: string,
    @Body(new ZodBodyPipe(RESTORE_CANVAS_TEMPLATE_SCHEMA)) body: RestoreBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    return this.run(async () =>
      C.operations.restoreTemplate.out.parse(
        await restoreTemplate(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            version: body.version,
          },
        ),
      ),
    );
  }

  /**
   * #493 —— 把模板绑到议程环节。**这是本控制器唯一会创建一行的路由**，所以它也是唯一
   * 没有那条「200 不是 201」注释的：另外四条是状态转移，它不是。
   *
   * ⚠ 仍然回 200 而不是 201：契约的 `out` 是 `{bindingId, templateKey, boundTemplateVersion}`，
   *   没有 `Location`／资源自描述，201 会承诺一个本操作没有提供的东西。
   *
   * ⚠ 判定不在这里。控制器只做协议适配 + 一次路径/body 一致性检查。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/agenda-segments/:agendaSegmentId/template-bindings")
  async bindTemplate(
    @Param("agendaSegmentId") agendaSegmentId: string,
    @Body(new ZodBodyPipe(BIND_CANVAS_TEMPLATE_SCHEMA)) body: BindBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // 同 `assertKeyMatches` 的理由：两者不一致时 400，不静默挑一个。
    if (agendaSegmentId !== body.agendaSegmentId) {
      throw new BadRequestException("agenda_segment_id_mismatch");
    }
    return this.run(async () =>
      C.operations.bindTemplateToSegment.out.parse(
        await bindTemplateToSegment(
          {
            auth: { repo: this.identity, ids: this.decisions },
            templates: this.templates,
            // ⚠ 复用 `ID_FACTORY` 而不是在用例里 `randomUUID()`：id 要可预测才断言得了，
            //   同 `application/artifact/ports.ts` 的 `IdFactory` 文件头。
            newBindingId: () => this.ids.next("cvbind"),
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            agendaSegmentId: body.agendaSegmentId,
            templateKey: body.templateKey,
            templateVersion: body.templateVersion,
          },
        ),
      ),
    );
  }

  private assertKeyMatches(pathKey: string, bodyKey: string): void {
    if (pathKey !== bodyKey) throw new BadRequestException("template_key_mismatch");
  }

  /**
   * 应用层错误 → HTTP，**一处**。
   *
   * 五条路由共用一段映射而不是各写一个 `catch`：同一个 `reasonCode` 在两条路由上渲染成
   * 两个状态码，是「两个码长出两种响应形状」的第一步（见 `application/canvas/errors.ts`）。
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CanvasError) {
        if (e.reasonCode === "TEMPLATE_NOT_FOUND") {
          throw new NotFoundException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          // 503 而不是 403：判定服务不可用不是一个裁定。
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      if (e instanceof CanvasPublishedVersionConflictError) {
        // 裸 409，不带 reasonCode：`restoreTemplate.err` 里没有这个码，编一个最像的
        // 会让前端按一个契约里含义不同的码去分支。
        throw new ConflictException("published_version_exists");
      }
      if (e instanceof CanvasIllegalTransitionError) {
        throw new BadRequestException("illegal_template_transition");
      }
      // #493：两条都是**裸**状态码，不带 reasonCode —— 契约的
      // `bindTemplateToSegment.err` 里没有它们的码，见 `segment-binding-errors.ts` 文件头。
      if (e instanceof CanvasSegmentNotFoundError) {
        throw new NotFoundException("agenda_segment_not_found");
      }
      if (e instanceof CanvasSegmentBindingExistsError) {
        throw new ConflictException("segment_template_binding_exists");
      }
      throw e;
    }
  }
}
