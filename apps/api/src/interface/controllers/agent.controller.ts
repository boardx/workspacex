/**
 * `POST /agents` -- 契约 `agentRuntime.operations.createAgent`（#617）。
 *
 * 独立文件，只挂 `createAgent` 这一条操作——`updateAgentDefinition` 同样零挂载
 * 但不在本次范围内（#617 任务说明），不在这里顺手接上，避免把两条不同的写路径
 * 混进一次审查。
 *
 * `AgentController` 与 `AgentTrialRunController` 都是 `@Controller()`（空前缀）、
 * 都落在裸的 `/agents` 前缀下，但方法不同（`POST /agents` vs
 * `POST /agents/:agentId/trial-run`）——Nest 按路径+方法整体匹配，两个控制器
 * 共存不冲突，与 `agent-trial-run.controller.ts` 文件头的独立文件理由相同。
 */
import { Body, Controller, ForbiddenException, Get, HttpStatus, Inject, NotFoundException, NotImplementedException, Param, Patch, Post, Query, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import { agentRuntime as C } from "@repo/contracts";
import type { AgentPublishStateName, AgentVisibility } from "../../domain/agent/definition";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  createAgent,
  CreateAgentError,
  CREATE_AGENT_REPOSITORY,
  type CreateAgentRepository,
} from "../../application/agent/create-agent";
import { listAgents, ListAgentsError, type ListAgentsRepository } from "../../application/agent/list-agents";
import {
  selfPublishToollessAgent,
  SelfPublishAgentError,
  SELF_PUBLISH_AGENT_REPOSITORY,
  type SelfPublishAgentRepository,
} from "../../application/agent/self-publish-toolless-agent";
import {
  setAgentInstructions,
  SetAgentInstructionsError,
  SET_AGENT_INSTRUCTIONS_REPOSITORY,
  type SetAgentInstructionsRepository,
} from "../../application/agent/set-agent-instructions";
import {
  setAgentRoleLabel,
  SetAgentRoleLabelError,
  SET_AGENT_ROLE_LABEL_REPOSITORY,
  type SetAgentRoleLabelRepository,
} from "../../application/agent/set-agent-role-label";
import {
  getAgentCapabilityGraph,
  GetAgentCapabilityGraphError,
} from "../../application/agent/get-agent-capability-graph";

type CreateAgentBody = ReturnType<typeof C.operations.createAgent.in.parse>;
type SelfPublishBody = ReturnType<typeof C.operations.selfPublishToollessAgent.in.parse>;
type UpdateAgentBody = ReturnType<typeof C.operations.updateAgentDefinition.in.parse>;

