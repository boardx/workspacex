/**
 * 用户直接交办（2026-09-25，ad-hoc）—— 平台级记忆抽取开关的两条路由
 * （`getPlatformExtractionSetting` / `setPlatformExtractionSetting`，契约束
 * `packages/contracts/src/chat-knowledge-graph.ts`）：
 *
 *   GET /platform/knowledge-graph/extraction-setting
 *   PUT /platform/knowledge-graph/extraction-setting
 *
 * ## 为什么单开一个 controller，不塞进 `KnowledgeGraphController`
 *
 * `KnowledgeGraphController` 全部路由都在组织上下文里（`toOrgId(principal.orgId)`），这两条
 * 是部署级、跟调用者当前所在组织无关——塞进去会让那个类第一次出现一条"不看 principal 的
 * org"的路由，下一个人会照着抄（同 `platform-member.controller.ts` 头注"为什么与组织级
 * 路由不在同一个 controller"的理由）。
 *
 * ## 鉴权：类级 `PlatformOperatorGuard`，GET/PUT 同一道门
 *
 * 同 `PlatformMemberController` 的 `setOrgRole`：平台运营准入（平台超管白名单，或落库的
 * `platform_admins`）即可读也可写——这一层没有比它更低的"只读"门槛可以拆分读写（组织级
 * `KnowledgeGraphController` 的 `getKnowledgeExtractionSetting` 能对"任何组织成员"开放读，
 * 是因为组织成员资格本身就是一个比"组织 admin"更低的门槛；平台运营准入已经是能碰到这条
 * 路由的最低门槛，没有再往下分的余地）。不叠 `PlatformSuperuserGuard`——那一层只用于
 * "谁能把别人也变成平台管理员"这类身份授予动作（`grantPlatformAdmin`/`revokePlatformAdmin`），
 * 抽取开关不是身份授予，落地损坏的上限是"抽取多跑或少跑"，不是"谁有权限"这件事本身。
 */
import { Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import {
  KG_DEPLOYMENT_EXTRACTION_SETTINGS_PORT, KG_EXTRACTION_MODEL_CONFIG,
  type KgDeploymentExtractionSettingsPort, type KgExtractionModelConfig,
} from "../../application/knowledge-graph/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 一类的断言与契约是**同一个对象**而非长得像。 */
export const SET_PLATFORM_EXTRACTION_SETTING_SCHEMA = KG.knowledgeGraph.setPlatformExtractionSetting.in;

type SetPlatformExtractionSettingBody = z.infer<typeof SET_PLATFORM_EXTRACTION_SETTING_SCHEMA>;

@Controller()
@UseGuards(PlatformOperatorGuard)
export class PlatformExtractionSettingController {
  constructor(
    @Inject(KG_EXTRACTION_MODEL_CONFIG) private readonly extractionModelConfig: KgExtractionModelConfig,
    @Inject(KG_DEPLOYMENT_EXTRACTION_SETTINGS_PORT) private readonly deploymentExtraction: KgDeploymentExtractionSettingsPort,
  ) {}

  @Get(KG.knowledgeGraph.getPlatformExtractionSetting.path)
  async get(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const enabled = await this.deploymentExtraction.getEnabled();
    return KG.knowledgeGraph.getPlatformExtractionSetting.out.parse({
      providerConfigured: this.extractionModelConfig.enabled, enabled,
    });
  }

  @Put(KG.knowledgeGraph.setPlatformExtractionSetting.path)
  async set(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(SET_PLATFORM_EXTRACTION_SETTING_SCHEMA)) body: SetPlatformExtractionSettingBody,
  ) {
    assertPrincipal(principal);
    const enabled = await this.deploymentExtraction.setEnabled(body.enabled, principal.userId);
    return KG.knowledgeGraph.setPlatformExtractionSetting.out.parse({
      providerConfigured: this.extractionModelConfig.enabled, enabled,
    });
  }
}
