import {ArtifactDownloadOutput,type StandardArtifactDownloadInvocation} from '@repo/contracts/standard-artifact-download';
import type {z} from 'zod';
import {issueDownloadUrl,type DeliveryDeps} from '../files/deliver-artifact';
import type {OrgId} from '../../domain/org-id';

export const STANDARD_ARTIFACT_DOWNLOAD=Symbol('StandardArtifactDownload');
export class StandardArtifactDownloadService{
 constructor(private readonly delivery:DeliveryDeps,private readonly issue:typeof issueDownloadUrl=issueDownloadUrl){}
 async invoke(actor:{orgId:OrgId;userId:string},input:z.infer<typeof StandardArtifactDownloadInvocation>['toolArgs']){
  const issued=await this.issue(this.delivery,{...actor,artifactId:input.artifactId,versionId:input.versionId,purpose:input.purpose});
  return ArtifactDownloadOutput.parse({downloadRef:issued.url,expiresAt:issued.expiresAt,artifactVersion:{artifactId:input.artifactId,versionId:input.versionId}});
 }
}
