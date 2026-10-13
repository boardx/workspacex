import { DECISION_ID_FACTORY,type DecisionIdFactory } from '../../application/identity/ports';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { CreateInterviewCustomExpert } from '@repo/contracts/interview-expert-library';
import { INTERVIEW_CUSTOM_EXPERT_LIBRARY, ExpertLibraryAccessError, ExpertLibraryConflictError, createCustomExpert, listCustomExperts, type InterviewCustomExpertLibrary } from '../../application/interview/custom-expert-library';
import { INTERVIEW_SCOPE_REPOSITORY, type InterviewScopeRepository } from '../../application/interview/ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { toOrgId } from '../../domain/org-id';
import { CurrentPrincipal } from '../current-principal.decorator';
@Controller('/interviews/digital/expert-library')
export class InterviewExpertLibraryController {
 constructor(@Inject(INTERVIEW_CUSTOM_EXPERT_LIBRARY)private readonly repo:InterviewCustomExpertLibrary,@Inject(INTERVIEW_SCOPE_REPOSITORY)private readonly scope:InterviewScopeRepository,@Inject(DECISION_ID_FACTORY)private readonly decisions:DecisionIdFactory){}
 private actor(principal:Principal){assertPrincipal(principal);return {orgId:toOrgId(principal.orgId),actorId:principal.userId};}
 private fail(error:unknown):never{if(error instanceof ExpertLibraryAccessError)throw new NotFoundException();if(error instanceof ExpertLibraryConflictError)throw new ConflictException({reasonCode:'IDEMPOTENCY_KEY_REUSED'});throw error;}
 @Get() async list(@CurrentPrincipal()principal:Principal){try{return await listCustomExperts({scope:this.scope,repo:this.repo,decisions:this.decisions},this.actor(principal));}catch(error){this.fail(error);}}
 @Post() async create(@CurrentPrincipal()principal:Principal,@Body()body:unknown){
  const input=CreateInterviewCustomExpert.safeParse(body);if(!input.success)throw new BadRequestException();
  try{const actor=this.actor(principal);return await createCustomExpert({scope:this.scope,repo:this.repo,decisions:this.decisions},actor,input.data);}catch(error){this.fail(error);}
 }
}