const ERROR_STATUS: Record<string, HttpStatus> = {
  ROLE_INSUFFICIENT: HttpStatus.FORBIDDEN,
  AGENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  AGENT_MARKET_NOT_AVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  /* #660 草案边的三条拒绝——都是 422「请求本身合法但当前状态不允许」。 */
  AGENT_NOT_DRAFT: HttpStatus.UNPROCESSABLE_ENTITY,
  AGENT_NOT_TOOLLESS: HttpStatus.UNPROCESSABLE_ENTITY,
  AGENT_VISIBILITY_UNSUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
  AGENT_NO_EXECUTABLE_DEFINITION: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Controller()
export class AgentController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    /**
     * `listAgents`（#1915）复用同一个注入 token：`PgCreateAgentRepository` 是同一个类
     * 同时实现 `CreateAgentRepository` 与 `ListAgentsRepository`（同一张表，`list()`
     * 挨着 `findForClone()`/`insert()` 写在同一个文件——见该文件头注「为什么不新开
     * 一个仓储文件」的同一条纪律）。两个接口类型合并成一个字段类型，
     * 不是两个 DI provider 指向同一个实例。
     */
    @Inject(CREATE_AGENT_REPOSITORY)
    private readonly repository: CreateAgentRepository & ListAgentsRepository,
    @Inject(SELF_PUBLISH_AGENT_REPOSITORY)
    private readonly selfPublishRepository: SelfPublishAgentRepository,
    @Inject(SET_AGENT_INSTRUCTIONS_REPOSITORY)
    private readonly instructionsRepository: SetAgentInstructionsRepository,
    @Inject(SET_AGENT_ROLE_LABEL_REPOSITORY)
    private readonly roleLabelRepository: SetAgentRoleLabelRepository,
  ) {}

  @Post(C.operations.createAgent.path)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.createAgent.in)) body: CreateAgentBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    try {
      const definition = await createAgent(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          name: body.name,
          initials: body.initials,
          role: body.role,
          roleLabel: body.roleLabel,
          visibility: body.visibility,
          cloneFrom: body.cloneFrom,
          source: body.source,
        },
        { identities: this.identities, repository: this.repository },
      );
      response.status(HttpStatus.CREATED);
      return C.operations.createAgent.out.parse({
        agentId: definition.agentId,
        publishState: definition.publishState,
        // ⚠ I-30：不是「碰巧是空数组」——`definition.toolWhitelist` 本身就是
        // `domain/agent/clone.ts` / `definition.ts` 保证恒为 `[]` 的那一个字段，
        // 这里原样透传，不是重新赋一次 `[]`（那样会看起来像是这一层的决定）。
        toolWhitelist: definition.toolWhitelist,
        cloneFrom: definition.cloneFrom,
      });
    } catch (error) {
      if (error instanceof CreateAgentError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /**
   * `POST /agents/:agentId/self-publish` —— #660。**⚠⚠ 草案边，尚未经人类签核**
   * （契约 `selfPublishToollessAgent` 头注 / `KNOWN_CONTRACT_GAPS.AR11`）。
   *
   * ⚠ 本方法**不**接收任何"这个 agent 有没有工具"的入参：`in` 只有 `agentId`。
   *   能力面、状态、可见性三项全部由用例从库里读出来交给 domain 判定。
   *   一个"调用方声明自己无工具"的入参就是这条豁免的绕过路径本身。
   */
  @Post(C.operations.selfPublishToollessAgent.path)
  async selfPublish(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(C.operations.selfPublishToollessAgent.in)) body: SelfPublishBody,
  ) {
    assertPrincipal(principal);
    // 路径与请求体不一致时按路径为准是"猜"——两者都写了就必须相等，
    // 同 `skill-review.controller.ts` 的 `assertPathMatchesBody`。
    if (body.agentId !== agentId) throw new NotFoundException({ reasonCode: "AGENT_NOT_FOUND" });
    try {
      const result = await selfPublishToollessAgent(
        { orgId: principal.orgId, actorId: principal.userId, agentId },
        { identities: this.identities, repository: this.selfPublishRepository },
      );
      return C.operations.selfPublishToollessAgent.out.parse({
        agentId: result.agentId,
        publishState: result.publishState,
        agentVersionId: result.agentVersionId,
        publishRoute: "自助发布",
      });
    } catch (error) {
      if (error instanceof SelfPublishAgentError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /**
   * `PATCH /agents/:agentId` —— #660 候选 A（instructions）+ #1705（#728 D-1，roleLabel）。
   *
   * ⚠ **只接 `patch.instructions` / `patch.roleLabel` 两个字段**。契约的 patch 还有另外
   * 六个，两轮加起来一共两个字段接线（见 `set-agent-instructions.ts` / `set-agent-role-label.ts`
   * 头注的范围说明）。收到其它字段时返回 **501 且不带 `reasonCode`**，**绝不静默忽略**
   * —— 静默忽略会让调用方以为改成功了，而那正是 #660 这一族 bug 的形状
   * （界面说成了，库里没变）。
   */
  @Patch(C.operations.updateAgentDefinition.path)
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(C.operations.updateAgentDefinition.in)) body: UpdateAgentBody,
  ) {
    assertPrincipal(principal);
    if (body.agentId !== agentId) throw new NotFoundException({ reasonCode: "AGENT_NOT_FOUND" });

    const { instructions, roleLabel, ...rest } = body.patch;
    const unsupported = Object.keys(rest);
    if (unsupported.length > 0) {
      throw new NotImplementedException(
        `updateAgentDefinition: 本轮只接线 instructions/roleLabel，未实现的字段：${unsupported.join(", ")}（#660 候选 A / #1705 范围）`,
      );
    }
    if (instructions === undefined && roleLabel === undefined) {
      throw new NotImplementedException("updateAgentDefinition: patch 为空——本轮只接线 instructions/roleLabel");
    }

    try {
      if (instructions !== undefined) {
        await setAgentInstructions(
          { orgId: principal.orgId, actorId: principal.userId, agentId, instructions },
          { identities: this.identities, repository: this.instructionsRepository },
        );
      }
      if (roleLabel !== undefined) {
        await setAgentRoleLabel(
          { orgId: principal.orgId, actorId: principal.userId, agentId, roleLabel },
          { identities: this.identities, repository: this.roleLabelRepository },
        );
      }
      // ⚠ 不回显 instructions（可能很长）——签核记录里那三条「刻意没做的事」第 3 条。
      // roleLabel 同理不回显：调用方已经知道自己刚发了什么，回显只是重复。
      return { agentId };
    } catch (error) {
      if (error instanceof SetAgentInstructionsError) throw this.toHttp(error.code);
      if (error instanceof SetAgentRoleLabelError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /**
   * `GET /agents/:agentId` —— #1911，agent 详情页「能力图」的数据源。
   * 只读，复用已注入的 `CREATE_AGENT_REPOSITORY`，但走的是
   * `findForCapabilityGraph`（#1918 hotfix，#1923）——**不是** `findForClone` 那条
   * 读路径，两者判据不同（见 `get-agent-capability-graph.ts` 头注）。不新增仓储
   * 文件、不碰任何写路径。
   *
   * ⚠ 与下面 `GET /agents`（`listAgents`，#1915）共存不冲突——Nest/Express 按路径
   *   整体匹配，`/agents` 这个裸静态路径不会命中要求 `:agentId` 段存在的这一条。
   */
  @Get(C.operations.getAgentCapabilityGraph.path)
  async getCapabilityGraph(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
  ) {
    assertPrincipal(principal);
    try {
      const result = await getAgentCapabilityGraph(
        { orgId: principal.orgId, agentId },
        { repository: this.repository },
      );
      return C.operations.getAgentCapabilityGraph.out.parse(result);
    } catch (error) {
      if (error instanceof GetAgentCapabilityGraphError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /**
   * `GET /agents` —— `listAgents`（#1915）。F55 Agent 库的第一条读路径，见
   * `application/agent/list-agents.ts` 头注的完整理由（授权门 / `tag` 为什么不生效）。
   *
   * ⚠ 查询字符串没有 `null` 这个类型——契约的 `in` 是 `z.object({...}).strict()` 且三个
   * 字段全部 `.nullable()`（不是 `.optional()`）,直接把裸 `@Query()` 丢给
   * `ZodBodyPipe(C.operations.listAgents.in)` 会让"没传"（`undefined`）在 `.strict()`
   * 下过不了 parse。所以这里先把"缺失"归一成显式 `null`，再交给契约的 schema 校验——
   * schema 仍然是唯一来源，只是校验前多一步"HTTP 查询字符串 → 契约输入形状"的转换，
   * 与 `listResearch`（同样三个 `.nullable()` 字段的 GET）尚未实现、没有先例可抄的
   * 情况一致：这里是本仓第一条这么接的路由。
   */
  @Get(C.operations.listAgents.path)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("tag") tagRaw: string | undefined,
    @Query("publishState") publishStateRaw: string | undefined,
    @Query("visibility") visibilityRaw: string | undefined,
  ) {
    assertPrincipal(principal);
    // ⚠ 空字符串与"完全没传"归一成同一个 null——`?tag=&publishState=&visibility=`
    // 是浏览器 URLSearchParams 序列化"这个过滤器我没设值"的常见形态，不该被当成
    // "过滤成空字符串"而落进 enum 校验失败。
    const normalize = <T extends string>(raw: string | undefined): T | null =>
      raw === undefined || raw === "" ? null : (raw as T);
    // ⚠ 手工构造归一化对象后，仍然经**同一个** `ZodBodyPipe`（与其它路由用的类完全相同）
    // 校验一遍——publishState/visibility 若传了不认识的值，走的是与其它路由相同的
    // `ContractValidationError` 字段级失败面，不是这里另开一条 400。
    const query = new ZodBodyPipe(C.operations.listAgents.in).transform({
      tag: normalize<string>(tagRaw),
      publishState: normalize<AgentPublishStateName>(publishStateRaw),
      visibility: normalize<AgentVisibility>(visibilityRaw),
    }) as ReturnType<typeof C.operations.listAgents.in.parse>;
    try {
      const rows = await listAgents(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          tag: query.tag,
          publishState: query.publishState,
          visibility: query.visibility,
        },
        { identities: this.identities, repository: this.repository },
      );
      return C.operations.listAgents.out.parse(
        rows.map((row) => ({
          agentId: row.agentId,
          initials: row.initials,
          name: row.name,
          role: row.role,
          roleLabel: row.roleLabel,
          visibility: row.visibility,
          publishState: row.publishState,
          modelId: row.modelId,
          skillCount: row.skillCount,
          // D-07：phase-1 恒为 null——见契约 `AgentRow.monthlyCallCount` 头注。
          monthlyCallCount: null,
        })),
      );
    } catch (error) {
      if (error instanceof ListAgentsError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /** 码 → HTTP 的唯一映射点，三条路由共用（同一张 `ERROR_STATUS` 表）。 */
  private toHttp(code: string) {
    const status = ERROR_STATUS[code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
    if (status === HttpStatus.FORBIDDEN) return new ForbiddenException({ reasonCode: code });
    if (status === HttpStatus.NOT_FOUND) return new NotFoundException({ reasonCode: code });
    return new UnprocessableEntityException({ reasonCode: code });
  }
}
