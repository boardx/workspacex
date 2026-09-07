import type {z} from 'zod';
import {SubtaskSpawnInput,SubtaskSpawnOutput,NativeSubtaskContext,NATIVE_SUBTASK_CONTEXT_PREFIX,STANDARD_SUBTASK_TOOL,STANDARD_SUBTASK_LIMITS,parseSubtaskContextRefs} from '@repo/contracts/standard-subtask-tools';
import {KnowledgeReadOutput} from '@repo/contracts/standard-context-tools';
import {resolveVisibility,type ResolveVisibilityDeps} from '../chat/resolve-visibility';
import type {OrgId} from '../../domain/org-id';
import type {AgentRunStore} from './ports';
import type {StandardContextService,TrustedContextActor} from './standard-context-tools';
import type {ExecutionAuthorityContext,ToolExecutionAuthority} from './tool-execution-authority';
import type {NativeSessionOwner} from './native-session-owner';
import type {SubtaskRun,SubtaskRunStore,SubtaskRunExecutorPort} from './subtask-run-queue';
export const STANDARD_SUBTASK_SERVICE=Symbol('StandardSubtaskService');
export const SUBTASK_CONTEXT_RESOLVER=Symbol('SubtaskContextResolver');
export interface SubtaskContextResolver {prepare(orgId:OrgId,run:SubtaskRun):Promise<string|null>}
export type StandardSubtaskContext=ExecutionAuthorityContext&{bindingId:string;toolCallId:string};
export interface StandardSubtaskService {spawn(context:StandardSubtaskContext,input:z.infer<typeof SubtaskSpawnInput>):Promise<z.infer<typeof SubtaskSpawnOutput>>}
/** Existing context reader is the authority for references. The queue stores references,
 * never a copied source body; current permission/version are checked again at execution. */
export class StandardSubtaskContextResolver implements SubtaskContextResolver {
 constructor(private runs:Pick<AgentRunStore,'findRequesterUserId'|'findLocator'>,private visibility:ResolveVisibilityDeps,
  private knowledge:Pick<StandardContextService,'read'>){}
 async actor(orgId:OrgId,parentRunId:string):Promise<TrustedContextActor>{
  if(!this.runs.findRequesterUserId)throw new Error('subtask_actor_unavailable');
  const userId=await this.runs.findRequesterUserId(orgId,parentRunId),locator=await this.runs.findLocator(orgId,parentRunId);
  if(!userId||!locator)throw new Error('subtask_actor_unavailable');
  if((await resolveVisibility(this.visibility,{orgId,userId,...locator})).kind!=='allow')throw new Error('subtask_context_denied');
  return {orgId,userId,...locator};
 }
 async read(orgId:OrgId,parentRunId:string,refs:z.infer<typeof NativeSubtaskContext>['refs']):Promise<string>{
  const actor=await this.actor(orgId,parentRunId);let size=0;const sources=[];
  for(const reference of refs){
   const source=KnowledgeReadOutput.parse(await this.knowledge.read(actor,reference));
   if(source.sourceId!==reference.sourceId||source.sourceVersion!==reference.versionId||source.truncated)throw new Error('subtask_context_incomplete_or_changed');
   size+=Buffer.byteLength(source.content,'utf8');if(size>STANDARD_SUBTASK_LIMITS.maxContextBytes)throw new Error('subtask_context_too_large');
   sources.push(source);
  }
  await this.actor(orgId,parentRunId);
  const serialized=JSON.stringify({sources});
  if(Buffer.byteLength(serialized,'utf8')>STANDARD_SUBTASK_LIMITS.maxContextBytes)throw new Error('subtask_context_too_large');
  return serialized;
 }
 async prepare(orgId:OrgId,run:SubtaskRun):Promise<string|null>{
  if(!run.context?.startsWith(NATIVE_SUBTASK_CONTEXT_PREFIX))return run.context;
  const envelope=NativeSubtaskContext.parse(JSON.parse(run.context.slice(NATIVE_SUBTASK_CONTEXT_PREFIX.length)));
  return this.read(orgId,run.parentRunId,envelope.refs);
 }
}
export class DefaultStandardSubtaskService implements StandardSubtaskService {
 constructor(private owner:Pick<NativeSessionOwner,'resolve'>,private authority:Pick<ToolExecutionAuthority,'check'>,
  private sources:StandardSubtaskContextResolver,private store:SubtaskRunStore,private executor:Pick<SubtaskRunExecutorPort,'kick'>){}
 async spawn(context:StandardSubtaskContext,raw:z.infer<typeof SubtaskSpawnInput>){
  const input=SubtaskSpawnInput.parse(raw),refs=parseSubtaskContextRefs(input.contextRefs);
  const check=async()=>{if(!(await this.authority.check({...context,toolName:STANDARD_SUBTASK_TOOL,toolArgs:input})).allowed)throw new Error('subtask_spawn_denied');await this.owner.resolve(context.bindingId,context);};
  await check();await this.sources.read(context.orgId,context.parentRunId,refs);await check();
  const envelope=NativeSubtaskContext.parse({refs});
  const run=await this.store.enqueue(context.orgId,{parentRunId:context.parentRunId,description:input.description,idempotencyKey:input.idempotencyKey,context:NATIVE_SUBTASK_CONTEXT_PREFIX+JSON.stringify(envelope),...(input.outputFiles?{outputFiles:input.outputFiles}:{})});
  this.executor.kick(context.orgId);
  return SubtaskSpawnOutput.parse({childRunId:run.id,status:run.status==='pending'?'queued':run.status});
 }
}
