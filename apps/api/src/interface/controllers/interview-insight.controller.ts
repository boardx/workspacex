/**
 * 洞察写路径的三条路由（F01，uc-6-5 R3 step1-3）。协议适配 only。
 *
 *   404  NO_INTERVIEW_ACCESS               无权/不存在（extractQuotes）。
 *   409  INSIGHT_NO_EVIDENCE               候选/确认阶段缺证据（I-29）。
 *   409  CONCURRENT_MODIFICATION           candidateId 已确认/不存在。
 *   503  AI_GENERATION_UNAVAILABLE         归纳服务失败，已抽引述保留（E1）。
 *   503  DEPENDENCY_UNAVAILABLE            Context Pack 不可读。
 */
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, ServiceUnavailableException, ConflictException } from "@nestjs/common";
import { interview as C } from "@repo/contracts";
import type { z } from "zod";
import { extractQuotes } from "../../application/interview/extract-quotes";
import { generateCandidateInsights } from "../../application/interview/generate-candidate-insights";
import { confirmInsight } from "../../application/interview/confirm-insight";
import { getEvidenceMatrix } from "../../application/interview/get-evidence-matrix";
import {
  InsightCandidateNotFoundError,
  InsightDependencyUnavailableError,
  InsightGenerationUnavailableError,
  InsightNoEvidenceError,
  NoInterviewAccessError,
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
import {
  EVIDENCE_MATRIX_READER,
  PROJECT_ROLE_READER,
  type EvidenceMatrixReader,
  type ProjectRoleReader,
} from "../../application/interview/evidence-matrix-ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const GET_EVIDENCE_MATRIX_SCHEMA = C.operations.getEvidenceMatrix.in;

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
    @Inject(EVIDENCE_MATRIX_READER) private readonly evidence: EvidenceMatrixReader,
    @Inject(PROJECT_ROLE_READER) private readonly projectRole: ProjectRoleReader,
  ) {}

  /**
   * 证据矩阵读路径（F02）。GET，入参同 `interview-scope.controller.ts` 的既有先例——
   * 契约的 `in` 应用在**拼装出来的参数对象**上，不因为是 GET 就跳过校验。
   */
  @Get("/interviews/evidence-matrix")
  async evidenceMatrix(
    @CurrentPrincipal() principal: Principal,
    @Query("scopeKind") scopeKind?: string,
    @Query("projectId") projectId?: string,
    @Query("researchProjectId") researchProjectId?: string,
  ) {
    assertPrincipal(principal);
    const assembled = {
      scope: {
        kind: scopeKind,
        projectId: projectId === undefined || projectId === "" ? null : projectId,
        researchProjectId:
          researchProjectId === undefined || researchProjectId === "" ? null : researchProjectId,
      },
    };
    const input = new ZodBodyPipe(GET_EVIDENCE_MATRIX_SCHEMA).transform(assembled) as z.infer<
      typeof GET_EVIDENCE_MATRIX_SCHEMA
    >;
    return this.run(() =>
      getEvidenceMatrix(
        {
          scope: this.scope,
          decisions: this.decisions,
          evidence: this.evidence,
          projectRole: this.projectRole,
        },
        { orgId: principal.orgId, viewerUserId: principal.userId, scope: input.scope },
      ),
    );
  }

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
      throw e;
    }
  }
}
