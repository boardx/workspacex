import {
  Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param,
  ServiceUnavailableException,
} from "@nestjs/common";
import { planPermissions as C } from "@repo/contracts";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  TOOL_PERMISSION_GRANT_STORE, type ToolPermissionGrantStore,
} from "../../application/agent-run/tool-permission-grants";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/**
 * issue #3068 —— 「以后都允许」（`tool_permission_grants.scope='forever'`）的查看与撤销。
 *
 * ## 为什么需要这条路由
 *
 * F06 只做了写入与生效判断：一次「以后都允许」写下一条组织级、跨 run、无期限的授权，
 * 此后同组织所有同类调用被 `hasGrant` 自动放行，而**仓里没有任何端点或界面能收回它**。
 * `tool-permission-card.tsx` 却告诉用户「可在下次弹出时改选拒绝以撤销」——那个弹层
 * 再也不会出现。一次点击 = 永久且不可达。coordinator 在 #3068 裁决 C1：加撤销路径。
 *
 * ## 为什么是组织面路由而不是挂在 run 下
 *
 * 这条授权本来就跨 run、无过期。挂在 `/agent-runs/:runId/...` 下等于把撤销入口绑在
 * 一个早已结束的 run 上——那正是今天这个洞的形状（入口存在于一个不会再出现的上下文里）。
 *
 * ## 为什么判据是组织 admin
 *
 * 授权面是**整个组织**：一条 forever 授权让同组织每个人的每次 run 都被放行，因此收回它
 * 是组织配置动作，判据是组织角色，与 `model.controller.ts` 的 `requireOrgAdmin` 同一条
 * （`tool_permission_grants` 不是 `ObjectRef` 的任何一种，硬塞进 `permission-filter`
 * 的项目维度裁定会退化成 DEFAULT_SCOPE 组织级、对每个成员返回 allowed=true——那比
 * 没有裁定更糟，见 `pg-model-pool-repository.ts` 在 lint 豁免里逐字写下的同一论证）。
 * 用户可见的收尾文案因此写明"由组织管理员撤销"，不承诺一个非管理员点不动的入口。
 */
@Controller()
export class ToolPermissionGrantController {
  constructor(
    @Inject(TOOL_PERMISSION_GRANT_STORE) private readonly grants: ToolPermissionGrantStore,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  /** 组织现存的「以后都允许」清单。空组织返回 `[]`——不预置任何行。 */
  @Get("/tool-permission-grants")
  async list(@CurrentPrincipal() principal: Principal) {
    const orgId = await this.requireOrgAdmin(principal);
    return this.run(async () => {
      const rows = await this.grants.listStanding(toOrgId(orgId));
      // 出门过契约的 `.strict()`：没有这一句，服务端可以发出契约没描述的字段而所有门控
      // 保持绿色——这里多一个 `run_id`/`scope` 就是在泄露另一档授权的存在。
      return C.operations.listStandingToolGrants.out.parse(rows);
    });
  }

  /**
   * 撤销一条。撤销后同组织的下一次同类调用重新走审批——这是本 issue 唯一要证的行为，
   * 真库反证在 `tests/agent-run/standing-grant-revocation-pg.test.ts`。
   */
  @Delete("/tool-permission-grants/:grantId")
  async revoke(@Param("grantId") grantId: string, @CurrentPrincipal() principal: Principal) {
    const orgId = await this.requireOrgAdmin(principal);
    assertPrincipal(principal);
    return this.run(async () => {
      const revoked = await this.grants.revokeStanding(toOrgId(orgId), grantId, principal.userId);
      // 不存在 / 已被另一位管理员撤销 —— 对调用方是同一件事，且都不是失败：界面
      // 重新拉一次清单即可。用 404 而不是 200，是为了不让"什么也没撤掉"看起来像撤掉了。
      if (!revoked) throw new NotFoundException({ reasonCode: "GRANT_NOT_FOUND" });
      return C.operations.revokeStandingToolGrant.out.parse({ grantId });
    });
  }

  /** `NOT_ORG_ADMIN` 的唯一落点，见类头注最后一节。 */
  private async requireOrgAdmin(principal: Principal): Promise<string> {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null || membership.orgRole !== "admin") {
      throw new ForbiddenException({ reasonCode: "NOT_ORG_ADMIN" });
    }
    return orgId;
  }

  /** 下层故障 → HTTP，一处。不回显 `e.message`（`lint-error-leak` 的同一条纪律）。 */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof NotFoundException) throw e;
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
  }
}
