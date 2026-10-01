/**
 * 首页「项目卡协作者」与「当前任务锚点」（ad-hoc feature，Refs #4698）。
 *
 *   GET /home/project-previews   当前登录者
 *
 * 为什么是服务端聚合，而不是让首页逐个 `GET /projects/:id/members`：组织 admin/lead 在项目列表里
 * 能「管理」看到很多自己不是成员的项目，逐个探测得到的是必然的 403——既是浏览器 console 噪音，
 * 也让服务端留下一串被拒记录（`project-create-smoke` 会逐条核对 403 正是为了守这一点）。
 * 这里在进程内复用既有的两个成员用例（工作坊成员表 / 研究·洞察协作者表），它们各自的
 * 「必须有项目角色」判定原样生效；**判为无角色的项目直接略过**，所以响应里出现某个项目 ⟺
 * 调用者是该项目成员。授权没有新写一份——仍然只由那两个用例裁决，本 controller 只做「列表 × 逐个求值」。
 * 只投影 `userId`/`displayName`（两个成员接口已对项目成员公开的字段）。
 *
 * 出现在项目列表里 ≠ 能读内容（D-18）：本接口不带任何内容摘要或计数。
 */
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { project as C } from "@repo/contracts";
import { listProjects } from "../../application/project/list-projects";
import { listProjectMembers } from "../../application/project/list-project-members";
import { listNonWorkshopMembers } from "../../application/project/list-non-workshop-member";
import {
  NON_WORKSHOP_MEMBER_REPOSITORY,
  type NonWorkshopMemberRepository,
} from "../../application/project/non-workshop-member-ports";
import { ProjectError, ProjectKindMismatchError } from "../../application/project/errors";
import { PROJECT_LIST_REPOSITORY, type ProjectListRepository } from "../../application/project/ports";
import {
  PROJECT_MEMBER_ROSTER_REPOSITORY,
  type ProjectMemberRosterRepository,
} from "../../application/project/member-ports";
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

/** 首页最多展示 4 张项目卡；多取一点给「略过无角色项目」留余量，仍是有界的。 */
const MAX_PROJECTS_EXAMINED = 8;
const MAX_PREVIEWS = 6;

type Member = { userId: string; displayName: string };

@Controller()
export class HomeProjectPreviewsController {
  constructor(
    @Inject(PROJECT_LIST_REPOSITORY) private readonly listRepo: ProjectListRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(PROJECT_MEMBER_ROSTER_REPOSITORY) private readonly roster: ProjectMemberRosterRepository,
    @Inject(NON_WORKSHOP_MEMBER_REPOSITORY) private readonly nonWorkshopMembers: NonWorkshopMemberRepository,
  ) {}

  @Get(C.operations.getHomeProjectPreviews.path)
  async previews(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    try {
      const all = await listProjects(
        { repo: this.listRepo, identity: this.identity },
        { orgId, actorId: principal.userId },
      );
      const active = all.filter((p) => p.readOnlyReason !== "archived").slice(0, MAX_PROJECTS_EXAMINED);

      const items: { projectId: string; members: Member[] }[] = [];
      for (const p of active) {
        if (items.length >= MAX_PREVIEWS) break;
        const members = await this.membersIfPermitted(principal.userId, orgId, p.id, p.kind);
        if (members !== null) items.push({ projectId: p.id, members });
      }
      return C.operations.getHomeProjectPreviews.out.parse({ items });
    } catch (e) {
      if (e instanceof ProjectError && e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
        throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /** `null` = 调用者在该项目里没有项目角色（或容器类型对不上）→ 略过。其余错误（含 503）照常上抛。 */
  private async membersIfPermitted(
    userId: string,
    orgId: ReturnType<typeof toOrgId>,
    projectId: string,
    kind: string,
  ): Promise<Member[] | null> {
    try {
      if (kind === "workshop") {
        const out = await listProjectMembers(
          { auth: { repo: this.identity, ids: this.decisions }, roster: this.roster },
          { userId, orgId, projectId },
        );
        if (out.members === null) return null;
        return out.members.map((m) => ({ userId: m.userId, displayName: m.displayName }));
      }
      const out = await listNonWorkshopMembers(
        { identity: this.identity, ids: this.decisions, members: this.nonWorkshopMembers },
        { actorId: userId, orgId, projectId },
      );
      return out.members.map((m) => ({ userId: m.userId, displayName: m.displayName }));
    } catch (e) {
      if (e instanceof ProjectKindMismatchError) return null;
      if (e instanceof ProjectError && e.reasonCode !== "AUTH_SERVICE_UNAVAILABLE") return null;
      throw e;
    }
  }
}
