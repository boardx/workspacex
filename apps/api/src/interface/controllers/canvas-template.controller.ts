/**
 * canvas 模板注册表的七条路由（#463 五条 + #493 一条 + #496 一条）。
 * 协议适配，判断全在 `application`。
 *
 *   POST /canvas/templates                     造一行（#496 → #988，已签核）
 *   POST /canvas/templates/suggestions         AI 提议分区名，只读不落库（2026-08-23，待补签）
 *   POST /canvas/templates/:key/draft          原地改写仍是 draft 的版本（2026-08-23，待补签）
 *   GET  /canvas/templates                     后台模板库 / 绑定选择器（共用一个端口，I-5）
 *   POST /canvas/templates/:key/publish        三段发布流程第三段（I-4）
 *   POST /canvas/templates/:key/trial          第二段
 *   POST /canvas/templates/:key/archive        O-10 归档（confirmed=false 为预检）
 *   POST /canvas/templates/:key/restore        恢复
 *   POST /canvas/templates/:key/versions       基于既有模板开新版（#988，本束「编辑」的语义）
 *   POST /canvas/agenda-segments/:id/template-bindings   环节绑定（#493，F102）
 *
 * ⚠ 上面这张表是**手写**的，会与真实路由漂移：#493 加了第六条却没更新它，本次 merge 时
 *   补上（那不是 #496 的改动，是顺手修一处会误导下一个人的注释）。
 *
 * ## `POST /canvas/templates` 与 `POST /canvas/templates/:key/versions` 已由人类签核
 *
 * #463 时这段注释逐字写着「这里**没有**创建模板的路由，而那不是遗漏」——当时属实：签核过的
 * 契约里没有创建操作，于是核心闭环「新增可视化模板」这一步交付不出来。#496 由 coord-main
 * 在人类不在场时代裁「先做」并登记**待补签**，契约与本路由随之落地；2026-08-17 人类在 #988
 * 补签确认，两条路由均已是签核过的契约面（见 `packages/contracts/src/canvas.ts` 对应操作
 * 的文件头）。
 *
 * ⚠ 这两条路由**都不是** upsert：`createTemplate` 只造 `draft` v1，`mintTemplateVersion`
 *   只造 `draft` vN（N = 该 key 当前最大版本 + 1）。发布仍然只能走 `/publish`。把 publish
 *   改成「不存在就创建」会让 `TEMPLATE_NOT_FOUND` 不可达，是契约自己点名要避免的形状。
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
import { createTemplate } from "../../application/canvas/create-template";
import { mintTemplateVersion } from "../../application/canvas/mint-template-version";
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
import { suggestTemplateSections } from "../../application/canvas/suggest-template-sections";
import { updateTemplateDraft } from "../../application/canvas/update-template-draft";
import { updateTemplateMetadata } from "../../application/canvas/update-template-metadata";
import {
  CANVAS_TEMPLATE_REPOSITORY,
  type CanvasTemplateRepository,
} from "../../application/canvas/template-ports";
import { trialTemplate } from "../../application/canvas/trial-template";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
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
export const BIND_CANVAS_TEMPLATE_SCHEMA = C.operations.bindTemplateToSegment.in;
export const MINT_CANVAS_TEMPLATE_VERSION_SCHEMA = C.operations.mintTemplateVersion.in;
export const SUGGEST_TEMPLATE_SECTIONS_SCHEMA = C.operations.suggestTemplateSections.in;
export const UPDATE_TEMPLATE_DRAFT_SCHEMA = C.operations.updateTemplateDraft.in;
export const UPDATE_TEMPLATE_METADATA_SCHEMA = C.operations.updateTemplateMetadata.in;

type CreateBody = z.infer<typeof C.operations.createTemplate.in>;
type SuggestSectionsBody = z.infer<typeof C.operations.suggestTemplateSections.in>;
type UpdateDraftBody = z.infer<typeof C.operations.updateTemplateDraft.in>;
type UpdateMetadataBody = z.infer<typeof C.operations.updateTemplateMetadata.in>;
type PublishBody = z.infer<typeof C.operations.publishTemplate.in>;
type TrialBody = z.infer<typeof C.operations.trialTemplate.in>;
type ArchiveBody = z.infer<typeof C.operations.archiveTemplate.in>;
type RestoreBody = z.infer<typeof C.operations.restoreTemplate.in>;
type BindBody = z.infer<typeof C.operations.bindTemplateToSegment.in>;
type MintVersionBody = z.infer<typeof C.operations.mintTemplateVersion.in>;

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
    @Inject(MODEL_CALL_PORT) private readonly model: ModelCallPort,
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
            tags: body.tags,
          },
        ),
      ),
    );
  }

  /**
   * 🟡 2026-08-23，**待人类补签**（同 `create()` 一样的先例）。只读——见用例文件头
   * 「为什么不直接写库」。**200**，不是 201：没有任何资源被创建。
   */
  @Post("/canvas/templates/suggestions")
  @HttpCode(HttpStatus.OK)
  async suggestSections(
    @Body(new ZodBodyPipe(SUGGEST_TEMPLATE_SECTIONS_SCHEMA)) body: SuggestSectionsBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    return this.run(async () =>
      C.operations.suggestTemplateSections.out.parse(
        await suggestTemplateSections(
          { identity: this.identity, model: this.model },
          { userId: principal.userId, orgId: principal.orgId, prompt: body.prompt },
        ),
      ),
    );
  }

  /**
   * 🟡 2026-08-23，**待人类补签**——全量替换一个仍是 `draft` 的版本的内容。**200**，
   * 不是 201：没有新资源被创建，写的是已存在的那一行（同下面四条状态转移一样）。
   */
  @Post("/canvas/templates/:key/draft")
  @HttpCode(HttpStatus.OK)
  async updateDraft(
    @Param("key") key: string,
    @Body(new ZodBodyPipe(UPDATE_TEMPLATE_DRAFT_SCHEMA)) body: UpdateDraftBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    return this.run(async () =>
      C.operations.updateTemplateDraft.out.parse(
        await updateTemplateDraft(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            version: body.version,
            displayName: body.displayName,
            sections: body.sections,
            visibility: body.visibility,
            tags: body.tags,
          },
        ),
      ),
    );
  }

  /**
   * 🟡 2026-08-25，**待人类补签**（R2）——原地改写 `displayName`/`tags`，**任意状态**
   * 均可（不像 `updateDraft` 限定 draft）。**200**：没有新资源被创建。
   */
  @Post("/canvas/templates/:key/:version/metadata")
  @HttpCode(HttpStatus.OK)
  async updateMetadata(
    @Param("key") key: string,
    @Param("version") versionParam: string,
    @Body(new ZodBodyPipe(UPDATE_TEMPLATE_METADATA_SCHEMA)) body: UpdateMetadataBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    // 同 `bindTemplate` 的 `agendaSegmentId` 一致性检查：路径与 body 各带一份 version，
    // 不一致时 400，不静默挑一个——`ZodBodyPipe` 校验不了跨字段一致性。
    if (Number(versionParam) !== body.version) {
      throw new BadRequestException("template_version_mismatch");
    }
    return this.run(async () =>
      C.operations.updateTemplateMetadata.out.parse(
        await updateTemplateMetadata(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            version: body.version,
            displayName: body.displayName,
            tags: body.tags,
            // ⚠ 这里逐字段透传，漏一个**不会报错**：请求体合法（`.strict()` 只挡多余的键，
            //   不挡少传的可选键）、服务端存默认值、前端显示的是本地 state ——三处都
            //   "看起来对"。`tags` 就是这么被静默丢掉过一次，只有真栈 e2e 才发现。
            title: body.title,
            footer: body.footer,
          },
        ),
      ),
    );
  }

  /**
   * 「基于既有模板开新版」（#988，本束「编辑」的语义）。**201**，同 `create()` 的理由：
   * 这条真的造出一行新纪录（一个新 `draft` 版本），不是状态转移。
   *
   * ⚠ `ownerTeamId` 的「team-only 需要归属团队」判定**不在**这层，也不在 `ZodBodyPipe`：
   *   请求体几乎总不带这个字段（没有前端团队选择器），真正的值要等 `mintTemplateVersion`
   *   用例里解出调用者自己的团队后才知道。`run()` 把用例抛出的
   *   `TEAM_REQUIRED_FOR_TEAM_ONLY` 映射成 400（见下方）。
   */
  @Post("/canvas/templates/:key/versions")
  async mintVersion(
    @Param("key") key: string,
    @Body(new ZodBodyPipe(MINT_CANVAS_TEMPLATE_VERSION_SCHEMA)) body: MintVersionBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    this.assertKeyMatches(key, body.key);
    return this.run(async () =>
      C.operations.mintTemplateVersion.out.parse(
        await mintTemplateVersion(
          { identity: this.identity, templates: this.templates },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            key: body.key,
            displayName: body.displayName,
            underlyingType: body.underlyingType,
            sections: body.sections,
            visibility: body.visibility,
            ownerTeamId: body.ownerTeamId,
            tags: body.tags,
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
        if (e.reasonCode === "TEMPLATE_KEY_CONFLICT") {
          // 409 而不是 403：key 被占用不是一次权限裁定。带 reasonCode——与下面那个裸 409
          // 不同，这个码**在 `createTemplate.err` 里**，所以前端按它分支是契约允许的。
          throw new ConflictException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          // 503 而不是 403：判定服务不可用不是一个裁定。
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "TEMPLATE_SUGGESTION_UNAVAILABLE") {
          // 503 同上一条——模型调用失败/输出解析不出来，都不是权限裁定。
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "TEMPLATE_NOT_DRAFT") {
          // 409 而不是 403：目标版本已发布/已归档，这是状态冲突，不是权限裁定——
          // 同 `TEMPLATE_KEY_CONFLICT` 用 409 的理由同型。
          throw new ConflictException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "TEAM_REQUIRED_FOR_TEAM_ONLY") {
          // 400 而不是 403：这是请求本身缺了一个必要条件（归属团队），不是权限裁定——
          // 与 `TEMPLATE_KEY_CONFLICT` 用 409 而不是 403 的理由同型（见 `errors.ts`）。
          throw new BadRequestException({ reasonCode: e.reasonCode });
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
