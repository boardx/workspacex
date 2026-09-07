import {BadRequestException,Body,Controller,HttpCode,Inject,NotFoundException,Param,Post,ServiceUnavailableException} from '@nestjs/common';
import {ArtifactIndexingRequest,ArtifactIndexingResult,ArtifactIndexVersionId} from '@repo/contracts/retrieval-indexing';
import {ARTIFACT_INDEXING_SERVICE,ArtifactIndexDenied,ArtifactIndexingService} from '../../application/retrieval/request-artifact-index';
import {assertPrincipal,type Principal} from '../../domain/principal';
import {toOrgId} from '../../domain/org-id';
import {CurrentPrincipal} from '../current-principal.decorator';
@Controller()
export class ArtifactIndexingController {
 constructor(@Inject(ARTIFACT_INDEXING_SERVICE)private service:ArtifactIndexingService){}
 @Post('/artifact-versions/:versionId/index') @HttpCode(200)
 async index(@CurrentPrincipal()principal:Principal,@Param('versionId')versionId:string,@Body()body:unknown){
  assertPrincipal(principal);
  if(!ArtifactIndexVersionId.safeParse(versionId).success||!ArtifactIndexingRequest.safeParse(body??{}).success)throw new BadRequestException('invalid_artifact_index_request');
  try{return ArtifactIndexingResult.parse(await this.service.request(toOrgId(principal.orgId),principal.userId,versionId));}
  catch(error){if(error instanceof ArtifactIndexDenied)throw new NotFoundException();throw new ServiceUnavailableException('artifact_index_unavailable');}
 }
}
