import {z} from 'zod';
import {NativeSessionResolveInput} from './native-session-binding';

export const STANDARD_ARTIFACT_DOWNLOAD_TOOL='wx_artifact_download' as const;
export const ArtifactDownloadInput=z.object({
 artifactId:z.string().min(1).max(256),versionId:z.string().min(1).max(256),purpose:z.enum(['download','export']),
}).strict();
export const ArtifactDownloadOutput=z.object({
 downloadRef:z.string().url(),expiresAt:z.string().datetime(),
 artifactVersion:z.object({artifactId:z.string(),versionId:z.string()}).strict(),
}).strict();
const identity=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const StandardArtifactDownloadInvocation=identity.extend({toolName:z.literal(STANDARD_ARTIFACT_DOWNLOAD_TOOL),toolArgs:ArtifactDownloadInput}).strict();
