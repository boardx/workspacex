/**
 * AG04（契约束 agent-role UC-4）—— 成员 Agent 目录两条只读路径：
 * `GET /agents/directory`（列表，可按 roleCategory/q 过滤）与
 * `GET /agents/directory/:agentId`（单卡，直链；无权/不存在 → 404，不泄露存在性）。
 * 独立文件：授权门槛是「任意组织成员」，与 `agent.controller.ts` 的 `listAgents`
 * （admin-only）不同一条纪律，混在一起会让人误以为两者共享权限判定。
 */
import { Controller, Get, Inject, NotFoundException, Optional, Param, Query, UnauthorizedException } from "@nestjs/common";
import { agentRole as R } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { parseDisplayLocale } from "../parse-display-locale";
import { ENTITY_LOCALIZATION_REPOSITORY, type EntityLocalizationRepository } from "../../application/localization/entity-localization";
import { localizeAuthorizedItems, matchesDisplayQuery } from "../../application/localization/localize-authorized-items";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { WORKFLOW_DEFINITION_STORE, type WorkflowDefinitionStore } from "../../application/agent-import/ports";
import {
  AGENT_DIRECTORY_REPOSITORY,
  AgentDirectoryError,
  getAgentDirectoryCard,
  getAgentDirectoryProfile,
  LAUNCHABLE_WORKFLOWS,
  listAgentDirectory,
  matchesAgentDirectoryQuery,
  type AgentDirectoryRepository,
  type LaunchableWorkflowsPort,
} from "../../application/agent/list-agent-directory";

type RoleCategory = ReturnType<typeof R.AgentRoleCategory.parse>;

@Controller()
export class AgentDirectoryController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AGENT_DIRECTORY_REPOSITORY) private readonly repository: AgentDirectoryRepository,
    @Inject(WORKFLOW_DEFINITION_STORE) private readonly workflows: WorkflowDefinitionStore,
    @Optional() @Inject(LAUNCHABLE_WORKFLOWS) private readonly launchable?: LaunchableWorkflowsPort,
    @Optional() @Inject(ENTITY_LOCALIZATION_REPOSITORY) private readonly localizations?: EntityLocalizationRepository,
  ) {}

  @Get(R.operations.listAgentDirectory.path)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("roleCategory") roleCategoryRaw: string | undefined,
    @Query("q") qRaw: string | undefined,
    @Query("locale") localeRaw?: string,
  ) {
    assertPrincipal(principal);
    const parsed = R.operations.listAgentDirectory.in.parse({
      roleCategory: roleCategoryRaw === undefined || roleCategoryRaw === "" ? undefined : roleCategoryRaw,
      q: qRaw === undefined || qRaw === "" ? undefined : qRaw,
      locale: parseDisplayLocale(localeRaw),
    });
    try {
      const items = await listAgentDirectory(
        {
          orgId: principal.orgId, actorId: principal.userId,
          roleCategory: (parsed.roleCategory ?? null) as RoleCategory | null,
          q: parsed.locale === undefined ? parsed.q ?? null : null,
        },
        { identities: this.identities, repository: this.repository, workflows: this.workflows, launchable: this.launchable },
      );
      const localized = await localizeAuthorizedItems(items, { orgId: principal.orgId, kind: "agent", locale: parsed.locale,
        idOf: row => row.agentId, versionOf: row => row.versionId, repository: this.localizations });
      const filtered = parsed.locale !== undefined && parsed.q
        ? localized.filter(row => matchesAgentDirectoryQuery(row, parsed.q ?? null) || matchesDisplayQuery(row.display, parsed.q ?? "")) : localized;
      return R.operations.listAgentDirectory.out.parse({ items: filtered });
    } catch (error) {
      if (error instanceof AgentDirectoryError && error.code === "UNAUTHENTICATED") throw new UnauthorizedException({ reasonCode: error.code });
      throw error;
    }
  }

  @Get(R.operations.getAgentDirectoryCard.path)
  async getOne(@CurrentPrincipal() principal: Principal, @Param("agentId") agentId: string, @Query("locale") localeRaw?: string) {
    assertPrincipal(principal);
    const locale = parseDisplayLocale(localeRaw);
    try {
      const card = await getAgentDirectoryCard(
        { orgId: principal.orgId, actorId: principal.userId, agentId },
        { identities: this.identities, repository: this.repository, workflows: this.workflows, launchable: this.launchable },
      );
      const localized = (await localizeAuthorizedItems([card], { orgId: principal.orgId, kind: "agent", locale,
        idOf: row => row.agentId, versionOf: row => row.versionId, repository: this.localizations }))[0];
      return R.operations.getAgentDirectoryCard.out.parse(localized);
    } catch (error) {
      if (error instanceof AgentDirectoryError) {
        if (error.code === "UNAUTHENTICATED") throw new UnauthorizedException({ reasonCode: error.code });
        throw new NotFoundException({ reasonCode: error.code });
      }
      throw error;
    }
  }

  /** AG04 follow-up：成员详情页补充（职责 / 技能引用 / 可转交对象）。判定与 404 语义同 `getOne`。 */
  @Get(R.operations.getAgentDirectoryProfile.path)
  async getProfile(@CurrentPrincipal() principal: Principal, @Param("agentId") agentId: string, @Query("locale") localeRaw?: string) {
    assertPrincipal(principal);
    const locale = parseDisplayLocale(localeRaw);
    try {
      const profile = await getAgentDirectoryProfile(
        { orgId: principal.orgId, actorId: principal.userId, agentId },
        { identities: this.identities, repository: this.repository },
      );
      const delegationTargets = await localizeAuthorizedItems(profile.delegationTargets, { orgId: principal.orgId, kind: "agent", locale,
        idOf: row => row.agentId, repository: this.localizations });
      const localized = (await localizeAuthorizedItems([{ ...profile, delegationTargets }], { orgId: principal.orgId, kind: "agent", locale,
        idOf: row => row.agentId, repository: this.localizations }))[0];
      return R.operations.getAgentDirectoryProfile.out.parse(localized);
    } catch (error) {
      if (error instanceof AgentDirectoryError) {
        if (error.code === "UNAUTHENTICATED") throw new UnauthorizedException({ reasonCode: error.code });
        throw new NotFoundException({ reasonCode: error.code });
      }
      throw error;
    }
  }
}
