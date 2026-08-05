/**
 * #467 / #509 —— 对话内临时挂载 skill（F65）的 HTTP 边界。
 *
 * 在这个文件之前，`application/skill/` 下的 `mountSkillToThread` /
 * `unmountSkillFromThread` 有完整实现与单测，但**没有任何路由到得了它们**——
 * 界面上的「挂 skill」因此只能是假的。本文件是那条边界。
 *
 * 三条路径**全部**取自 `packages/contracts/src/skills.ts` 的 `operations`，
 * 路径与方法不手写字符串（ADR-020）：
 *
 *   · `mountSkillToThread`     POST   /threads/:threadId/skill-mounts
 *   · `unmountSkillFromThread` DELETE /threads/:threadId/skill-mounts/:mountId
 *   · `listThreadDeviations`   GET    /threads/:threadId/skill-deviations
 *
 * ## 为什么第三条是 `listThreadDeviations` 而不是 `resolveMountedSkills`
 *
 * 界面刷新后必须还能看见「我挂了什么」，否则挂载只活在浏览器内存里。契约里唯一
 * 会吐出 `ThreadSkillMount[]` 的读操作就是 `listThreadDeviations.out.temporary`。
 * `resolveMountedSkills`（F64，按议程环节自动挂载）读的是**蓝本编排**，
 * 而 `ProjectOrchestrationStorePort` 今天没有适配器——把它接出来只会得到一条
 * 恒返回 `DEPENDENCY_UNAVAILABLE` 的路由，即界面上一个骗人的入口。不接。
 *
 * ## 可选池走既有的 `GET /skills`
 *
 * 契约另有 `listMountableSkills`（`/threads/:threadId/mountable-skills`），它的
 * `boundBySegment` 同样要读蓝本编排 ⇒ 同上，今天接不出真东西。前端的选择池因此
 * 复用**已经存在且真实**的 `listSkills`（`skill.controller.ts`）并按 `已启用` 过滤。
 * 少一条路由，且没有一个字段是编出来的。
 *
 * ## 角色判定在服务端，且只有一处
 *
 * `mountSkillToThread` 的 `role` 来自 `project_memberships.project_role`
 * （经 `deliverRoleOfProjectRole`，`domain/skill/binding-slot.ts`），**不来自请求**。
 * 组员 / 组长 / 观察者一律被用例拒绝并写安全审计（V4 / I-23）——本 controller
 * **不自己判一次**：在这里加一个「不是引导师就 403」的分支，就是同一条规则的
 * 第二份副本，而它与用例里那份必然有一天不一致。
 */
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { skills as C } from "@repo/contracts";
import { mountSkillToThread } from "../../application/skill/mount-skill-to-thread";
import { unmountSkillFromThread } from "../../application/skill/unmount-skill-from-thread";
import { listThreadDeviations } from "../../application/skill/list-thread-deviations";
import { decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import { discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { deliverRoleOfProjectRole, type DeliverRole } from "../../domain/skill/binding-slot";
import { isSelfMountAllowed } from "../../domain/skill/thread-mount";
import { mountListFingerprint } from "../../domain/skill/thread-mount";
import {
  SKILL_CONTRACT_REPOSITORY,
  SKILL_SECURITY_AUDIT,
  THREAD_MOUNT_STORE,
  type SecurityAuditPort,
  type SkillContractRepositoryFactory,
  type SkillVisibilityPort,
  type ThreadMountStoreFactory,
} from "../../application/skill/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type MountBody = {
  readonly threadId: string;
  readonly skillIds: string[];
  readonly expectedVersion: string;
};

/**
 * 蓝本绑定基线 —— 今天恒为空，**且这件事有一个可指的原因**：
 * `ProjectOrchestrationStorePort` 没有适配器（F63/F64 的落库不在 #467 范围内），
 * 所以这套系统里此刻**不可能存在**任何环节绑定。空基线不是缺省值，是真值。
 *
 * ⚠ 接上编排存储的那一天，改的是**这一行**（换成一次真实读取），
 *   而不是 `list-thread-deviations.ts` 里的差异运算——那里没有「基线为空」的分支。
 */
const NO_SEGMENT_BINDINGS: readonly string[] = [];

@Controller()
export class SkillMountController {
  constructor(
    @Inject(SKILL_CONTRACT_REPOSITORY) private readonly repositories: SkillContractRepositoryFactory,
    @Inject(THREAD_MOUNT_STORE) private readonly mountStores: ThreadMountStoreFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_SECURITY_AUDIT) private readonly audit: SecurityAuditPort,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  /* ────────── POST /threads/:threadId/skill-mounts ────────── */

  @Post(C.operations.mountSkillToThread.path)
  async mount(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string | undefined,
    @Body(new ZodBodyPipe(C.operations.mountSkillToThread.in)) body: MountBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    this.assertPathMatchesBody(threadId, body.threadId);
    const project = this.requireProjectId(projectId);

    const result = await mountSkillToThread(
      {
        threadId,
        principalId: principal.userId,
        // ⚠ 服务端解析，不信任前端。读不到成员关系 ⇒ `null` ⇒ 用例拒绝并写审计。
        role: (await this.deliverRoleOf(principal, project)) ?? "",
        skillIds: body.skillIds,
        // 每条挂载一个 uuid。`mountIdFor` 收 index 只是为了让测试能给可预期的值，
        // 生产就是「一次一个新 id」——不复用 skillId 之类的东西：同一个 skill
        // 可以被挂上、摘掉、再挂上，那是三行历史而不是一行被改了两次。
        mountIdFor: () => randomUUID(),
        mountedAt: new Date().toISOString(),
        expectedFingerprint: body.expectedVersion,
      },
      {
        mounts: this.mountStores.forOrg(principal.orgId),
        skills: await this.visibilityPort(principal),
        audit: this.audit,
        fingerprintOf: mountListFingerprint,
      },
    );

    if (!result.ok) throw this.toHttpError(result.code);

    response.status(HttpStatus.CREATED);
    return C.operations.mountSkillToThread.out.parse({ mounts: result.mounts });
  }

  /* ────── DELETE /threads/:threadId/skill-mounts/:mountId ────── */

  @Delete(C.operations.unmountSkillFromThread.path)
  async unmount(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Param("mountId") mountId: string,
    @Query("projectId") projectId: string | undefined,
  ) {
    assertPrincipal(principal);
    await this.assertMayWriteMounts(principal, this.requireProjectId(projectId), threadId, mountId);

    const result = await unmountSkillFromThread(
      { threadId, mountId, removedAt: new Date().toISOString() },
      { mounts: this.mountStores.forOrg(principal.orgId) },
    );

    if (!result.ok) throw this.toHttpError(result.code);
    return C.operations.unmountSkillFromThread.out.parse({
      mountId: result.mountId,
      removedAt: result.removedAt,
    });
  }

  /* ────────── GET /threads/:threadId/skill-deviations ────────── */

  @Get(C.operations.listThreadDeviations.path)
  async deviations(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string | undefined,
  ) {
    assertPrincipal(principal);
    // ⚠ 读对**本项目的任意角色**开放，含组员与观察者（V5：组员看得见、但没有增删改入口）。
    //   要求的是「你在这个项目里」，不是「你是引导师」——把读也收成引导师专属，
    //   组员就再也看不到自己这场挂了什么，那与 V5 直接矛盾。
    await this.assertProjectMember(principal, this.requireProjectId(projectId));

    const result = await listThreadDeviations(
      { threadId, bindingSkillIds: NO_SEGMENT_BINDINGS },
      { mounts: this.mountStores.forOrg(principal.orgId) },
    );

    return C.operations.listThreadDeviations.out.parse(result);
  }

  /* ─────────────────────────── 内部 ─────────────────────────── */

  /**
   * 契约的 `mountSkillToThread.in` 同时带路径参数 `threadId` 和请求体 `threadId`。
   * 不一致时**拒绝**，而不是「以路径为准、悄悄忽略请求体那个」——后者会让调用方
   * 以为自己在改 B 线程、实际改了 A 线程，且没有任何地方看得出来
   * （同 `skill.controller.ts` 的 `assertOwnTenant` 那条纪律）。
   */
  private assertPathMatchesBody(pathValue: string, bodyValue: string): void {
    if (pathValue !== bodyValue) {
      throw new UnprocessableEntityException({ reasonCode: "CONTRACT_VALIDATION_FAILED" });
    }
  }

  /**
   * `projectId` 走 query —— 与 `getAgentPanel` / `updateAgentRoster`
   * （`chat.controller.ts`）同一个落法，不是本路由特有的怪癖：契约的 `in` 是
   * `.strict()` 的，把 `projectId` 塞进 body 会被拒。
   *
   * ⚠ 缺了它**拒绝**，不是「退化成组员」：角色解析不出来时放行一个较低权限，
   *   等于给「不带 projectId 就绕过引导师判定」留了一条路。
   */
  private requireProjectId(projectId: string | undefined): string {
    if (projectId === undefined || projectId === "") {
      throw new UnprocessableEntityException({ reasonCode: "CONTRACT_VALIDATION_FAILED" });
    }
    return projectId;
  }

  /**
   * 写路径（摘除）的授权 —— **判据复用 domain 的 `isSelfMountAllowed`**，不在这里
   * 重写一个「是不是引导师」的谓词。挂载那半由 `mountSkillToThread` 内部同一个函数判；
   * 两处指向同一个 domain 函数，所以「下放开关落地」的那天改的仍然只有那一个函数。
   *
   * ⚠ 拒绝时**写安全审计**（I-23）：一次没有留痕的拒绝，事后无法与「从未发生」区分。
   *   审计 kind 沿用挂载那条 —— 它记的是同一条 R3 流程上的越权尝试，
   *   为「摘除」单开一个 kind 会让同一件事在审计里分成两半。
   */
  private async assertMayWriteMounts(
    principal: Principal,
    projectId: string,
    threadId: string,
    detail: string,
  ): Promise<void> {
    const role = await this.deliverRoleOf(principal, projectId);
    if (role !== null && isSelfMountAllowed(role)) return;
    await this.audit.record({
      kind: "skill-member-self-mount-attempt",
      principalId: principal.userId,
      detail: `role=${role ?? "none"} 试图在 thread=${threadId} 摘除挂载（${detail}），服务端拒绝`,
    });
    throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
  }

  /** 读路径：只要求「你在这个项目里」。不在 ⇒ 403，不是空列表——空列表会被读成「没挂东西」。 */
  private async assertProjectMember(principal: Principal, projectId: string): Promise<void> {
    const membership = await this.identities.findProjectMembership(
      principal.userId,
      projectId,
      toOrgId(principal.orgId),
    );
    if (membership === null) throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
  }

  /** `null` = 不在这个项目里，或角色不对应任何下发角色（observer）。 */
  private async deliverRoleOf(principal: Principal, projectId: string): Promise<DeliverRole | null> {
    const membership = await this.identities.findProjectMembership(
      principal.userId,
      projectId,
      toOrgId(principal.orgId),
    );
    return deliverRoleOfProjectRole(membership?.projectRole ?? null);
  }

  /**
   * `SkillVisibilityPort` 的适配 —— 复用 `getSkillDetail` 那条**唯一**的可见性判定
   * （`decideCapabilityVisibility` + `discloseDecided`），不在这里新写一份过滤。
   *
   * ⚠ `currentVersionId === null` 折成 `SKILL_NOT_FOUND`（返回 `null`）：一个没有
   *   生效版本的 skill 挂上去，`ThreadSkillMount.versionId` 就没有真实取值可填。
   *   编一个空串会让复盘时「当时挂的是哪一版」永久不可回答。
   *   实践中这一支到不了——`已启用` 蕴含有生效版本——但它是编译期就得答的问题。
   */
  private async visibilityPort(principal: Principal): Promise<SkillVisibilityPort> {
    const repository = this.repositories.forOrg(principal.orgId);
    const membership = await this.identities.findOrgMembership(
      principal.userId,
      toOrgId(principal.orgId),
    );
    const ids = this.ids;
    return {
      async visibleTo({ skillId }) {
        const guarded = await repository.loadDetail(skillId);
        if (guarded === null) return null;
        const disclosed = discloseDecided(
          guarded.detail,
          decideCapabilityVisibility({
            decisionId: ids.next(),
            orgRole: membership?.orgRole ?? null,
            requesterTeamId: membership?.teamId ?? null,
            scope: guarded.facts.scope,
            ownerTeamId: guarded.facts.ownerTeamId,
          }),
        );
        if (!isDisclosed(disclosed)) return null;
        const row = disclosed.payload.row;
        if (row.currentVersionId === null) return null;
        return { status: row.status, currentVersionId: row.currentVersionId };
      },
    };
  }

  private toHttpError(code: string): Error {
    switch (code) {
      case "SKILL_NOT_FOUND":
        return new NotFoundException({ reasonCode: code });
      case "MEMBER_CANNOT_SELF_MOUNT":
      case "MOUNT_SCOPE_VIOLATION":
      case "PERMISSION_REVOKED":
        return new ForbiddenException({ reasonCode: code });
      case "SKILL_VERSION_CHANGED":
        return new ConflictException({ reasonCode: code });
      default:
        // `SKILL_NOT_ENABLED` / `CONTEXT_BUDGET_EXCEEDED` / …
        return new UnprocessableEntityException({ reasonCode: code });
    }
  }
}
