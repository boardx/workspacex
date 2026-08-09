/**
 * `POST /agents/:agentId/submit` 与 `POST /agents/:agentId/publish-decision`
 * —— 契约 `agentRuntime.operations.submitAgentForReview` / `decideAgentPublish`（#660）。
 *
 * 独立文件、独立 `@Controller()`，与 `agent.controller.ts`（`POST /agents`）和
 * `agent-trial-run.controller.ts` 共存不冲突（Nest 按路径+方法整体匹配），
 * 理由与那两个文件头逐字相同：不同的写路径不混进一次审查。
 */
import {
  Body,
  Controller,
  ConflictException,
  HttpCode,
  ForbiddenException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { agentRuntime as C } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  AgentPublishError,
  AGENT_PUBLISH_REPOSITORY,
  AGENT_REVIEWER_FUNCTION_PORT,
  decideAgentPublish,
  submitAgentForReview,
  type AgentPublishRepository,
  type AgentReviewerFunctionPort,
} from "../../application/agent/agent-publish";

type DecideBody = ReturnType<typeof C.operations.decideAgentPublish.in.parse>;

/**
 * 错误码 → HTTP。
 * ⚠ 「这个人没资格」(403) 与「这个 agent 还不够格」(422) 分开——同 skill 评审的分法：
 *   对错的人先答「你不能问」，不要先泄漏「这个 agent 哪里不合格」。
 */
const ERROR_STATUS: Record<string, HttpStatus> = {
  AGENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  ROLE_INSUFFICIENT: HttpStatus.FORBIDDEN,
  WRONG_REVIEW_FUNCTION: HttpStatus.FORBIDDEN,
  SELF_REVIEW_FORBIDDEN: HttpStatus.FORBIDDEN,
  AGENT_STATE_CONFLICT: HttpStatus.CONFLICT,
};

function rethrow(error: unknown): never {
  if (error instanceof AgentPublishError) {
    const status = ERROR_STATUS[error.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
    if (status === HttpStatus.NOT_FOUND) throw new NotFoundException({ reasonCode: error.code });
    if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
    /**
     * ⚠ **裸 409，故意不带 `reasonCode`**（见契约已知缺口 `AR9`）。
     *
     * 「前驱状态不对」（重复提交 / 直接批准一个草稿）是一个**必须拦**的失败，
     * 但两个操作的 `err` 数组里**都没有能表达它的码**。`all-exceptions.filter.ts` 只放行
     * 解析得过契约闭集枚举的 `reasonCode`，所以随手编一个 `AGENT_STATE_CONFLICT`
     * 会被它当场丢掉——**这是过滤器设计对了，不是它挡了路**：
     * 发明一个码等于替签核人扩契约（AR7 逐字写过同一条理由）。
     *
     * ⇒ 这里只用 HTTP 语义（409 = 冲突）表达，不注入自造枚举；缺口登记在 `AR9`，
     *   等人类签核补码之后再把 `reasonCode` 加回来。
     *   同样的处理在本仓有先例：`interview-scope.controller.ts` 抛的是不带
     *   `reasonCode` 的裸 404（见过滤器文件里那段注释）。
     */
    if (status === HttpStatus.CONFLICT) throw new ConflictException();
    throw new UnprocessableEntityException({ reasonCode: error.code });
  }
  throw error;
}

@Controller()
export class AgentPublishController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AGENT_PUBLISH_REPOSITORY) private readonly repository: AgentPublishRepository,
    @Inject(AGENT_REVIEWER_FUNCTION_PORT) private readonly reviewerFunctions: AgentReviewerFunctionPort,
  ) {}

  /** 状态迁移，不是创建资源 ⇒ 200 而不是 Nest 对 POST 的默认 201。 */
  @Post(C.operations.submitAgentForReview.path)
  @HttpCode(HttpStatus.OK)
  async submit(@CurrentPrincipal() principal: Principal, @Param("agentId") agentId: string) {
    assertPrincipal(principal);
    try {
      const result = await submitAgentForReview(
        { orgId: principal.orgId, actorId: principal.userId, agentId },
        { identities: this.identities, repository: this.repository, reviewerFunctions: this.reviewerFunctions },
      );
      return C.operations.submitAgentForReview.out.parse(result);
    } catch (error) {
      rethrow(error);
    }
  }

  @Post(C.operations.decideAgentPublish.path)
  @HttpCode(HttpStatus.OK)
  async decide(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(C.operations.decideAgentPublish.in)) body: DecideBody,
  ) {
    assertPrincipal(principal);
    try {
      const result = await decideAgentPublish(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          // ⚠ 路径参数是权威：body.agentId 与它不一致时以路径为准，不接受请求体改写目标。
          agentId,
          decision: body.decision,
        },
        { identities: this.identities, repository: this.repository, reviewerFunctions: this.reviewerFunctions },
      );
      return C.operations.decideAgentPublish.out.parse(result);
    } catch (error) {
      rethrow(error);
    }
  }
}
