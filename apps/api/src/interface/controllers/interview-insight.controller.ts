/**
 * 洞察写路径的三条路由（F01，uc-6-5 R3 step1-3）。协议适配 only。
 *
 *   404  NO_INTERVIEW_ACCESS               无权/不存在（extractQuotes）。
 *   409  INSIGHT_NO_EVIDENCE               候选/确认阶段缺证据（I-29）。
 *   409  CONCURRENT_MODIFICATION           candidateId 已确认/不存在。
 *   503  AI_GENERATION_UNAVAILABLE         归纳服务失败，已抽引述保留（E1）。
 *   503  DEPENDENCY_UNAVAILABLE            Context Pack 不可读。
 */
import { Body, Controller, ForbiddenException, Inject, NotFoundException, Param, Post, ServiceUnavailableException, ConflictException } from "@nestjs/common";
import { interview as C } from "@repo/contracts";
import type { z } from "zod";
import { extractQuotes } from "../../application/interview/extract-quotes";
import { generateCandidateInsights } from "../../application/interview/generate-candidate-insights";
import { confirmInsight } from "../../application/interview/confirm-insight";
import { markStrongInsight } from "../../application/interview/mark-strong-insight";
import { referenceForDecision } from "../../application/interview/reference-for-decision";
import {
  InsightCandidateNotFoundError,
  InsightDependencyUnavailableError,
  InsightGenerationUnavailableError,
  InsightNoEvidenceError,
  NoInterviewAccessError,
  VirtualSourceForbiddenError,
} from "../../application/interview/errors";
import { INTERVIEW_SCOPE_REPOSITORY, type InterviewScopeRepository } from "../../application/interview/ports";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import {
  CANDIDATE_INSIGHT_GENERATOR,
  CONSENT_DECLINE_READER,
  INSIGHT_CANDIDATE_STORE,
  INSIGHT_CONTEXT_API,
  INSIGHT_REPOSITORY,
  QUOTE_REPOSITORY,
  SEGMENT_READER,
  type CandidateInsightGenerator,
  type ConsentDeclineReader,
  type InsightCandidateStore,
  type InsightContextApi,
  type InsightRepository,
  type QuoteRepository,
  type SegmentReader,
} from "../../application/interview/insight-ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
export class InterviewInsightController {
  constructor(
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly scope: InterviewScopeRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
    @Inject(SEGMENT_READER) private readonly segments: SegmentReader,
    @Inject(QUOTE_REPOSITORY) private readonly quotes: QuoteRepository,
    @Inject(INSIGHT_CONTEXT_API) private readonly context: InsightContextApi,
    @Inject(CONSENT_DECLINE_READER) private readonly consent: ConsentDeclineReader,
    @Inject(CANDIDATE_INSIGHT_GENERATOR) private readonly generator: CandidateInsightGenerator,
    @Inject(INSIGHT_CANDIDATE_STORE) private readonly candidates: InsightCandidateStore,
    @Inject(INSIGHT_REPOSITORY) private readonly insights: InsightRepository,
  ) {}

  @Post("/interviews/:interviewId/quotes")
  async extract(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body(new ZodBodyPipe(C.operations.extractQuotes.in))
    body: z.infer<typeof C.operations.extractQuotes.in>,
  ) {
    assertPrincipal(principal);
    return this.run(() =>
      extractQuotes(
        { scope: this.scope, decisions: this.decisions, segments: this.segments, quotes: this.quotes, ids: this.ids },
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          interviewId,
          segmentIds: [...body.segmentIds],
          rqBinding: body.rqBinding,
        },
      ),
    );
  }

  @Post("/interviews/insights/candidates")
  async generate(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.generateCandidateInsights.in))
    body: z.infer<typeof C.operations.generateCandidateInsights.in>,
  ) {
    assertPrincipal(principal);
    return this.run(() =>
      generateCandidateInsights(
        {
          context: this.context,
          quotes: this.quotes,
          consent: this.consent,
          generator: this.generator,
          candidates: this.candidates,
          ids: this.ids,
        },
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          interviewId: body.interviewId,
          themeScope: body.themeScope,
          contextPackId: body.contextPackId,
        },
      ),
    );
  }

  @Post("/interviews/insights/:candidateId/confirm")
  async confirm(
    @CurrentPrincipal() principal: Principal,
    @Param("candidateId") candidateId: string,
    @Body(new ZodBodyPipe(C.operations.confirmInsight.in))
    body: z.infer<typeof C.operations.confirmInsight.in>,
  ) {
    assertPrincipal(principal);
    return this.run(() =>
      confirmInsight(
        { candidates: this.candidates, quotes: this.quotes, insights: this.insights },
        { orgId: principal.orgId, actorId: principal.userId, candidateId, edits: body.edits },
      ),
    );
  }

  /**
   * markStrongInsight —— 虚拟隔离的接口层门（F03，V3/I-28）。
   * ⚠ 接口层拒绝，不是前端按钮置灰：直接调这个路由绕过前端仍被拒。
   */
  @Post("/interviews/insights/:insightId/mark-strong")
  async markStrong(
    @CurrentPrincipal() principal: Principal,
    @Param("insightId") insightId: string,
    @Body(new ZodBodyPipe(C.operations.markStrongInsight.in))
    _body: z.infer<typeof C.operations.markStrongInsight.in>,
  ) {
    assertPrincipal(principal);
    return this.run(() =>
      markStrongInsight({ insights: this.insights }, { orgId: principal.orgId, insightId }),
    );
  }

  /**
   * referenceForDecision —— 同一道虚拟隔离门（F03，V3/I-28）。
   */
  @Post("/interviews/insights/:insightId/decision-reference")
  async referenceForDecision(
    @CurrentPrincipal() principal: Principal,
    @Param("insightId") insightId: string,
    @Body(new ZodBodyPipe(C.operations.referenceForDecision.in))
    body: z.infer<typeof C.operations.referenceForDecision.in>,
  ) {
    assertPrincipal(principal);
    return this.run(() =>
      referenceForDecision(
        { insights: this.insights },
        { orgId: principal.orgId, insightId, decisionId: body.decisionId },
      ),
    );
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof NoInterviewAccessError) throw new NotFoundException();
      if (e instanceof InsightNoEvidenceError) throw new ConflictException({ reasonCode: "INSIGHT_NO_EVIDENCE" });
      if (e instanceof InsightCandidateNotFoundError) throw new ConflictException({ reasonCode: "CONCURRENT_MODIFICATION" });
      if (e instanceof InsightGenerationUnavailableError) {
        throw new ServiceUnavailableException({ reasonCode: "AI_GENERATION_UNAVAILABLE" });
      }
      if (e instanceof InsightDependencyUnavailableError) {
        throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
      }
      if (e instanceof VirtualSourceForbiddenError) {
        throw new ForbiddenException({ reasonCode: "VIRTUAL_SOURCE_FORBIDDEN" });
      }
      throw e;
    }
  }
}
