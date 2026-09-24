/**
 * backlog E3 —— 组织管理员查看**自己组织**的第一个价值时刻漏斗（本地事实，永不离开实例）。
 * 契约：`firstValueEvents.operations.getOrgFirstValueFunnel`。组织取自会话（principal.orgId），
 * 不接受路径参数——没有「看别的组织」这条路。
 */
import { Controller, ForbiddenException, Get, Inject } from "@nestjs/common";
import { firstValueEvents as FV } from "@repo/contracts";
import { FIRST_VALUE_FACT_STORE, type FirstValueFactStore } from "../../application/first-value/first-value-recorder";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class FirstValueController {
  constructor(
    @Inject(FIRST_VALUE_FACT_STORE) private readonly facts: FirstValueFactStore,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  @Get(FV.operations.getOrgFirstValueFunnel.path)
  async funnel(@CurrentPrincipal() principal: Principal): Promise<FV.OrgFirstValueFunnelOutValue> {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership?.orgRole !== "admin") throw new ForbiddenException({ reasonCode: "NOT_ORG_ADMIN" });
    const rows = await this.facts.listForOrg(orgId);
    return FV.orgFirstValueFunnel(rows.map((r) => ({ step: r.step, occurredAt: r.occurredAt.toISOString() })));
  }
}
