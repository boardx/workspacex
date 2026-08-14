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

@Controller()
export class BlueprintController {
  constructor(
    @Inject(BLUEPRINT_PERSISTENCE_PORT) private readonly repo: BlueprintPersistencePort,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
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
   * F178（BP-04）—— 试跑一场，发布门槛「已试跑」判据的写入路径。
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
   * F178（BP-04）—— 发布新版本。门槛判定（必填面 + 试跑面）与版本生成的编排
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
