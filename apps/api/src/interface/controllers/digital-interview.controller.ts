import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import { interview as C } from "@repo/contracts";
import type { z } from "zod";
import {
  DIGITAL_INTERVIEW_REPOSITORY,
  DIGITAL_EXPERT_CONTEXT_API,
  type DigitalExpertContextApi,
  type DigitalInterviewRepository,
} from "../../application/interview/digital-interview-ports";
import {
  listDigitalExperts,
  listDigitalInterviews,
} from "../../application/interview/list-digital-interviews";
import type { DigitalInterviewStatusName } from "../../domain/interview/digital-interview";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { INTERVIEW_SCOPE_REPOSITORY, type InterviewScopeRepository } from "../../application/interview/ports";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import { PUBLISHED_AGENT_READER, type PublishedAgentReader } from "../../application/chat/message-command-ports";
import { AGENT_RUN_STORE, MODEL_CALL_PORT, type AgentRunStore, type ModelCallPort } from "../../application/agent-run/ports";
import { appendQuick, convertQuick, getQuick, startQuick } from "../../application/interview/quick-digital-interview";
import {
  DigitalInterviewConcurrentModificationError,
  DigitalInterviewDependencyUnavailableError,
  DigitalInterviewPermissionRevokedMidwayError,
  NoInterviewAccessError,
} from "../../application/interview/errors";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { toOrgId } from "../../domain/org-id";
import {
  DIGITAL_INTERVIEW_RUNTIME,
  DigitalInterviewWorkflowError,
  type DigitalInterviewRuntime,
} from "../../application/interview/workflow/digital-interview-runtime.port";

@Controller("/interviews/digital")
export class DigitalInterviewController {
  constructor(
    @Inject(DIGITAL_INTERVIEW_REPOSITORY) private readonly repo: DigitalInterviewRepository,
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly scope: InterviewScopeRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
    @Inject(PUBLISHED_AGENT_READER) private readonly agents: PublishedAgentReader,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(MODEL_CALL_PORT) private readonly model: ModelCallPort,
    @Inject(DIGITAL_EXPERT_CONTEXT_API) private readonly context: DigitalExpertContextApi,
    @Inject(DIGITAL_INTERVIEW_RUNTIME) private readonly workflow: DigitalInterviewRuntime,
  ) {}

