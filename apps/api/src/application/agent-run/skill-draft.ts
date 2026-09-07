import {createHash} from 'node:crypto';
import type {z} from 'zod';
import {SkillDraftInput,SkillDraftOutput,SKILL_DRAFT_TOOL,SKILL_DRAFT_LIMITS} from '@repo/contracts/standard-skill-draft';
import {CanonicalBase64,SkillPackagePath} from '@repo/contracts/standard-capabilities';
import {schemas} from '@repo/contracts/sandbox-session';
import {verifySkillStarterPack,sha256} from '../../domain/skill/starter-pack';
import {ObjectExistsError,type ObjectStore} from '../artifact/ports';
import type {NativeSessionOwner,NativeResolved} from './native-session-owner';
import type {ExecutionAuthorityContext,ToolExecutionAuthority} from './tool-execution-authority';
export const SKILL_DRAFT_SERVICE=Symbol('SkillDraftService');
export interface DraftSessionFiles {read(path:string):Promise<unknown>;write(file:{path:string;contentBase64:string}):Promise<unknown>}
export type SkillDraftContext=ExecutionAuthorityContext&{bindingId:string;toolCallId:string};
export interface SkillDraftService {create(context:SkillDraftContext,input:z.infer<typeof SkillDraftInput>):Promise<z.infer<typeof SkillDraftOutput>>}
export class DefaultSkillDraftService implements SkillDraftService {
 constructor(private owner:NativeSessionOwner,private sessions:(bound:NativeResolved)=>DraftSessionFiles,private authority:Pick<ToolExecutionAuthority,'check'>,private objects:ObjectStore){}
 async create(context:SkillDraftContext,raw:z.infer<typeof SkillDraftInput>){
  const input=SkillDraftInput.parse(raw);
  const authorize=async()=>{if(!(await this.authority.check({...context,toolName:SKILL_DRAFT_TOOL,toolArgs:input})).allowed)throw new Error('skill_draft_denied');};
  await authorize();const bound=await this.owner.resolve(context.bindingId,context),session=this.sessions(bound);
  const paths=new Set<string>(),files=[];let total=0;
  for(const item of input.files){
   SkillPackagePath.parse(item.workspacePath.slice('/workspace/'.length));
   if(paths.has(item.packagePath))throw new Error('skill_draft_duplicate_path');paths.add(item.packagePath);
   const file=schemas.file.parse(await session.read(item.workspacePath));CanonicalBase64.parse(file.contentBase64);
   const bytes=Buffer.from(file.contentBase64,'base64');total+=bytes.length;
   if(file.path!==item.workspacePath||file.sizeBytes!==bytes.length||total>SKILL_DRAFT_LIMITS.maxBytes)throw new Error('skill_draft_size_or_path');
   // Current skill storage holds UTF-8 file content. Do not corrupt binary files by re-encoding.
   new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const runtime=item.packagePath.endsWith('.py')?'python':/\.(?:js|mjs|cjs|ts)$/.test(item.packagePath)?'node':null;
   if(runtime&&!input.dependencies.some(d=>d.runtime===runtime))throw new Error('skill_draft_runtime_undeclared');
   files.push({path:item.packagePath,mediaType:item.packagePath.endsWith('.md')?'text/markdown':'text/plain',digest:sha256(bytes),contentBase64:file.contentBase64});
  }
  const entry=files.find(file=>file.path==='SKILL.md');if(!entry)throw new Error('skill_draft_entry_missing');
  const body=Buffer.from(entry.contentBase64,'base64').toString('utf8');
  for(const match of body.matchAll(/(?:scripts|references|assets)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]/g))if(!paths.has(match[0]))throw new Error('skill_draft_reference_missing');
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const metadata={description:input.description,inputSchema:input.inputSchema,outputSchema:input.outputSchema,dependencies:input.dependencies,draftInputDigest:sha256(JSON.stringify(input)),origin:'user_draft',risk_level:'L2'};
  const packId=`draft-${sha256(JSON.stringify([context.orgId,context.parentRunId,context.toolCallId])).slice(0,48)}`;
  const unsigned={schemaVersion:1,packId,packVersion:input.semanticVersion,skills:[{stableName:input.stableName,name:input.name,semanticVersion:input.semanticVersion,manifest:metadata,files}]};
  const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId,packVersion:input.semanticVersion});
  const data=Buffer.from(JSON.stringify(pack,null,2)+'\n');if(data.length>SKILL_DRAFT_LIMITS.maxBytes)throw new Error('skill_draft_size');
  await authorize();await this.owner.resolve(context.bindingId,context);
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  const key=`skill-draft-artifacts/${hash(context.orgId)}/${hash(context.parentRunId)}/${hash(context.toolCallId)}`;
  try{await this.objects.putOnce(key,data,'application/json');}catch(e){if(!(e instanceof ObjectExistsError))throw e;}
  const saved=await this.objects.get(key);if(!saved||!Buffer.from(saved).equals(data))throw new Error('skill_draft_idempotency_conflict');
  const workspacePath=`/workspace/skill-draft-${hash(context.toolCallId)}.json`;
  await session.write({path:workspacePath,contentBase64:data.toString('base64')});
  const check=schemas.file.parse(await session.read(workspacePath));
  if(check.path!==workspacePath||check.sizeBytes!==data.length||check.contentBase64!==data.toString('base64'))throw new Error('skill_draft_readback_failed');
  await authorize();await this.owner.resolve(context.bindingId,context);
  return SkillDraftOutput.parse({status:'artifact_draft',workspacePath,packId,packVersion:input.semanticVersion,packDigest:pack.packDigest,fileDigest:sha256(data),validationReport:{packageIntegrity:'verified',fileCount:files.length,dependencyExecution:'not_verified',fixtureExecution:'not_run',publication:'admin_import_required'}});
 }
}
