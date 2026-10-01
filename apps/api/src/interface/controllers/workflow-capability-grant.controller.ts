import {
  Body, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Put,
  ServiceUnavailableException,
} from "@nestjs/common";
import { workflowCapabilityGrants as C } from "@repo/contracts";
import {
  WorkflowCapabilityGrantError, type WorkflowCapabilityGrantService,
} from "../../application/workflow/workflow-capability-grants";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const WORKFLOW_CAPABILITY_GRANT_SERVICE = Symbol("WorkflowCapabilityGrantService");

/**
 * Workflow 能力授权管理面（组织 admin）—— 授予 / 撤销 `workflow_capability_grants`。
 * 判据与审计都在 `WorkflowCapabilityGrantService`；这里只做契约进出与错误映射。
 * 路径是裸的 `/workflow-capability-grants`（空前缀），web 侧 rewrite 见 next.config.mjs。
 */
@Controller()
export class WorkflowCapabilityGrantController {
  constructor(@Inject(WORKFLOW_CAPABILITY_GRANT_SERVICE) private readonly service: WorkflowCapabilityGrantService) {}

  @Get("/workflow-capability-grants")
  async list(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return this.run(async () =>
      C.operations.listWorkflowCapabilityGrants.out.parse(await this.service.list(principal.orgId, principal.userId)));
  }

  @Put("/workflow-capability-grants/:capabilityCategory")
  async grant(@Param("capabilityCategory") capabilityCategory: string, @Body() body: unknown, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const input = C.operations.setWorkflowCapabilityGrant.in.parse(body);
    return this.run(async () =>
      C.operations.setWorkflowCapabilityGrant.out.parse(
        await this.service.grant(principal.orgId, principal.userId, capabilityCategory, input.sideEffectCap)));
  }

  @Delete("/workflow-capability-grants/:capabilityCategory")
  async revoke(@Param("capabilityCategory") capabilityCategory: string, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return this.run(async () =>
      C.operations.revokeWorkflowCapabilityGrant.out.parse(
        await this.service.revoke(principal.orgId, principal.userId, capabilityCategory)));
  }

  /** 下层故障 → HTTP，一处。只映射 reasonCode，不回显异常文本。 */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof WorkflowCapabilityGrantError) {
        if (e.reasonCode === "NOT_ORG_ADMIN") throw new ForbiddenException({ reasonCode: "NOT_ORG_ADMIN" });
        throw new NotFoundException({ reasonCode: "UNKNOWN_CAPABILITY" });
      }
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
  }
}
