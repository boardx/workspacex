import {describe,expect,it} from 'vitest';
import {ArtifactDownloadInput,ArtifactDownloadOutput,StandardArtifactDownloadInvocation} from '../src/standard-artifact-download';
describe('WX-T021 contract',()=>{it('accepts only explicit artifact/version and trusted envelope',()=>{
 expect(ArtifactDownloadInput.safeParse({artifactId:'a',versionId:'v',purpose:'download'}).success).toBe(true);
 expect(ArtifactDownloadInput.safeParse({artifactId:'a',versionId:'v',purpose:'download',userId:'forged'}).success).toBe(false);
 expect(StandardArtifactDownloadInvocation.safeParse({orgId:'o',attemptId:'r:0',leaseEpoch:1,toolCallId:'c',toolName:'wx_artifact_download',toolArgs:{artifactId:'a',versionId:'v',purpose:'download'}}).success).toBe(true);
 expect(ArtifactDownloadOutput.safeParse({downloadRef:'https://download.example/t',expiresAt:new Date().toISOString(),artifactVersion:{artifactId:'a',versionId:'v'}}).success).toBe(true);
});});
