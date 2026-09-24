import { timingSafeEqual } from 'node:crypto';
import { Body,ConflictException,Controller,Get,Headers,HttpCode,Inject,NotFoundException,Param,ParseUUIDPipe,Post,ServiceUnavailableException,UnauthorizedException } from '@nestjs/common';
import * as C from '@repo/contracts/whiteboard-proposal';
import { WHITEBOARD_PROPOSALS,ProposalConflict,type ProposalConflictCode,type WhiteboardProposals } from '../../application/whiteboard/proposal-ports';
import { WhiteboardCollaborationError } from '../../application/whiteboard/collaboration-ports';
import { assertPrincipal,type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';
import { Public } from '../public.decorator';

const PROPOSAL_CONFLICT_MESSAGE = 'Whiteboard proposal conflicts with the current state.';

function safeProposalConflictCode(error: ProposalConflict): ProposalConflictCode {
  switch (error.code) {
    case 'PROPOSAL_TOO_LARGE': return 'PROPOSAL_TOO_LARGE';
    case 'REQUEST_ID_REUSED': return 'REQUEST_ID_REUSED';
    case 'PROPOSAL_LIMIT': return 'PROPOSAL_LIMIT';
    case 'PROPOSAL_ALREADY_DECIDED': return 'PROPOSAL_ALREADY_DECIDED';
    case 'AGENT_RUN_NOT_FOUND': return 'AGENT_RUN_NOT_FOUND';
    default: return 'PROPOSAL_CONFLICT';
  }
}

@Controller('whiteboards/:boardId/proposals')
export class WhiteboardProposalController {
  constructor(@Inject(WHITEBOARD_PROPOSALS)private readonly proposals:WhiteboardProposals){}
  private async result<T>(p:Principal,action:()=>Promise<T|null>):Promise<T>{assertPrincipal(p);try{const result=await action();if(result===null)throw new NotFoundException();return result;}catch(error){if(error instanceof ProposalConflict)throw new ConflictException({reasonCode:safeProposalConflictCode(error),message:PROPOSAL_CONFLICT_MESSAGE});if(error instanceof WhiteboardCollaborationError){if(error.code==='NOT_FOUND')throw new NotFoundException();if(error.code==='VALIDATOR_UNAVAILABLE')throw new ServiceUnavailableException();throw new ConflictException(error.code);}throw error;}}
  @Get()
  async list(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string){return{items:await this.result(p,()=>this.proposals.list(p,b))};}
  @Post()
  create(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Body(new ZodBodyPipe(C.CreateProposal))input:C.CreateProposal){return this.result(p,()=>this.proposals.create(p,b,input));}
  @Post('decisions')
  batchDecide(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Body(new ZodBodyPipe(C.BatchDecision))input:C.BatchDecision){return this.result(p,()=>this.proposals.batchDecide(p,b,input));}
  @Post(':proposalId/accept')
  accept(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Param('proposalId',new ParseUUIDPipe())id:string,@Body(new ZodBodyPipe(C.DecideProposal))input:C.DecideProposal){return this.result(p,()=>this.proposals.decide(p,b,id,'accept',input));}
  @Post(':proposalId/reject')
  reject(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Param('proposalId',new ParseUUIDPipe())id:string,@Body(new ZodBodyPipe(C.DecideProposal))input:C.DecideProposal){return this.result(p,()=>this.proposals.decide(p,b,id,'reject',input));}

}

@Controller()
export class TrustedWhiteboardProposalController {
  constructor(@Inject(WHITEBOARD_PROPOSALS)private readonly proposals:WhiteboardProposals){}
  @Public() @Post('/internal/agent-runs/:runId/whiteboards/:boardId/proposals') @HttpCode(201)
  async createFromAgentRun(@Headers('x-deep-agent-internal-key')key:string|undefined,@Param('runId')runId:string,
    @Param('boardId',new ParseUUIDPipe())boardId:string,@Body(new ZodBodyPipe(C.CreateAgentProposal))body:C.CreateAgentProposal){
    const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
    if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
    const {orgId,...input}=body;
    try{const result=await this.proposals.createFromAgentRun(orgId,runId,boardId,input);if(result===null)throw new NotFoundException();return result;}
    catch(error){if(error instanceof ProposalConflict)throw new ConflictException({reasonCode:safeProposalConflictCode(error),message:PROPOSAL_CONFLICT_MESSAGE});throw error;}
  }
}
