import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query, ServiceUnavailableException } from "@nestjs/common";
import { interview as C } from "@repo/contracts";
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
  ) {}

  private deps() { return { repo:this.repo, ids:this.ids, agents:this.agents, runs:this.runs, model:this.model, scope:this.scope, decisions:this.decisions, context:this.context }; }

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
}
