/**
 * F05（phase-10 `group-checkin` 束）—— `GetCheckinBoard`（F16 / UC-1.3 R8）的 HTTP 边界。
 *
 * ## 这个文件要消掉的那句话
 *
 * `apps/api/src/application/auth/get-checkin-board.ts` 与它的仓储端口
 * （`live-session-ports.ts` / `pg-live-session-repository.ts`）在 F05 开工前**早已完整实现、
 * 且有真实 DB 测试**（`tests/auth/checkin-writeback.test.ts`）——但 `grep` 全仓
 * `apps/api/src/interface/controllers/` 找不到任何一条路由接它，前端也完全没有消费它。
 * 一段测得再全的用例，没有一条路由到得了它，界面上的「分组与签到」就只能是假的
 * （同 `skill-mount.controller.ts` 头注 #467 那句话的处境）。本文件是那条边界。
 *
 * ## 契约用的是 `orgAdmin.operations.getCheckinBoard`，不是新建 `live-collab-checkin.ts`
 *
 * `group-checkin` 束 `design-signoff.md` ③ 那节写着「契约文件尚不存在，签核通过后开工时的
 * 第一件产出」——**这句话已经不成立**：契约、用例、仓储三层其实是更早的 F16（UC-1.3 R8）
 * 顺手做出来的，只是签核时没人 grep 到它。核实结果见本 feature 的 PR 描述与
 * `feature_list.json` F05 `notes`，这里不重复整段调查过程，只记一句机械事实：
 * `packages/contracts/src/org-admin.ts` 的 `getCheckinBoard` 操作与本 controller 绑定的
 * 是**同一个** zod schema（`CHECKIN_BOARD_QUERY_SCHEMA` 供 `contract-single-source` 类测试核对）。
 *
 * ## 角色投影在用例层，不在这里
 *
 * `actorOrgRole`/`actorTeamId`/`actorProjectRole`/`actorGroupId` 全部服务端解析
 * （`findOrgMembership` + `findProjectMembership`），不信任请求——路径与
 * `skill-mount.controller.ts` 的 `deliverRoleOf` 同型。组长只见本组、越权判定
 * （`decideCheckinBoardAccess`）都在 `getCheckinBoard` 用例内部，本 controller 只是
 * 把 principal 翻成用例要的输入形状，不重新判一次。
 */
import { Controller, ForbiddenException, Get, Inject, Param } from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import { getCheckinBoard } from "../../application/auth/get-checkin-board";
import { OrgAdminError } from "../../application/auth/org-invite-errors";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { LIVE_SESSION_REPOSITORY, type LiveSessionRepository } from "../../application/auth/live-session-ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const CHECKIN_BOARD_QUERY_SCHEMA = C.operations.getCheckinBoard.in;

@Controller()
export class CheckinBoardController {
  constructor(
    @Inject(LIVE_SESSION_REPOSITORY) private readonly liveSessions: LiveSessionRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  @Get(C.operations.getCheckinBoard.path)
  async board(@Param("projectId") projectId: string, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);

    // ⚠ 组织角色/团队、项目角色/组，都从库里读，不从请求读——同
    // `org-invite-link.controller.ts` `resolveOrgRole` 的既有纪律。读不到就是 `null`，
    // 由 `decideCheckinBoardAccess` 判定拒绝，不是这里代判。
    const [orgMembership, projectMembership] = await Promise.all([
      this.identities.findOrgMembership(principal.userId, orgId),
      this.identities.findProjectMembership(principal.userId, projectId, orgId),
    ]);

    try {
      const out = await getCheckinBoard(
        { liveSessions: this.liveSessions, ids: this.ids },
        {
          orgId,
          projectId,
          actorId: principal.userId,
          actorOrgRole: orgMembership?.orgRole ?? null,
          actorTeamId: orgMembership?.teamId ?? null,
          actorProjectRole: projectMembership?.projectRole ?? null,
          actorGroupId: projectMembership?.groupId ?? null,
        },
      );
      return {
        groups: out.groups.map((g) => ({
          groupId: g.groupId,
          title: g.title,
          present: g.present,
          total: g.total,
          links: g.links.map((l) => ({ url: l.url, qrPayload: l.qrPayload })),
          roster: g.roster.map((r) => ({ alias: r.alias, attendance: r.attendance })),
        })),
        overall: out.overall,
        realtime: out.realtime,
      };
    } catch (e) {
      if (e instanceof OrgAdminError) {
        // `get-checkin-board.ts` 的 `denied()` 只吐 NO_ORG_MEMBERSHIP / NO_PROJECT_ROLE，
        // 两者都是「读不到你」，映射成 403——同 `org-invite-link.controller.ts` 的
        // `mapAdminError` 对同族错误码的既有映射（此处没有 409/404 分支需要区分）。
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
