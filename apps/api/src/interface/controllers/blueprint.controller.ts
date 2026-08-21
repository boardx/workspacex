/**
 * 蓝本控制器（F175 / BP-01）——本束**第一条**接上电的 HTTP 路由。
 *
 *   POST /blueprints   createBlueprint（origin = blank / copy）
 *   GET  /blueprints   listBlueprints
 *
 * ## 这个文件为什么现在才出现
 *
 * templates 束此前是「契约 34 个 operation + 应用层 32 个纯用例，**零控制器、零表、零仓储**」
 * （#991 勘探）。领域与编排早写好了，只是没有任何人能调到它。本文件补的是那一层。
 *
 * ## `origin = reverse-from-project` 为什么被拒绝，以及为什么用这个码
 *
 * 反向生成要求调用方**先算出**「项目 → 设计环节」的映射（纯用例
 * `planReverseFromProject` 的入参 `mappedFacets`），而那个映射是 **AI 抽取**——
 * 契约 `createBlueprint.out.machineGenerated` 那句「AI 产出必须被标识」指的就是它。
 * 全仓没有任何实现。
 *
 * 于是三种做法里：
 * · 静默降级成空白蓝本 —— 用户以为反向生成成功了，拿到一个空壳。**最坏**。
 * · 新造一个错误码 —— 那是新增设计面，要走 delta 重签（本 feature 明确不做）。
 * · 用契约既有的 `DEPENDENCY_UNAVAILABLE` + detail 写明原因 —— **本版采用**。
 *
 * ⚠ 这个码的字面是「依赖不可用」，而这里的事实是「依赖尚未接入」。两者不完全等同，
 *   所以 detail 必须说人话，不能只回一个码让人以为是临时故障。这条口径上的凑合
 *   已登记为待补缺口，将来与其它 templates 契约变更攒批走 delta。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
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
import { createBlueprint } from "../../application/templates/create-blueprint";
import { getInitializationPreview } from "../../application/templates/get-initialization-preview";
import {
  BLUEPRINT_PERSISTENCE_PORT,
  type BlueprintPersistencePort,
} from "../../application/templates/blueprint-persistence-ports";
import {
  DESIGN_FACET_DEFINITIONS,
  designFacetKeys,
} from "../../domain/templates/design-facet-table";
import { IDENTITY_REPOSITORY } from "../../application/identity/ports";
import type { IdentityRepository } from "../../application/identity/ports";
import { ID_FACTORY } from "../../application/artifact/ports";
import type { IdFactory } from "../../application/artifact/ports";
import { canMutateCapabilities, decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import { discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { Put, Param } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import { designFacetKeys as designFacetKeySet } from "../../domain/templates/design-facet-table";
// F950（2026-08-16 delta）：定题/分组/筹备计数——F24/F25 签的契约第一次接上真实 Postgres。
import { getProjectPrepUseCase, GetProjectPrepError } from "../../application/templates/get-project-prep";
import { PROJECT_PREP_REPOSITORY, type ProjectPrepRepository } from "../../application/templates/project-prep-ports";
import { getProjectTopicUseCase, GetProjectTopicError } from "../../application/templates/get-project-topic";
import { saveAndSyncTopicUseCase, SaveAndSyncTopicError } from "../../application/templates/save-and-sync-topic";
import {
  PROJECT_TOPIC_REPOSITORY,
  type ProjectTopicRepository,
} from "../../application/templates/save-and-sync-topic-ports";
import { getProjectGroupingUseCase, GetProjectGroupingError } from "../../application/templates/get-project-grouping";
import { getViewerOptionsUseCase, GetViewerOptionsError } from "../../application/live-collab/get-viewer-options";
import { updateGroupingUseCase, UpdateGroupingError } from "../../application/templates/update-grouping";
import { GROUPING_REPOSITORY, type GroupingRepository } from "../../application/templates/grouping-ports";
import type { ProjectRole } from "../../domain/identity/roles";
import {
  updateInterviewSubjectsUseCase,
  UpdateInterviewSubjectsError,
} from "../../application/templates/update-interview-subjects";
import { getInterviewSubjectsUseCase, GetInterviewSubjectsError } from "../../application/templates/get-interview-subjects";
import { INTERVIEW_SUBJECTS_REPOSITORY, type InterviewSubjectsRepository } from "../../application/templates/interview-subjects-ports";

const CREATE_SCHEMA = C.operations.createBlueprint.in;
type CreateBody = z.infer<typeof CREATE_SCHEMA>;
type BlueprintState = z.infer<typeof C.BlueprintState>;
const UPDATE_FACET_BODY_SCHEMA = C.operations.updateDesignFacet.in.omit({ blueprintId: true, designFacetKey: true });
type UpdateFacetBody = z.infer<typeof UPDATE_FACET_BODY_SCHEMA>;
const SET_DURATION_TIER_BODY_SCHEMA = C.operations.setDurationTier.in.omit({ blueprintId: true });
type SetDurationTierBody = z.infer<typeof SET_DURATION_TIER_BODY_SCHEMA>;
const START_TRIAL_RUN_BODY_SCHEMA = C.operations.startTrialRun.in.omit({ blueprintId: true });
type StartTrialRunBody = z.infer<typeof START_TRIAL_RUN_BODY_SCHEMA>;
const PUBLISH_VERSION_BODY_SCHEMA = C.operations.publishBlueprintVersion.in.omit({ blueprintId: true });
type PublishVersionBody = z.infer<typeof PUBLISH_VERSION_BODY_SCHEMA>;
const UPDATE_INTERVIEW_SUBJECTS_BODY_SCHEMA = C.operations.updateInterviewSubjects.in.omit({
  projectId: true,
  groupId: true,
});
type UpdateInterviewSubjectsBody = z.infer<typeof UPDATE_INTERVIEW_SUBJECTS_BODY_SCHEMA>;

@Controller()
export class BlueprintController {
  constructor(
    @Inject(BLUEPRINT_PERSISTENCE_PORT) private readonly repo: BlueprintPersistencePort,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
    @Inject(PROJECT_PREP_REPOSITORY) private readonly prepRepo: ProjectPrepRepository,
    @Inject(PROJECT_TOPIC_REPOSITORY) private readonly topicRepo: ProjectTopicRepository,
    @Inject(GROUPING_REPOSITORY) private readonly groupingRepo: GroupingRepository,
    @Inject(INTERVIEW_SUBJECTS_REPOSITORY) private readonly interviewSubjects: InterviewSubjectsRepository,
  ) {}

  @Post("/blueprints")
  async create(
    @Body(new ZodBodyPipe(CREATE_SCHEMA)) body: CreateBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(body.orgId);
    await this.requireCapabilityAdmin(orgId, principal.userId);

    if (body.origin === "reverse-from-project") {
      // 见文件头注：不静默降级、不新造码。
      throw new ServiceUnavailableException({
        reasonCode: "DEPENDENCY_UNAVAILABLE",
        detail: "反向生成依赖「项目 → 设计环节」的 AI 抽取能力，本版未接入；请用「从空白开始」或「套用已有蓝本」。",
      });
    }

    const blueprintId = this.ids.next("bp");

    if (body.origin === "blank") {
      const out = createBlueprint({ origin: "blank", blueprintId });
      await this.repo.create({
        blueprintId,
        orgId,
        actorId: principal.userId,
        name: body.name,
        origin: "blank",
        sourceId: null,
        machineGenerated: out.machineGenerated,
        designFacets: new Map(),
      });
      return out;
    }

    // origin === "copy"
    if (body.sourceId === null) {
      // 契约把 sourceId 定义成 nullable（blank 时为 null），所以「copy 却没给源」
      // 只能在这里判。用 BLUEPRINT_NOT_FOUND：从调用方视角，它指定的源确实不存在。
      throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    }
    if (!(await this.repo.exists(orgId, body.sourceId))) {
      throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    }
    const sourceContent = await this.repo.readDesignFacets(orgId, body.sourceId);
    const out = createBlueprint({
      origin: "copy",
      blueprintId,
      sourceContent: Object.fromEntries(sourceContent),
    });
    await this.repo.create({
      blueprintId,
      orgId,
      actorId: principal.userId,
      name: body.name,
      origin: "copy",
      sourceId: body.sourceId,
      machineGenerated: out.machineGenerated,
      designFacets: sourceContent,
    });
    return out;
  }

  @Get("/blueprints")
  async list(
    @Query("orgId") orgIdRaw: string | undefined,
    @Query("state") stateRaw: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // ⚠ query 用逐参声明（同 `project.controller.ts` 的 listProjects）。
    //   `state` 用契约的枚举解析，不自己写 if 串——多写一份取值清单就是第二处声明。
    const parsedState = stateRaw === undefined || stateRaw === "" ? null : C.BlueprintState.parse(stateRaw);
    const orgId = toOrgId(orgIdRaw ?? "");
    await this.requireOrgMember(orgId, principal.userId);

    const rows = await this.repo.list(orgId, parsedState as BlueprintState | null);
    // ⚠ 分母**运行时读定义表**，不硬编码 15/16（F17 行为契约逐字禁止）。
    const total = designFacetKeys(DESIGN_FACET_DEFINITIONS).length;

    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_ROLE" });

    const out = [];
    for (const row of rows) {
      // 与画布模板列表共用同一个判定函数：蓝本与画布模板同属 capability，
      // 判它们的必须是同一段代码，否则「谁能看见什么」会有两个答案。
      const decision = decideCapabilityVisibility({
        decisionId: this.ids.next("dec"),
        orgRole: membership.orgRole,
        requesterTeamId: membership.teamId,
        scope: row.facts.scope,
        ownerTeamId: row.facts.ownerTeamId,
      });
      // payload 除了这一句拿不出来——忘了判定是**类型错误**，不是一次疏漏。
      const disclosed = discloseDecided(row.listing, decision);
      if (!isDisclosed(disclosed)) continue;
      const r = disclosed.payload;
      out.push({
        blueprintId: r.blueprintId,
        name: r.name,
        state: r.state,
        versionNumber: r.versionNumber,
        agendaSegmentCount: r.agendaSegmentCount,
        durationTier: r.durationTier,
        appliedProjectCount: r.appliedProjectCount,
        // 样本不足 ⇒ null（契约逐字）。满意度要等蓝本被真实套用并回收评分，BP-01 恒 null。
        satisfaction: null,
        completeness: { done: r.filledDesignFacetCount, denominator: total },
        // 服务端派生（契约逐字「前端不得自行决定能不能删」）。BP-01 只实现了新建与列出，
        // 归档/删除/回滚的端点都还不存在 ⇒ 此刻没有任何可用动作，空数组是事实不是占位。
        availableActions: [],
      });
    }
    return out;
  }

  /**
   * 写路径的门：org admin。
   *
   * #991 裁决 ③：蓝本是六类 AssetKind 之一，**复用 `canMutateCapabilities`**
   * （画布模板与 Skill 走的同一个谓词），不新造「蓝本维护者」角色——
   * 另造一个 = 同一事实声明在两处，本仓已五次因此漂移。
   *
   * ⚠ 非成员与「成员但角色不够」抛**同一个** `ROLE_INSUFFICIENT`，照
   *   `canvas/template-admin.ts` 的先例：把非成员单独渲染成另一种拒绝，
   *   等于告诉一个陌生人「这个组织存在，只是你不在里面」。
   */
  /**
   * F174（BP-02）—— 设计环节逐项写入。
   *
   * ⚠ `designFacetKey` 不在契约的 err 闭集里有专门的码（对照先例 `roleKey` 有
   *   `UNKNOWN_ROLE_KEY`，这里没有——两处不对称，本身是一个契约缺口，登记但
   *   不新造码，见类的文件头注同一条纪律）。key 不属于定义表时，用
   *   `BLUEPRINT_NOT_FOUND`：路径 `/blueprints/:id/design-facets/:key` 寻址的
   *   是这一对 (blueprintId, designFacetKey)，key 不存在 ⇒ 该资源不存在，
   *   这是对该码字面最不勉强的读法。
   */
  @Put("/blueprints/:blueprintId/design-facets/:designFacetKey")
  async updateDesignFacet(
    @Param("blueprintId") blueprintId: string,
    @Param("designFacetKey") designFacetKey: string,
    @Body(new ZodBodyPipe(UPDATE_FACET_BODY_SCHEMA)) body: UpdateFacetBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    await this.requireCapabilityAdmin(orgId, principal.userId);

    if (!designFacetKeySet(DESIGN_FACET_DEFINITIONS).includes(designFacetKey)) {
      throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    }

    const outcome = await this.repo.updateDesignFacet({
      orgId,
      blueprintId,
      designFacetKey,
      value: body.value,
      expectedItemRevision: body.expectedItemRevision,
    });

    switch (outcome.kind) {
      case "blueprint-not-found":
        throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
      case "version-changed":
        throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      case "ok": {
        const total = designFacetKeys(DESIGN_FACET_DEFINITIONS).length;
        return {
          itemRevision: outcome.itemRevision,
          completed: outcome.itemRevision !== "",
          completeness: { done: outcome.filledDesignFacetCount, denominator: total },
          // ⚠ 真实写入时刻（契约逐字要求），不是「我们打算保存的时间」——
          //   这里没有伪造，Date.now() 就是这次请求真正落库完成的那一刻。
          autosavedAt: new Date().toISOString(),
        };
      }
    }
  }

  /**
   * F177（BP-03）—— 换时长档位。
   *
   * ⚠ 已知契约缺口（如实登记，见迁移文件头注、`packages/contracts/src/templates.ts`
   *   `KNOWN_CONTRACT_GAPS.T13`）：契约要求调用方传 `expectedVersion`，但没有任何
   *   契约操作把它读出来——`listBlueprints` 不含它，也没有 `getBlueprint`。
   *   本端点因此真实、可测，但目前没有合法途径从前端拿到第一个 `expectedVersion`；
   *   真正接线（BP-05 之后的某个 BP）要等这个读路径的缺口被补上或走 delta 新增。
   */
  @Put("/blueprints/:blueprintId/duration-tier")
  async setDurationTier(
    @Param("blueprintId") blueprintId: string,
    @Body(new ZodBodyPipe(SET_DURATION_TIER_BODY_SCHEMA)) body: SetDurationTierBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    await this.requireCapabilityAdmin(orgId, principal.userId);

    const outcome = await this.repo.setDurationTier({
      orgId,
      blueprintId,
      tier: body.tier,
      confirmed: body.confirmed,
      expectedVersion: body.expectedVersion,
    });

    switch (outcome.kind) {
      case "blueprint-not-found":
        throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
      case "version-changed":
        throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      case "custom-tier-undefined":
        // D-7「宁可拒绝也不猜一个推导式」——custom 档的规则本身未定，不是这次请求的输入错了。
        throw new BadRequestException({ reasonCode: "CUSTOM_TIER_RULE_UNDEFINED" });
      case "confirmation-required":
        // 契约逐字要求这份清单要能带给调用方（A2「已填内容不得静默丢弃」）。
        throw new ConflictException({
          reasonCode: "TIER_CHANGE_NEEDS_CONFIRMATION",
          detail: { added: outcome.added, removed: outcome.removed },
        });
      case "applied":
        return {
          agendaSegmentCount: outcome.agendaSegmentCount,
          added: outcome.added,
          removed: outcome.removed,
          recoverable: outcome.recoverable,
        };
    }
  }

  /**
   * F179（BP-04）—— 试跑一场，发布门槛「已试跑」判据的写入路径。
   * 复用 `requireCapabilityAdmin`：试跑是编辑动作的一种（同 setDurationTier/
   * updateDesignFacet 的角色门槛），不新造一套判据。
   */
  @Post("/blueprints/:blueprintId/trial-runs")
  async startTrialRun(
    @Param("blueprintId") blueprintId: string,
    @Body(new ZodBodyPipe(START_TRIAL_RUN_BODY_SCHEMA)) _body: StartTrialRunBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    await this.requireCapabilityAdmin(orgId, principal.userId);

    const outcome = await this.repo.startTrialRun({
      orgId,
      blueprintId,
      trialRunId: this.ids.next("trial"),
    });

    if (outcome.kind === "blueprint-not-found") {
      throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    }
    // 见 `application/templates/start-trial-run.ts`：判据挂在绑定表上，
    // 今天等价于「创建即算」（D-6 未裁，`KNOWN_CONTRACT_GAPS.T7`）。
    return { trialRunId: outcome.trialRunId, trialRunDone: true };
  }

  /**
   * F179（BP-04）—— 发布新版本。门槛判定（必填面 + 试跑面）与版本生成的编排
   * 全部在仓储层完成（`publishBlueprintVersionUseCase`），控制器只做错误码映射。
   */
  @Post("/blueprints/:blueprintId/versions")
  async publishBlueprintVersion(
    @Param("blueprintId") blueprintId: string,
    @Body(new ZodBodyPipe(PUBLISH_VERSION_BODY_SCHEMA)) body: PublishVersionBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    await this.requireCapabilityAdmin(orgId, principal.userId);

    const outcome = await this.repo.publishBlueprintVersion({
      orgId,
      blueprintId,
      expectedCurrentVersionNumber: body.expectedCurrentVersionNumber,
      newVersionId: this.ids.next("bpv"),
    });

    switch (outcome.kind) {
      case "blueprint-not-found":
        throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
      case "version-changed":
        throw new ConflictException({ reasonCode: "VERSION_CHANGED" });
      case "gate-blocked":
        // 422：请求形式合法，但当前资源状态不满足发布的语义前置条件——
        //   与 400（请求本身畸形）和 409（并发写冲突，上面那支）都不是同一件事。
        throw new UnprocessableEntityException({
          reasonCode: outcome.reasonCode,
          detail: outcome.reasonCode === "REQUIRED_CONFIG_INCOMPLETE" ? { missingKeys: outcome.missingKeys } : undefined,
        });
      case "ok":
        return {
          versionId: outcome.versionId,
          versionNumber: outcome.versionNumber,
          changedDesignFacetKeys: outcome.changedDesignFacetKeys,
          archivedVersionId: outcome.archivedVersionId,
        };
    }
  }

  /**
   * 2026-08-15 delta（`design-deltas/blueprint-read-path/`，人类已批准）——
   * 读一个蓝本已填的设计环节内容 + 蓝本级并发令牌。解锁 BP-06（设计器接线）与
   * BP-03 遗留的 T13（`setDurationTier.expectedVersion` 之前没有读路径）。
   *
   * ⚠ 门槛用 `requireCapabilityAdmin` 而不是 `requireOrgMember`：本端点声明的
   *   `err` 是 `ROLE_INSUFFICIENT`（对齐 `updateDesignFacet`/`setDurationTier`
   *   这类同一资源的写端点），不是 `listBlueprints` 用的 `NO_ORG_ROLE`——
   *   设计环节内容与写它用的是同一档敏感度，读写门槛不该不对称。
   */
  @Get("/blueprints/:blueprintId/design-facets")
  async getDesignFacets(
    @Param("blueprintId") blueprintId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    await this.requireCapabilityAdmin(orgId, principal.userId);

    const outcome = await this.repo.getBlueprintDesignFacets(orgId, blueprintId);
    if (outcome.kind === "blueprint-not-found") {
      throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    }
    return { revision: outcome.revision, designFacets: outcome.designFacets };
  }

  /**
   * F189（BP-07）—— 「套用后会初始化什么」六类一览接真（`getInitializationPreview`，
   * uc-2-2 R3 / AC2 / AC5）。契约操作与应用层纯函数（`get-initialization-preview.ts` /
   * `planInitializationPreview`）在本束原始签核范围内早已存在，本端点只补控制器接线，
   * 未新增任何字段/错误码/交互语义（`design-signoff.md` covers 追加自查记录见该文件）。
   *
   * ⚠ 门槛与 `getDesignFacets` 不同：契约声明的 `err` 是 `BLUEPRINT_NOT_FOUND` /
   *   `BLUEPRINT_NOT_VISIBLE` / `DEPENDENCY_UNAVAILABLE`，**没有** `ROLE_INSUFFICIENT`——
   *   这是一条可见性门（同「谁能看见这个蓝本」），不是管理员门，所以不能复用
   *   `requireCapabilityAdmin`。判定复用与画布模板/蓝本列表同一份 `decideCapabilityVisibility`
   *   （#991 裁决 ③ 同款单一事实源纪律），非该组织成员与「蓝本对你不可见」都落在
   *   `BLUEPRINT_NOT_VISIBLE` 一个码上——不额外区分「你根本不是这个组织的人」，
   *   同 `permission-decision.ts` 头注「不可分辨」的既有立场一致，本端点没有另造判断。
   *
   * ⚠ `filledFacetKeys` 从 `getBlueprintDesignFacets` 的输出派生（`designFacets` 里
   *   出现的每一行即已填——未填的 facet 根本没有行，见该端点仓储层的写入侧过滤 +
   *   CHECK 约束），不新开一次仓储查询、不新增 port 方法。
   *
   * ⚠ `versionId`/`tier` 入参按用例现有实现范围**不参与派生**（应用层文件头注已注明，
   *   本 feature 未做新裁决，只是让已有的「按当前草稿生成」路径首次接上真实存储）。
   */
  @Get("/blueprints/:blueprintId/initialization-preview")
  async getInitializationPreview(
    @Param("blueprintId") blueprintId: string,
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

    const decision = decideCapabilityVisibility({
      decisionId: this.ids.next("dec"),
      orgRole: membership?.orgRole ?? null,
      requesterTeamId: membership?.teamId ?? null,
      // BP-01 尚未有可见性写入路径（同 `list()` 的既有说明），此刻蓝本恒 org-wide、
      // 无归属团队——这是当前的真实值，不是本端点新做的裁决。
      scope: "org-wide",
      ownerTeamId: null,
    });
    if (!decision.allowed) {
      throw new ForbiddenException({ reasonCode: "BLUEPRINT_NOT_VISIBLE" });
    }

    const outcome = await this.repo.getBlueprintDesignFacets(orgId, blueprintId);
    if (outcome.kind === "blueprint-not-found") {
      throw new NotFoundException({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    }

    return getInitializationPreview({
      filledFacetKeys: outcome.designFacets.map((f) => f.designFacetKey),
    });
  }

  /**
   * F950（2026-08-16 delta）：定题/分组/筹备计数的五条路由。`orgId` 取自
   * `principal.orgId`——同 `project.controller.ts` 里 `getProjectOverview`/`archiveProject`
   * 那批路由的形状，五个契约的 `in` 都只有 `projectId`（或 `projectId + tags` 那种混合
   * body），没有 `orgId` 字段。角色门槛统一走 `getActorProjectRole`。
   */
  @Get("/projects/:projectId/prep")
  async getPrep(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const role = await this.getActorProjectRole(orgId, projectId, principal.userId);
    try {
      return await getProjectPrepUseCase({ repo: this.prepRepo }, { orgId, projectId, actorProjectRole: role });
    } catch (e) {
      if (e instanceof GetProjectPrepError) throw this.mapPrepFamilyError(e.reasonCode);
      throw e;
    }
  }

  @Get("/projects/:projectId/topic")
  async getTopic(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const role = await this.getActorProjectRole(orgId, projectId, principal.userId);
    try {
      return await getProjectTopicUseCase({ repo: this.topicRepo }, { orgId, projectId, actorProjectRole: role });
    } catch (e) {
      if (e instanceof GetProjectTopicError) throw this.mapPrepFamilyError(e.reasonCode);
      throw e;
    }
  }

  @Put("/projects/:projectId/topic")
  async putTopic(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(C.operations.saveAndSyncTopic.in.omit({ projectId: true })))
    body: Omit<z.infer<typeof C.operations.saveAndSyncTopic.in>, "projectId">,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const role = await this.getActorProjectRole(orgId, projectId, principal.userId);
    try {
      return await saveAndSyncTopicUseCase(
        { repo: this.topicRepo },
        { orgId, projectId, actorProjectRole: role, ...body },
      );
    } catch (e) {
      if (e instanceof SaveAndSyncTopicError) {
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "VERSION_CHANGED") throw new ConflictException({ reasonCode: e.reasonCode });
        if (e.reasonCode === "AI_SOURCES_INSUFFICIENT") {
          throw new BadRequestException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Get("/projects/:projectId/grouping")
  async getGrouping(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const role = await this.getActorProjectRole(orgId, projectId, principal.userId);
    try {
      return await getProjectGroupingUseCase(
        { repo: this.groupingRepo },
        { orgId, projectId, actorProjectRole: role },
      );
    } catch (e) {
      if (e instanceof GetProjectGroupingError) throw this.mapPrepFamilyError(e.reasonCode);
      throw e;
    }
  }

  /**
   * F02（phase-10 viewer-role 束，2026-08-21）——`tab-live.tsx`（现场协作视角切换器）
   * 专用的独立只读端点。**不复用** `getGrouping()`：那个端点服务筹备阶段
   * `tab-prep.tsx` 的「全量分组内部协作视图」，语义与这里的角色收窄互斥（见
   * `get-project-grouping.ts` 头注）。这里读一次完整 membership（角色 + 所在组），
   * 用 `projectViewersForRole` 做服务端投影：facilitator 全场+全部分组；
   * groupLead/member 只有自己那一组；observer 只有『主持台·全场』一项，不含任何
   * 分组条目（`viewer-role/domain.md` 不变量 2/3）。`requestedViewerId` 是可选的
   * 「我要切到这个视角」意图，越权 ⇒ `VIEWER_SCOPE_DENIED`（403），不是 200 + 猜不到
   * 内容的空列表（不变量 1）。
   */
  @Get("/projects/:projectId/viewer-options")
  async getViewerOptions(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Query("requestedViewerId") requestedViewerId?: string,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const membership = await this.identity.findProjectMembership(principal.userId, projectId, orgId);
    const role = (membership?.projectRole as ProjectRole | undefined) ?? null;
    const actorGroupId = membership?.groupId ?? null;
    try {
      return await getViewerOptionsUseCase(
        { repo: this.groupingRepo },
        { orgId, projectId, actorProjectRole: role, actorGroupId, requestedViewerId },
      );
    } catch (e) {
      if (e instanceof GetViewerOptionsError) {
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Put("/projects/:projectId/grouping")
  async putGrouping(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(C.operations.updateGrouping.in.omit({ projectId: true })))
    body: Omit<z.infer<typeof C.operations.updateGrouping.in>, "projectId">,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const role = await this.getActorProjectRole(orgId, projectId, principal.userId);
    try {
      return await updateGroupingUseCase(
        { repo: this.groupingRepo },
        { orgId, projectId, actorProjectRole: role, ...body },
      );
    } catch (e) {
      if (e instanceof UpdateGroupingError) {
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        if (e.reasonCode === "VERSION_CHANGED") throw new ConflictException({ reasonCode: e.reasonCode });
        if (e.reasonCode === "NO_PROJECT_ROLE" || e.reasonCode === "ROLE_INSUFFICIENT") {
          throw new ForbiddenException({ reasonCode: e.reasonCode });
        }
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /** `getProjectPrep`/`getProjectTopic`/`getProjectGrouping` 三条读路由共用的失败面映射
   *  ——三者的 `err` 都只有 `["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"]` 这两个码。 */
  private mapPrepFamilyError(reasonCode: "NO_PROJECT_ROLE" | "DEPENDENCY_UNAVAILABLE"): Error {
    if (reasonCode === "DEPENDENCY_UNAVAILABLE") {
      return new ServiceUnavailableException({ reasonCode });
    }
    return new ForbiddenException({ reasonCode });
  }

  /**
   * F960（2026-08-17 delta）—— 观察/访谈对象表读写接线。同 F950/`getProjectGrouping` 的
   * 先例：门槛读 `project_memberships` 拿角色，不新造第二套判定（见
   * `identity.findProjectMembership` 既有方法，本端点不新增仓储查询）。
   */
  @Put("/projects/:projectId/groups/:groupId/interview-subjects")
  async updateInterviewSubjects(
    @Param("projectId") projectId: string,
    @Param("groupId") groupId: string,
    @Body(new ZodBodyPipe(UPDATE_INTERVIEW_SUBJECTS_BODY_SCHEMA)) body: UpdateInterviewSubjectsBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const actorProjectRole = await this.getActorProjectRole(orgId, projectId, principal.userId);

    try {
      const out = await updateInterviewSubjectsUseCase(
        { repo: this.interviewSubjects },
        { orgId, projectId, groupId, actorProjectRole, subjects: body.subjects, expectedRevision: body.expectedRevision },
      );
      return out.subjects;
    } catch (err) {
      if (err instanceof UpdateInterviewSubjectsError) throw this.mapInterviewSubjectsError(err.reasonCode);
      throw err;
    }
  }

  @Get("/projects/:projectId/groups/:groupId/interview-subjects")
  async getInterviewSubjects(
    @Param("projectId") projectId: string,
    @Param("groupId") groupId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const actorProjectRole = await this.getActorProjectRole(orgId, projectId, principal.userId);

    try {
      return await getInterviewSubjectsUseCase(
        { repo: this.interviewSubjects },
        { orgId, projectId, groupId, actorProjectRole },
      );
    } catch (err) {
      if (err instanceof GetInterviewSubjectsError) throw this.mapInterviewSubjectsError(err.reasonCode);
      throw err;
    }
  }

  private mapInterviewSubjectsError(
    reasonCode: "NO_PROJECT_ROLE" | "ROLE_INSUFFICIENT" | "VERSION_CHANGED" | "DEPENDENCY_UNAVAILABLE",
  ) {
    switch (reasonCode) {
      case "NO_PROJECT_ROLE":
        return new ForbiddenException({ reasonCode: "NO_PROJECT_ROLE" });
      case "ROLE_INSUFFICIENT":
        return new ForbiddenException({ reasonCode: "ROLE_INSUFFICIENT" });
      case "VERSION_CHANGED":
        return new ConflictException({ reasonCode: "VERSION_CHANGED" });
      case "DEPENDENCY_UNAVAILABLE":
        return new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
  }

  /** `null` = 调用者在这个项目没有任何角色——同 `skill-mount.controller.ts` 的既有形状。 */
  private async getActorProjectRole(orgId: OrgId, projectId: string, userId: string): Promise<ProjectRole | null> {
    const membership = await this.identity.findProjectMembership(userId, projectId, orgId);
    return (membership?.projectRole as ProjectRole | undefined) ?? null;
  }

  private async requireCapabilityAdmin(orgId: OrgId, userId: string): Promise<void> {
    let membership;
    try {
      membership = await this.identity.findOrgMembership(userId, orgId);
    } catch {
      // 503 而不是 403：判定服务不可用**不是**一个裁定。渲染成拒绝，
      // 用户会去找管理员要一个他本来就有的权限。
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
    if (membership === null || !canMutateCapabilities(membership.orgRole)) {
      throw new ForbiddenException({ reasonCode: "ROLE_INSUFFICIENT" });
    }
  }

  /** 读路径的门：本组织成员即可（契约 `listBlueprints.err` 只有 NO_ORG_ROLE）。 */
  private async requireOrgMember(orgId: OrgId, userId: string): Promise<void> {
    let membership;
    try {
      membership = await this.identity.findOrgMembership(userId, orgId);
    } catch {
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_ROLE" });
  }
}
