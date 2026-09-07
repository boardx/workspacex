import type {OrgId} from '../../domain/org-id';
import type {PermissionDecision} from '../../domain/identity/permission-decision';
import type {DeliverableVersion} from './download-ports';
export const AGENT_ARTIFACT_DELIVERY_SOURCE=Symbol('AgentArtifactDeliverySource');
/** Null only for a version outside the Agent artifact domain; known but unavailable sources throw. */
export interface AgentArtifactDeliverySource {
 resolve(input:{orgId:OrgId;userId:string;versionId:string;artifactId?:string}):Promise<{version:DeliverableVersion;decision:PermissionDecision}|null>;
 readBytes(objectKey:string):Promise<Uint8Array|null>;
}
