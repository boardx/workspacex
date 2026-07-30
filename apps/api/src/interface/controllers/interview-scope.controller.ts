/**
 * 访谈范围与列表的两条读路由（F80）。协议适配 only —— 每一处判断都在 `application`。
 *
 * ## 状态码
 *
 *   403 + reasonCode SCOPE_NOT_VISIBLE   这个范围档位对你不该显示。**不是 404**：
 *                                        范围（项目）是否存在本来就是项目层的可见事实，
 *                                        把它做成 404 反而多说了一句。
 *   404                                  `NO_INTERVIEW_ACCESS`。无权与不存在**同一个响应**，
 *                                        且响应体逐字节相同（uc-6-0/E3 的枚举探测面）——
 *                                        所以这里不带 reasonCode、不带 id、不带任何区分位。
 *   422                                  范围选择器自相矛盾（`kind:"none"` 却带了 projectId）。
 *                                        契约的 `InterviewError` 没有对应码，见 `errors.ts`。
 *
 * ## GET 的入参也过契约 schema
 *
 * 两条都是 GET，没有 body，所以契约的 `in` 被应用在**拼装出来的参数对象**上而不是被跳过。
 * 跳过它意味着：全项目唯一没有请求体的操作，同时也是唯一没有任何东西校验的操作。
 *
 * ⚠ 查询串到 `InterviewScope` 的映射（`scopeKind` / `projectId` / `researchProjectId`
 * 三个查询参数拼成一个对象）是**本层的编码决定**，契约只规定了对象形状不规定查询串形状。
 * 拼装完立刻交给契约 schema 判，所以映射错了会在这里 400，而不是在仓储里变成一次奇怪的查询。
 */
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { interview as C } from "@repo/contracts";
import { getInterview } from "../../application/interview/get-interview";
import { listInterviews } from "../../application/interview/list-interviews";
import {
  IncoherentScopeError,
  NoInterviewAccessError,
  ScopeNotVisibleError,
} from "../../application/interview/errors";
import {
  INTERVIEW_SCOPE_REPOSITORY,
  type InterviewScopeRepository,
} from "../../application/interview/ports";
import {
  DECISION_ID_FACTORY,
  type DecisionIdFactory,
} from "../../application/identity/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const LIST_INTERVIEWS_SCHEMA = C.operations.listInterviews.in;
export const GET_INTERVIEW_SCHEMA = C.operations.getInterview.in;

type ListInput = {
  scope: { kind: "project" | "research" | "none"; projectId: string | null; researchProjectId: string | null };
  filters?: { tags: string[] | null; archived: boolean | null };
  cursor?: string;
  limit?: number;
};

/** `?archived=true|false`，缺省 = 不筛。三态，所以不能用 `=== "true"` 一句话打发。 */
function triBool(v: string | undefined): boolean | null {
  if (v === undefined || v === "") return null;
  return v === "true";
}

@Controller()
export class InterviewScopeController {
  constructor(
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly repo: InterviewScopeRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
  ) {}

  @Get("/interviews")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("scopeKind") scopeKind?: string,
    @Query("projectId") projectId?: string,
    @Query("researchProjectId") researchProjectId?: string,
    @Query("tags") tags?: string,
    @Query("archived") archived?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    assertPrincipal(principal);
    const assembled = {
      scope: {
        kind: scopeKind,
        // 查询串里「没写」与「写了空」都当成 null —— 契约那三个字段是 nullable 而不是 optional，
        // 少一个键会被 `.strict()` 直接判 400，而那个 400 说的是「schema 不匹配」，
        // 不是调用方真正做错的事。
        projectId: projectId === undefined || projectId === "" ? null : projectId,
        researchProjectId:
          researchProjectId === undefined || researchProjectId === "" ? null : researchProjectId,
      },
      filters: {
        tags: tags === undefined || tags === "" ? null : tags.split(","),
        archived: triBool(archived),
      },
      ...(cursor === undefined || cursor === "" ? {} : { cursor }),
      // 查询串里一切都是字符串；契约要 number。在**校验之前**转一次，
      // 转不出数就让 schema 去拒绝它（`Number("abc")` 是 NaN，`z.number().int()` 会红）。
      ...(limit === undefined || limit === "" ? {} : { limit: Number(limit) }),
    };
    const input = new ZodBodyPipe(LIST_INTERVIEWS_SCHEMA).transform(assembled) as ListInput;

    return this.run(() =>
      listInterviews(
        { repo: this.repo, decisions: this.decisions },
        {
          orgId: principal.orgId,
          viewerUserId: principal.userId,
          scope: input.scope,
          filters: input.filters,
          cursor: input.cursor,
          limit: input.limit,
        },
      ),
    );
  }

  @Get("/interviews/:interviewId")
  async get(@CurrentPrincipal() principal: Principal, @Param("interviewId") interviewId: string) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(GET_INTERVIEW_SCHEMA).transform({ interviewId }) as {
      interviewId: string;
    };
    return this.run(() =>
      getInterview(
        { repo: this.repo, provenance: this.provenance, decisions: this.decisions },
        { orgId: principal.orgId, viewerUserId: principal.userId, interviewId: input.interviewId },
      ),
    );
  }

  /**
   * 唯一的失败映射表。
   *
   * ⚠ 404 分支**没有** message、没有 reasonCode、没有 id。
   * 「无权」与「不存在」必须逐字节不可区分，而最容易破坏这一点的就是
   * 一句看起来很有帮助的 `not_found: itv-xxx`。这里也不读异常的 message ——
   * 那条 message 里带着调用者刚刚被拒绝访问的那个 id。
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof NoInterviewAccessError) throw new NotFoundException();
      if (e instanceof ScopeNotVisibleError) {
        throw new ForbiddenException({ reasonCode: "SCOPE_NOT_VISIBLE" });
      }
      if (e instanceof IncoherentScopeError) {
        throw new UnprocessableEntityException("scope_selector_inconsistent");
      }
      throw e;
    }
  }
}
