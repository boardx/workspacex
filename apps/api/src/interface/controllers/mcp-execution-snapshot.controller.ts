import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,BadRequestException,UnauthorizedException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {McpInvokeInput,McpReviewInput,McpIsolationInput} from '@repo/contracts/mcp-execution-snapshot';
import {MCP_EXECUTION_SNAPSHOT,type McpExecutionSnapshot} from '../../application/agent-run/mcp-execution-snapshot';
import {McpReviewRejectedError} from '../../application/mcp/review-mcp-server';
import {assertPrincipal,type Principal} from '../../domain/principal';
import {CurrentPrincipal} from '../current-principal.decorator';
import {Public} from '../public.decorator';
@Controller()
export class McpExecutionSnapshotController {
 constructor(@Inject(MCP_EXECUTION_SNAPSHOT) private readonly snapshots:McpExecutionSnapshot){}
 @Post('/mcp-servers/:serverId/review') @HttpCode(200)
 async review(@CurrentPrincipal() principal:Principal,@Param('serverId') serverId:string,@Body() body:unknown){
  assertPrincipal(principal);
  const parsed=McpReviewInput.safeParse(body);
  if(!parsed.success||parsed.data.serverId!==serverId)throw new BadRequestException('mcp_review_invalid');
  try{return await this.snapshots.review(principal.orgId,principal.userId,parsed.data);}
  catch(error){if(error instanceof McpReviewRejectedError)throw new ForbiddenException({reasonCode:error.reason});throw new ForbiddenException('mcp_review_refused');}
 }
 @Post('/mcp-servers/:serverId/isolate') @HttpCode(200)
 async isolate(@CurrentPrincipal() principal:Principal,@Param('serverId') serverId:string,@Body() body:unknown){
  assertPrincipal(principal);const parsed=McpIsolationInput.safeParse(body);
  if(!parsed.success||parsed.data.serverId!==serverId)throw new BadRequestException('mcp_isolation_invalid');
  try{return await this.snapshots.isolate(principal.orgId,principal.userId,parsed.data);}catch{throw new ForbiddenException('mcp_isolation_refused');}
 }
 @Get('/mcp-servers/:serverId/isolation-requests/:requestId')
 async isolationStatus(@CurrentPrincipal() principal:Principal,@Param('serverId') serverId:string,@Param('requestId') requestId:string){
  assertPrincipal(principal);
  try{return await this.snapshots.isolationStatus(principal.orgId,principal.userId,serverId,requestId);}catch{throw new ForbiddenException('mcp_isolation_refused');}
 }
 @Public() @Post('/internal/agent-runs/:runId/mcp/invoke') @HttpCode(200)
 async invoke(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=McpInvokeInput.safeParse(body);if(!parsed.success)throw new BadRequestException('mcp_input_invalid');
  try{return await this.snapshots.invoke(runId,parsed.data);}
  catch{throw new ServiceUnavailableException('mcp_execution_unavailable_or_unconfirmed');}
 }
}
