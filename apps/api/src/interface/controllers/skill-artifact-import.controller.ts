import {Body,Controller,Post,Inject,Res,ForbiddenException,NotFoundException,UnprocessableEntityException,ConflictException} from '@nestjs/common';
import type {Response} from 'express';
import {SkillArtifactImportInput} from '@repo/contracts/standard-skill-draft';
import {wave2Runtime} from '@repo/contracts';
import {importSkillArtifact,SKILL_ARTIFACT_IMPORT_DEPS,type SkillArtifactImportDeps} from '../../application/skill-import/import-skill-artifact';
import {SkillStarterImportAdminRequiredError,SkillStarterPackConflictError,SkillStarterImportIdempotencyConflictError} from '../../application/skill-import/import-skill-starter-pack';
import {ArtifactNotFoundError,ArtifactNotVisibleError} from '../../application/artifacts-steering/errors';
import {CurrentPrincipal} from '../current-principal.decorator';
import {assertPrincipal,type Principal} from '../../domain/principal';
import {ZodBodyPipe} from '../pipes/zod-body.pipe';
import type {z} from 'zod';
@Controller()
export class SkillArtifactImportController{
 constructor(@Inject(SKILL_ARTIFACT_IMPORT_DEPS) private deps:SkillArtifactImportDeps){}
 @Post('/admin/skills/artifact-imports')
 async import(@CurrentPrincipal() principal:Principal,@Body(new ZodBodyPipe(SkillArtifactImportInput)) input:z.infer<typeof SkillArtifactImportInput>,@Res({passthrough:true}) response:Response){
  assertPrincipal(principal);
  try{const result=await importSkillArtifact(this.deps,{orgId:principal.orgId,userId:principal.userId},input);response.status(result.created?201:200);return wave2Runtime.SkillStarterImportResult.parse(result.result);}
  catch(e){if(e instanceof SkillStarterImportAdminRequiredError)throw new ForbiddenException({reasonCode:'SKILL_STARTER_IMPORT_ADMIN_REQUIRED'});
   if(e instanceof ArtifactNotFoundError||e instanceof ArtifactNotVisibleError)throw new NotFoundException({reasonCode:'SKILL_ARTIFACT_NOT_VISIBLE'});
   if(e instanceof SkillStarterPackConflictError||e instanceof SkillStarterImportIdempotencyConflictError)throw new ConflictException({reasonCode:'SKILL_STARTER_IMPORT_CONFLICT'});
   throw new UnprocessableEntityException({reasonCode:'SKILL_ARTIFACT_INVALID'});
  }
 }
}