  private deps() { return { repo:this.repo, ids:this.ids, agents:this.agents, runs:this.runs, model:this.model, scope:this.scope, decisions:this.decisions, context:this.context }; }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new BadRequestException();
    return parsed.data;
  }

  private withPath(body: unknown, path: Readonly<Record<string, string>>): unknown {
    return { ...(body !== null && typeof body === "object" ? body : {}), ...path };
  }

  @Post()
  async createDraft(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.createDigitalInterviewDraft.in))
    body: z.infer<typeof C.operations.createDigitalInterviewDraft.in>,
  ) {
    assertPrincipal(principal);
    try {
      return C.operations.createDigitalInterviewDraft.out.parse(
        await this.workflow.createDraft({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...body }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/:interviewId/topic/confirm")
  async confirmTopic(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(C.operations.confirmDigitalInterviewTopic.in, this.withPath(body, { interviewId }));
    try {
      return C.operations.confirmDigitalInterviewTopic.out.parse(
        await this.workflow.confirmTopic({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/:interviewId/experts/confirm")
  async confirmExperts(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(C.operations.confirmDigitalInterviewExperts.in, this.withPath(body, { interviewId }));
    try {
      return C.operations.confirmDigitalInterviewExperts.out.parse(
        await this.workflow.confirmExperts({
          orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input,
          addedExperts: input.addedExperts ?? [],
        }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/:interviewId/questions/confirm")
  async confirmQuestions(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(C.operations.confirmDigitalInterviewQuestions.in, this.withPath(body, { interviewId }));
    try {
      return C.operations.confirmDigitalInterviewQuestions.out.parse(
        await this.workflow.confirmQuestions({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/:interviewId/report/generate")
  async generateReport(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(C.operations.generateDigitalInterviewReport.in, this.withPath(body, { interviewId }));
    try {
      return C.operations.generateDigitalInterviewReport.out.parse(
        await this.workflow.generateReport({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  /**
   * Additive streaming transport for F06. Each frame is a complete recovery view that was
   * already committed before it is written, so the client never observes an unresumable
   * optimistic fragment.
   */
  @Post("/:interviewId/report/generate/stream")
  async generateReportStream(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    assertPrincipal(principal);
    const input = this.parse(C.operations.generateDigitalInterviewReport.in, this.withPath(body, { interviewId }));
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (type: "progress" | "complete" | "error", value: unknown): void => {
      if (!response.writableEnded && !response.destroyed) response.write(`${JSON.stringify({ type, value })}\n`);
    };
    try {
      const workflow = await this.workflow.generateReport(
        { orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input },
        async (progress) => write("progress", C.DigitalInterviewWorkflowView.parse(progress)),
      );
      write("complete", C.DigitalInterviewWorkflowView.parse(workflow));
    } catch (error) {
      write("error", { reasonCode: error instanceof DigitalInterviewWorkflowError ? error.code : "DEPENDENCY_UNAVAILABLE" });
    } finally {
      if (!response.writableEnded && !response.destroyed) response.end();
    }
  }

  /** Reconnect-only stream. It never starts a second model call. */
  @Get("/:interviewId/report/stream")
  async observeReportStream(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Res() response: Response,
  ): Promise<void> {
    assertPrincipal(principal);
    const actor = { orgId: toOrgId(principal.orgId), actorId: principal.userId, interviewId };
    let workflow = await this.workflow.get(actor);
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let lastUpdatedAt = "";
    while (!response.destroyed) {
      const updatedAt = workflow.reportGeneration?.updatedAt ?? workflow.report?.generatedAt ?? "";
      if (updatedAt !== lastUpdatedAt) {
        response.write(`${JSON.stringify({ type: workflow.report ? "complete" : "progress", value: C.DigitalInterviewWorkflowView.parse(workflow) })}\n`);
        lastUpdatedAt = updatedAt;
      }
      if (workflow.report || workflow.reportGeneration?.status === "failed" || !workflow.reportGeneration) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      workflow = await this.workflow.get(actor);
    }
    if (!response.writableEnded && !response.destroyed) response.end();
  }

  @Post("/:interviewId/skill/messages")
  async appendSkillMessage(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(C.operations.appendDigitalInterviewSkillMessage.in, this.withPath(body, { interviewId }));
    try {
      return C.operations.appendDigitalInterviewSkillMessage.out.parse(
        await this.workflow.appendSkillMessage({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/:interviewId/skill/proposals/:proposalId/apply")
  async applySkillProposal(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Param("proposalId") proposalId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(
      C.operations.applyDigitalInterviewSkillProposal.in,
      this.withPath(body, { interviewId, proposalId }),
    );
    try {
      return C.operations.applyDigitalInterviewSkillProposal.out.parse(
        await this.workflow.applySkillProposal({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/:interviewId/skill/proposals/:proposalId/reject")
  async rejectSkillProposal(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
    @Param("proposalId") proposalId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const input = this.parse(
      C.operations.rejectDigitalInterviewSkillProposal.in,
      this.withPath(body, { interviewId, proposalId }),
    );
    try {
      return C.operations.rejectDigitalInterviewSkillProposal.out.parse(
        await this.workflow.rejectSkillProposal({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }

  @Post("/quick")
  async start(@CurrentPrincipal() principal: Principal, @Body(new ZodBodyPipe(C.operations.startQuickDigitalInterview.in)) body: {expertId:string;requestId:string}) {
    assertPrincipal(principal); try { return await startQuick(this.deps(),{orgId:toOrgId(principal.orgId),actorId:principal.userId,...body}); } catch(e){ return this.translate(e); }
  }

  @Get("/quick/:interviewId")
  async quick(@CurrentPrincipal() principal: Principal,@Param("interviewId") interviewId:string) {
    assertPrincipal(principal); try { return await getQuick(this.deps(),{orgId:toOrgId(principal.orgId),actorId:principal.userId,interviewId}); } catch(e){ return this.translate(e); }
  }

  @Post("/quick/:interviewId/messages")
  async message(@CurrentPrincipal() principal:Principal,@Param("interviewId") interviewId:string,@Body(new ZodBodyPipe(C.operations.appendQuickDigitalInterviewMessage.in)) body:{interviewId:string;text:string;expectedVersion:number}) {
    assertPrincipal(principal); try{return await appendQuick(this.deps(),{orgId:toOrgId(principal.orgId),actorId:principal.userId,interviewId,text:body.text,expectedVersion:body.expectedVersion});}catch(e){return this.translate(e);}
  }

  @Post("/quick/:interviewId/convert")
  async convert(@CurrentPrincipal() principal:Principal,@Param("interviewId") interviewId:string,@Body(new ZodBodyPipe(C.operations.convertQuickInterviewToBatch.in)) body:{interviewId:string;expectedVersion:number;name:string;tags:string[];topic:string}) {
    assertPrincipal(principal); try{return await convertQuick(this.deps(),{orgId:toOrgId(principal.orgId),actorId:principal.userId,interviewId,expectedVersion:body.expectedVersion,name:body.name,tags:body.tags,topic:body.topic});}catch(e){return this.translate(e);}
  }

  private translate(error:unknown):never {
    if(error instanceof DigitalInterviewWorkflowError) {
      if(error.code === "NO_INTERVIEW_ACCESS") throw new NotFoundException();
      if(error.code === "DEPENDENCY_UNAVAILABLE" || error.code === "AI_GENERATION_UNAVAILABLE") throw new ServiceUnavailableException({reasonCode:error.code});
      if(error.code === "DIGITAL_INTERVIEW_INPUT_INVALID") throw new BadRequestException({reasonCode:error.code});
      throw new ConflictException({reasonCode:error.code});
    }
    if(error instanceof NoInterviewAccessError) throw new NotFoundException();
    if(error instanceof DigitalInterviewConcurrentModificationError) throw new ConflictException({reasonCode:"CONCURRENT_MODIFICATION"});
    if(error instanceof DigitalInterviewDependencyUnavailableError) throw new ServiceUnavailableException({reasonCode:"DEPENDENCY_UNAVAILABLE"});
    if(error instanceof DigitalInterviewPermissionRevokedMidwayError) throw new ConflictException({reasonCode:"PERMISSION_REVOKED_MIDWAY"});
    throw error;
  }

  @Get("/experts")
  async experts(
    @CurrentPrincipal() principal: Principal,
    @Query("domain") domain?: string,
  ) {
    assertPrincipal(principal);
    const parsed = C.operations.listDigitalExperts.in.safeParse({
      ...(domain === undefined || domain === "" ? {} : { domain }),
    });
    if (!parsed.success) throw new BadRequestException();
    return listDigitalExperts(this.repo, {
      orgId: principal.orgId,
      viewerUserId: principal.userId,
      ...parsed.data,
    });
  }

  @Get()
  async history(
    @CurrentPrincipal() principal: Principal,
    @Query("status") status?: string,
  ) {
    assertPrincipal(principal);
    const parsed = C.operations.listDigitalInterviews.in.safeParse({
      ...(status === undefined || status === "" ? {} : { status }),
    });
    if (!parsed.success) throw new BadRequestException();
    return listDigitalInterviews({ repo: this.repo, scope: this.scope, decisions: this.decisions }, {
      orgId: principal.orgId,
      viewerUserId: principal.userId,
      ...(parsed.data.status === undefined ? {} : {
        status: parsed.data.status as DigitalInterviewStatusName,
      }),
    });
  }

  @Get("/:interviewId")
  async getWorkflow(
    @CurrentPrincipal() principal: Principal,
    @Param("interviewId") interviewId: string,
  ) {
    assertPrincipal(principal);
    const input = this.parse(C.operations.getDigitalInterview.in, { interviewId });
    try {
      return C.operations.getDigitalInterview.out.parse(
        await this.workflow.get({ orgId: toOrgId(principal.orgId), actorId: principal.userId, ...input }),
      );
    } catch (error) {
      return this.translate(error);
    }
  }
}
