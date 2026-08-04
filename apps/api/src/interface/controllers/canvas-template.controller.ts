/**
 * canvas 模板注册表的六条路由（#463 五条 + #496 一条）。协议适配，判断全在 `application`。
 *
 *   POST /canvas/templates                     🟡 造一行（#496，**该契约面待人类补签**）
 *   GET  /canvas/templates                     后台模板库 / 绑定选择器（共用一个端口，I-5）
 *   POST /canvas/templates/:key/publish        三段发布流程第三段（I-4）
 *   POST /canvas/templates/:key/trial          第二段
 *   POST /canvas/templates/:key/archive        O-10 归档（confirmed=false 为预检）
 *   POST /canvas/templates/:key/restore        恢复
 *
 * ## 🟡 `POST /canvas/templates` 是 #496 的 design-delta，尚未签核
 *
 * #463 时这段注释逐字写着「这里**没有**创建模板的路由，而那不是遗漏」——当时属实：签核过的
 * 契约里没有创建操作，于是核心闭环「新增可视化模板」这一步交付不出来。#496 由 coord-main
 * 在人类不在场时代裁「先做」并登记**待补签**，契约与本路由随之落地。人类回来后要么补签、
 * 要么推翻并回退。理由与边界见 `packages/contracts/src/canvas.ts` 的 `createTemplate` 文件头。
 *
 * ⚠ 这条路由**不是** upsert：它只造 `draft`，发布仍然只能走 `/publish`。把 publish 改成
 *   「不存在就创建」会让 `TEMPLATE_NOT_FOUND` 不可达，是契约自己点名要避免的形状。
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
import { createTemplate } from "../../application/canvas/create-template";
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
export const CREATE_CANVAS_TEMPLATE_SCHEMA = C.operations.createTemplate.in;
export const LIST_CANVAS_TEMPLATES_SCHEMA = C.operations.listTemplates.in;
export const PUBLISH_CANVAS_TEMPLATE_SCHEMA = C.operations.publishTemplate.in;
export const TRIAL_CANVAS_TEMPLATE_SCHEMA = C.operations.trialTemplate.in;
export const ARCHIVE_CANVAS_TEMPLATE_SCHEMA = C.operations.archiveTemplate.in;
export const RESTORE_CANVAS_TEMPLATE_SCHEMA = C.operations.restoreTemplate.in;

type CreateBody = z.infer<typeof C.operations.createTemplate.in>;
type PublishBody = z.infer<typeof C.operations.publishTemplate.in>;
type TrialBody = z.infer<typeof C.operations.trialTemplate.in>;
type ArchiveBody = z.infer<typeof C.operations.archiveTemplate.in>;
type RestoreBody = z.infer<typeof C.operations.restoreTemplate.in>;

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
  ) {}

  /**
   * 🟡 #496，**待人类补签**。
   *
   * ⚠ **201，而不是下面四条的 200**，且这个差别是有意义的：那四条是状态转移，没有任何
   *   资源被创建（它们的 `@HttpCode(200)` 注释逐字这么写，并附了一句「这个束里真正会创建行的
   *   操作在契约里根本不存在」——#496 之后那句不再成立，所以本条是 Nest 对 POST 的缺省 201，
   *   不加 `@HttpCode`）。一条真的造出资源的路由回 200，等于把「新建」与「改状态」在协议层
   *   抹平，而调用方**看得见**这个差别。
   *
   * ⚠ 组织取自会话主体，**不从请求体读**——契约 `createTemplate.in` 里没有 `orgId`，
   *   且它是 `.strict()`，所以塞一个进来是 400 而不是被悄悄用上。
   */
  @Post("/canvas/templates")
  async create(
    @Body(new ZodBodyPipe(CREATE_CANVAS_TEMPLATE_SCHEMA)) body: CreateBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    return this.run(async () =>
      // 出门也过契约的 `.strict()`：没有这一句，服务端可以发出一个契约没描述的响应体
      // 而所有门控保持绿色（`contract-response.test.ts` 存在的原因）。
      C.operations.createTemplate.out.parse(
        await createTemplate(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            displayName: body.displayName,
            underlyingType: body.underlyingType,
            sections: body.sections,
            visibility: body.visibility,
          },
        ),
      ),
    );
  }

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
        if (e.reasonCode === "TEMPLATE_KEY_CONFLICT") {
          // 409 而不是 403：key 被占用不是一次权限裁定。带 reasonCode——与下面那个裸 409
          // 不同，这个码**在 `createTemplate.err` 里**，所以前端按它分支是契约允许的。
          throw new ConflictException({ reasonCode: e.reasonCode });
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
      throw e;
    }
  }
}
